/**
 * App root — composition root bootstrap + navigation + MQTT lifecycle.
 *
 * Wires the dashboard/devices feature on top of the existing
 * telemetry/relay/history/settings modules:
 * - ThemeProvider driven by the persisted settings theme mode; the status
 *   bar follows the effective theme.
 * - NavigationContainer owns the navigation tree: `RootTabs` provides the
 *   EXACTLY three root tabs (Dashboard / Lịch sử / Cài đặt). The Dashboard
 *   tab is the VIEW-ONLY surface (active-theme gel gradient, MQTT badge,
 *   room strip of the ACTIVE Template, sectioned live widgets); all
 *   Template → Room → Widget management lives INSIDE the Settings tab's
 *   single typed native stack, opened by one management entry on the
 *   settings root screen (Template/Room are never root tabs and never
 *   screens of the Dashboard tab).
 * - Safe-area ownership: SafeAreaProvider at the root; RootTabs applies the
 *   runtime TOP inset exactly once per tab screen and the React Navigation
 *   tab bar owns the BOTTOM inset.
 * - bootstrap loads devices + dashboards, starts DeviceStateSync and reacts
 *   to `devices:changed` (cascade removeWidgetsForDevice).
 * - WidgetServices implementation (live state, series, commands, history,
 *   connection) provided to the dashboard grids; widgets subscribe
 *   reactively through `subscribeDeviceState`.
 * - History room-selection seam (approved compatibility decision): the
 *   History tab keeps using the dashboard module's persisted shared
 *   physical-room selection (`activeRoomId`) INDEPENDENTLY from the
 *   Settings management stack — a Template-room route is never a hidden
 *   global filter, and the fallback below keeps that selection valid.
 * - History queries carry a HistoryQuery value object with a stale-request
 *   guard in the history store. Every focus of the History tab re-queries
 *   the current room + range through the shell `TabFocusRefresh` wrapper
 *   (history-tab-focus-refresh — the first fetch ≡ the first focus, since
 *   `lazy: true` mounts the screen exactly when it first gains focus).
 * - Inter fonts load at the root via `useFonts`; the render gate waits for
 *   bootstrap loads AND fonts before the first frame.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';

import { defaultSettings, type AppSettings } from '@modules/settings/api';
import type { MqttConnectionConfig } from '@modules/telemetry/api';
import { mqttConnectionLabel } from '@core/i18n';
import {
  INTER_LIGHT,
  INTER_REGULAR,
  INTER_SEMIBOLD,
  ThemeProvider,
  useTheme,
} from '@core/theme';
import type { HistoryQuery, HistoryRange } from '@modules/history/api';
import { historyQueryForRoom, sensorFieldsForRoom } from '@modules/history/api';
import { HistoryScreen } from '@modules/history/ui/HistoryScreen';
import type { WidgetServices } from '@modules/widgets/api';
import type { CapabilityType } from '@modules/devices/api';
import { mqttRoomIdOf } from '@modules/devices/api';

import { RootTabs } from './src/app/shell/RootTabs';
import { TabFocusRefresh } from './src/app/shell/TabFocusRefresh';
import { SettingsNavigator } from './src/app/settings/SettingsNavigator';
import { DashboardScreen } from '@modules/dashboard/ui/DashboardScreen';
import { buildContainer } from './src/app/wiring/container';

/** Application singletons — created once at module load (composition root). */
const deps = buildContainer();

function toMqttConfig(settings: AppSettings): MqttConnectionConfig {
  return {
    host: settings.mqtt.host,
    port: settings.mqtt.port,
    username: settings.mqtt.username,
    password: settings.mqtt.password,
    prefix: settings.mqtt.prefix,
  };
}

/** Apply settings to telemetry / relay / history / board discovery. */
function applySettings(settings: AppSettings): void {
  deps.telemetryService.applyConfig(toMqttConfig(settings));
  deps.relayService.applyPrefix(settings.mqtt.prefix);
  deps.boardInventory.applyPrefix(settings.mqtt.prefix);
  deps.historyAdapter.configure(
    settings.influx.url,
    settings.influx.org,
    settings.influx.bucket,
    settings.influx.token,
  );
}

/**
 * Bootstrap: load settings + devices + dashboards, wire reactions, start
 * MQTT + the sync bridge.
 *
 * ALL persisted loads are awaited before the returned `loaded` promise
 * resolves — App grants readiness only after they complete, so the
 * History-room fallback can never run against the seed snapshot. Load
 * failures are reported through the logger; start behavior (services, sync
 * bridge, subscriptions, AppState lifecycle) is preserved.
 */
function bootstrap(): { loaded: Promise<void>; cleanup: () => void } {
  /**
   * Re-apply the persisted settings and start the real services. The store
   * adoption seam is parameterized: full events adopt the snapshot
   * wholesale via `setCurrent`, while UI-only events (theme) use
   * `applyPersistedUi` so a divergent unsaved technical draft survives the
   * theme round-trip. Services always reconfigure from the persisted
   * technical values.
   */
  const startServices = (
    settings: AppSettings,
    adoptStore: (persisted: AppSettings) => void,
  ) => {
    applySettings(settings);
    adoptStore(settings);
    deps.telemetryService.start();
    deps.relayService.startFeedbackListener();
    // boards-topic-contract-v2: discovery listens to BOTH the descriptor
    // and status wildcards (the telemetry resolver + the boards UI read
    // the descriptors).
    deps.boardInventory.startListeners();
  };
  const adoptFull = (persisted: AppSettings) => {
    deps.settingsStore.getState().setCurrent(persisted);
  };
  const adoptUiOnly = (persisted: AppSettings) => {
    deps.settingsStore.getState().applyPersistedUi(persisted);
  };

  // Settings load is independent; the DASHBOARD load is sequenced AFTER the
  // devices registry load: legacy migration re-orders room references (and
  // finalizes the sentinel reference) against `getRooms()` — running it
  // concurrently could sort against the SEED registry and persist a wrong
  // order. Readiness still waits for ALL loads.
  const loaded = Promise.all([
    deps.settingsService.load(),
    deps.devicesRegistry.load(),
  ])
    .then(([settingsResult, devicesResult]) => {
      if (!devicesResult.ok) {
        deps.logger.warn(`Devices load failed: ${devicesResult.error.message}`);
      }
      return deps.dashboardService
        .load()
        .then(dashboardsResult => ({ settingsResult, dashboardsResult }));
    })
    .then(({ settingsResult, dashboardsResult }) => {
      const settings: AppSettings = settingsResult.ok
        ? settingsResult.value
        : defaultSettings();
      // Bootstrap is a FULL persisted adoption: current and draft sync.
      startServices(settings, adoptFull);
      if (!dashboardsResult.ok) {
        deps.logger.warn(
          `Dashboards load failed: ${dashboardsResult.error.message}`,
        );
      }
    });

  // The sync bridge re-reads the registry per event, so it can start
  // alongside the loads (unchanged timing).
  deps.deviceStateSync.start();

  // React to settings changes.
  const unsubscribeSettings = deps.settingsService.onChanged(snapshot => {
    const settings: AppSettings = {
      mqtt: {
        host: snapshot.mqtt.host,
        port: snapshot.mqtt.port,
        username: snapshot.mqtt.username,
        password: snapshot.mqtt.password,
        prefix: snapshot.mqtt.prefix,
      },
      influx: {
        url: snapshot.influx.url,
        org: snapshot.influx.org,
        bucket: snapshot.influx.bucket,
        token: snapshot.influx.token,
      },
      ui: {
        theme: snapshot.ui.theme,
      },
    };
    if (snapshot.changeScope === 'ui-only') {
      // UI-only persistence (theme): services reconfigure from the
      // persisted technical values, but the settings store must KEEP the
      // divergent unsaved technical draft.
      startServices(settings, adoptUiOnly);
      return;
    }
    startServices(settings, adoptFull);
  });

  // Cascade: when a device is removed, drop its widgets from every
  // Template-room layout and its live values/series from the device state
  // store. When only ONE projected sensor metric of a surviving legacy
  // multi-capability device is removed, the cascade is binding-level.
  const unsubscribeDevicesChanged = deps.bus.subscribe(
    'devices:changed',
    event => {
      for (const deviceId of event.removedDeviceIds) {
        void deps.dashboardService.removeWidgetsForDevice(deviceId);
        deps.deviceStateStore.getState().removeDevice(deviceId);
      }
      for (const binding of event.removedBindings) {
        void deps.dashboardService.removeWidgetsForBinding(
          binding.deviceId,
          binding.capability,
        );
        deps.deviceStateStore
          .getState()
          .clearCapability(binding.deviceId, binding.capability);
      }
    },
  );

  // Forward relay states + board discovery messages from the shared MQTT
  // stream (boards-topic-contract-v2: the retained descriptor wildcard
  // feeds the board inventory through the same client as status/relay —
  // no extra connection; handler order is irrelevant, each handler only
  // claims its own topic shape).
  deps.mqttClient.onMessage(message => {
    deps.relayService.handleFeedbackMessage(message);
    deps.boardInventory.handleDescriptorMessage(message);
    deps.boardInventory.handleStatusMessage(message);
  });

  // AppState lifecycle: disconnect on background, reconnect on foreground.
  const handleAppState = (next: AppStateStatus) => {
    if (next === 'background' || next === 'inactive') {
      deps.telemetryService.stop();
    } else if (next === 'active') {
      deps.telemetryService.start();
    }
  };
  const appStateSub = AppState.addEventListener('change', handleAppState);

  return {
    loaded,
    cleanup: () => {
      unsubscribeSettings();
      unsubscribeDevicesChanged();
      appStateSub.remove();
      deps.deviceStateSync.stop();
      deps.telemetryService.stop();
    },
  };
}

/** Status bar that follows the effective theme. */
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const bootstrapped = useRef(false);

  // Inter custom font: loaded once at the root; the render gate below
  // waits for it so the first frame never flashes the system font.
  const [fontsLoaded] = useFonts({
    [INTER_LIGHT]: Inter_300Light,
    [INTER_REGULAR]: Inter_400Regular,
    [INTER_SEMIBOLD]: Inter_600SemiBold,
  });

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;

    // Readiness is granted ONLY after every persisted load completed: the
    // fallback below must never observe the seed snapshot.
    const { loaded, cleanup } = bootstrap();
    void loaded.then(() => {
      setReady(true);
    });
    return cleanup;
  }, []);

  // Reactive store subscriptions (zustand) so the UI re-renders on updates.
  const themeMode = useStore(
    deps.settingsStore,
    state => state.current.ui.theme,
  );
  // The ACTIVE Template (deterministic first-Template fallback mirrors the
  // service's own fallback): the Dashboard tab's view surface renders its
  // ordered room references and the selected room's Template layout.
  const activeTemplate = useStore(
    deps.dashboardStore,
    state =>
      state.templates.find(template => template.id === state.activeId) ??
      state.templates[0],
  );
  const activeRoomId = useStore(
    deps.dashboardStore,
    state => state.activeRoomId,
  );
  const rooms = useStore(deps.devicesStore, state => state.snapshot.rooms);
  const devices = useStore(deps.devicesStore, state => state.snapshot.devices);
  const capabilities = useStore(
    deps.devicesStore,
    state => state.snapshot.capabilities,
  );
  const connection = useStore(deps.telemetryStore, state => state.connection);
  const lastErrorCode = useStore(
    deps.telemetryStore,
    state => state.lastErrorCode,
  );
  const historyRange = useHistoryRange();
  const historySeries = useHistorySeries();
  const historyLoading = useHistoryLoading();
  const historyError = useHistoryError();

  // MQTT badge snapshot for the view-only Dashboard screen (same shape the
  // management screens use — state + friendly label + failure cause).
  // Memoized on the underlying primitives so the identity stays stable for
  // `useSyncExternalStore` (the widget layer's amendment-2 offline lock
  // reads it through `WidgetServices.getConnectionState`).
  const connectionState = useMemo(
    () => ({
      state: connection,
      label: mqttConnectionLabel(connection),
      errorCode: lastErrorCode ?? undefined,
    }),
    [connection, lastErrorCode],
  );

  // History room-selection seam: the shared physical-room selection must
  // stay valid for the History tab. First run / deleted room / empty
  // selection fall back to the first ordered room; the no-room state is
  // handled by the screen's empty hint. Gated on `ready` — the persisted
  // loads must have completed so this write can never run against the seed
  // snapshot and overwrite the persisted selection.
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (rooms.length === 0) {
      return;
    }
    const valid =
      activeRoomId !== null && rooms.some(room => room.id === activeRoomId);
    if (!valid) {
      const first = [...rooms].sort((a, b) => a.order - b.order)[0]!;
      void deps.dashboardService.setActiveRoom(first.id);
    }
  }, [ready, rooms, activeRoomId]);

  /**
   * History tag identity (board-discovery-binding + boards-topic-contract-
   * v2): the Influx tag carries the room's MQTT identity — the board `code`
   * when the room is bound, the internal room id otherwise. For a
   * board-bound room the query filters the `boardId` tag (the backend's
   * direct-Influx contract) while unbound rooms keep the historical
   * `roomId` filter. Field derivation stays scoped by the internal id
   * (registrations never carry codes).
   */
  const historyTagRoomIdFor = (roomId: string | null): string | null => {
    if (roomId === null) {
      return null;
    }
    const room = rooms.find(candidate => candidate.id === roomId);
    return room ? mqttRoomIdOf(room) : roomId;
  };

  /**
   * History tag arguments for one room: `tagRoomId` feeds the legacy
   * `roomId` filter and `boardCode` (bound rooms only) switches the query
   * to the `boardId` tag filter (`{boardId, roomId: null}`).
   */
  const historyTagArgsFor = (
    roomId: string | null,
  ): { tagRoomId: string | undefined; boardCode?: string } => {
    if (roomId === null) {
      return { tagRoomId: undefined };
    }
    const room = rooms.find(candidate => candidate.id === roomId);
    if (!room) {
      return { tagRoomId: roomId };
    }
    return room.code !== undefined
      ? { tagRoomId: room.code, boardCode: room.code }
      : { tagRoomId: room.id };
  };

  // History always uses the active Template's SAVED room layout. A missing
  // reference is an explicit empty scope; draftWidgets never enter this path.
  const savedHistoryWidgetsFor = (roomId: string | null) =>
    activeTemplate?.rooms.find(reference => reference.roomId === roomId)
      ?.widgets ?? null;
  const historyFields = sensorFieldsForRoom(
    devices,
    capabilities,
    activeRoomId,
    savedHistoryWidgetsFor(activeRoomId),
  );
  const historyNoSensors = activeRoomId !== null && historyFields.length === 0;

  /**
   * Run the room history query for a room + range with the stale guard:
   * `beginRequest` invalidates older in-flight requests, so a slow older
   * response can never overwrite a newer room/range result. Rooms without
   * eligible saved sensor widgets short-circuit to an empty series set (through
   * beginRequest, invalidating anything still in flight). The data source
   * is the selectable front door: demo data while the Settings toggle is
   * ON, InfluxDB otherwise (default).
   */
  const runHistoryQuery = (roomId: string | null, range: HistoryRange) => {
    const store = deps.historyStore.getState();
    const requestId = store.beginRequest();
    const tags = historyTagArgsFor(roomId);
    const query = historyQueryForRoom(
      devices,
      capabilities,
      roomId,
      range,
      tags.tagRoomId,
      tags.boardCode,
      savedHistoryWidgetsFor(roomId),
    );
    if (!query) {
      store.setSeriesIfCurrent(requestId, []);
      return;
    }
    void deps.historySource.query(query).then(result => {
      if (result.ok) {
        deps.historyStore
          .getState()
          .setSeriesIfCurrent(requestId, result.value);
      } else {
        deps.historyStore
          .getState()
          .setErrorIfCurrent(requestId, result.error.message);
      }
    });
  };

  // WidgetServices: the runtime bridge widgets consume through context.
  // The live MQTT connection snapshot rides the same seam (scope amendment
  // 2 — the switch widgets' offline lock): `getConnectionState` returns the
  // memoized snapshot above and `subscribeConnection` forwards the
  // telemetry store's subscription. The services identity changes only
  // when the connection snapshot changes (a deliberate, rare re-render).
  const widgetServices = useMemo<WidgetServices>(
    () => ({
      getState: (deviceId, capability: CapabilityType) => {
        const key = `${deviceId}:${capability}`;
        return deps.deviceStateStore.getState().values[key];
      },
      getSeries: (deviceId, capability) =>
        deps.deviceStateStore.getState().getSeriesPoints(deviceId, capability),
      sendCommand: (deviceId, capability, value) =>
        deps.deviceCommandService.sendCommand(deviceId, capability, value),
      getCommandError: (deviceId, capability: CapabilityType) =>
        deps.deviceStateStore
          .getState()
          .getCommandError(deviceId, capability) ?? null,
      queryHistory: (query: HistoryQuery) => deps.historySource.query(query),
      getRooms: () => deps.devicesRegistry.getRooms(),
      getDevices: () => deps.devicesRegistry.getDevices(),
      getCapabilities: () => deps.devicesRegistry.getCapabilities(),
      getActiveRoomId: () => deps.dashboardService.getActiveRoomId(),
      subscribeDeviceState: listener =>
        deps.deviceStateStore.subscribe(listener),
      getConnectionState: () => connectionState,
      subscribeConnection: listener => deps.telemetryStore.subscribe(listener),
    }),
    [connectionState],
  );

  // Render gate: bootstrap loads AND fonts must both be ready (no FOUT /
  // system-font flash; also keeps the room fallback ordering guarantees).
  if (!ready || !fontsLoaded) {
    return null;
  }

  return (
    // Root safe-area provider: must wrap every `useSafeAreaInsets` consumer
    // (RootTabs owns applying the runtime top inset exactly once; the tab
    // bar owns the bottom).
    <SafeAreaProvider>
      <ThemeProvider mode={themeMode}>
        {/* StatusBar must live INSIDE ThemeProvider — it reads the effective
            theme through useTheme. */}
        <ThemedStatusBar />
        <NavigationContainer>
          <RootTabs
            renderDashboard={() => (
              // View-only surface: the ACTIVE Template's room strip +
              // selected room's layout. No management affordances — every
              // mutation lives behind the Settings tab's management stack.
              <DashboardScreen
                template={activeTemplate}
                connection={connectionState}
                rooms={rooms}
                registry={deps.widgetRegistry}
                services={widgetServices}
              />
            )}
            renderHistory={() => (
              // history-tab-focus-refresh: EVERY focus of the History tab
              // (including the first — `lazy: true` makes mount ≡ first
              // focus) re-queries the current room + range through the
              // stale-guarded `runHistoryQuery` below. The wrapper lives in
              // the shell (navigation concern); the screen stays
              // prop-driven. Re-renders with a new callback identity
              // (telemetry ticks) never re-fire it — the wrapper reads the
              // latest callback through a ref.
              <TabFocusRefresh
                onFocus={() => {
                  runHistoryQuery(activeRoomId, historyRange);
                }}
              >
                <HistoryScreen
                  range={historyRange}
                  series={historySeries}
                  loading={historyLoading}
                  error={historyError}
                  rooms={rooms}
                  registeredFields={historyFields}
                  capabilities={capabilities}
                  roomId={activeRoomId}
                  seriesRoomId={historyTagRoomIdFor(activeRoomId)}
                  noSensors={historyNoSensors}
                  onRangeChange={range => {
                    deps.historyStore.getState().setRange(range);
                    runHistoryQuery(activeRoomId, range);
                  }}
                  onRoomChange={roomId => {
                    // Updates the shared History room selection (dashboard
                    // module persistence) AND immediately re-queries history
                    // for the new room (stale cards from the previous room
                    // must not survive a room switch; a sensor-less room
                    // short-circuits through beginRequest, clearing the
                    // in-flight/previous series).
                    void deps.dashboardService.setActiveRoom(roomId);
                    runHistoryQuery(roomId, historyRange);
                  }}
                />
              </TabFocusRefresh>
            )}
            renderSettings={() => (
              <SettingsNavigator deps={deps} services={widgetServices} />
            )}
            onSettingsLeave={() => {
              // Leaving the Settings tab discards any open editor draft
              // (never silently persisted) — the stack reset itself is
              // owned by RootTabs.
              deps.dashboardStore.getState().cancelEdit();
            }}
          />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function useHistoryRange() {
  return useStore(deps.historyStore, state => state.range);
}
function useHistorySeries() {
  return useStore(deps.historyStore, state => state.series);
}
function useHistoryLoading() {
  return useStore(deps.historyStore, state => state.loading);
}
function useHistoryError() {
  return useStore(deps.historyStore, state => state.error);
}
