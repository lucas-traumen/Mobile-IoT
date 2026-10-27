/**
 * Composition-root tests (boards-topic-contract-v2).
 *
 * The REAL container is built and the cross-module seams are exercised
 * through the REAL services: the board inventory (descriptor parsing +
 * resolver), the App.tsx message fan-out contract (relay + descriptor +
 * status handlers on the shared client) and the telemetry resolver port —
 * a real `TelemetryServiceImpl` wired EXACTLY like `container.ts` wires it
 * (lazy resolve into the container's board inventory) proves the
 * state-first buffering + `board:changed` replay across REAL modules and
 * the REAL event bus.
 *
 * The only controllable fakes are the MQTT transports (unit-level fakes of
 * the `MqttClientPort`, per the module tests' convention) — every service,
 * store and the event bus under test are the real implementations.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildContainer } from './container';
import { DEFAULT_MQTT_PREFIX } from '@core/constants';
import { ok, type Result } from '@core/errors';
import type {
  MqttClientPort,
  MqttConnectionConfig,
  MqttConnectionState,
  MqttMessage,
} from '@modules/telemetry/api';
import { createTelemetryStore } from '@modules/telemetry/api';
import { TelemetryServiceImpl } from '@modules/telemetry/api';
import type { SensorTelemetry } from '@modules/telemetry/api';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

/** Unit fake of the MQTT transport (same convention as the module tests). */
class FakeMqttClient implements MqttClientPort {
  private messageHandlers: ((m: MqttMessage) => void)[] = [];
  private stateHandlers: ((s: MqttConnectionState) => void)[] = [];
  public subscribedTopics: string[] = [];

  async connect(_config: MqttConnectionConfig): Promise<void> {
    for (const handler of this.stateHandlers) {
      handler('connected');
    }
  }
  subscribe(topic: string): void {
    this.subscribedTopics.push(topic);
  }
  publish(_topic: string, _payload: string): Result<void> {
    return ok(undefined);
  }
  disconnect(): void {
    for (const handler of this.stateHandlers) {
      handler('idle');
    }
  }
  onMessage(handler: (message: MqttMessage) => void): void {
    this.messageHandlers.push(handler);
  }
  onStateChange(handler: (state: MqttConnectionState) => void): void {
    this.stateHandlers.push(handler);
  }
  emitMessage(message: MqttMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }
}

const VALID_DESCRIPTOR = {
  schemaVersion: 1,
  boardId: 'board-1',
  boardType: 'esp32-sensor-relay',
  sensors: [{ channel: 'S1', field: 'temperature', unit: '°C' }],
  relays: [{ channel: 'K1' }],
};

describe('composition root (boards-topic-contract-v2 wiring)', () => {
  it('parses a descriptor through the REAL board inventory and serves the resolver', () => {
    const deps = buildContainer();

    const matched = deps.boardInventory.handleDescriptorMessage({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-1/descriptor`,
      payload: JSON.stringify(VALID_DESCRIPTOR),
    });

    expect(matched).toBe(true);
    expect(deps.boardInventory.getBoards()).toEqual([
      {
        code: 'board-1',
        status: 'seen',
        descriptor: {
          boardType: 'esp32-sensor-relay',
          sensors: [{ channel: 'S1', field: 'temperature', unit: '°C' }],
          relays: ['K1'],
        },
      },
    ]);
    // The resolver the telemetry port consumes (exact container wiring).
    expect(deps.boardInventory.resolveSensorField('board-1', 'S1')).toBe(
      'temperature',
    );
    expect(deps.boardInventory.resolveSensorField('board-1', 'S9')).toBeNull();
  });

  it('routes the shared-client fan-out: status handler merges WITHOUT losing the descriptor', () => {
    const deps = buildContainer();

    // The App.tsx fan-out contract: every message reaches all three
    // handlers; each claims its own topic shape.
    const forward = (message: MqttMessage): void => {
      deps.relayService.handleFeedbackMessage(message);
      deps.boardInventory.handleDescriptorMessage(message);
      deps.boardInventory.handleStatusMessage(message);
    };

    forward({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-1/descriptor`,
      payload: JSON.stringify(VALID_DESCRIPTOR),
    });
    forward({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-1/status`,
      payload: 'online',
    });
    forward({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-1/relays/K1/state`,
      payload: 'ON',
    });

    const entry = deps.boardInventory.getBoards()[0];
    expect(entry?.status).toBe('online');
    expect(entry?.descriptor?.boardType).toBe('esp32-sensor-relay');
  });

  it('wires the telemetry resolver port to the board inventory: state-first arrives, descriptor replays it (REAL modules + bus)', async () => {
    const deps = buildContainer();
    // A real TelemetryServiceImpl wired EXACTLY like container.ts (lazy
    // resolve into the container's boardInventory) on a controllable
    // transport.
    const client = new FakeMqttClient();
    const telemetry = new TelemetryServiceImpl({
      client,
      bus: deps.bus,
      logger: deps.logger,
      store: createTelemetryStore(),
      config: { host: 'broker.local', port: 9001, prefix: DEFAULT_MQTT_PREFIX },
      resolveSensorField: (boardId, channel) =>
        deps.boardInventory.resolveSensorField(boardId, channel),
    });
    telemetry.start();
    await Promise.resolve();

    const received: SensorTelemetry[] = [];
    deps.bus.subscribe('telemetry:received', reading => received.push(reading));

    // STATE first: the descriptor is not known yet → buffered, no event.
    client.emitMessage({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-2/sensors/S1/state`,
      payload: '25.6',
    });
    expect(received).toEqual([]);

    // DESCRIPTOR arrives → the inventory upserts and emits `board:changed`
    // on the REAL bus → the real telemetry service replays the buffer.
    deps.boardInventory.handleDescriptorMessage({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-2/descriptor`,
      payload: JSON.stringify({
        ...VALID_DESCRIPTOR,
        boardId: 'board-2',
      }),
    });

    expect(received).toEqual([
      { roomId: 'board-2', field: 'temperature', value: 25.6 },
    ]);
  });

  it('an OFFLINE status transition touches ONLY the badge: last-known device-state values survive (REAL modules)', () => {
    const deps = buildContainer();
    // The sync bridge is started by App bootstrap in production; the
    // container itself never starts it.
    deps.deviceStateSync.start();

    // Give the seed relay (relay-1, room-living, slot 1) a live optimistic
    // value through the REAL bus + REAL sync bridge.
    deps.bus.emit('relay:command', {
      roomId: 'room-living',
      index: 1,
      state: 'ON',
    });
    const key = 'relay-1:switch';
    expect(deps.deviceStateStore.getState().values[key]?.value).toBe(true);

    // Forward a retained OFFLINE status through the App.tsx fan-out: the
    // structural guarantee is that status handling mutates ONLY the board
    // inventory — the device-state store has no path to be cleared.
    const forward = (message: MqttMessage): void => {
      deps.relayService.handleFeedbackMessage(message);
      deps.boardInventory.handleDescriptorMessage(message);
      deps.boardInventory.handleStatusMessage(message);
    };
    forward({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/room-living/status`,
      payload: 'offline',
    });

    // The badge flipped…
    expect(deps.boardInventory.getBoards()[0]?.status).toBe('offline');
    // …and the last-known relay value SURVIVES (offline ≠ value loss).
    expect(deps.deviceStateStore.getState().values[key]?.value).toBe(true);

    // Same guarantee for the descriptor path (a board republishing its
    // descriptor must not clear live values either).
    deps.boardInventory.handleDescriptorMessage({
      topic: `${DEFAULT_MQTT_PREFIX}/boards/room-living/descriptor`,
      payload: JSON.stringify({
        schemaVersion: 1,
        boardId: 'room-living',
        boardType: 'esp32-relay',
        sensors: [],
        relays: [{ channel: 'K1' }],
      }),
    });
    expect(deps.deviceStateStore.getState().values[key]?.value).toBe(true);
  });

  it('keeps a deleted board hidden until QR restoration', async () => {
    const mockGetItem = AsyncStorage.getItem as jest.Mock;
    const mockSetItem = AsyncStorage.setItem as jest.Mock;
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    const deps = buildContainer();
    expect((await deps.devicesRegistry.load()).ok).toBe(true);
    expect((await deps.dashboardService.load()).ok).toBe(true);
    expect(
      (await deps.devicesRegistry.rebindRoomBoard('board-1', 'room-living')).ok,
    ).toBe(true);
    const descriptorMessage = {
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-1/descriptor`,
      payload: JSON.stringify(VALID_DESCRIPTOR),
    };
    const statusMessage = {
      topic: `${DEFAULT_MQTT_PREFIX}/boards/board-1/status`,
      payload: 'online',
    };
    deps.boardInventory.handleDescriptorMessage(descriptorMessage);
    deps.boardInventory.handleStatusMessage(statusMessage);
    const devicesBefore = deps.devicesRegistry.getDevices();
    const templatesBefore = deps.dashboardService.getTemplates();

    expect((await deps.devicesRegistry.removeBoard('board-1')).ok).toBe(true);
    expect(deps.boardStore.getState().boards).toEqual([]);
    expect(deps.devicesRegistry.findRoom('room-living')?.code).toBe('board-1');
    expect(deps.devicesRegistry.getDevices()).toEqual(devicesBefore);
    expect(deps.dashboardService.getTemplates()).toEqual(templatesBefore);

    const savedSnapshot = mockSetItem.mock.calls.at(-1)?.[1] as string;
    mockGetItem.mockResolvedValue(savedSnapshot);
    const restarted = buildContainer();
    expect((await restarted.devicesRegistry.load()).ok).toBe(true);
    restarted.boardInventory.handleDescriptorMessage(descriptorMessage);
    restarted.boardInventory.handleStatusMessage(statusMessage);
    expect(restarted.boardStore.getState().boards).toEqual([]);
    expect(restarted.devicesRegistry.getDeletedBoardCodes()).toEqual([
      'board-1',
    ]);
    expect(
      restarted.boardInventory.resolveSensorField('board-1', 'S1'),
    ).toBeNull();

    expect((await restarted.devicesRegistry.restoreBoard('board-1')).ok).toBe(
      true,
    );
    restarted.boardInventory.restoreFromQr('board-1', 'esp32-sensor-relay');
    expect(restarted.boardStore.getState().boards).toHaveLength(1);
    expect(restarted.devicesRegistry.getDeletedBoardCodes()).toEqual([]);
    expect(restarted.boardInventory.resolveSensorField('board-1', 'S1')).toBe(
      'temperature',
    );

    expect(
      (
        await restarted.devicesRegistry.rebindRoomBoard(
          'board-1',
          'room-bedroom',
        )
      ).ok,
    ).toBe(true);
    expect(restarted.boardStore.getState().boards).toHaveLength(1);
    expect(restarted.devicesRegistry.findRoom('room-bedroom')?.code).toBe(
      'board-1',
    );
    expect(restarted.boardInventory.resolveSensorField('board-1', 'S1')).toBe(
      'temperature',
    );
  });

  it('reveals a deleted board on BLE-only recovery (no QR label, no fresh MQTT)', async () => {
    const mockGetItem = AsyncStorage.getItem as jest.Mock;
    const mockSetItem = AsyncStorage.setItem as jest.Mock;
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    const deps = buildContainer();
    expect((await deps.devicesRegistry.load()).ok).toBe(true);
    expect((await deps.dashboardService.load()).ok).toBe(true);

    const descriptorMessage = {
      topic: `${DEFAULT_MQTT_PREFIX}/boards/3b6baf6c/descriptor`,
      payload: JSON.stringify({
        ...VALID_DESCRIPTOR,
        boardId: '3b6baf6c',
        boardType: 'esp32-sensor-relay',
      }),
    };
    deps.boardInventory.handleDescriptorMessage(descriptorMessage);
    expect(deps.boardStore.getState().boards.map(b => b.code)).toEqual([
      '3b6baf6c',
    ]);

    expect((await deps.devicesRegistry.removeBoard('3b6baf6c')).ok).toBe(true);
    expect(deps.boardStore.getState().boards).toEqual([]);

    // Cold restart: the retained descriptor was consumed by the previous
    // session (the ESP32 publishes it once on connect), so the board is
    // online in the broker but this session has never seen its descriptor.
    const savedSnapshot = mockSetItem.mock.calls.at(-1)?.[1] as string;
    mockGetItem.mockResolvedValue(savedSnapshot);
    const restarted = buildContainer();
    expect((await restarted.devicesRegistry.load()).ok).toBe(true);
    expect(restarted.boardStore.getState().boards).toEqual([]);

    // BLE recovery path used by BoardsScreen after provisioning succeeds:
    // registry tombstone cleared + inventory entry seeded, without a QR type.
    expect((await restarted.devicesRegistry.restoreBoard('3b6baf6c')).ok).toBe(
      true,
    );
    restarted.boardInventory.restoreFromQr('3b6baf6c');

    expect(restarted.boardStore.getState().boards.map(b => b.code)).toEqual([
      '3b6baf6c',
    ]);
    expect(restarted.devicesRegistry.getDeletedBoardCodes()).toEqual([]);
  });
});
