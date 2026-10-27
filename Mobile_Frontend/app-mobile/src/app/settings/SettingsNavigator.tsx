/**
 * SettingsNavigator — the Settings tab's ONE typed native stack (official
 * single navigation system; the hand-written `routeMachine` is retired and
 * its transition coverage replaced by {@link ./SettingsNavigator.test.tsx}):
 *
 *   root (settings summary) → advanced
 *                           → device-management
 *                           → TemplateList → CreateTemplate
 *                                          → RoomList → CreateRoom
 *                                                     → RoomDashboard
 *                                                     → EditRoomDashboard
 *
 * The Template → Room → Widget management hierarchy lives INSIDE Settings
 * (one management entry on the root screen) — the Dashboard tab stays the
 * view-only surface. The management screens are dumb (props in, callbacks
 * out); this navigator is the only place they meet React Navigation and the
 * composition-root services (module persistence ownership is unchanged).
 *
 * Back behavior: Android/native back pops the stack (React Navigation); the
 * editor route's Hủy path discards the draft BEFORE leaving (never silent
 * persistence — see {@link ./hierarchyRoutes.tsx}).
 *
 * Connection truthfulness: the MQTT retry action drives the REAL telemetry
 * service lifecycle (no parallel MQTT client); the explicit Influx probe
 * queries the RAW `historyAdapter` — never the demo history source.
 */

import React from 'react';
import { useStore } from 'zustand';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { STRINGS } from '@core/i18n';
import type { WidgetServices } from '@modules/widgets/api';
import type {
  DevicePatch,
  NewCapabilityInput,
  NewDeviceInput,
} from '@modules/devices/api';
import { SettingsScreen } from '@modules/settings/ui/SettingsScreen';
import { AdvancedSettingsScreen } from '@modules/settings/ui/AdvancedSettingsScreen';
import { BoardsScreen } from '@modules/devices/ui/BoardsScreen';
import { DeviceManagementScreen } from '@modules/devices/ui/DevicesScreen';

import type { AppDependencies } from '../wiring/container';
import type { SettingsStackParams } from './routes';
import {
  CreateRoomRoute,
  CreateTemplateRoute,
  EditRoomDashboardRoute,
  RoomDashboardRoute,
  RoomListRoute,
  TemplateListRoute,
  toOutcome,
} from './hierarchyRoutes';

const Stack = createNativeStackNavigator<SettingsStackParams>();
const EMPTY_DELETED_BOARD_CODES: readonly string[] = [];

interface SettingsNavigatorProps {
  /** Composition-root singletons (services + stores). */
  readonly deps: AppDependencies;
  /** The runtime widget services (widget grids render live state). */
  readonly services: WidgetServices;
}

/**
 * The Settings tab content: one native stack from the root summary screen
 * through the management hierarchy.
 *
 * @param props - see {@link SettingsNavigatorProps}.
 */
export function SettingsNavigator({ deps, services }: SettingsNavigatorProps) {
  // Mirror-store subscriptions for the root/advanced/device screens (the
  // hierarchy routes subscribe inside their own route components).
  const settingsDraft = useStore(deps.settingsStore, state => state.draft);
  const settingsCurrent = useStore(deps.settingsStore, state => state.current);
  const settingsErrors = useStore(deps.settingsStore, state => state.errors);
  const rooms = useStore(deps.devicesStore, state => state.snapshot.rooms);
  const devices = useStore(deps.devicesStore, state => state.snapshot.devices);
  const deletedBoardCodes = useStore(
    deps.devicesStore,
    state => state.snapshot.deletedBoardCodes ?? EMPTY_DELETED_BOARD_CODES,
  );
  const capabilities = useStore(
    deps.devicesStore,
    state => state.snapshot.capabilities,
  );
  const connection = useStore(deps.telemetryStore, state => state.connection);
  const lastErrorCode = useStore(
    deps.telemetryStore,
    state => state.lastErrorCode,
  );
  // Board discovery (board-discovery-binding): the mirror store pushed by
  // the BoardInventoryService feeds the boards screen.
  const boards = useStore(deps.boardStore, state => state.boards);

  /**
   * Draft-vs-persisted dirtiness for the advanced diagnostics contract.
   * (Service Results map to UI outcomes through the shared `toOutcome`
   * imported from {@link ./hierarchyRoutes.tsx}.)
   */
  const settingsEqual = (
    a: { mqtt: unknown; influx: unknown },
    b: { mqtt: unknown; influx: unknown },
  ): boolean =>
    JSON.stringify(a.mqtt) === JSON.stringify(b.mqtt) &&
    JSON.stringify(a.influx) === JSON.stringify(b.influx);
  const mqttDirty = !settingsEqual(
    { mqtt: settingsDraft.mqtt, influx: {} },
    { mqtt: settingsCurrent.mqtt, influx: {} },
  );
  const influxDirty = !settingsEqual(
    { mqtt: {}, influx: settingsDraft.influx },
    { mqtt: {}, influx: settingsCurrent.influx },
  );

  return (
    <Stack.Navigator
      initialRouteName="root"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="root">
        {({
          navigation,
        }: NativeStackScreenProps<SettingsStackParams, 'root'>) => (
          <SettingsScreen
            settings={settingsDraft.ui}
            onUpdateUi={patch => {
              deps.settingsStore.getState().updateUi(patch);
            }}
            onOpenDashboardManager={() => navigation.navigate('TemplateList')}
            onOpenBoards={() => navigation.navigate('boards')}
            onOpenDeviceManagement={() =>
              navigation.navigate('device-management')
            }
            onOpenAdvanced={() => navigation.navigate('advanced')}
            connectionState={connection}
            lastErrorCode={lastErrorCode}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="advanced">
        {({
          navigation,
        }: NativeStackScreenProps<SettingsStackParams, 'advanced'>) => (
          <AdvancedSettingsScreen
            onBack={() => navigation.goBack()}
            settings={settingsDraft}
            // The live MQTT status card + the status-card visibility rule
            // describe the PERSISTED config — what the real telemetry
            // client actually connects to (never the draft).
            persistedMqtt={settingsCurrent.mqtt}
            // The probe tests the raw history adapter, which is configured
            // from the LAST PERSISTED settings (`settings:changed`) — pass
            // that config so probe results are fingerprinted against their
            // true target.
            persistedInflux={settingsCurrent.influx}
            errors={settingsErrors}
            onUpdateMqtt={patch => {
              deps.settingsStore.getState().updateMqtt(patch);
            }}
            onUpdateInflux={patch => {
              deps.settingsStore.getState().updateInflux(patch);
            }}
            onSave={async candidate => {
              const result = await deps.settingsService.save(candidate);
              return {
                ok: result.ok,
                message: result.ok
                  ? STRINGS.settings.saved
                  : result.error.message,
              };
            }}
            connectionState={connection}
            lastErrorCode={lastErrorCode}
            mqttDirty={mqttDirty}
            influxDirty={influxDirty}
            onMqttRetry={() => {
              // Real lifecycle only (approved contract): stop → start the
              // actual telemetry service. NO parallel MQTT client exists.
              deps.telemetryService.stop();
              deps.telemetryService.start();
            }}
            onCheckInflux={async () => {
              // Raw explicit probe against the InfluxDB adapter — no room
              // filter (`roomId: null`), default fields. The demo history
              // source is never consulted — a demo dataset must not fake a
              // connectivity check.
              const influxResult = await deps.historyAdapter.query({
                measurement: 'sensors',
                range: '1h',
                fields: [],
                roomId: null,
              });
              return influxResult.ok ? 'ok' : 'fail';
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="boards">
        {({
          navigation,
        }: NativeStackScreenProps<SettingsStackParams, 'boards'>) => (
          <BoardsScreen
            onBack={() => navigation.goBack()}
            boards={boards}
            rooms={rooms}
            capabilities={capabilities}
            deletedBoardCodes={deletedBoardCodes}
            onAssignBoard={async (code, roomId) => {
              // Atomic board rebind (fix cycle 2): the registry clears the
              // code's current holder (if any) and binds the target in ONE
              // validated write — assigning an already-bound board to
              // another room TRANSFERS it (the source room keeps its
              // devices/widgets; only the MQTT identity moves). A target
              // that held a different code releases it. Plain updateRoom
              // would wrongly reject the transfer via the uniqueness check.
              const result = await deps.devicesRegistry.rebindRoomBoard(
                code,
                roomId,
              );
              return toOutcome(result);
            }}
            onDeleteBoard={async code => {
              const result = await deps.devicesRegistry.removeBoard(code);
              return toOutcome(result);
            }}
            onRestoreBoard={async (code, boardType) => {
              const result = await deps.devicesRegistry.restoreBoard(code);
              if (result.ok) {
                // Seed/refresh the inventory entry unconditionally. Clearing
                // the hide marker alone is not enough: the ESP32 publishes its
                // descriptor ONCE on connect (retained), so a board that was
                // deleted and then re-provisioned has no cached entry to
                // reveal — the card would stay invisible until the board
                // reboots. `boardType` is optional (a BLE-only recovery has no
                // QR label); the entry still lands, rendering the placeholder.
                deps.boardInventory.restoreFromQr(code, boardType);
              }
              return toOutcome(result);
            }}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="device-management">
        {({
          navigation,
        }: NativeStackScreenProps<
          SettingsStackParams,
          'device-management'
        >) => (
          <DeviceManagementScreen
            onBack={() => navigation.goBack()}
            rooms={rooms}
            devices={devices}
            capabilities={capabilities}
            boards={boards}
            onAddRoom={async (name, code) => {
              // Room-first device management: the created room is returned
              // so the screen can open its detail immediately on success.
              // `code` (board-discovery-binding) binds the created room to
              // the board picked in the AddRoomDialog step.
              const result = await deps.devicesRegistry.addRoom(name, code);
              return result.ok
                ? { ok: true, message: '', roomId: result.value.id }
                : { ok: false, message: result.error.message || 'Lỗi' };
            }}
            onRenameRoom={async (roomId, name) => {
              const result = await deps.devicesRegistry.updateRoom(roomId, {
                name,
              });
              return toOutcome(result);
            }}
            onRemoveRoom={async (roomId, target) => {
              const result = await deps.devicesRegistry.removeRoomWithMigration(
                roomId,
                target,
              );
              return toOutcome(result);
            }}
            onAddDevice={async (input: NewDeviceInput) => {
              const result = await deps.devicesRegistry.addDevice(input);
              return toOutcome(result);
            }}
            onUpdateDevice={async (id: string, patch: DevicePatch) => {
              const result = await deps.devicesRegistry.updateDevice(id, patch);
              return toOutcome(result);
            }}
            onRemoveDevice={async (id: string) => {
              const result = await deps.devicesRegistry.removeDevice(id);
              return toOutcome(result);
            }}
            onAddCapability={async (input: NewCapabilityInput) => {
              const result = await deps.devicesRegistry.addCapability(input);
              return toOutcome(result);
            }}
            onRemoveDeviceCapability={async (
              deviceId: string,
              field: string,
            ) => {
              const result = await deps.devicesRegistry.removeDeviceCapability(
                deviceId,
                field,
              );
              return toOutcome(result);
            }}
          />
        )}
      </Stack.Screen>

      {/* Template → Room → Widget management hierarchy (view-only tab is
          the Dashboard; mutations live only here). */}
      <Stack.Screen name="TemplateList">
        {({
          navigation,
        }: NativeStackScreenProps<SettingsStackParams, 'TemplateList'>) => (
          <TemplateListRoute
            deps={deps}
            services={services}
            navigation={navigation}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="CreateTemplate">
        {({
          navigation,
        }: NativeStackScreenProps<SettingsStackParams, 'CreateTemplate'>) => (
          <CreateTemplateRoute
            deps={deps}
            services={services}
            navigation={navigation}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="RoomList">
        {({
          navigation,
          route,
        }: NativeStackScreenProps<SettingsStackParams, 'RoomList'>) => (
          <RoomListRoute
            deps={deps}
            services={services}
            navigation={navigation}
            route={route}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="CreateRoom">
        {({
          navigation,
          route,
        }: NativeStackScreenProps<SettingsStackParams, 'CreateRoom'>) => (
          <CreateRoomRoute
            deps={deps}
            services={services}
            navigation={navigation}
            route={route}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="RoomDashboard">
        {({
          navigation,
          route,
        }: NativeStackScreenProps<SettingsStackParams, 'RoomDashboard'>) => (
          <RoomDashboardRoute
            deps={deps}
            services={services}
            navigation={navigation}
            route={route}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="EditRoomDashboard">
        {({
          navigation,
          route,
        }: NativeStackScreenProps<
          SettingsStackParams,
          'EditRoomDashboard'
        >) => (
          <EditRoomDashboardRoute
            deps={deps}
            services={services}
            navigation={navigation}
            route={route}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
