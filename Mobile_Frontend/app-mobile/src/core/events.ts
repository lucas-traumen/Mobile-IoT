/**
 * Shared event payload types used by {@link EventMap}.
 *
 * These types are deliberately declared in `core` (not in the modules) so the
 * event bus contract can be defined without importing module internals.
 * Modules re-export their own payload types through their `api/` facade.
 */

/** MQTT connection lifecycle states. */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * A validated room-scoped sensor reading (approved room-sensor rework):
 * each wire message on a board's sensor-state topic
 * (`<prefix>/boards/<boardId>/sensors/S<n>/state`) carries exactly
 * ONE finite numeric metric; the descriptor resolves the channel to the
 * semantic `field` and the board id becomes the `roomId` (ADR-022
 * identity). Exact dispatch: only registrations matching BOTH the room and
 * the field consume the value.
 */
export interface SensorTelemetry {
  readonly roomId: string;
  /** Sensor field (capability machine key, e.g. `temperature`). */
  readonly field: string;
  /** The parsed finite metric value. */
  readonly value: number;
}

/**
 * A relay ON/OFF command for one room-scoped slot.
 *
 * Room-scoped protocol: the identity is `{ roomId, index }` with
 * `index` in 1..10 — the same slot number can be used independently in
 * different rooms. The topic routes through
 * `<prefix>/boards/<boardId>/relays/K<index>/set` (the `roomId` carries the
 * board id on the wire).
 */
export interface RelayCommand {
  readonly roomId: string;
  readonly index: import('./constants').RelaySlotIndex;
  readonly state: 'ON' | 'OFF';
}

/**
 * Relay state reported back by the device (the boards state topic
 * `<prefix>/boards/<boardId>/relays/K<index>/state`).
 */
export interface RelayFeedback {
  readonly roomId: string;
  readonly index: import('./constants').RelaySlotIndex;
  readonly state: 'ON' | 'OFF';
}

/**
 * A relay command that timed out (boards-topic-contract-v2, decision
 * M13-4): the `set` command was not acknowledged by a matching
 * `.../relays/K<index>/state` message within `RELAY_COMMAND_TIMEOUT_MS`.
 * The optimistic store value has already been rolled back when this event
 * fires; consumers (DeviceStateSync → SwitchWidget) surface the error and
 * the honest pre-command state (or an unknown state when none was known).
 *
 * `previous` is the pre-command state — `null` when the slot had NO known
 * state before the command (the honest "unknown" is propagated, never an
 * invented OFF).
 */
export interface RelayCommandFailure {
  readonly roomId: string;
  readonly index: import('./constants').RelaySlotIndex;
  readonly attempted: 'ON' | 'OFF';
  readonly previous: 'ON' | 'OFF' | null;
  readonly error: import('./errors').AppError;
}

/**
 * Board discovery change notice (board-discovery-binding plan): the board
 * inventory observed a create/update for the board publishing under
 * `code` on `<prefix>/boards/<code>/...`. The full inventory (status,
 * descriptor) lives in the devices module's board store — this payload
 * only identifies WHAT changed on the wire.
 */
export interface BoardInventoryChange {
  /** The wire board code (MQTT boards segment) whose entry changed. */
  readonly code: string;
}

/** Snapshot of the persisted app settings (no secrets beyond token). */
export interface SettingsSnapshot {
  readonly mqtt: {
    readonly host: string;
    readonly port: number;
    readonly username?: string;
    readonly password?: string;
    readonly prefix: string;
  };
  readonly influx: {
    readonly url: string;
    readonly org: string;
    readonly bucket: string;
    readonly token: string;
  };
  readonly ui: {
    /**
     * Theme preference selected in Settings. Exactly two explicit choices —
     * `'system'` no longer exists (persisted legacy values migrate to
     * `'light'` in the settings module before they reach the app runtime).
     */
    readonly theme: 'light' | 'dark';
  };
  /**
   * Scope of the change that produced this snapshot (user-authorized
   * exceptional fix for the Settings draft-loss defect): `'full'` = the
   * complete persisted settings changed (bootstrap adoption or an explicit
   * full save) — consumers may adopt the snapshot wholesale. `'ui-only'` =
   * ONLY UI preferences changed; the technical fields are identical to the
   * previously persisted settings, so the settings store must preserve any
   * divergent unsaved technical draft instead of replacing it.
   */
  readonly changeScope: 'full' | 'ui-only';
}
