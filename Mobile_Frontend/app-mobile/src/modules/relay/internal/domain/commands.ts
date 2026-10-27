/**
 * Relay domain: address/command model + topic/payload builders (pure).
 *
 * Boards topic contract v2 (boards-topic-contract-v2 plan; clean cut — the
 * legacy `<prefix>/room/<roomId>/cmnd|stat/relay/<n>` topics are gone):
 *
 * - command (app → device, QoS 1, NOT retained):
 *   `<prefix>/boards/<boardId>/relays/K<1..10>/set`
 * - state (device → app, the acknowledgement / feedback path):
 *   `<prefix>/boards/<boardId>/relays/K<1..10>/state`
 *
 * The relay identity is the {@link RelayAddress} value object
 * `{ roomId, index }`: `roomId` carries the room's MQTT identity (the board
 * `code` for bound rooms, the internal id for unbound demo rooms) and the
 * same slot number can be used independently in different rooms. The wire
 * channel is the `K<n>` string ({@link relayIndexToChannel} /
 * {@link parseRelayChannel}); the persisted slot model stays numeric 1..10.
 * Out-of-contract slots (0, 11, …) and malformed board ids are rejected at
 * build/parse time.
 *
 * MQTT limitation (documented, accepted): there is NO command correlation id
 * on the wire. Local generations protect timers/concurrency but cannot prove
 * that a late state packet belongs to the newest command.
 */

import { RELAY_INDICES } from '@core/constants';
import { Errors, err, ok, type AppError, type Result } from '@core/errors';

/** Relay slots supported by the hardware contract (1..10). */
export type RelayIndex = (typeof RELAY_INDICES)[number];

/** Relay on/off state. */
export type RelayState = 'ON' | 'OFF';

/**
 * Room-scoped relay address — the relay identity value object carried
 * through devices, commands, topics, events and the runtime store.
 */
export interface RelayAddress {
  readonly roomId: string;
  readonly index: RelayIndex;
}

/** A relay command ready to publish. */
export interface RelayCommand {
  readonly roomId: string;
  readonly index: RelayIndex;
  readonly state: RelayState;
}

/** Guard: true when `value` is a supported relay slot (1..10). */
export function isRelayIndex(value: number): value is RelayIndex {
  return (RELAY_INDICES as readonly number[]).includes(value);
}

/** Guard: true when `value` is a valid relay state string. */
export function isRelayState(value: string): value is RelayState {
  return value === 'ON' || value === 'OFF';
}

/**
 * Guard: true when `roomId` is topic-safe — non-empty and free of MQTT
 * wildcard (`+`, `#`) and separator (`/`) characters.
 */
export function isRelayRoomId(roomId: string): boolean {
  return roomId.length > 0 && !/[/+#]/.test(roomId);
}

/** The wire relay channel grammar: `K` + the decimal slot, `K1`..`K10`. */
const RELAY_CHANNEL_REGEX = /^K([1-9]|10)$/;

/** Guard: true when `channel` is a wire relay channel `K1`..`K10`. */
export function isRelayChannel(channel: string): boolean {
  return RELAY_CHANNEL_REGEX.test(channel);
}

/**
 * Map a wire relay channel (`K1`..`K10`) to its numeric slot 1..10.
 *
 * @returns `ok(slot)` or `err` with code `validation` for channels outside
 *   the contract (`K0`, `K11`, `K01`, non-`K` strings).
 */
export function parseRelayChannel(channel: string): Result<RelayIndex> {
  const match = channel.match(RELAY_CHANNEL_REGEX);
  if (!match) {
    return err(
      Errors.validation(
        `Relay channel must be one of K1..K10 (got "${channel}")`,
      ),
    );
  }
  return ok(Number(match[1]) as RelayIndex);
}

/**
 * Map a numeric slot 1..10 to its wire channel label (`K1`..`K10`).
 *
 * @returns the channel label, or `null` for a slot outside the contract.
 */
export function relayIndexToChannel(index: RelayIndex): string | null {
  return isRelayIndex(index) ? `K${index}` : null;
}

/**
 * Build a validated room-scoped relay address.
 *
 * @param roomId - the room's MQTT identity (topic-safe, non-empty).
 * @param index - relay slot; must be 1..10.
 * @returns `ok(address)` or `err` with code `validation` when the id or
 *   slot is outside the contract.
 */
export function buildRelayAddress(
  roomId: string,
  index: number,
): Result<RelayAddress> {
  if (!isRelayRoomId(roomId)) {
    return err(
      Errors.validation(
        `Relay roomId must be non-empty and free of "/", "+" and "#" (got "${roomId}")`,
      ),
    );
  }
  if (!isRelayIndex(index)) {
    return err(
      Errors.validation(
        `Relay index must be one of ${RELAY_INDICES.join(', ')} (got ${index})`,
      ),
    );
  }
  return ok({ roomId, index });
}

/**
 * Build a validated relay command.
 *
 * @param roomId - the room's MQTT identity (the board id on the wire).
 * @param index - relay slot; must be 1..10.
 * @param state - `'ON'` or `'OFF'`.
 * @returns `ok(command)` or `err` with code `validation`.
 */
export function buildRelayCommand(
  roomId: string,
  index: number,
  state: string,
): Result<RelayCommand> {
  const address = buildRelayAddress(roomId, index);
  if (!address.ok) {
    return address;
  }
  if (!isRelayState(state)) {
    return err(
      Errors.validation(`Relay state must be "ON" or "OFF" (got "${state}")`),
    );
  }
  return ok({ roomId, index: address.value.index, state });
}

/**
 * Build an MQTT topic for a board-scoped relay, validating the address and
 * prefix first.
 *
 * @param prefix - configured topic prefix (e.g. `smarthome`).
 * @param address - room-scoped relay identity (`roomId` = board id).
 * @param suffix - `'set'` for command topics, `'state'` for state topics.
 * @returns `ok(topic)` e.g. `smarthome/boards/board-1/relays/K2/set`, or
 *   `err` with code `validation` when the address/prefix is outside the
 *   contract.
 */
function buildRelayTopic(
  prefix: string,
  address: RelayAddress,
  suffix: 'set' | 'state',
): Result<string, AppError> {
  if (!isRelayRoomId(prefix)) {
    return err(Errors.validation('Relay topic prefix must be topic-safe'));
  }
  const validated = buildRelayAddress(address.roomId, address.index);
  if (!validated.ok) {
    return validated;
  }
  const channel = relayIndexToChannel(validated.value.index);
  if (channel === null) {
    return err(
      Errors.validation(
        `Relay index ${validated.value.index} has no wire channel`,
      ),
    );
  }
  return ok(
    `${prefix}/boards/${validated.value.roomId}/relays/${channel}/${suffix}`,
  );
}

/**
 * Build the MQTT topic for a relay set command (QoS 1, NOT retained).
 *
 * @returns `ok(topic)` e.g. `smarthome/boards/board-1/relays/K1/set`, or
 *   `err` with code `validation` when the address/prefix is outside the
 *   contract.
 */
export function buildRelaySetTopic(
  prefix: string,
  address: RelayAddress,
): Result<string, AppError> {
  return buildRelayTopic(prefix, address, 'set');
}

/**
 * Build the MQTT topic for relay state feedback.
 *
 * @returns `ok(topic)` e.g. `smarthome/boards/board-1/relays/K2/state`, or
 *   `err` with code `validation`.
 */
export function buildRelayStateTopic(
  prefix: string,
  address: RelayAddress,
): Result<string, AppError> {
  return buildRelayTopic(prefix, address, 'state');
}

/**
 * The state subscription topic for ALL board relay channels:
 * `<prefix>/boards/+/relays/+/state`. The `+` wildcards match exactly one
 * level each, so every `{boardId, channel}` state topic matches while
 * foreign structures (e.g. `.../relays/K1/set`) do not.
 */
export function relayStateSubscriptionTopic(prefix: string): string {
  return `${prefix}/boards/+/relays/+/state`;
}

/**
 * Parse a relay state topic into its room-scoped address.
 *
 * The configured prefix is regex-escaped, so state from another
 * device/prefix on the same broker is rejected. The board segment must be
 * non-empty and wildcard-free; the channel must be `K1`..`K10`.
 *
 * @param topic - the received MQTT topic.
 * @param prefix - the configured topic prefix (e.g. `smarthome`).
 * @returns `ok({roomId, index})` or `err` with code `validation`.
 */
export function parseRelayStateTopic(
  topic: string,
  prefix: string,
): Result<RelayAddress> {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `^${escaped}\\/boards\\/([^/+#]+)\\/relays\\/(K(?:[1-9]|10))\\/state$`,
  );
  const match = topic.match(re);
  if (!match) {
    return err(
      Errors.validation(
        `Topic does not match the relay state contract (${prefix}/boards/<boardId>/relays/K<1..10>/state): "${topic}"`,
      ),
    );
  }
  const channel = parseRelayChannel(match[2] ?? '');
  if (!channel.ok) {
    return channel;
  }
  return buildRelayAddress(match[1] ?? '', channel.value);
}

/** Parse a state payload (`"ON"` / `"OFF"`) safely. */
export function parseRelayStatePayload(raw: string): Result<RelayState> {
  const trimmed = raw.trim().toUpperCase();
  if (isRelayState(trimmed)) {
    return ok(trimmed);
  }
  return err(
    Errors.validation(`Relay state must be "ON" or "OFF" (got "${raw}")`),
  );
}
