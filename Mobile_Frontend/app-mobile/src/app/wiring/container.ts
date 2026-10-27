/**
 * Composition root — wires every interface to its implementation.
 *
 * This is the ONLY place where concrete classes are instantiated and shared
 * singletons (logger, event bus, stores) are created. Modules never construct
 * each other's implementations.
 */

import { Container } from '@core/di';
import { createLogger, type Logger } from '@core/logger';
import { InMemoryEventBus, type EventBus } from '@core/eventbus';
import { SystemClock, type Clock } from '@core/time';
import { DEFAULT_MQTT_PREFIX, DEFAULT_MQTT_WS_PORT } from '@core/constants';

import type { MqttConnectionConfig } from '@modules/telemetry/api';

import {
  AsyncStorageSettingsRepository,
  SettingsServiceImpl,
  createSettingsStore,
  type SettingsStore,
} from '@modules/settings/api';
import {
  createTelemetryStore,
  MqttJsClient,
  TelemetryServiceImpl,
  type TelemetryStore,
} from '@modules/telemetry/api';
import {
  createRelayStore,
  RelayServiceImpl,
  type RelayStore,
} from '@modules/relay/api';
import {
  createHistoryStore,
  DemoHistoryDataSource,
  InfluxV2Adapter,
  SelectableHistoryDataSource,
  type HistoryStore,
} from '@modules/history/api';
import {
  AsyncStorageDevicesRepository,
  createDeviceStateStore,
  BoardInventoryService,
  DeviceCommandServiceImpl,
  DeviceRegistryServiceImpl,
  DeviceStateSync,
  createBoardStore,
  type BoardStore,
  type DevicesStore,
  type DeviceStateStore,
} from '@modules/devices/api';
import {
  createDefaultRegistry,
  type WidgetRegistry,
} from '@modules/widgets/api';
import {
  AsyncStorageDashboardRepository,
  DashboardServiceImpl,
  type DashboardStore,
} from '@modules/dashboard/api';

/** DI tokens (plain symbols keep the container type-safe). */
export const TOKENS = {
  logger: Symbol('logger'),
  bus: Symbol('eventBus'),
  clock: Symbol('clock'),
  settingsService: Symbol('settingsService'),
  settingsStore: Symbol('settingsStore'),
  mqttClient: Symbol('mqttClient'),
  telemetryService: Symbol('telemetryService'),
  telemetryStore: Symbol('telemetryStore'),
  relayService: Symbol('relayService'),
  relayStore: Symbol('relayStore'),
  historyAdapter: Symbol('historyAdapter'),
  demoHistorySource: Symbol('demoHistorySource'),
  historySource: Symbol('historySource'),
  historyStore: Symbol('historyStore'),
  devicesRepository: Symbol('devicesRepository'),
  devicesRegistry: Symbol('devicesRegistry'),
  devicesStore: Symbol('devicesStore'),
  deviceStateStore: Symbol('deviceStateStore'),
  deviceStateSync: Symbol('deviceStateSync'),
  deviceCommandService: Symbol('deviceCommandService'),
  boardInventory: Symbol('boardInventory'),
  boardStore: Symbol('boardStore'),
  widgetRegistry: Symbol('widgetRegistry'),
  dashboardRepository: Symbol('dashboardRepository'),
  dashboardService: Symbol('dashboardService'),
  dashboardStore: Symbol('dashboardStore'),
} as const;

/** Shared singletons returned for the React tree. */
export interface AppDependencies {
  logger: Logger;
  bus: EventBus;
  clock: Clock;
  settingsService: SettingsServiceImpl;
  settingsStore: SettingsStore;
  mqttClient: MqttJsClient;
  telemetryService: TelemetryServiceImpl;
  telemetryStore: TelemetryStore;
  relayService: RelayServiceImpl;
  relayStore: RelayStore;
  historyAdapter: InfluxV2Adapter;
  /**
   * The UI history front door (demo↔Influx selector). `historyAdapter`
   * stays the RAW Influx adapter: `applySettings` configures it and the
   * Settings connection probe probes it directly — demo mode must never
   * fake a connectivity check.
   */
  historySource: SelectableHistoryDataSource;
  historyStore: HistoryStore;
  devicesRepository: AsyncStorageDevicesRepository;
  devicesRegistry: DeviceRegistryServiceImpl;
  devicesStore: DevicesStore;
  deviceStateStore: DeviceStateStore;
  deviceStateSync: DeviceStateSync;
  deviceCommandService: DeviceCommandServiceImpl;
  /**
   * Board discovery (boards-topic-contract-v2): subscribes the descriptor +
   * status wildcards on the SHARED MQTT client and maintains the
   * discovered-board inventory from retained descriptors + status messages
   * (descriptor-driven — bus data events never create entries).
   */
  boardInventory: BoardInventoryService;
  /** Mirror store the board inventory pushes snapshots into. */
  boardStore: BoardStore;
  widgetRegistry: WidgetRegistry;
  dashboardRepository: AsyncStorageDashboardRepository;
  dashboardService: DashboardServiceImpl;
  dashboardStore: DashboardStore;
}

/** Build the full dependency graph. Call once at app startup. */
export function buildContainer(): AppDependencies {
  const container = new Container();

  container.register(TOKENS.logger, () => createLogger('app'));
  container.register(
    TOKENS.bus,
    () => new InMemoryEventBus(container.resolve<Logger>(TOKENS.logger)),
  );
  container.register(TOKENS.clock, () => new SystemClock());

  // Settings: repository → service → store.
  container.register(TOKENS.settingsService, () => {
    const logger = container.resolve<Logger>(TOKENS.logger);
    const repository = new AsyncStorageSettingsRepository(logger);
    return new SettingsServiceImpl(
      repository,
      container.resolve<EventBus>(TOKENS.bus),
      logger,
    );
  });
  container.register(TOKENS.settingsStore, () =>
    createSettingsStore(
      container.resolve<SettingsServiceImpl>(TOKENS.settingsService),
    ),
  );

  // MQTT client is shared between telemetry and relay.
  container.register(
    TOKENS.mqttClient,
    () => new MqttJsClient(container.resolve<Logger>(TOKENS.logger)),
  );

  // Telemetry: client + store + service. The descriptor resolver port is
  // wired LAZILY (the same pattern as the registry `getRooms` getters):
  // boardInventory is registered later in this file, so resolving it inside
  // the callback avoids a construction cycle.
  container.register(TOKENS.telemetryStore, () => createTelemetryStore());
  container.register(
    TOKENS.telemetryService,
    () =>
      new TelemetryServiceImpl({
        client: container.resolve<MqttJsClient>(TOKENS.mqttClient),
        bus: container.resolve<EventBus>(TOKENS.bus),
        logger: container.resolve<Logger>(TOKENS.logger),
        store: container.resolve<TelemetryStore>(TOKENS.telemetryStore),
        config: EMPTY_CONFIG,
        // Descriptor channel → semantic field (boards-topic-contract-v2):
        // unresolved readings buffer inside the telemetry service and
        // replay on `board:changed`.
        resolveSensorField: (boardId, channel) =>
          container
            .resolve<BoardInventoryService>(TOKENS.boardInventory)
            .resolveSensorField(boardId, channel),
      }),
  );

  // Relay: same MQTT client, own store + service. The Clock drives the
  // deterministic command-acknowledgement timeout (M13-4).
  container.register(TOKENS.relayStore, () => createRelayStore());
  container.register(
    TOKENS.relayService,
    () =>
      new RelayServiceImpl({
        client: container.resolve<MqttJsClient>(TOKENS.mqttClient),
        bus: container.resolve<EventBus>(TOKENS.bus),
        logger: container.resolve<Logger>(TOKENS.logger),
        store: container.resolve<RelayStore>(TOKENS.relayStore),
        prefix: DEFAULT_MQTT_PREFIX,
        clock: container.resolve<Clock>(TOKENS.clock),
      }),
  );

  // History: InfluxDB adapter + store. The UI-facing source is a selector
  // (Influx default ⇄ in-memory demo toggle); see AppDependencies.
  container.register(TOKENS.historyStore, () => createHistoryStore());
  container.register(
    TOKENS.historyAdapter,
    () =>
      new InfluxV2Adapter(
        { url: '', org: '', bucket: '', token: '' },
        container.resolve<Logger>(TOKENS.logger),
      ),
  );
  container.register(
    TOKENS.demoHistorySource,
    () => new DemoHistoryDataSource(),
  );
  container.register(
    TOKENS.historySource,
    () =>
      new SelectableHistoryDataSource(
        container.resolve<InfluxV2Adapter>(TOKENS.historyAdapter),
        container.resolve<DemoHistoryDataSource>(TOKENS.demoHistorySource),
      ),
  );

  // Widgets: default registry (2 built-in types).
  container.register(TOKENS.widgetRegistry, () => createDefaultRegistry());

  // Devices: repository → registry service → mirror store; live state store +
  // sync bridge; command router (delegates switch → relayService).
  // The `isCapabilityInUse` predicate inspects dashboard widget bindings
  // (resolved lazily to avoid a construction cycle with dashboardService).
  container.register(
    TOKENS.devicesRepository,
    () =>
      new AsyncStorageDevicesRepository(
        container.resolve<Logger>(TOKENS.logger),
      ),
  );
  container.register(
    TOKENS.devicesRegistry,
    () =>
      new DeviceRegistryServiceImpl({
        repository: container.resolve<AsyncStorageDevicesRepository>(
          TOKENS.devicesRepository,
        ),
        bus: container.resolve<EventBus>(TOKENS.bus),
        logger: container.resolve<Logger>(TOKENS.logger),
        clock: container.resolve<Clock>(TOKENS.clock),
        isCapabilityInUse: type =>
          container
            .resolve<DashboardServiceImpl>(TOKENS.dashboardService)
            .getTemplates()
            .some(template =>
              template.rooms.some(room =>
                room.widgets.some(
                  widget => widget.binding?.capability === type,
                ),
              ),
            ),
        migrateWidgetsFromRoom: (fromId, toId) =>
          container
            .resolve<DashboardServiceImpl>(TOKENS.dashboardService)
            .migrateWidgetsFromRoom(fromId, toId),
      }),
  );
  container.register(TOKENS.devicesStore, () =>
    container
      .resolve<DeviceRegistryServiceImpl>(TOKENS.devicesRegistry)
      .getStore(),
  );
  container.register(TOKENS.deviceStateStore, () => createDeviceStateStore());
  container.register(
    TOKENS.deviceStateSync,
    () =>
      new DeviceStateSync({
        bus: container.resolve<EventBus>(TOKENS.bus),
        registry: container.resolve<DeviceRegistryServiceImpl>(
          TOKENS.devicesRegistry,
        ),
        // Board-discovery-binding identity entrance: resolve incoming wire
        // room ids (board codes first, internal ids fallback) against the
        // registry's CURRENT rooms snapshot — the registry mutates its
        // snapshot synchronously before broadcasting `devices:changed`, so
        // the getter is always fresh without a local cache.
        getRooms: () =>
          container
            .resolve<DeviceRegistryServiceImpl>(TOKENS.devicesRegistry)
            .getRooms(),
        store: container.resolve<DeviceStateStore>(TOKENS.deviceStateStore),
        logger: container.resolve<Logger>(TOKENS.logger),
      }),
  );
  container.register(
    TOKENS.deviceCommandService,
    () =>
      new DeviceCommandServiceImpl({
        registry: container.resolve<DeviceRegistryServiceImpl>(
          TOKENS.devicesRegistry,
        ),
        relayService: container.resolve<RelayServiceImpl>(TOKENS.relayService),
      }),
  );

  // Board discovery: descriptor + status wildcards on the SHARED MQTT
  // client + mirror store (prefix discipline mirrors relayService;
  // applyPrefix is driven by the app bootstrap on settings changes).
  container.register(TOKENS.boardStore, () => createBoardStore());
  container.register(
    TOKENS.boardInventory,
    () =>
      new BoardInventoryService({
        client: container.resolve<MqttJsClient>(TOKENS.mqttClient),
        bus: container.resolve<EventBus>(TOKENS.bus),
        logger: container.resolve<Logger>(TOKENS.logger),
        store: container.resolve<BoardStore>(TOKENS.boardStore),
        prefix: DEFAULT_MQTT_PREFIX,
        getDeletedBoardCodes: () =>
          container
            .resolve<DeviceRegistryServiceImpl>(TOKENS.devicesRegistry)
            .getDeletedBoardCodes(),
      }),
  );

  // Dashboard: repository → service (store created inside the service).
  // The `roomExists` predicate checks the devices registry and `getRooms`
  // supplies the physical-room order for legacy-reference migration — both
  // resolved lazily to avoid a construction cycle with devicesRegistry.
  // The Clock makes `updatedAt` stamps deterministic for tests.
  container.register(
    TOKENS.dashboardRepository,
    () =>
      new AsyncStorageDashboardRepository(
        container.resolve<Logger>(TOKENS.logger),
      ),
  );
  container.register(
    TOKENS.dashboardService,
    () =>
      new DashboardServiceImpl({
        repository: container.resolve<AsyncStorageDashboardRepository>(
          TOKENS.dashboardRepository,
        ),
        registry: container.resolve<WidgetRegistry>(TOKENS.widgetRegistry),
        bus: container.resolve<EventBus>(TOKENS.bus),
        logger: container.resolve<Logger>(TOKENS.logger),
        clock: container.resolve<Clock>(TOKENS.clock),
        roomExists: roomId =>
          container
            .resolve<DeviceRegistryServiceImpl>(TOKENS.devicesRegistry)
            .getRooms()
            .some(room => room.id === roomId),
        getRooms: () =>
          container
            .resolve<DeviceRegistryServiceImpl>(TOKENS.devicesRegistry)
            .getRooms(),
        getCapabilities: () =>
          container
            .resolve<DeviceRegistryServiceImpl>(TOKENS.devicesRegistry)
            .getCapabilities(),
        // Room-scoped binding authority: the dashboard service rejects
        // binding/rebinding a room-scoped widget to a device of a different
        // room (WidgetConfig.roomId is authoritative).
        getDeviceRoom: deviceId =>
          container
            .resolve<DeviceRegistryServiceImpl>(TOKENS.devicesRegistry)
            .findDevice(deviceId)?.roomId,
      }),
  );
  container.register(TOKENS.dashboardStore, () =>
    container.resolve<DashboardServiceImpl>(TOKENS.dashboardService).getStore(),
  );

  return {
    logger: container.resolve<Logger>(TOKENS.logger),
    bus: container.resolve<EventBus>(TOKENS.bus),
    clock: container.resolve<Clock>(TOKENS.clock),
    settingsService: container.resolve<SettingsServiceImpl>(
      TOKENS.settingsService,
    ),
    settingsStore: container.resolve<SettingsStore>(TOKENS.settingsStore),
    mqttClient: container.resolve<MqttJsClient>(TOKENS.mqttClient),
    telemetryService: container.resolve<TelemetryServiceImpl>(
      TOKENS.telemetryService,
    ),
    telemetryStore: container.resolve<TelemetryStore>(TOKENS.telemetryStore),
    relayService: container.resolve<RelayServiceImpl>(TOKENS.relayService),
    relayStore: container.resolve<RelayStore>(TOKENS.relayStore),
    historyAdapter: container.resolve<InfluxV2Adapter>(TOKENS.historyAdapter),
    historySource: container.resolve<SelectableHistoryDataSource>(
      TOKENS.historySource,
    ),
    historyStore: container.resolve<HistoryStore>(TOKENS.historyStore),
    devicesRepository: container.resolve<AsyncStorageDevicesRepository>(
      TOKENS.devicesRepository,
    ),
    devicesRegistry: container.resolve<DeviceRegistryServiceImpl>(
      TOKENS.devicesRegistry,
    ),
    devicesStore: container.resolve<DevicesStore>(TOKENS.devicesStore),
    deviceStateStore: container.resolve<DeviceStateStore>(
      TOKENS.deviceStateStore,
    ),
    deviceStateSync: container.resolve<DeviceStateSync>(TOKENS.deviceStateSync),
    deviceCommandService: container.resolve<DeviceCommandServiceImpl>(
      TOKENS.deviceCommandService,
    ),
    boardInventory: container.resolve<BoardInventoryService>(
      TOKENS.boardInventory,
    ),
    boardStore: container.resolve<BoardStore>(TOKENS.boardStore),
    widgetRegistry: container.resolve<WidgetRegistry>(TOKENS.widgetRegistry),
    dashboardRepository: container.resolve<AsyncStorageDashboardRepository>(
      TOKENS.dashboardRepository,
    ),
    dashboardService: container.resolve<DashboardServiceImpl>(
      TOKENS.dashboardService,
    ),
    dashboardStore: container.resolve<DashboardStore>(TOKENS.dashboardStore),
  };
}

const EMPTY_CONFIG: MqttConnectionConfig = {
  host: '',
  port: DEFAULT_MQTT_WS_PORT,
  prefix: DEFAULT_MQTT_PREFIX,
};
