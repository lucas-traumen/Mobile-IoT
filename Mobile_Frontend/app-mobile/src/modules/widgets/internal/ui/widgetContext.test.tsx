/**
 * CP-R1 regression tests — the widget reactive seam.
 *
 * Proves the `widgetContext` contract on top of a minimal fake device-state
 * store (same subscription semantics as the real zustand store, kept local
 * so the test does not reach into another module's internals):
 * 1. A component bound via `useCapabilityState` re-renders with the new
 *    value when the store writes its `${deviceId}:${capability}` key.
 * 2. Snapshot identity stability: a write to an unrelated key notifies
 *    listeners but does NOT re-render the bound component (the selected
 *    snapshot keeps its identity), and the latest value stays intact.
 * 3. `useCapabilitySeries` returns a stable empty array while there is no
 *    data and updates when numeric points arrive; boolean writes never
 *    extend series (charts only render numbers).
 * 4. `enabled: false` (or an empty device id) stays `undefined` and never
 *    re-renders on store writes.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Errors, err, ok } from '@core/errors';
import type {
  CapabilityType,
  DeviceCapabilityValue,
  SeriesPoint,
} from '@modules/devices/api';
import type { HistorySeries } from '@modules/history/api';
import {
  WidgetServicesProvider,
  useCapabilityState,
  useCapabilitySeries,
  type WidgetServices,
} from './widgetContext';

/**
 * Minimal fake of the device state store's subscription contract: a plain
 * mutable record + listener set. Numeric writes append `{value, ts}` points
 * (like `appendSeries` in the real store); boolean writes do not.
 */
function createFakeDeviceState() {
  const listeners = new Set<() => void>();
  const values: Record<string, DeviceCapabilityValue> = {};
  const series: Record<string, SeriesPoint[]> = {};
  let now = 1000;

  return {
    values,
    series,
    listeners,
    setCapabilityValue(
      deviceId: string,
      capability: CapabilityType,
      value: number | boolean,
    ) {
      const key = `${deviceId}:${capability}`;
      now += 1000;
      values[key] = { value, updatedAt: now };
      if (typeof value === 'number') {
        const points = series[key] ?? [];
        series[key] = [...points, { value, ts: now }];
      }
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/** Build WidgetServices backed by the fake store (all members required). */
function createServices(
  store: ReturnType<typeof createFakeDeviceState>,
): WidgetServices {
  // Stable connected snapshot (identity stability for useSyncExternalStore).
  const connection = { state: 'connected' as const, label: 'Đã kết nối' };
  const connectionListeners = new Set<() => void>();
  return {
    getState: (deviceId, capability) =>
      store.values[`${deviceId}:${capability}`],
    getSeries: (deviceId, capability) =>
      store.series[`${deviceId}:${capability}`] ?? [],
    sendCommand: () =>
      err(Errors.unknown('sendCommand is not wired in this test')),
    queryHistory: async () => ok<HistorySeries[]>([]),
    getRooms: () => [],
    getDevices: () => [],
    getCapabilities: () => [],
    getActiveRoomId: () => null,
    getCommandError: () => null,
    subscribeDeviceState: listener => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    getConnectionState: () => connection,
    subscribeConnection: listener => {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
  };
}

interface ProbeProps {
  deviceId: string;
  capability: CapabilityType;
  enabled?: boolean;
}

/** Harness: probes record render counts + latest snapshot values. */
function createHarness() {
  const store = createFakeDeviceState();
  const services = createServices(store);

  const state = {
    renders: 0,
    value: undefined as DeviceCapabilityValue | undefined,
  };
  function StateProbe({ deviceId, capability, enabled = true }: ProbeProps) {
    state.renders += 1;
    state.value = useCapabilityState(deviceId, capability, enabled);
    return null;
  }

  const seriesState = {
    renders: 0,
    value: [] as readonly SeriesPoint[],
  };
  function SeriesProbe({ deviceId, capability, enabled = true }: ProbeProps) {
    seriesState.renders += 1;
    seriesState.value = useCapabilitySeries(deviceId, capability, enabled);
    return null;
  }

  return { store, services, StateProbe, state, SeriesProbe, seriesState };
}

async function renderHarness(
  harness: ReturnType<typeof createHarness>,
  stateProps: ProbeProps,
  seriesProps: ProbeProps,
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <WidgetServicesProvider services={harness.services}>
        <harness.StateProbe {...stateProps} />
        <harness.SeriesProbe {...seriesProps} />
      </WidgetServicesProvider>,
    );
  });
  return renderer;
}

describe('widgetContext — CP-R1 reactive seam', () => {
  it('re-renders with the new value when the bound key is written', async () => {
    const harness = createHarness();
    await renderHarness(
      harness,
      { deviceId: 'sensor-01', capability: 'temperature' },
      { deviceId: 'sensor-01', capability: 'temperature' },
    );

    expect(harness.state.renders).toBe(1);
    expect(harness.state.value).toBeUndefined();
    expect(harness.seriesState.value).toEqual([]);

    await act(async () => {
      harness.store.setCapabilityValue('sensor-01', 'temperature', 25.5);
    });

    expect(harness.state.value).toEqual({ value: 25.5, updatedAt: 2000 });
    expect(harness.seriesState.value).toEqual([{ value: 25.5, ts: 2000 }]);

    await act(async () => {
      harness.store.setCapabilityValue('sensor-01', 'temperature', 27);
    });

    expect(harness.state.value).toEqual({ value: 27, updatedAt: 3000 });
    expect(harness.seriesState.value).toHaveLength(2);
  });

  it('does not re-render when an unrelated key is written (snapshot identity stability)', async () => {
    const harness = createHarness();
    await renderHarness(
      harness,
      { deviceId: 'sensor-01', capability: 'temperature' },
      { deviceId: 'sensor-01', capability: 'temperature' },
    );

    await act(async () => {
      harness.store.setCapabilityValue('sensor-01', 'temperature', 25.5);
    });
    expect(harness.state.renders).toBe(2);

    // A different device writes: listeners fire, but the bound component's
    // selected snapshot keeps its identity → React skips the re-render and
    // the displayed value stays intact.
    await act(async () => {
      harness.store.setCapabilityValue('sensor-02', 'humidity', 60);
    });
    expect(harness.state.renders).toBe(2);
    expect(harness.state.value).toEqual({ value: 25.5, updatedAt: 2000 });

    // Same device, different capability: the temperature series snapshot is
    // untouched → the series probe does not re-render either.
    const seriesRendersBefore = harness.seriesState.renders;
    await act(async () => {
      harness.store.setCapabilityValue('sensor-01', 'humidity', 60);
    });
    expect(harness.seriesState.renders).toBe(seriesRendersBefore);
    expect(harness.state.value).toEqual({ value: 25.5, updatedAt: 2000 });
  });

  it('never appends boolean values to series (charts render numbers only)', async () => {
    const harness = createHarness();
    await renderHarness(
      harness,
      { deviceId: 'switch-01', capability: 'light-switch' },
      { deviceId: 'switch-01', capability: 'light-switch' },
    );

    await act(async () => {
      harness.store.setCapabilityValue('switch-01', 'light-switch', true);
    });

    expect(harness.state.value).toEqual({ value: true, updatedAt: 2000 });
    expect(harness.seriesState.value).toEqual([]);
  });

  it('stays disabled: enabled=false or empty deviceId never renders values', async () => {
    const harness = createHarness();
    await renderHarness(
      harness,
      { deviceId: 'sensor-01', capability: 'temperature', enabled: false },
      { deviceId: '', capability: 'temperature' },
    );

    expect(harness.state.value).toBeUndefined();
    expect(harness.seriesState.value).toEqual([]);

    await act(async () => {
      harness.store.setCapabilityValue('sensor-01', 'temperature', 25.5);
    });

    expect(harness.state.value).toBeUndefined();
    expect(harness.seriesState.value).toEqual([]);
  });
});
