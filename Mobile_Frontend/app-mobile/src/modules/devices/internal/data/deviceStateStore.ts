/**
 * Device state store — runtime values per device capability.
 *
 * Live values are NOT persisted (they're ephemeral MQTT state). The store is
 * keyed by `${deviceId}:${capability}` so widgets can subscribe to exactly the
 * capability they render.
 */

import { create } from 'zustand';

import type { CapabilityType } from '../domain/devices';
import { capabilityKey } from '../domain/devices';

/** A live capability value with the wall-clock time it was set. */
export interface DeviceCapabilityValue {
  readonly value: number | boolean;
  readonly updatedAt: number;
}

/** A timestamped numeric series point (sparkline / delta source, CP6). */
export interface SeriesPoint {
  readonly value: number;
  /** Wall-clock millis when the value was observed. */
  readonly ts: number;
}

/** Rolling series buffer: newest 40 points, keyed like values. */
const SERIES_CAP = 40;

/**
 * Cap the appended series at `SERIES_CAP` points and return the new array.
 * `append` drops the oldest points when the cap is exceeded.
 */
function appendSeries(
  previous: readonly SeriesPoint[] | undefined,
  point: SeriesPoint,
): readonly SeriesPoint[] {
  const padded = [...(previous ?? []), point];
  return padded.length > SERIES_CAP
    ? padded.slice(padded.length - SERIES_CAP)
    : padded;
}

/**
 * Delta between the newest point and the point ~`horizonMs` ago (CP6).
 *
 * The reference is the most recent point at or before `nowMs - horizonMs`;
 * when every point is newer than the horizon the first point is used (the
 * series simply is shorter than the horizon). Returns `null` when there are
 * fewer than 2 points or the reference equals the newest point.
 */
export function deltaOverHorizon(
  series: readonly SeriesPoint[],
  horizonMs: number,
  nowMs: number,
): number | null {
  if (series.length < 2) {
    return null;
  }
  const latest = series[series.length - 1];
  const cutoff = nowMs - horizonMs;
  let reference: SeriesPoint | null = null;
  for (const point of series) {
    if (point.ts <= cutoff) {
      reference = point;
    }
  }
  const base = reference ?? series[0];
  if (base === latest) {
    return null;
  }
  return latest.value - base.value;
}

interface DeviceStateStoreShape {
  /** Live values keyed by `${deviceId}:${capability}`. */
  values: Record<string, DeviceCapabilityValue>;
  /**
   * Rolling numeric series per `${deviceId}:${capability}` (newest last),
   * capped at {@link SERIES_CAP}. Boolean values are NOT appended — series are
   * for charts/sparklines that only render numbers.
   */
  series: Record<string, readonly SeriesPoint[]>;
  /**
   * Last command failure message per `${deviceId}:${capability}`
   * (boards-topic-contract-v2): set by `DeviceStateSync` on
   * `relay:commandFailed`, cleared (null) on the next successful
   * command/feedback for the same capability. Widgets read it reactively
   * through `WidgetServices.getCommandError`.
   */
  errors: Record<string, string>;
  /** Set (or overwrite) a capability value. */
  setCapabilityValue(
    deviceId: string,
    capability: CapabilityType,
    value: number | boolean,
  ): void;
  /**
   * Store (or clear with `null`) the per-capability command error message.
   * Every write notifies store subscribers (zustand `set`) so widgets can
   * react to async command failures.
   */
  setCommandError(
    deviceId: string,
    capability: CapabilityType,
    message: string | null,
  ): void;
  /** The last command error message for a capability (null = none). */
  getCommandError(deviceId: string, capability: CapabilityType): string | null;
  /** Recent numeric series for a capability (empty array when none yet). */
  getSeriesValues(
    deviceId: string,
    capability: CapabilityType,
  ): readonly number[];
  /** Recent timestamped numeric series (CP6 sparkline + 1h delta source). */
  getSeriesPoints(
    deviceId: string,
    capability: CapabilityType,
  ): readonly SeriesPoint[];
  /** Drop every value + series belonging to a device (on device removal). */
  removeDevice(deviceId: string): void;
  /**
   * Drop ONE capability's value + series (approved binding-level cascade):
   * removing one projected sensor metric of a surviving legacy
   * multi-capability device cleans only that metric's ephemeral state —
   * sibling metrics stay.
   */
  clearCapability(deviceId: string, capability: CapabilityType): void;
}

/**
 * Create the device state zustand store.
 *
 * @param nowMillis - optional clock for `updatedAt` (defaults to `Date.now`).
 *   Tests pass a fake so `updatedAt` deterministic.
 */
export function createDeviceStateStore(
  nowMillis: () => number = () => Date.now(),
) {
  return create<DeviceStateStoreShape>((set, get) => ({
    values: {},
    series: {},
    errors: {},

    setCapabilityValue: (deviceId, capability, value) =>
      set(state => {
        const key = capabilityKey(deviceId, capability);
        // Boolean values are not appended to the series (charts need numbers).
        const series =
          typeof value === 'number'
            ? {
                ...state.series,
                [key]: appendSeries(state.series[key], {
                  value,
                  ts: nowMillis(),
                }),
              }
            : state.series;
        return {
          values: {
            ...state.values,
            [key]: { value, updatedAt: nowMillis() },
          },
          series,
        };
      }),

    getSeriesValues: (deviceId, capability) =>
      (get().series[capabilityKey(deviceId, capability)] ?? []).map(
        point => point.value,
      ),

    setCommandError: (deviceId, capability, message) =>
      set(state => {
        const key = capabilityKey(deviceId, capability);
        if (message === null) {
          if (state.errors[key] === undefined) {
            return state;
          }
          const errors = { ...state.errors };
          delete errors[key];
          return { errors };
        }
        return { errors: { ...state.errors, [key]: message } };
      }),

    getCommandError: (deviceId, capability) =>
      get().errors[capabilityKey(deviceId, capability)] ?? null,

    getSeriesPoints: (deviceId, capability) =>
      get().series[capabilityKey(deviceId, capability)] ?? [],

    removeDevice: deviceId =>
      set(state => {
        const prefix = `${deviceId}:`;
        const values: Record<string, DeviceCapabilityValue> = {};
        for (const [key, entry] of Object.entries(state.values)) {
          if (!key.startsWith(prefix)) {
            values[key] = entry;
          }
        }
        const series: Record<string, readonly SeriesPoint[]> = {};
        for (const [key, entry] of Object.entries(state.series)) {
          if (!key.startsWith(prefix)) {
            series[key] = entry;
          }
        }
        const errors: Record<string, string> = {};
        for (const [key, entry] of Object.entries(state.errors)) {
          if (!key.startsWith(prefix)) {
            errors[key] = entry;
          }
        }
        return { values, series, errors };
      }),

    clearCapability: (deviceId, capability) =>
      set(state => {
        const key = capabilityKey(deviceId, capability);
        if (
          state.values[key] === undefined &&
          state.series[key] === undefined
        ) {
          return state;
        }
        const values = { ...state.values };
        delete values[key];
        const series = { ...state.series };
        delete series[key];
        return { values, series };
      }),
  }));
}

/** The zustand store instance shape returned by {@link createDeviceStateStore}. */
export type DeviceStateStore = ReturnType<typeof createDeviceStateStore>;
