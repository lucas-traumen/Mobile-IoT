/**
 * Widget services context — the runtime services a widget may use.
 *
 * Widgets never import other modules or core services directly (D8): the app
 * composition root wraps the dashboard tree in a {@link WidgetServicesProvider}
 * with real implementations. A widget receives its services through
 * {@link useWidgetServices} so it stays decoupled and unit-testable.
 *
 * NOTE: only types are defined here for now — CP5 wires the real adapters in
 * the composition root. Widget components must tolerate `undefined` results
 * (no value yet, no history data, no connection).
 */

import React, {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { AppErrorCode, Result } from '@core/errors';
import type { AppError } from '@core/errors';
import type { ConnectionState } from '@core/events';
import type {
  CapabilityDef,
  CapabilityType,
  Device,
  DeviceCapabilityValue,
  Room,
  SeriesPoint,
} from '@modules/devices/api';
import type { HistoryQuery, HistorySeries } from '@modules/history/api';

/**
 * Connection snapshot (state + user-facing label + error cause).
 *
 * The built-in `connection` widget was retired (Phase 1): global MQTT status
 * is shown by the Dashboard header badge, so widgets no longer read it.
 * The type stays here because the dashboard screen maps its telemetry
 * snapshot to this shape.
 */
export interface WidgetConnectionState {
  readonly state: ConnectionState;
  readonly label: string;
  /**
   * Machine-readable cause of the last failed connection (CP5); present only
   * while offline. Widgets map it to a friendly sentence via `errorLabel`.
   */
  readonly errorCode?: AppErrorCode;
}

/** Runtime services exposed to widget components through React context. */
export interface WidgetServices {
  /** Live (or last-known) value for a device capability. */
  getState(
    deviceId: string,
    capability: CapabilityType,
  ): DeviceCapabilityValue | undefined;
  /**
   * Recent timestamped numeric series for a device capability (CP6 sparkline
   * + "so với 1 giờ trước" delta source).
   */
  getSeries(
    deviceId: string,
    capability: CapabilityType,
  ): readonly SeriesPoint[];
  /** Send a boolean command to a device capability (`switch` → relay). */
  sendCommand(
    deviceId: string,
    capability: CapabilityType,
    value: boolean,
  ): Result<void, AppError>;
  /**
   * The last ASYNC command failure message for a device capability
   * (boards-topic-contract-v2, M13-4): the relay acknowledgement timeout
   * surfaces here (set by DeviceStateSync on `relay:commandFailed`,
   * cleared on the next successful command/feedback for the capability).
   * `null` = no failure. The synchronous send-command rejections stay on
   * the `sendCommand` Result — this seam carries the ASYNC path only.
   */
  getCommandError(deviceId: string, capability: CapabilityType): string | null;
  /**
   * Query historical series for a query value object (CP-R5): the widget
   * passes its exact `deviceId + field` so only its own series is fetched.
   */
  queryHistory(query: HistoryQuery): Promise<Result<HistorySeries[], AppError>>;
  /** All rooms (from the devices registry snapshot). */
  getRooms(): readonly Room[];
  /** All devices (from the devices registry snapshot). */
  getDevices(): readonly Device[];
  /** The capability catalog (labels/units/icons/colors per type). */
  getCapabilities(): readonly CapabilityDef[];
  /** The currently active room filter id (`null` = Tất cả). */
  getActiveRoomId(): string | null;
  /**
   * Subscribe to device state changes (CP-R1 reactive seam).
   * Returns an unsubscribe function. Listeners fire on any state change;
   * consumers must use snapshot getters to check identity stability.
   */
  subscribeDeviceState(listener: () => void): () => void;
  /**
   * The LIVE MQTT connection snapshot for the widget layer (scope
   * amendment 2 — offline lock): the switch widgets disable themselves and
   * show the "Không thể điều khiển" caption while the connection is not
   * `'connected'`. The returned object MUST keep a stable identity while
   * the underlying state is unchanged (the `useSyncExternalStore`
   * snapshot contract — the composition root memoizes it).
   */
  getConnectionState(): WidgetConnectionState;
  /**
   * Subscribe to MQTT connection changes (amendment-2 reactive seam).
   * Returns an unsubscribe function; listeners re-read
   * {@link WidgetServices.getConnectionState}.
   */
  subscribeConnection(listener: () => void): () => void;
}

const WidgetServicesContext = createContext<WidgetServices | null>(null);

/**
 * Provide {@link WidgetServices} to the widget tree.
 *
 * @param props.services - the service implementation (wired at the app root).
 */
export function WidgetServicesProvider({
  services,
  children,
}: {
  readonly services: WidgetServices;
  readonly children: ReactNode;
}) {
  return (
    <WidgetServicesContext.Provider value={services}>
      {children}
    </WidgetServicesContext.Provider>
  );
}

/**
 * Access the widget runtime services.
 *
 * @returns the {@link WidgetServices} object.
 * @throws when used outside a {@link WidgetServicesProvider}.
 */
export function useWidgetServices(): WidgetServices {
  const services = useContext(WidgetServicesContext);
  if (!services) {
    throw new Error(
      'useWidgetServices must be used inside a WidgetServicesProvider',
    );
  }
  return services;
}

/**
 * Access the widget runtime services without throwing.
 *
 * @returns the {@link WidgetServices} object, or `null` outside a provider
 *   (callers must tolerate the absence — e.g. edit-mode chrome that renders
 *   widget cards without live services).
 */
export function useOptionalWidgetServices(): WidgetServices | null {
  return useContext(WidgetServicesContext);
}

/** Stable empty series constant to avoid infinite rerenders when no data exists. */
const EMPTY_SERIES: readonly SeriesPoint[] = Object.freeze([]);

/**
 * Reactive hook for a single capability's live value (CP-R1).
 * Uses `useSyncExternalStore` so the component only rerenders when the
 * selected snapshot identity actually changes.
 *
 * @param deviceId - target device id (empty string = disabled/no-op).
 * @param capability - target capability type.
 * @param enabled - when false, returns undefined without subscribing.
 */
export function useCapabilityState(
  deviceId: string,
  capability: CapabilityType,
  enabled = true,
): DeviceCapabilityValue | undefined {
  const services = useWidgetServices();
  const subscribe = React.useCallback(
    (listener: () => void) => services.subscribeDeviceState(listener),
    [services],
  );
  const getSnapshot = React.useCallback(() => {
    if (!enabled || !deviceId) return undefined;
    return services.getState(deviceId, capability);
  }, [services, deviceId, capability, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Reactive hook for a single capability's recent numeric series (CP-R1).
 * Returns a stable empty array reference when no data exists.
 */
export function useCapabilitySeries(
  deviceId: string,
  capability: CapabilityType,
  enabled = true,
): readonly SeriesPoint[] {
  const services = useWidgetServices();
  const subscribe = React.useCallback(
    (listener: () => void) => services.subscribeDeviceState(listener),
    [services],
  );
  const getSnapshot = React.useCallback(() => {
    if (!enabled || !deviceId) return EMPTY_SERIES;
    const series = services.getSeries(deviceId, capability);
    return series.length === 0 ? EMPTY_SERIES : series;
  }, [services, deviceId, capability, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Reactive hook for a capability's ASYNC command failure (M13-4 seam).
 * Uses the same device-state subscription as {@link useCapabilityState} —
 * the errors map and the values map live in the same store, so one listener
 * set drives both. The snapshot is the error message itself (`null` when
 * none) so the widget re-renders only on error transitions.
 */
export function useCommandError(
  deviceId: string,
  capability: CapabilityType,
  enabled = true,
): string | null {
  const services = useWidgetServices();
  const subscribe = React.useCallback(
    (listener: () => void) => services.subscribeDeviceState(listener),
    [services],
  );
  const getSnapshot = React.useCallback(() => {
    if (!enabled || !deviceId) return null;
    return services.getCommandError(deviceId, capability) ?? null;
  }, [services, deviceId, capability, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Reactive hook for the LIVE MQTT connection snapshot (scope amendment 2 —
 * the offline lock seam). Uses `useSyncExternalStore` so a switch widget
 * re-renders only when the connection snapshot identity actually changes.
 *
 * @returns the current {@link WidgetConnectionState}.
 */
export function useConnectionState(): WidgetConnectionState {
  const services = useWidgetServices();
  const subscribe = React.useCallback(
    (listener: () => void) => services.subscribeConnection(listener),
    [services],
  );
  const getSnapshot = React.useCallback(
    () => services.getConnectionState(),
    [services],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
