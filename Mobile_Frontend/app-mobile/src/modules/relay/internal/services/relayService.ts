/**
 * Relay service implementation: validates commands, publishes over MQTT,
 * tracks optimistic state with a command acknowledgement timeout, and
 * consumes device state from the boards state topics
 * (boards-topic-contract-v2, decision M13-4).
 *
 * Boards protocol: commands publish to
 * `<prefix>/boards/<boardId>/relays/K<1..10>/set` (QoS 1, NOT retained) and
 * the device reports state on
 * `<prefix>/boards/<boardId>/relays/K<1..10>/state`. A single wildcard state
 * subscription (`<prefix>/boards/+/relays/+/state`) covers every board and
 * channel, so no re-subscription is needed when rooms/devices change — only
 * when the prefix changes ({@link applyPrefix}).
 *
 * Acknowledgement lifecycle (deterministic via the injected Clock):
 * - `setRelay` captures the pre-command state, publishes the `set` topic,
 *   applies the optimistic state and registers a pending command with a
 *   `RELAY_COMMAND_TIMEOUT_MS` timer. A second command for the SAME address
 *   while one is pending is REJECTED (validation error); different
 *   addresses are independent.
 * - a state message that MATCHES the pending request confirms the command
 *   (store confirm + timer cancelled); a state message that does NOT match
 *   is applied WITHOUT clearing pending (most likely the stale retained
 *   pre-command state — it must not ack the toggle).
 * - on timeout the store rolls back (previous known → restored; previous
 *   unknown → slot key deleted, honest unknown), pending clears and the
 *   typed `relay:commandFailed` event is emitted. `DeviceStateSync` →
 *   `SwitchWidget` surface the error and the restored state.
 *
 * MQTT limitation (documented, accepted): the wire contract has NO command
 * correlation id. The local generation counter protects timers and
 * concurrent local commands, but it cannot prove that a late state packet
 * belongs to the newest command — when no confirmed baseline is known, a
 * stale retained state packet equal to the requested state can ack a
 * command it does not belong to. The implementation must not claim stronger
 * stale-packet guarantees than the wire provides.
 */

import type { EventBus } from '@core/eventbus';
import { Errors, err, ok, type AppError, type Result } from '@core/errors';
import type { Logger } from '@core/logger';
import { RELAY_COMMAND_TIMEOUT_MS } from '@core/constants';
import type { Clock } from '@core/time';

import type { MqttClientPort } from '@modules/telemetry/api';
import {
  buildRelayCommand,
  buildRelaySetTopic,
  parseRelayStatePayload,
  parseRelayStateTopic,
  relayStateSubscriptionTopic,
  type RelayAddress,
  type RelayState,
} from '../domain/commands';
import { relaySlotKey, type RelayStore } from '../data/relayStore';
import type { RelayService } from '../../api';

/** A command awaiting acknowledgement (keyed by `relaySlotKey`). */
interface PendingCommand {
  readonly requested: RelayState;
  /** Pre-command store state; `null` = the slot had no known state. */
  readonly previous: RelayState | null;
  /**
   * Service-level monotonic generation the command was registered under —
   * a fired timer whose generation no longer matches the live pending
   * entry is stale and does nothing.
   */
  readonly generation: number;
  readonly cancelTimer: () => void;
}

/**
 * Default {@link RelayService} implementation.
 *
 * Publishes validated commands over MQTT (QoS 1, non-retained), applies
 * optimistic state, and confirms/rolls back per the boards acknowledgement
 * contract with the deterministic timeout above.
 */
export class RelayServiceImpl implements RelayService {
  private readonly client: MqttClientPort;
  private readonly bus: EventBus;
  private readonly logger: Logger;
  private readonly store: RelayStore;
  private readonly clock: Clock;
  private prefix: string;
  /** In-flight commands keyed by `relaySlotKey(roomId, index)`. */
  private readonly pendingCommands = new Map<string, PendingCommand>();
  /** Monotonic generation for stale-timer protection (no wire correlation id). */
  private generation = 0;

  constructor(options: {
    client: MqttClientPort;
    bus: EventBus;
    logger: Logger;
    store: RelayStore;
    prefix: string;
    /** Deterministic time source (tests inject a FakeClock). */
    clock: Clock;
  }) {
    this.client = options.client;
    this.bus = options.bus;
    this.logger = options.logger;
    this.store = options.store;
    this.clock = options.clock;
    this.prefix = options.prefix;
  }

  /** Update the topic prefix and re-subscribe the state wildcard (B1/M2). */
  applyPrefix(prefix: string): void {
    this.prefix = prefix;
    // Re-subscribe with the new prefix; old subscriptions remain active on
    // the broker until disconnect but will no longer match handleFeedbackMessage.
    this.client.subscribe(relayStateSubscriptionTopic(this.prefix));
  }

  /** Publish a validated relay command and update the store optimistically. */
  setRelay(address: RelayAddress, state: string): Result<void, AppError> {
    const command = buildRelayCommand(address.roomId, address.index, state);
    if (!command.ok) {
      return command;
    }
    const slotKey = relaySlotKey(command.value.roomId, command.value.index);
    if (this.pendingCommands.has(slotKey)) {
      return err(
        Errors.validation(
          `A command is already in flight for this relay (room ${command.value.roomId}, slot ${command.value.index}) — wait for its acknowledgement or timeout`,
        ),
      );
    }
    const topic = buildRelaySetTopic(this.prefix, {
      roomId: command.value.roomId,
      index: command.value.index,
    });
    if (!topic.ok) {
      return topic;
    }
    // Pre-command state captured BEFORE the optimistic write: the raw store
    // map (not `relayStateOf`) so a never-touched slot is `null` (unknown),
    // not an invented 'OFF'.
    const previous = this.store.getState().states[slotKey] ?? null;
    const published = this.client.publish(topic.value, command.value.state);
    if (!published.ok) {
      // M3: do not apply optimistic state when the publish was rejected
      // (e.g. client disconnected). The store keeps its previous state and
      // pending stays false — no stuck optimistic state. Surface the failure
      // to the caller so the UI can show the error.
      this.logger.warn(
        `Relay boards/${command.value.roomId} slot ${command.value.index} → ${command.value.state} rejected: ${published.error.message}`,
      );
      return published;
    }
    this.store
      .getState()
      .setOptimistic(
        { roomId: command.value.roomId, index: command.value.index },
        command.value.state,
      );
    this.bus.emit('relay:command', {
      roomId: command.value.roomId,
      index: command.value.index,
      state: command.value.state,
    });
    // Register the pending command + deterministic timeout (generation-
    // guarded: a fired timer validates against the LIVE pending entry).
    this.generation += 1;
    const generation = this.generation;
    const cancelTimer = this.clock.setTimeout(() => {
      this.handleTimeout(
        { roomId: command.value.roomId, index: command.value.index },
        generation,
      );
    }, RELAY_COMMAND_TIMEOUT_MS);
    this.pendingCommands.set(slotKey, {
      requested: command.value.state,
      previous,
      generation,
      cancelTimer,
    });
    this.logger.info(
      `Relay boards/${command.value.roomId} slot ${command.value.index} → ${command.value.state}`,
    );
    return ok(undefined);
  }

  /**
   * Subscribe to the state MQTT wildcard topic. The acknowledgement logic
   * itself runs in {@link handleFeedbackMessage} (composition-root message
   * fan-out); this method only (re)subscribes the MQTT topic so it is safe
   * to call repeatedly (e.g. after every settings change / reconnect).
   */
  startFeedbackListener(): void {
    this.client.subscribe(relayStateSubscriptionTopic(this.prefix));
  }

  /**
   * Handle an MQTT message that may be relay state
   * (`<prefix>/boards/<boardId>/relays/K<n>/state`). Returns true when the
   * message matched.
   *
   * The topic is matched against the *configured* prefix (regex-escaped, M2)
   * and parsed into the room-scoped address, so state from another
   * device/prefix on the same broker is ignored and equal slots in different
   * rooms stay isolated.
   *
   * Acknowledgement rule (M13-4): a state message confirms the pending
   * command ONLY when it equals the requested state; a non-matching state
   * (likely the stale retained pre-command state) is applied WITHOUT
   * clearing pending. The `relay:feedback` event is ALWAYS emitted so the
   * sync bridge keeps the device state fresh.
   */
  handleFeedbackMessage(message: { topic: string; payload: string }): boolean {
    const address = parseRelayStateTopic(message.topic, this.prefix);
    if (!address.ok) {
      return false;
    }
    const state = parseRelayStatePayload(message.payload);
    if (!state.ok) {
      this.logger.warn(`Relay: ignoring invalid state "${message.payload}"`);
      return true;
    }
    const slotKey = relaySlotKey(address.value.roomId, address.value.index);
    const pending = this.pendingCommands.get(slotKey);
    if (pending) {
      if (pending.requested === state.value) {
        // Matching ack: confirm (state + pending false) and cancel the timer.
        pending.cancelTimer();
        this.pendingCommands.delete(slotKey);
        this.store.getState().confirm(address.value, state.value);
      } else {
        // Non-matching state while pending: apply WITHOUT clearing pending
        // (stale retained pre-command state must not ack the toggle).
        this.store.getState().apply(address.value, state.value);
      }
    } else {
      // No command in flight: keep the store fresh from the device report.
      this.store.getState().apply(address.value, state.value);
    }
    this.bus.emit('relay:feedback', {
      roomId: address.value.roomId,
      index: address.value.index,
      state: state.value,
    });
    return true;
  }

  /**
   * Timeout callback (M13-4): only the LIVE generation rolls back — a stale
   * timer (command already confirmed or replaced) does nothing.
   */
  private handleTimeout(address: RelayAddress, generation: number): void {
    const slotKey = relaySlotKey(address.roomId, address.index);
    const pending = this.pendingCommands.get(slotKey);
    if (!pending || pending.generation !== generation) {
      return; // stale timer callback (confirmed / replaced / already fired)
    }
    this.pendingCommands.delete(slotKey);
    this.store.getState().rollback(address, pending.previous);
    const error = Errors.timeout(
      `Relay command timed out after ${RELAY_COMMAND_TIMEOUT_MS} ms without a matching state message (room ${address.roomId}, slot ${address.index})`,
    );
    this.logger.warn(error.message);
    this.bus.emit('relay:commandFailed', {
      roomId: address.roomId,
      index: address.index,
      attempted: pending.requested,
      previous: pending.previous,
      error,
    });
  }
}
