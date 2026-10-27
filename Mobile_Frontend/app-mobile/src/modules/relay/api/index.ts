/**
 * Relay module — public facade.
 *
 * The only entry point other modules may use. Everything else lives in
 * `internal/` and must not be imported across modules (enforced by
 * `eslint-plugin-boundaries`).
 */

import type { AppError, Result } from '@core/errors';
import type { RelayAddress } from '../internal/domain/commands';

/**
 * Relay domain types: room-scoped identity ({@link RelayAddress}), slot
 * (1..10), ON/OFF state, command record.
 */
export type {
  RelayAddress,
  RelayIndex,
  RelayState,
  RelayCommand,
} from '../internal/domain/commands';
/**
 * Pure command/topic builders + guards + state topic/payload parsers.
 * Topics: `<prefix>/boards/<boardId>/relays/K<1..10>/set|state`.
 */
export {
  buildRelayAddress,
  buildRelayCommand,
  buildRelaySetTopic,
  buildRelayStateTopic,
  isRelayChannel,
  isRelayIndex,
  isRelayRoomId,
  isRelayState,
  parseRelayChannel,
  parseRelayStatePayload,
  parseRelayStateTopic,
  relayIndexToChannel,
  relayStateSubscriptionTopic,
} from '../internal/domain/commands';
/** zustand ViewModel factory: per-room-slot optimistic state. */
export { createRelayStore } from '../internal/data/relayStore';
/**
 * Composite key helpers for the store (states/pending keyed by
 * `relaySlotKey(roomId, index)` so equal slots in different rooms never
 * alias) + the key/slot types.
 */
export {
  relaySlotKey,
  relayStateOf,
  relayPendingOf,
} from '../internal/data/relayStore';
export type {
  RelaySlotKey,
  RelayStates,
  RelayStore,
} from '../internal/data/relayStore';
/** Default {@link RelayService} implementation (publish + feedback handling). */
export { RelayServiceImpl } from '../internal/services/relayService';

/**
 * Relay service — publishes ON/OFF commands over MQTT (QoS 1, non-retained
 * `set` topics) and tracks state with the acknowledgement timeout.
 */
export interface RelayService {
  /**
   * Publish a relay command
   * (`<prefix>/boards/<boardId>/relays/K<1..10>/set`).
   *
   * @param address - room-scoped relay identity (`{ roomId, index }`).
   * @param state - `'ON'` or `'OFF'`.
   * @returns `ok` when the command was accepted for publishing; `err` with
   *   code `validation` for out-of-contract rooms/slots/states or a second
   *   command while one is already in flight for the address.
   */
  setRelay(address: RelayAddress, state: string): Result<void, AppError>;
}
