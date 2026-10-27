/**
 * App-level regression tests (fix cycle 1).
 *
 * 1. Provider-order smoke: the whole App tree renders without throwing —
 *    `ThemedStatusBar` (which calls `useTheme`) must live INSIDE the
 *    `ThemeProvider`; the previous order crashed at startup with
 *    "useTheme must be used inside a ThemeProvider".
 * 2. Active-room History requery wiring: switching the room on the History
 *    screen must update the shared active room AND run the guarded history
 *    request path for the new room; a sensor-less room short-circuits
 *    through `beginRequest` (series cleared, no HTTP call, stale cards
 *    gone).
 *
 * The composition root is mocked with lightweight fakes (the factory is
 * self-contained because jest hoists jest.mock above the test body); pure
 * stores (history/device-state) and the widget registry are the REAL ones
 * so the wiring is exercised end-to-end at the seam.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { create as mockCreate } from 'zustand';
import { ok as mockOk, err, type Result } from '@core/errors';
import { defaultSettings as mockDefaultSettings } from '@modules/settings/api';
import { createHistoryStore as mockCreateHistoryStore } from '@modules/history/api';
import { createDeviceStateStore as mockCreateDeviceStateStore } from '@modules/devices/api';
import { createDefaultRegistry as mockCreateDefaultRegistry } from '@modules/widgets/api';
import { createDashboardStore as mockCreateDashboardStore } from '@modules/dashboard/api';
import { defaultDashboardsFile as mockDefaultDashboardsFile } from '@modules/dashboard/api';

import type { DashboardTemplate } from '@modules/dashboard/api';
import type { DevicesSnapshot } from '@modules/devices/api';
import type { HistorySeries } from '@modules/history/api';
import { STRINGS } from '@core/i18n';
import { HistoryScreen } from '@modules/history/ui/HistoryScreen';
import { HistoryChartCard } from '@modules/history/ui/HistoryChartCard';
import { EditRoomDashboardScreen } from '@modules/dashboard/ui/EditRoomDashboardScreen';

import App from '../../App';
import * as containerModule from './wiring/container';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

/**
 * Font seam: the Inter google-font package loads assets through expo-font
 * (async, native-backed). The App render gate waits for it, so the tests
 * mock it as instantly-loaded with stub font sources.
 */
jest.mock('@expo-google-fonts/inter', () => ({
  __esModule: true,
  useFonts: () => [true, null],
  Inter_300Light: 'Inter_300Light',
  Inter_400Regular: 'Inter_400Regular',
  Inter_600SemiBold: 'Inter_600SemiBold',
}));

/**
 * Safe-area seam: the real `SafeAreaProvider` renders children only after
 * the native inset event fires, which never happens under react-test-renderer
 * (no native layout). The mock is a passthrough with zero insets AND the
 * context surface React Navigation's navigators consume
 * (`SafeAreaInsetsContext` etc.), so these tests keep exercising App's own
 * logic (bootstrap race, tab switching, history flow, view surface +
 * Settings management stack) with every original assertion unchanged.
 */
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  /** Standalone inset type (avoids a self-referential `typeof` annotation). */
  type MockInsets = {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  const insets: MockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: { readonly children: React.ReactNode }) =>
      children,
    SafeAreaConsumer: ({
      children,
    }: {
      readonly children: (insets: MockInsets) => React.ReactNode;
    }) => children(insets),
    SafeAreaInsetsContext: React.createContext(insets),
    SafeAreaFrameContext: React.createContext(frame),
    initialWindowMetrics: { insets, frame },
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
  };
});

/** Shape of the test handle the container mock factory exposes. */
interface ContainerTestHandle {
  ensure(): {
    stores: {
      dashboardStore: ReturnType<typeof mockCreateDashboardStore>;
      devicesStore: {
        getState(): { snapshot: DevicesSnapshot };
        setState(partial: Record<string, unknown>): void;
      };
      historyStore: ReturnType<typeof mockCreateHistoryStore>;
      /** Re-render trigger for the focus-refresh regression (telemetry tick). */
      telemetryStore: { setState(partial: Record<string, unknown>): void };
    };
    spies: {
      query: jest.Mock;
      setActiveRoom: jest.Mock;
      onMqttMessage: jest.Mock;
      handleRelayFeedback: jest.Mock;
      handleDescriptorMessage: jest.Mock;
      handleBoardStatus: jest.Mock;
      applyTemplateLayouts: jest.Mock;
    };
    loadOrder: string[];
  };
}

/** Reach the factory-exposed handle through the mocked module namespace. */
const handle = () =>
  (
    containerModule as unknown as { __handle: ContainerTestHandle }
  ).__handle.ensure();

interface RaceHandle {
  deps: never;
  stores: {
    dashboardStore: { getState(): { activeRoomId: string | null } };
    devicesStore: { getState(): { snapshot: { rooms: { id: string }[] } } };
  };
  spies: { setActiveRoom: jest.Mock };
  resolveDevices: () => void;
}

/** Build the bootstrap-race scenario (fix cycle 2) and point App at it. */
const raceHandle = (
  persistedRoomIds: string[],
  persistedActiveRoomId: string,
): RaceHandle => {
  const handleNamespace = containerModule as unknown as {
    __handle: {
      makeRaceDeps: (
        rooms: { id: string; name: string }[],
        persistedActiveRoomId: string,
      ) => RaceHandle;
      useRaceDeps: (race: RaceHandle) => void;
    };
  };
  const scenario = handleNamespace.__handle.makeRaceDeps(
    persistedRoomIds.map(id => ({ id, name: id })),
    persistedActiveRoomId,
  );
  handleNamespace.__handle.useRaceDeps(scenario);
  return scenario;
};

jest.mock('./wiring/container', () => {
  const create = mockCreate;
  const ok = mockOk;
  const defaultSettings = mockDefaultSettings;
  const createHistoryStore = mockCreateHistoryStore;
  const createDeviceStateStore = mockCreateDeviceStateStore;
  const createDefaultRegistry = mockCreateDefaultRegistry;
  const createDashboardStore = mockCreateDashboardStore;
  const defaultDashboardsFile = mockDefaultDashboardsFile;

  const query = jest.fn(async (q: { roomId: string | null }) => {
    if (q.roomId === 'room-a') {
      return ok([
        {
          roomId: 'room-a',
          field: 'temperature',
          points: [
            { t: 1000, value: 25 },
            { t: 2000, value: 26 },
          ],
        },
      ]);
    }
    return ok([]);
  });

  // Message fan-out spies (boards-topic-contract-v2): bootstrap registers
  // ONE handler on the shared client that forwards every message to the
  // relay + board discovery handlers.
  const onMqttMessage = jest.fn();
  const handleRelayFeedback = jest.fn(() => false);
  const handleDescriptorMessage = jest.fn(() => false);
  const handleBoardStatus = jest.fn(() => false);
  const applyTemplateLayouts = jest.fn(async () => ({
    ok: false,
    error: { code: 'unknown', message: 'Save failed' },
  }));

  const makeDeps = () => {
    // Bootstrap ordering probe: the dashboard load must be sequenced AFTER
    // the devices registry load (legacy migration reads the PERSISTED
    // registry, never the seed snapshot).
    const loadOrder: string[] = [];
    const rooms = [
      { id: 'room-a', name: 'Phòng A', order: 0, icon: 'home-outline' },
      { id: 'room-b', name: 'Phòng B', order: 1, icon: 'bed-outline' },
    ];
    const devices = [
      {
        id: 'sensor-01',
        name: 'Cảm biến A',
        roomId: 'room-a',
        type: 'sensor',
        capabilities: ['temperature', 'humidity'],
        binding: { kind: 'telemetry-sensor' as const },
      },
    ];
    const capabilities = [
      {
        type: 'temperature',
        label: 'Nhiệt độ',
        kind: 'sensor' as const,
        unit: '°C',
        builtin: true,
      },
    ];

    capabilities.push({
      type: 'humidity',
      label: 'Độ ẩm',
      kind: 'sensor',
      unit: '%',
      builtin: true,
    });

    // Real dashboard store (Template model) for the fields App + the
    // DashboardNavigator read; the seed file is re-pointed at the mock rooms.
    const dashboardFile = defaultDashboardsFile();
    dashboardFile.templates = [
      {
        id: 'dash-1',
        name: 'Nhà',
        updatedAt: 0,
        rooms: [
          {
            roomId: 'room-a',
            order: 0,
            widgets: [
              {
                id: 'w-temperature',
                type: 'sensor-value',
                roomId: 'room-a',
                binding: { deviceId: 'sensor-01', capability: 'temperature' },
                layout: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
        ],
      },
    ];
    dashboardFile.activeId = 'dash-1';
    dashboardFile.activeRoomId = 'room-a';
    const dashboardStore = createDashboardStore(dashboardFile);
    const setActiveRoom = jest.fn(async (roomId: string) => {
      dashboardStore.setState({ activeRoomId: roomId });
      return ok(undefined);
    });
    const devicesStore = create(() => ({
      snapshot: { rooms, devices, capabilities },
    }));
    const settingsStore = create(() => ({
      current: defaultSettings(),
      draft: defaultSettings(),
      errors: {},
      setCurrent: () => undefined,
      applyPersistedUi: () => undefined,
      updateMqtt: () => undefined,
      updateInflux: () => undefined,
      updateUi: () => undefined,
    }));
    const telemetryStore = create(() => ({
      connection: 'disconnected' as const,
      lastErrorCode: null,
    }));
    const historyStore = createHistoryStore();

    return {
      stores: { dashboardStore, devicesStore, historyStore, telemetryStore },
      spies: {
        query,
        setActiveRoom,
        onMqttMessage,
        handleRelayFeedback,
        handleDescriptorMessage,
        handleBoardStatus,
        applyTemplateLayouts,
      },
      deps: {
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          debug: () => undefined,
        },
        bus: { subscribe: () => () => undefined, emit: () => undefined },
        clock: { nowMillis: () => 0, setTimeout: () => () => undefined },
        settingsService: {
          load: async () => {
            loadOrder.push('settings');
            return ok(defaultSettings());
          },
          save: async () => ok(undefined),
          onChanged: () => () => undefined,
        },
        settingsStore,
        mqttClient: { onMessage: onMqttMessage },
        telemetryService: {
          start: () => undefined,
          stop: () => undefined,
          applyConfig: () => undefined,
        },
        telemetryStore,
        relayService: {
          applyPrefix: () => undefined,
          startFeedbackListener: () => undefined,
          handleFeedbackMessage: handleRelayFeedback,
          publish: async () => ok(undefined),
        },
        relayStore: create(() => ({})),
        historyAdapter: { configure: () => undefined, query },
        // The demo↔Influx selector front door (same query spy — App routes
        // every history query through it). The Settings tab's navigator
        // also reads/mirrors the selector state on mount.
        historySource: {
          query,
          isDemoEnabled: () => false,
          setDemoEnabled: () => undefined,
        },
        historyStore,
        devicesRepository: {},
        devicesRegistry: {
          load: async () => {
            loadOrder.push('devices');
            return ok(undefined);
          },
          getRooms: () => rooms,
          getDevices: () => devices,
          getCapabilities: () => capabilities,
          getDeletedBoardCodes: () => [],
          removeBoard: async () => ok(undefined),
          findDevice: (id: string) => devices.find(d => d.id === id),
        },
        devicesStore,
        deviceStateStore: createDeviceStateStore(),
        deviceStateSync: { start: () => undefined, stop: () => undefined },
        deviceCommandService: { sendCommand: async () => ok(undefined) },
        // Board discovery (board-discovery-binding): no-op service + empty
        // mirror store (the screens read the store, never the service).
        boardInventory: {
          applyPrefix: () => undefined,
          startListeners: () => undefined,
          handleDescriptorMessage,
          handleStatusMessage: handleBoardStatus,
        },
        boardStore: create(() => ({ boards: [] })),
        widgetRegistry: createDefaultRegistry(),
        dashboardRepository: {},
        dashboardService: {
          load: async () => {
            loadOrder.push('dashboards');
            return ok(undefined);
          },
          getActiveRoomId: () => dashboardStore.getState().activeRoomId,
          getTemplates: () => dashboardStore.getState().templates,
          setActiveTemplate: async () => ok(undefined),
          setActiveRoom,
          renameTemplate: async () => ok(undefined),
          duplicateTemplate: async () => ok(undefined),
          deleteTemplate: async () => ok(undefined),
          addRoomReference: async () => ok(undefined),
          duplicateRoomReference: async () => ok(undefined),
          reorderRoomReferences: async () => ok(undefined),
          removeRoomReference: async () => ok(undefined),
          applyLayout: async () => ok(undefined),
          applyTemplateLayouts,
          addWidget: async () => ok(undefined),
          duplicateWidgetToRoom: async () => ok(undefined),
          moveWidgetToRoom: async () => ok(undefined),
        },
        dashboardStore,
      },
      loadOrder,
    };
  };

  let cached: ReturnType<typeof makeDeps> | null = null;
  const ensure = () => {
    if (!cached) {
      cached = makeDeps();
    }
    return cached;
  };

  /**
   * Fix cycle 2 — bootstrap active-room race scenario: the dashboard file
   * loads immediately (its persisted active room becomes visible) while the
   * DEVICES registry load is deferred (the registry still shows the seed
   * snapshot). Readiness must wait for the devices load; the fallback must
   * never run against the seed snapshot.
   */
  const makeRaceDeps = (
    persistedRooms: { id: string; name: string }[],
    persistedActiveRoomId: string,
  ) => {
    const seedRooms = [
      { id: 'room-seed', name: 'Seed', order: 0, icon: 'home-outline' },
    ];
    const persistedCapabilities = [
      {
        type: 'temperature',
        label: 'Nhiệt độ',
        kind: 'sensor' as const,
        unit: '°C',
        builtin: true,
      },
    ];
    const raceFile = defaultDashboardsFile();
    raceFile.templates = [
      { id: 'dash-seed', name: 'Nhà', updatedAt: 0, rooms: [] },
    ];
    raceFile.activeId = 'dash-seed';
    raceFile.activeRoomId = 'room-seed';
    const dashboardStore = createDashboardStore(raceFile);
    const setActiveRoom = jest.fn(async (roomId: string) => {
      dashboardStore.setState({ activeRoomId: roomId });
      return ok(undefined);
    });
    const devicesStore = create(() => ({
      snapshot: {
        rooms: seedRooms,
        devices: [] as { id: string; name: string }[],
        capabilities: [] as {
          type: string;
          label: string;
          kind: 'sensor' | 'relay';
          unit: string;
          builtin: boolean;
        }[],
      },
    }));
    const telemetryStore = create(() => ({
      connection: 'idle' as const,
      lastErrorCode: null,
    }));
    const settingsStore = create(() => ({
      current: defaultSettings(),
      draft: defaultSettings(),
      errors: {},
      setCurrent: () => undefined,
      applyPersistedUi: () => undefined,
      updateMqtt: () => undefined,
      updateInflux: () => undefined,
      updateUi: () => undefined,
    }));

    let resolveDevices!: () => void;
    const devicesLoaded = new Promise<void>(resolve => {
      resolveDevices = resolve;
    });

    const deps = {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
      bus: { subscribe: () => () => undefined, emit: () => undefined },
      clock: { nowMillis: () => 0, setTimeout: () => () => undefined },
      settingsService: {
        load: async () => ok(defaultSettings()),
        save: async () => ok(undefined),
        onChanged: () => () => undefined,
      },
      settingsStore,
      mqttClient: { onMessage: () => undefined },
      telemetryService: {
        start: () => undefined,
        stop: () => undefined,
        applyConfig: () => undefined,
      },
      telemetryStore,
      relayService: {
        applyPrefix: () => undefined,
        startFeedbackListener: () => undefined,
        handleFeedbackMessage: () => undefined,
        publish: async () => ok(undefined),
      },
      relayStore: create(() => ({})),
      historyAdapter: { configure: () => undefined, query },
      historySource: {
        query,
        isDemoEnabled: () => false,
        setDemoEnabled: () => undefined,
      },
      historyStore: createHistoryStore(),
      devicesRepository: {},
      devicesRegistry: {
        // Deferred persisted load: applies the persisted rooms when the
        // test releases it.
        load: () =>
          devicesLoaded.then(() => {
            devicesStore.setState({
              snapshot: {
                rooms: persistedRooms.map((room, index) => ({
                  ...room,
                  order: index,
                  icon: 'home-outline',
                })),
                devices: [],
                capabilities: persistedCapabilities,
              },
            });
            return ok(undefined);
          }),
        getRooms: () => devicesStore.getState().snapshot.rooms,
        getDevices: () => devicesStore.getState().snapshot.devices,
        getCapabilities: () => devicesStore.getState().snapshot.capabilities,
        getDeletedBoardCodes: () => [],
        removeBoard: async () => ok(undefined),
        findDevice: () => undefined,
      },
      devicesStore,
      deviceStateStore: createDeviceStateStore(),
      deviceStateSync: { start: () => undefined, stop: () => undefined },
      deviceCommandService: { sendCommand: async () => ok(undefined) },
      // Board discovery (board-discovery-binding): no-op service + empty
      // mirror store (the screens read the store, never the service).
      boardInventory: {
        applyPrefix: () => undefined,
        startListeners: () => undefined,
        handleDescriptorMessage: () => false,
        handleStatusMessage: () => false,
      },
      boardStore: create(() => ({ boards: [] })),
      widgetRegistry: createDefaultRegistry(),
      dashboardRepository: {},
      dashboardService: {
        // The dashboard file load completes immediately and re-points the
        // active room to the persisted value.
        load: async () => {
          dashboardStore.setState({
            templates: [{ id: 'dash-x', name: 'X', updatedAt: 0, rooms: [] }],
            activeId: 'dash-x',
            activeRoomId: persistedActiveRoomId,
          });
          return ok(undefined);
        },
        getActiveRoomId: () => dashboardStore.getState().activeRoomId,
        getTemplates: () => dashboardStore.getState().templates,
        setActiveTemplate: async () => ok(undefined),
        setActiveRoom,
        renameTemplate: async () => ok(undefined),
        duplicateTemplate: async () => ok(undefined),
        deleteTemplate: async () => ok(undefined),
        addRoomReference: async () => ok(undefined),
        duplicateRoomReference: async () => ok(undefined),
        reorderRoomReferences: async () => ok(undefined),
        removeRoomReference: async () => ok(undefined),
        applyLayout: async () => ok(undefined),
        addWidget: async () => ok(undefined),
        duplicateWidgetToRoom: async () => ok(undefined),
        moveWidgetToRoom: async () => ok(undefined),
      },
      dashboardStore,
    };

    return {
      deps: deps as never,
      stores: { dashboardStore, devicesStore },
      spies: { setActiveRoom },
      resolveDevices,
    };
  };

  // Point the cached container at a race scenario so buildContainer()
  // (which App consumes) hands the race deps to the component.
  const useRaceDeps = (race: RaceHandle) => {
    cached = race as unknown as ReturnType<typeof makeDeps>;
  };

  return {
    __handle: { ensure, makeRaceDeps, useRaceDeps },
    // App.tsx binds `deps` at module scope, so the container must be a
    // lazy proxy: every property access resolves against the CURRENT
    // cached deps, letting the race tests swap the scenario underneath.
    buildContainer: (): ReturnType<typeof mockCreate> =>
      new Proxy({} as Record<string | symbol, unknown>, {
        get: (_target, prop) =>
          (ensure().deps as Record<string | symbol, unknown>)[prop],
      }) as unknown as ReturnType<typeof mockCreate>,
  };
});

describe('App (fix cycle 1 regressions)', () => {
  it('renders the whole tree without a provider-order crash', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    let thrown: unknown = null;
    await act(async () => {
      try {
        renderer = TestRenderer.create(<App />);
      } catch (error) {
        thrown = error;
      }
    });
    expect(thrown).toBeNull();
    // The tab bar rendered (three tabs) — the tree mounted fully.
    expect(renderer.root.findByProps({ testID: 'tab-dashboard' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'tab-history' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'tab-settings' })).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('loads the devices registry BEFORE the dashboard migration (bootstrap order)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    const { loadOrder } = handle();
    // Legacy dashboard migration re-orders room references (and finalizes
    // the sentinel) against getRooms() — it must never run against the
    // seed registry: the devices load strictly precedes the dashboard load.
    expect(loadOrder.indexOf('devices')).toBeGreaterThanOrEqual(0);
    expect(loadOrder.indexOf('devices')).toBeLessThan(
      loadOrder.indexOf('dashboards'),
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('Dashboard tab renders the VIEW surface of the ACTIVE Template', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    const { stores } = handle();

    // Point the saved layout at a different active Template referencing
    // room-a with one sensor widget (App reacts to the store subscription).
    act(() => {
      stores.dashboardStore.setState({
        templates: [
          {
            id: 'dash-view',
            name: 'Nhà',
            updatedAt: 0,
            rooms: [
              {
                roomId: 'room-a',
                order: 0,
                widgets: [
                  {
                    id: 'w-a',
                    type: 'sensor-value',
                    roomId: 'room-a',
                    binding: {
                      deviceId: 'sensor-01',
                      capability: 'temperature',
                    },
                    layout: { x: 0, y: 0, width: 1, height: 1 },
                  },
                ],
              },
            ],
          },
        ],
        activeId: 'dash-view',
      });
    });
    // The Smart Home header lists the ACTIVE Template's referenced rooms
    // via the MENU (room-a) — the physical room room-b is NOT referenced
    // and never appears (dashboard-smart-home-redesign; the History tab
    // uses its own dropdown + the same RoomListModal).
    expect(
      renderer.root.findByProps({ testID: 'dashboard-room-menu' }),
    ).toBeTruthy();
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-menu' })
        .props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'dashboard-room-row-room-a' }),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: 'dashboard-room-row-room-b' }),
    ).toHaveLength(0);
    // No management affordances on the view surface.
    expect(
      renderer.root.findAllByProps({ testID: 'room-dashboard-edit' }),
    ).toHaveLength(0);

    // The Settings tab hosts the management stack: the management entry
    // opens the hierarchy (routeMachine retired).
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-settings' }).props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'settings-open-dashboard-manager' }),
    ).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('re-queries history (guarded) when the active room changes', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    const { stores, spies } = handle();

    // Switch to the History tab.
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
    });

    // Initial mount query for the active room (room-a → sensor-01 series).
    await act(async () => {
      await Promise.resolve();
    });
    expect(spies.query).toHaveBeenCalledTimes(1);
    expect(stores.historyStore.getState().series).toHaveLength(1);
    expect(stores.historyStore.getState().series[0].roomId).toBe('room-a');

    // Switch the room to room-b (no sensor device). The History tab's room
    // filter is the Smart Home dropdown (history-smart-home-redesign — it
    // replaced the legacy chip strip): open the dropdown and
    // pick the room-b option.
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'history-room-dropdown-trigger' })
        .props.onPress();
    });
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'history-room-dropdown-option-room-b' })
        .props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The shared active room was updated AND the guarded request path ran:
    // the sensor-less room short-circuits (series cleared, no HTTP query —
    // the stale series from room-a must not survive).
    expect(spies.setActiveRoom).toHaveBeenCalledWith('room-b');
    expect(spies.query).toHaveBeenCalledTimes(1);
    expect(stores.historyStore.getState().series).toEqual([]);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('re-queries history on EVERY History tab focus; an unrelated re-render while focused never re-queries', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    const { stores, spies } = handle();
    // Query counts accumulate across the file's tests (the container mock
    // is cached) — this test asserts its OWN deltas. The shared dashboard
    // store's active room is re-pinned too (a previous test may have left
    // the sensor-less room-b selected → the no-sensors short-circuit would
    // legitimately produce zero HTTP queries).
    spies.query.mockClear();
    await act(async () => {
      stores.dashboardStore.setState({ activeRoomId: 'room-a' });
    });

    // First open of the History tab: EXACTLY ONE query (with `lazy: true`
    // the first mount ≡ the first focus — no duplicated mount+focus fetch).
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(spies.query).toHaveBeenCalledTimes(1);
    expect(stores.historyStore.getState().series).toHaveLength(1);

    // An unrelated App re-render while focused (a telemetry tick re-renders
    // App and gives the inline focus callback a NEW identity) must NOT
    // re-query — the wrapper's ref pattern keeps the focus effect stable.
    await act(async () => {
      stores.telemetryStore.setState({ connection: 'connecting' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(spies.query).toHaveBeenCalledTimes(1);

    // Dashboard → History: every later unfocused → focused transition
    // re-queries the current room + range through the guarded path.
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-dashboard' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(spies.query).toHaveBeenCalledTimes(2);

    // …and again — one query per focus, repeatedly.
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-dashboard' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(spies.query).toHaveBeenCalledTimes(3);

    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('App message fan-out (boards-topic-contract-v2)', () => {
  it('registers ONE shared-client handler that forwards every message to relay + descriptor + status handling', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    const { spies } = handle();

    // Bootstrap registered handler(s) on the shared MQTT client — take the
    // most recent registration (one per App mount).
    expect(spies.onMqttMessage).toHaveBeenCalled();
    const forward = spies.onMqttMessage.mock.calls.at(-1)![0] as (message: {
      topic: string;
      payload: string;
    }) => void;

    // Every incoming message reaches ALL three handlers — each handler
    // claims its own topic shape (descriptor / status / relay state).
    const descriptorMessage = {
      topic: 'smarthome/boards/board-1/descriptor',
      payload: '{}',
    };
    forward(descriptorMessage);
    expect(spies.handleDescriptorMessage).toHaveBeenCalledWith(
      descriptorMessage,
    );
    expect(spies.handleBoardStatus).toHaveBeenCalledWith(descriptorMessage);
    expect(spies.handleRelayFeedback).toHaveBeenCalledWith(descriptorMessage);

    const stateMessage = {
      topic: 'smarthome/boards/board-1/relays/K1/state',
      payload: 'ON',
    };
    forward(stateMessage);
    expect(spies.handleDescriptorMessage).toHaveBeenLastCalledWith(
      stateMessage,
    );
    expect(spies.handleRelayFeedback).toHaveBeenLastCalledWith(stateMessage);

    await act(async () => {
      renderer.unmount();
    });
  });
});

/** Saved Template layouts supplied through the composition root's public store. */
function savedHistoryTemplate(
  id: string,
  fields: readonly string[],
): DashboardTemplate {
  return {
    id,
    name: id,
    updatedAt: 0,
    rooms: [
      {
        roomId: 'room-a',
        order: 0,
        widgets: fields.map((field, index) => ({
          id: `w-${field}`,
          type: 'sensor-value',
          roomId: 'room-a',
          binding: { deviceId: 'sensor-01', capability: field },
          layout: {
            x: index % 2,
            y: Math.floor(index / 2),
            width: 1,
            height: 1,
          },
        })),
      },
    ],
  };
}

async function focusHistory(
  renderer: TestRenderer.ReactTestRenderer,
): Promise<void> {
  await act(async () => {
    renderer.root.findByProps({ testID: 'tab-dashboard' }).props.onPress();
  });
  await act(async () => {
    renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
  });
}

describe('App History follows the active saved layout', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  let originalSnapshot: DevicesSnapshot;

  beforeEach(async () => {
    const { stores, spies } = handle();
    spies.query.mockClear();
    spies.applyTemplateLayouts.mockClear();
    originalSnapshot = stores.devicesStore.getState().snapshot;
    stores.dashboardStore.setState({
      templates: [savedHistoryTemplate('saved', ['temperature', 'humidity'])],
      activeId: 'saved',
      activeRoomId: 'room-a',
    });
    stores.dashboardStore.getState().cancelEdit();
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    await focusHistory(renderer);
  });

  afterEach(async () => {
    await act(async () => {
      renderer.unmount();
    });
    handle().stores.devicesStore.setState({ snapshot: originalSnapshot });
  });

  const fields = () =>
    renderer.root.findByType(HistoryScreen).props.registeredFields;
  const cards = () =>
    ['temperature', 'humidity'].filter(
      field =>
        renderer.root.findAllByProps({ testID: `history-card-${field}` })
          .length > 0,
    );

  it('keeps draft removal and Cancel out of History, then follows saved removal and re-add on focus', async () => {
    const { stores, spies } = handle();
    expect(cards()).toEqual(['temperature', 'humidity']);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['temperature', 'humidity'] }),
    );
    act(() => {
      stores.dashboardStore.getState().enterEdit('saved', 'room-a');
      stores.dashboardStore.getState().removeWidget('w-humidity');
    });
    expect(
      stores.dashboardStore
        .getState()
        .draftWidgets?.map(widget => widget.binding?.capability),
    ).toEqual(['temperature']);
    expect(fields()).toEqual(['temperature', 'humidity']);
    await focusHistory(renderer);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['temperature', 'humidity'] }),
    );
    act(() => {
      stores.dashboardStore.getState().cancelEdit();
    });
    expect(cards()).toEqual(['temperature', 'humidity']);

    // Successful Save publishes a new saved Template snapshot. The editor's
    // persistence transaction is tested in its own module; this exercises
    // App's reaction to that publication, independent of the draft.
    act(() => {
      stores.dashboardStore.setState({
        templates: [savedHistoryTemplate('saved', ['temperature'])],
      });
    });
    expect(fields()).toEqual(['temperature']);
    expect(cards()).toEqual(['temperature']);
    await focusHistory(renderer);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['temperature'] }),
    );
    act(() => {
      stores.dashboardStore.setState({
        templates: [savedHistoryTemplate('saved', ['temperature', 'humidity'])],
      });
    });
    await focusHistory(renderer);
    expect(cards()).toEqual(['temperature', 'humidity']);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['temperature', 'humidity'] }),
    );
  });

  it('keeps a failed Save out of History and discards the draft on tab leave', async () => {
    const { stores, spies } = handle();
    for (const testID of [
      'tab-settings',
      'settings-open-dashboard-manager',
      'template-card-saved',
      'room-card-room-a',
      'room-dashboard-edit',
    ]) {
      await act(async () => {
        renderer.root.findByProps({ testID }).props.onPress();
      });
    }
    act(() => {
      renderer.root
        .findByType(EditRoomDashboardScreen)
        .props.onDraftRemove('w-humidity');
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'room-edit-save' }).props.onPress();
    });
    expect(spies.applyTemplateLayouts).toHaveBeenCalledWith('saved', [
      expect.objectContaining({
        roomId: 'room-a',
        widgets: [expect.objectContaining({ id: 'w-temperature' })],
      }),
    ]);
    expect(stores.dashboardStore.getState().editMode).toBe(true);
    expect(fields()).toEqual(['temperature', 'humidity']);
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
    });
    // Assert History's saved-state contract; the shell owns its deferred
    // stack reset and the editor may re-enter from the saved layout first.
    expect(fields()).toEqual(['temperature', 'humidity']);
    expect(cards()).toEqual(['temperature', 'humidity']);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['temperature', 'humidity'] }),
    );
  });

  it('uses the switched Template on next focus and on range changes without requests on re-render', async () => {
    const { stores, spies } = handle();
    act(() => {
      stores.dashboardStore.setState({
        templates: [
          savedHistoryTemplate('saved', ['temperature', 'humidity']),
          savedHistoryTemplate('other', ['humidity']),
        ],
        activeId: 'other',
      });
      stores.telemetryStore.setState({ connection: 'connected' });
    });
    expect(fields()).toEqual(['humidity']);
    expect(cards()).toEqual(['humidity']);
    expect(spies.query).toHaveBeenCalledTimes(1);
    await focusHistory(renderer);
    expect(spies.query).toHaveBeenCalledTimes(2);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['humidity'] }),
    );
    await act(async () => {
      renderer.root.findByType(HistoryScreen).props.onRangeChange('24h');
    });
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['humidity'], range: '24h' }),
    );
    act(() => {
      stores.dashboardStore.setState({ activeId: 'saved' });
    });
    await focusHistory(renderer);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['temperature', 'humidity'] }),
    );
  });

  it.each(['empty', 'missing', 'invalid'] as const)(
    '%s saved scope has no fields, cards or network query',
    async scope => {
      const { stores, spies } = handle();
      const template = savedHistoryTemplate('saved', []);
      if (scope === 'missing') {
        template.rooms = [];
      } else if (scope === 'invalid') {
        const snapshot = stores.devicesStore.getState().snapshot;
        act(() => {
          stores.devicesStore.setState({
            snapshot: {
              ...snapshot,
              devices: [
                ...snapshot.devices,
                {
                  ...snapshot.devices[0]!,
                  id: 'other-room-device',
                  roomId: 'room-b',
                },
              ],
            },
          });
        });
        template.rooms[0]!.widgets = [
          {
            ...savedHistoryTemplate('x', ['temperature']).rooms[0]!.widgets[0]!,
            binding: { deviceId: 'deleted', capability: 'temperature' },
          },
          {
            ...savedHistoryTemplate('x', ['humidity']).rooms[0]!.widgets[0]!,
            binding: { deviceId: 'other-room-device', capability: 'humidity' },
          },
          {
            ...savedHistoryTemplate('x', ['humidity']).rooms[0]!.widgets[0]!,
            binding: { deviceId: 'sensor-01', capability: 'pressure' },
          },
          {
            ...savedHistoryTemplate('x', ['humidity']).rooms[0]!.widgets[0]!,
            type: 'switch',
          },
          {
            ...savedHistoryTemplate('x', ['humidity']).rooms[0]!.widgets[0]!,
            binding: undefined,
          },
        ].map((widget, index) => ({ ...widget, id: `invalid-${index}` }));
      }
      act(() => {
        stores.dashboardStore.setState({ templates: [template] });
      });
      await focusHistory(renderer);
      expect(fields()).toEqual([]);
      expect(cards()).toEqual([]);
      expect(renderer.root.findByType(HistoryScreen).props.noSensors).toBe(
        true,
      );
      expect(JSON.stringify(renderer.toJSON())).toContain(
        STRINGS.history.noSensorForRoom,
      );
      expect(spies.query).toHaveBeenCalledTimes(1); // only the initial valid layout
      expect(stores.historyStore.getState().series).toEqual([]);
      // A range change must use the same explicit empty scope as focus.
      await act(async () => {
        renderer.root.findByType(HistoryScreen).props.onRangeChange('7d');
      });
      expect(spies.query).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['success', 'error'] as const)(
    'drops a deferred %s after a saved empty layout is focused',
    async outcome => {
      const { stores, spies } = handle();
      let resolve!: (result: Result<HistorySeries[]>) => void;
      const pending = new Promise<Result<HistorySeries[]>>(done => {
        resolve = done;
      });
      spies.query.mockImplementationOnce(() => pending);
      await focusHistory(renderer);
      expect(stores.historyStore.getState().loading).toBe(true);
      act(() => {
        stores.dashboardStore.setState({
          templates: [savedHistoryTemplate('saved', [])],
        });
      });
      await focusHistory(renderer);
      expect(spies.query).toHaveBeenCalledTimes(2);
      expect(stores.historyStore.getState().loading).toBe(false);
      await act(async () => {
        resolve(
          outcome === 'success'
            ? mockOk([
                {
                  roomId: 'room-a',
                  field: 'humidity',
                  points: [{ t: 1000, value: 80 }],
                },
              ])
            : err({ code: 'network', message: 'Late failure' }),
        );
      });
      expect(stores.historyStore.getState().series).toEqual([]);
      expect(stores.historyStore.getState().error).toBeNull();
      expect(cards()).toEqual([]);
    },
  );

  it('cannot create hidden cards or pair wrong-room points from cached and returned series', async () => {
    const { stores, spies } = handle();
    const returned: HistorySeries[] = [
      {
        roomId: 'room-b',
        field: 'temperature',
        points: [{ t: 1000, value: 99 }],
      },
      { roomId: null, field: 'temperature', points: [{ t: 1000, value: 88 }] },
      { roomId: 'room-a', field: 'humidity', points: [{ t: 1000, value: 50 }] },
      { roomId: 'room-a', field: 'extra', points: [{ t: 1000, value: 55 }] },
    ];
    spies.query.mockResolvedValueOnce(mockOk(returned));
    await focusHistory(renderer);
    act(() => {
      stores.dashboardStore.setState({
        templates: [savedHistoryTemplate('saved', ['temperature'])],
      });
    });
    expect(cards()).toEqual(['temperature']);
    expect(renderer.root.findByType(HistoryChartCard).props.points).toEqual([]);
    spies.query.mockResolvedValueOnce(mockOk(returned));
    await focusHistory(renderer);
    expect(renderer.root.findAllByType(HistoryChartCard)).toHaveLength(1);
    expect(renderer.root.findByType(HistoryChartCard).props.points).toEqual([]);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ['temperature'] }),
    );
    // Adding the saved binding back can display already stored data.
    act(() => {
      stores.dashboardStore.setState({
        templates: [savedHistoryTemplate('saved', ['temperature', 'humidity'])],
      });
    });
    expect(
      renderer.root
        .findAllByType(HistoryChartCard)
        .find(card => card.props.testID === 'history-card-humidity')?.props
        .points,
    ).toEqual([{ t: 1000, value: 50 }]);
    expect(
      renderer.root.findAllByProps({ testID: 'history-card-extra' }),
    ).toHaveLength(0);
  });

  it('keeps board tag identity while filtering fields by the saved room layout', async () => {
    const { stores, spies } = handle();
    act(() => {
      stores.devicesStore.setState({
        snapshot: {
          ...originalSnapshot,
          rooms: originalSnapshot.rooms.map(room =>
            room.id === 'room-a' ? { ...room, code: 'board-1' } : room,
          ),
        },
      });
      stores.dashboardStore.setState({
        templates: [savedHistoryTemplate('saved', ['humidity'])],
      });
    });
    spies.query.mockResolvedValueOnce(
      mockOk([
        {
          roomId: 'room-a',
          boardId: 'board-other',
          field: 'humidity',
          points: [{ t: 1000, value: 99 }],
        },
        {
          roomId: 'room-a',
          boardId: 'board-1',
          field: 'humidity',
          points: [{ t: 1000, value: 60 }],
        },
      ]),
    );
    await focusHistory(renderer);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fields: ['humidity'],
        boardId: 'board-1',
        roomId: null,
      }),
    );
    expect(renderer.root.findByType(HistoryChartCard).props.points).toEqual([
      { t: 1000, value: 60 },
    ]);
  });
});

describe('App bootstrap active-room race (fix cycle 2)', () => {
  it('waits for persisted loads and reuses a valid persisted active room', async () => {
    const scenario = raceHandle(['room-x'], 'room-x');
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    // Flush settings + dashboard loads; the devices load stays deferred.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // NOT ready yet (the devices registry is still loading)…
    expect(
      renderer.root.findAllByProps({ testID: 'tab-dashboard' }),
    ).toHaveLength(0);
    // …and the persisted active room was NOT overwritten by a seed fallback.
    expect(scenario.spies.setActiveRoom).not.toHaveBeenCalled();

    // Release the persisted devices load.
    await act(async () => {
      scenario.resolveDevices();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Ready now; the valid persisted active room is REUSED (no fallback
    // write ever happened — the seed room never overwrote it).
    expect(renderer.root.findByProps({ testID: 'tab-dashboard' })).toBeTruthy();
    expect(scenario.spies.setActiveRoom).not.toHaveBeenCalled();
    expect(scenario.stores.dashboardStore.getState().activeRoomId).toBe(
      'room-x',
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('runs the fallback once against the PERSISTED registry, not the seed', async () => {
    // Persisted active room "room-gone" no longer exists among the
    // persisted rooms ("room-y") — the fallback must fire exactly once,
    // after the loads complete, with the persisted first room.
    const scenario = raceHandle(['room-y'], 'room-gone');
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(scenario.spies.setActiveRoom).not.toHaveBeenCalled();

    await act(async () => {
      scenario.resolveDevices();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(scenario.spies.setActiveRoom).toHaveBeenCalledTimes(1);
    expect(scenario.spies.setActiveRoom).toHaveBeenCalledWith('room-y');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('Qwen tester blockers (exception fix)', () => {
  it('history screen never renders raw comment prose (blocker 1)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const texts: string[] = [];
    const walk = (node: TestRenderer.ReactTestInstance) => {
      const children = node.props.children;
      if (typeof children === 'string') {
        texts.push(children);
      } else if (Array.isArray(children)) {
        for (const entry of children) {
          if (typeof entry === 'string') {
            texts.push(entry);
          }
        }
      }
      for (const child of node.children) {
        if (typeof child === 'object') {
          walk(child as TestRenderer.ReactTestInstance);
        }
      }
    };
    walk(renderer.root);
    const all = texts.join('\n');

    expect(all).not.toContain('Cards are hidden');
    expect(all).not.toContain('stale series from the previously selected');
    await act(async () => {
      renderer.unmount();
    });
  });
});
