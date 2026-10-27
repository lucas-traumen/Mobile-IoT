/**
 * Typed in-process event bus (Observer pattern).
 *
 * Modules communicate through this bus instead of importing each other's
 * internals: `settings` publishes `settings:changed`, `telemetry` publishes
 * `telemetry:received`, `relay` publishes `relay:command` / `relay:feedback`.
 * Event names + payload types are declared in the single {@link EventMap}
 * below so subscribers get compile-time safety.
 */

/** A handler for a specific event type. */
export type EventHandler<E> = (payload: E) => void;

/** Removes the subscription when called. */
export type Unsubscribe = () => void;

/**
 * Event bus contract. Implementations must be safe to call from any module
 * (no async semantics needed — all handlers run synchronously).
 */
export interface EventBus {
  /** Subscribe to an event; returns an unsubscribe function. */
  subscribe<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): Unsubscribe;
  /** Publish an event payload to all current subscribers (sync). */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
}

/** The single event-name → payload-type map used by the whole app. */
export interface EventMap {
  /** Settings persisted and became active (payload: full settings snapshot). */
  'settings:changed': import('@core/events').SettingsSnapshot;
  /** A room-scoped sensor reading was parsed and accepted (payload: reading). */
  'telemetry:received': import('@core/events').SensorTelemetry;
  /** MQTT connection state transitioned (payload: new state). */
  'telemetry:connectionState': import('@core/events').ConnectionState;
  /** A relay command was published (payload: the command). */
  'relay:command': import('@core/events').RelayCommand;
  /** Relay state was received from the device (payload: state). */
  'relay:feedback': import('@core/events').RelayFeedback;
  /**
   * A relay command timed out without an acknowledgement (M13-4): the
   * store already rolled back; the payload carries the attempted state,
   * the pre-command state (`null` = unknown) and the timeout error.
   */
  'relay:commandFailed': import('@core/events').RelayCommandFailure;
  /**
   * Devices registry changed (payload: removed device ids AND the
   * binding-level sensor removals — one projected metric of a surviving
   * legacy multi-capability device — so widgets/ephemeral state can be
   * cleaned without deleting sibling metrics).
   */
  'devices:changed': {
    readonly removedDeviceIds: readonly string[];
    readonly removedBindings: readonly {
      readonly deviceId: string;
      readonly capability: string;
    }[];
  };
  /**
   * Board discovery inventory changed (board-discovery-binding plan):
   * a board's status/fields/relay-slots entry was created or updated. The
   * payload carries the wire board code whose entry changed — consumers
   * pull the full inventory from the devices module's board store.
   */
  'board:changed': import('@core/events').BoardInventoryChange;
  /** Dashboard layout changed (payload: id of the active dashboard). */
  'dashboards:changed': {
    readonly activeId: string;
  };
}
