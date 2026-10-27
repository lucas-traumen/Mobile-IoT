/**
 * Telemetry service implementation: connects the MQTT client, validates
 * incoming sensor-state payloads, resolves descriptor channels to semantic
 * fields, updates the store and broadcasts on the event bus
 * (boards-topic-contract-v2).
 */

import type { EventBus } from '@core/eventbus';
import type { ConnectionState } from '@core/events';
import type { Logger } from '@core/logger';
import {
  parseSensorStateTopic,
  sensorStateSubscriptionTopic,
  sensorStateTopicShape,
} from '@core/topics';

import type {
  MqttClientPort,
  MqttConnectionConfig,
} from '../data/mqttClientPort';
import type { TelemetryStore } from '../data/telemetryStore';
import { parseSensorPayload } from '../domain/payloads';
import type { TelemetryService } from '../../api';

/** Bounded replay buffer size (latest value per `{boardId, channel}`). */
const BUFFER_CAP = 128;

/** One buffered unresolved reading (latest per `{boardId, channel}`). */
interface BufferedReading {
  readonly boardId: string;
  readonly channel: string;
  readonly value: number;
}

/**
 * Default {@link TelemetryService} implementation.
 *
 * Owns the MQTT client lifecycle for telemetry: {@link start} connects and
 * subscribes `<prefix>/boards/+/sensors/+/state`; incoming messages are
 * topic/payload-validated (pure parsers + zod) and only valid readings
 * reach the store / event bus.
 *
 * Channel → semantic-field resolution rides the OPTIONAL injected
 * {@link resolveSensorField} port (wired to the devices module's descriptor
 * inventory at the composition root — no telemetry↔devices internal import
 * cycle). A reading whose channel cannot be resolved yet (no descriptor
 * received) is BUFFERED — latest value per `{boardId, channel}`, bounded at
 * {@link BUFFER_CAP} with FIFO eviction — and replayed through the resolver
 * when `board:changed` fires for that board (the inventory upserts BEFORE
 * emitting the event, so the resolver is already updated). This makes
 * retained-message arrival order (descriptor first vs state first)
 * irrelevant for the first emission.
 *
 * Noise discipline: messages that are NOT sensor-state topics (descriptor,
 * status, relay, legacy shapes) are ignored SILENTLY. The service warns ONLY
 * for sensor-SHAPED topics with an invalid channel and for non-numeric
 * payloads on valid sensor topics.
 *
 * Message/state handlers are attached once in the constructor (B1). The
 * client port keeps registered handlers and subscriptions across
 * `disconnect()` (background teardown) and reconnects, so a stop/start
 * cycle never loses the telemetry pipeline.
 */
export class TelemetryServiceImpl implements TelemetryService {
  private readonly client: MqttClientPort;
  private readonly bus: EventBus;
  private readonly logger: Logger;
  private readonly store: TelemetryStore;
  /**
   * Descriptor resolver port (optional, composition-root wired):
   * `{boardId, channel}` → semantic field, or `null` when the channel is
   * not (yet) declared by a descriptor.
   */
  private readonly resolveSensorField:
    | ((boardId: string, channel: string) => string | null)
    | undefined;
  private config: MqttConnectionConfig;
  private running = false;
  /**
   * Bounded replay buffer of unresolved readings — insertion-ordered Map
   * (oldest first), one entry per `{boardId, channel}` key.
   */
  private readonly pending = new Map<string, BufferedReading>();

  constructor(options: {
    client: MqttClientPort;
    bus: EventBus;
    logger: Logger;
    store: TelemetryStore;
    config: MqttConnectionConfig;
    resolveSensorField?: (boardId: string, channel: string) => string | null;
  }) {
    this.client = options.client;
    this.bus = options.bus;
    this.logger = options.logger;
    this.store = options.store;
    this.config = options.config;
    this.resolveSensorField = options.resolveSensorField;
    this.attachHandlers();
  }

  /**
   * Update the broker configuration and reconnect when running.
   * Called by the composition root on `settings:changed`.
   */
  applyConfig(config: MqttConnectionConfig): void {
    this.config = config;
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  /**
   * Connect to the broker and subscribe to
   * `<prefix>/boards/+/sensors/+/state` (boards contract v2; exact dispatch
   * happens in `DeviceStateSync`).
   *
   * Idempotent: repeated calls while running are no-ops. When no host is
   * configured yet (fresh install before the user saves settings) the
   * connection is skipped with a warn log.
   */
  start(): void {
    if (this.running) {
      return;
    }
    if (!this.config.host) {
      this.logger.warn(
        'Telemetry: no broker host configured — configure settings first',
      );
      return;
    }
    this.running = true;
    void this.client.connect(this.config).then(() => {
      this.client.subscribe(sensorStateSubscriptionTopic(this.config.prefix));
    });
  }

  /** Disconnect and reset the connection state to idle. */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.client.disconnect();
    this.store.getState().setConnection('idle');
  }

  private attachHandlers(): void {
    this.client.onMessage(message => {
      this.handleMessage(message);
    });

    this.client.onStateChange((state, errorCode) => {
      this.store.getState().setConnection(state as ConnectionState, errorCode);
      this.bus.emit('telemetry:connectionState', state as ConnectionState);
    });

    // Replay seam (attached ONCE — B1): the board inventory upserts its
    // descriptor BEFORE emitting `board:changed`, so the resolver is
    // already current when this fires.
    this.bus.subscribe('board:changed', event => {
      this.replayBuffered(event.code);
    });
  }

  /**
   * Route one MQTT message: sensor-state topics validate + resolve, every
   * other topic is ignored SILENTLY (no warn — the shared client fans
   * descriptor/status/relay messages through here too).
   */
  private handleMessage(message: { topic: string; payload: string }): void {
    // 1. LENIENT shape match first: anything that is not the exact
    //    `<prefix>/boards/<id>/sensors/<channel>/state` structure is not
    //    ours — drop silently (kills the legacy "Malformed sensor topic"
    //    warn noise from the message fan-out).
    const shape = sensorStateTopicShape(message.topic, this.config.prefix);
    if (!shape) {
      return;
    }
    // 2. Strict channel grammar (the shape matched but the channel may be
    //    `S0`/`S01`/junk — that IS warn-worthy).
    const address = parseSensorStateTopic(message.topic, this.config.prefix);
    if (!address.ok) {
      this.logger.warn(
        `Telemetry: dropped invalid sensor topic: ${address.error.message}`,
      );
      return;
    }
    // 3. Payload: one finite number.
    const value = parseSensorPayload(message.payload);
    if (!value.ok) {
      this.logger.warn(
        `Telemetry: dropped invalid payload: ${value.error.message}`,
      );
      return;
    }
    this.deliver(shape.boardId, shape.channel, value.value);
  }

  /** Resolve + emit a validated reading, or buffer it when unresolved. */
  private deliver(boardId: string, channel: string, value: number): void {
    const field = this.resolveSensorField?.(boardId, channel) ?? null;
    if (field === null) {
      // No descriptor (yet) — keep the latest value per
      // `{boardId, channel}` for replay when the descriptor arrives.
      this.buffer(boardId, channel, value);
      return;
    }
    this.emit(boardId, field, value);
  }

  /** Emit the UNCHANGED semantic event + store reading. */
  private emit(boardId: string, field: string, value: number): void {
    const reading = {
      roomId: boardId,
      field,
      value,
    };
    this.store.getState().applyReading(reading);
    this.bus.emit('telemetry:received', reading);
  }

  /** Buffer one unresolved reading (latest per key, FIFO-capped). */
  private buffer(boardId: string, channel: string, value: number): void {
    const key = `${boardId}/${channel}`;
    // Delete-then-set keeps the Map insertion order = recency order.
    this.pending.delete(key);
    this.pending.set(key, { boardId, channel, value });
    if (this.pending.size > BUFFER_CAP) {
      const oldest = this.pending.keys().next();
      if (!oldest.done) {
        this.pending.delete(oldest.value);
      }
      this.logger.debug(
        `Telemetry: replay buffer full — evicted the oldest unresolved reading`,
      );
    }
  }

  /** Replay every buffered reading of one board through the resolver. */
  private replayBuffered(boardId: string): void {
    for (const [key, entry] of [...this.pending.entries()]) {
      if (entry.boardId !== boardId) {
        continue;
      }
      this.pending.delete(key);
      const field =
        this.resolveSensorField?.(entry.boardId, entry.channel) ?? null;
      if (field === null) {
        // Still unresolved (e.g. the descriptor declares other channels) —
        // keep the buffered value for a later replay.
        this.pending.set(key, entry);
        continue;
      }
      this.emit(entry.boardId, field, entry.value);
    }
  }
}
