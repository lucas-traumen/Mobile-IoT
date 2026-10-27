/**
 * DeviceRegistryServiceImpl tests.
 *
 * Verifies: addRoom/updateRoom; addDevice/updateDevice (validation, binding
 * constraint, REQUIRED room, per-room 10+10 capacity, room-scoped relay slot
 * uniqueness); removeDevice emits `devices:changed { removedDeviceIds: [id] }`;
 * room removal unassigns devices; migration move respects capacity; mirror
 * store updates after commit; capability catalog CRUD + `getCapabilities`;
 * over-capacity legacy snapshots stay loadable but cannot be worsened.
 * (Seed-on-load behavior is covered by devicesRepository.test.ts.)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Errors, err, ok, type Result } from '@core/errors';
import { FakeClock } from '@core/time';
import { InMemoryEventBus } from '@core/eventbus';
import { NullLogger, createLogger } from '@core/logger';

import {
  BUILT_IN_CAPABILITIES,
  projectSensorRegistrations,
} from '../domain/devices';
import { AsyncStorageDevicesRepository } from '../data/devicesRepository';
import { DeviceRegistryServiceImpl } from './deviceRegistryService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

function makeRegistry(options?: {
  isCapabilityInUse?: (type: string) => boolean;
  migrateWidgetsFromRoom?: (
    fromId: string,
    toId: string | null,
  ) => Promise<Result<void>>;
}) {
  const bus = new InMemoryEventBus(createLogger('test'));
  const registry = new DeviceRegistryServiceImpl({
    repository: new AsyncStorageDevicesRepository(new NullLogger()),
    bus,
    logger: createLogger('test'),
    clock: new FakeClock(),
    isCapabilityInUse: options?.isCapabilityInUse,
    migrateWidgetsFromRoom: options?.migrateWidgetsFromRoom,
  });
  return { bus, registry };
}

/** Create a room and return its id (per-test fixture helper). */
async function addRoom(registry: DeviceRegistryServiceImpl, name: string) {
  const result = await registry.addRoom(name);
  expect(result.ok).toBe(true);
  const rooms = registry.getRooms();
  return rooms[rooms.length - 1]!.id;
}

describe('DeviceRegistryServiceImpl', () => {
  let bus: InMemoryEventBus;
  let registry: DeviceRegistryServiceImpl;
  let roomA: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Start from an empty persisted snapshot (no seed) for a clean slate.
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    const made = makeRegistry();
    bus = made.bus;
    registry = made.registry;
    await registry.load();
    roomA = await addRoom(registry, 'Phòng khách');
  });

  it('adds rooms and updates the mirror store', async () => {
    expect(registry.getRooms()).toHaveLength(1);
    expect(registry.getRooms()[0].name).toBe('Phòng khách');
    expect(registry.getStore().getState().snapshot.rooms).toHaveLength(1);
  });

  it('rejects an empty room name', async () => {
    const result = await registry.addRoom('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });

  it('removes a room via the explicit unassign migration', async () => {
    const device = await addRelayDevice(registry, roomA, 1);

    // The plain (bypass) `removeRoom` no longer exists on the service —
    // deletion must always go through the explicit migration API.
    expect(
      (registry as unknown as Record<string, unknown>)['removeRoom'],
    ).toBeUndefined();

    const result = await registry.removeRoomWithMigration(roomA, {
      kind: 'unassign',
    });
    expect(result.ok).toBe(true);
    expect(registry.getRooms()).toHaveLength(0);
    expect(registry.getDevices()[0].roomId).toBeUndefined();
    expect(device).toBeDefined();
  });

  it('rolls the registry back when the widget migration fails', async () => {
    const roomB = await addRoom(registry, 'Phòng B');
    await addSensorDevice(registry, roomA);
    const roomsBefore = registry.getRooms();
    const devicesBefore = registry.getDevices();

    const failing = makeRegistry({
      migrateWidgetsFromRoom: async () =>
        err(Errors.unknown('widget store locked')),
    });
    await failing.registry.load();
    const failRoomA = await addRoom(failing.registry, 'Phòng A');
    await addRoom(failing.registry, 'Phòng B');
    await addSensorDevice(failing.registry, failRoomA);

    const result = await failing.registry.removeRoomWithMigration(failRoomA, {
      kind: 'unassign',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('rolled back');
      expect(result.error.message).toContain('widget store locked');
    }
    // Compensating rollback restored the pre-mutation snapshot: room still
    // present, device still assigned, mirror store back in sync.
    expect(failing.registry.getRooms()).toHaveLength(2);
    expect(failing.registry.getRooms()[0].id).toBe(failRoomA);
    expect(failing.registry.getDevices()[0].roomId).toBe(failRoomA);
    expect(failing.registry.getStore().getState().snapshot.rooms).toHaveLength(
      2,
    );
    expect(roomsBefore.length).toBe(2);
    expect(devicesBefore).toHaveLength(1);
    expect(roomB).toBeDefined();
  });

  it('reports an explicit failure when even the rollback persist fails', async () => {
    // Own registry with a failing widget migration so the compensation
    // path (and its persist) actually runs.
    const failing = makeRegistry({
      migrateWidgetsFromRoom: async () =>
        err(Errors.unknown('widget store locked')),
    });
    await failing.registry.load();
    const failRoomA = await addRoom(failing.registry, 'Phòng A');
    await addSensorDevice(failing.registry, failRoomA);

    // First save (the mutation) succeeds; the widget migration fails; the
    // rollback persist then fails too — both failures must be surfaced.
    mockSetItem.mockResolvedValueOnce(undefined);
    mockSetItem.mockRejectedValueOnce(new Error('rollback disk full'));

    const result = await failing.registry.removeRoomWithMigration(failRoomA, {
      kind: 'unassign',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Widget migration failed');
      expect(result.error.message).toContain('registry rollback failed');
      expect(result.error.message).toContain('Failed to write devices');
    }
    // In-memory state is still compensated so the UI keeps the original.
    expect(failing.registry.getRooms()).toHaveLength(1);
    expect(failing.registry.getDevices()[0].roomId).toBe(failRoomA);
    expect(failing.registry.getStore().getState().snapshot.rooms).toHaveLength(
      1,
    );
  });

  it('rejects a duplicate machine key with an explicit message', async () => {
    const first = await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
      unit: 'hPa',
      icon: 'speedometer-outline',
      color: '#0878ff',
    });
    expect(first.ok).toBe(true);

    const second = await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất khác',
      kind: 'sensor',
      unit: 'hPa',
      icon: 'speedometer-outline',
      color: '#0878ff',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.message).toContain(
        'Capability type "pressure" already exists',
      );
    }
    // The catalog still holds exactly one "pressure" entry.
    expect(
      registry.getCapabilities().filter(def => def.type === 'pressure'),
    ).toHaveLength(1);
  });

  it('rejects a device whose capability is not in the catalog', async () => {
    const result = await registry.addDevice({
      name: 'Cảm biến lạ',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['ghost-capability'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(
        'not defined in the capability catalog',
      );
    }
    expect(registry.getDevices()).toHaveLength(0);
  });

  it('accepts a valid custom pressure assignment (catalog membership)', async () => {
    const added = await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
      unit: 'hPa',
      icon: 'speedometer-outline',
      color: '#0878ff',
    });
    expect(added.ok).toBe(true);

    const result = await registry.addDevice({
      name: 'Cảm biến áp suất',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['pressure'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(result.ok).toBe(true);
    expect(registry.getDevices()[0].capabilities).toEqual(['pressure']);
  });

  it('rejects a capability whose kind does not match the binding', async () => {
    const added = await registry.addCapability({
      type: 'custom_switch',
      label: 'Công tắc riêng',
      kind: 'switch',
      icon: 'flash-outline',
      color: '#0878ff',
    });
    expect(added.ok).toBe(true);

    const result = await registry.addDevice({
      name: 'Thiết bị sai loại',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['custom_switch'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(
        'does not match a telemetry-sensor binding',
      );
    }
    expect(registry.getDevices()).toHaveLength(0);
  });

  it('rejects updateDevice patches with unknown capabilities', async () => {
    const device = await addSensorDevice(registry, roomA);
    const result = await registry.updateDevice(device.id, {
      capabilities: ['temperature', 'ghost'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('ghost');
    }
    // The device is unchanged (still its single registered field).
    expect(registry.findDevice(device.id)?.capabilities).toEqual(
      device.capabilities,
    );
  });

  it('adds a device with a generated id and validates the binding', async () => {
    const result = await registry.addDevice({
      name: 'Đèn',
      roomId: roomA,
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 1 },
    });
    expect(result.ok).toBe(true);
    expect(registry.getDevices()).toHaveLength(1);
    expect(registry.getDevices()[0].id).toMatch(/^dev-/);
    expect(registry.findDevice(registry.getDevices()[0].id)).toBeDefined();
  });

  it('rejects a device violating the binding↔capability constraint', async () => {
    const result = await registry.addDevice({
      name: 'Đèn',
      roomId: roomA,
      type: 'relay',
      capabilities: ['switch', 'temperature'],
      binding: { kind: 'relay', index: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
    expect(registry.getDevices()).toHaveLength(0);
  });

  it('removeDevice emits devices:changed with removedDeviceIds', async () => {
    await addRelayDevice(registry, roomA, 1);
    const id = registry.getDevices()[0].id;

    const events: { removedDeviceIds: readonly string[] }[] = [];
    bus.subscribe('devices:changed', e => events.push(e));

    const result = await registry.removeDevice(id);
    expect(result.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].removedDeviceIds).toEqual([id]);
    expect(registry.getDevices()).toHaveLength(0);
    expect(mockSetItem).toHaveBeenCalled();
  });

  it('hides a board while preserving its room binding and logical devices', async () => {
    const bound = await registry.updateRoom(roomA, { code: 'board-1' });
    expect(bound.ok).toBe(true);
    await addSensorDevice(registry, roomA);

    const roomsBefore = registry.getRooms();
    const devicesBefore = registry.getDevices();
    const events = jest.fn();
    bus.subscribe('devices:changed', events);
    mockSetItem.mockClear();
    const result = await registry.removeBoard('board-1');

    expect(result.ok).toBe(true);
    expect(registry.getRooms()).toHaveLength(1);
    expect(registry.getRooms()[0]?.code).toBe('board-1');
    expect(registry.getDevices()).toEqual(devicesBefore);
    expect(registry.getRooms()[0]?.id).toBe(roomsBefore[0]?.id);
    expect(registry.getDeletedBoardCodes()).toEqual(['board-1']);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith({
      removedDeviceIds: [],
      removedBindings: [],
    });

    const persisted = JSON.parse(
      mockSetItem.mock.calls.at(-1)?.[1] as string,
    ) as {
      rooms: { code?: string }[];
      devices: unknown[];
      deletedBoardCodes: string[];
    };
    expect(persisted.rooms[0]?.code).toBe('board-1');
    expect(persisted.devices).toHaveLength(1);
    expect(persisted.deletedBoardCodes).toEqual(['board-1']);
  });

  it('keeps the snapshot unchanged when removing a board cannot be persisted', async () => {
    await registry.updateRoom(roomA, { code: 'board-1' });
    const roomsBefore = registry.getRooms();
    const devicesBefore = registry.getDevices();
    const snapshotBefore = registry.getStore().getState().snapshot;
    const events = jest.fn();
    bus.subscribe('devices:changed', events);
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));

    const result = await registry.removeBoard('board-1');

    expect(result.ok).toBe(false);
    expect(registry.getRooms()).toEqual(roomsBefore);
    expect(registry.getDevices()).toEqual(devicesBefore);
    expect(registry.getDeletedBoardCodes()).toEqual([]);
    expect(registry.getStore().getState().snapshot).toBe(snapshotBefore);
    expect(events).not.toHaveBeenCalled();
  });

  it('deletes an unassigned board and treats repeated deletion as a no-op', async () => {
    const roomsBefore = registry.getRooms();
    const events = jest.fn();
    bus.subscribe('devices:changed', events);
    mockSetItem.mockClear();

    expect((await registry.removeBoard(' board-2 ')).ok).toBe(true);
    expect((await registry.removeBoard('board-2')).ok).toBe(true);

    expect(registry.getRooms()).toEqual(roomsBefore);
    expect(registry.getDeletedBoardCodes()).toEqual(['board-2']);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledTimes(1);
  });

  it.each(['', ' ', 'board/1', 'board+', 'a'.repeat(33)])(
    'rejects invalid deletion code %j without writing',
    async code => {
      mockSetItem.mockClear();
      const result = await registry.removeBoard(code);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('validation');
      }
      expect(mockSetItem).not.toHaveBeenCalled();
      expect(registry.getDeletedBoardCodes()).toEqual([]);
    },
  );

  it('restores a deleted board when it is explicitly rebound to a room', async () => {
    const roomB = await addRoom(registry, 'Phòng ngủ');
    await registry.updateRoom(roomA, { code: 'board-1' });
    expect((await registry.removeBoard('board-1')).ok).toBe(true);

    const result = await registry.rebindRoomBoard('board-1', roomB);

    expect(result.ok).toBe(true);
    expect(registry.findRoom(roomA)?.code).toBeUndefined();
    expect(registry.findRoom(roomB)?.code).toBe('board-1');
    expect(registry.getDeletedBoardCodes()).toEqual([]);
  });

  it('restores a deleted board when explicitly assigning it in a new room', async () => {
    await registry.removeBoard('board-2');
    const result = await registry.addRoom('Phòng mới', ' board-2 ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe('board-2');
    }
    expect(registry.getDeletedBoardCodes()).toEqual([]);
  });

  it('restores a deleted board when explicitly editing a room binding', async () => {
    await registry.removeBoard('board-2');
    expect((await registry.updateRoom(roomA, { code: 'board-2' })).ok).toBe(
      true,
    );
    expect(registry.getDeletedBoardCodes()).toEqual([]);
    expect(registry.findRoom(roomA)?.code).toBe('board-2');
  });

  it('restores a deleted board by removing only its marker', async () => {
    await registry.updateRoom(roomA, { code: 'board-1' });
    await addSensorDevice(registry, roomA);
    expect((await registry.removeBoard('board-1')).ok).toBe(true);
    expect((await registry.removeBoard('board-2')).ok).toBe(true);

    const roomsBeforeRestore = registry.getRooms();
    const devicesBeforeRestore = registry.getDevices();
    const events = jest.fn();
    bus.subscribe('devices:changed', events);
    mockSetItem.mockClear();

    const result = await registry.restoreBoard(' board-1 ');

    expect(result.ok).toBe(true);
    expect(registry.getRooms()).toEqual(roomsBeforeRestore);
    expect(registry.getDevices()).toEqual(devicesBeforeRestore);
    expect(registry.getDeletedBoardCodes()).toEqual(['board-2']);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith({
      removedDeviceIds: [],
      removedBindings: [],
    });
  });

  it('persists restoration so a reload keeps the board visible', async () => {
    await registry.removeBoard('board-1');
    expect((await registry.restoreBoard('board-1')).ok).toBe(true);
    mockGetItem.mockResolvedValue(mockSetItem.mock.calls.at(-1)?.[1]);

    const reloaded = makeRegistry().registry;
    expect((await reloaded.load()).ok).toBe(true);
    expect(reloaded.getDeletedBoardCodes()).toEqual([]);
    expect(reloaded.getRooms()).toEqual(registry.getRooms());
    expect(reloaded.getDevices()).toEqual(registry.getDevices());
  });

  it('treats restoration of an unhidden board as a no-op', async () => {
    await registry.removeBoard('board-1');
    await registry.restoreBoard('board-1');
    const snapshotBefore = registry.getStore().getState().snapshot;
    const events = jest.fn();
    bus.subscribe('devices:changed', events);
    mockSetItem.mockClear();

    expect((await registry.restoreBoard('board-1')).ok).toBe(true);
    expect((await registry.restoreBoard('never-seen')).ok).toBe(true);
    expect(registry.getStore().getState().snapshot).toBe(snapshotBefore);
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'board/1', 'board+', 'a'.repeat(33)])(
    'rejects invalid restoration code %j without writing',
    async code => {
      await registry.removeBoard('board-1');
      const snapshotBefore = registry.getStore().getState().snapshot;
      mockSetItem.mockClear();

      const result = await registry.restoreBoard(code);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('validation');
      }
      expect(mockSetItem).not.toHaveBeenCalled();
      expect(registry.getStore().getState().snapshot).toBe(snapshotBefore);
    },
  );

  it('keeps the marker and snapshot unchanged when restoreBoard cannot be persisted', async () => {
    await addSensorDevice(registry, roomA);
    await registry.removeBoard('board-1');
    const snapshotBefore = registry.getStore().getState().snapshot;
    const events = jest.fn();
    bus.subscribe('devices:changed', events);
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));

    const result = await registry.restoreBoard('board-1');

    expect(result.ok).toBe(false);
    expect(registry.getDeletedBoardCodes()).toEqual(['board-1']);
    expect(registry.getStore().getState().snapshot).toBe(snapshotBefore);
    expect(registry.getRooms()).toEqual(snapshotBefore.rooms);
    expect(registry.getDevices()).toEqual(snapshotBefore.devices);
    expect(events).not.toHaveBeenCalled();
  });

  it('keeps a board deleted when its attempted restoration cannot be saved', async () => {
    await registry.removeBoard('board-2');
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));

    const result = await registry.rebindRoomBoard('board-2', roomA);

    expect(result.ok).toBe(false);
    expect(registry.findRoom(roomA)?.code).toBeUndefined();
    expect(registry.getDeletedBoardCodes()).toEqual(['board-2']);
  });

  it('preserves board deletion markers when removing a room', async () => {
    await registry.removeBoard('board-2');
    expect(
      (await registry.removeRoomWithMigration(roomA, { kind: 'unassign' })).ok,
    ).toBe(true);
    expect(registry.getDeletedBoardCodes()).toEqual(['board-2']);
  });

  it('persists through the repository on every mutation', async () => {
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(registry.getStore().getState().snapshot),
    );
  });
});

/** Monotonic counter for fixture-created catalog metric fields. */
let metricCounter = 0;

/**
 * Add a telemetry-sensor device into `roomId` (fixture helper).
 *
 * Room+field is unique per room, so the fixture picks a sensor-kind catalog
 * field not yet registered in that room — extending the catalog with a new
 * distinct metric when the built-ins are exhausted.
 */
async function addSensorDevice(
  registry: DeviceRegistryServiceImpl,
  roomId: string,
  name = 'Cảm biến',
) {
  const used = new Set(
    registry
      .getDevices()
      .filter(
        device =>
          device.roomId === roomId &&
          device.binding.kind === 'telemetry-sensor',
      )
      .flatMap(device => device.capabilities),
  );
  const freeField = registry
    .getCapabilities()
    .find(def => def.kind === 'sensor' && !used.has(def.type));
  const field =
    freeField?.type ??
    (() => {
      metricCounter += 1;
      return `metric_${metricCounter}`;
    })();
  if (!freeField) {
    const added = await registry.addCapability({
      type: field,
      label: field,
      kind: 'sensor',
    });
    expect(added.ok).toBe(true);
  }
  const result = await registry.addDevice({
    name,
    roomId,
    type: 'sensor',
    capabilities: [field],
    binding: { kind: 'telemetry-sensor' },
  });
  expect(result.ok).toBe(true);
  return registry.getDevices()[registry.getDevices().length - 1]!;
}

/** Add a relay device into `roomId` on a slot (fixture helper). */
async function addRelayDevice(
  registry: DeviceRegistryServiceImpl,
  roomId: string,
  index: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  name = 'Đèn',
) {
  const result = await registry.addDevice({
    name,
    roomId,
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index },
  });
  expect(result.ok).toBe(true);
  return registry.getDevices()[registry.getDevices().length - 1]!;
}

describe('per-room device capacity (service-authoritative)', () => {
  let registry: DeviceRegistryServiceImpl;
  let roomA: string;
  let roomB: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    const made = makeRegistry();
    registry = made.registry;
    await registry.load();
    roomA = await addRoom(registry, 'Phòng khách');
    roomB = await addRoom(registry, 'Phòng ngủ');
  });

  it('accepts exactly 10 sensor devices in one room and rejects the 11th', async () => {
    for (let n = 1; n <= 10; n++) {
      await addSensorDevice(registry, roomA, `Cảm biến ${n}`);
    }
    expect(
      registry.getDevices().filter(device => device.roomId === roomA),
    ).toHaveLength(10);

    // An 11th DISTINCT metric (not yet registered in the room) trips the
    // projected quota — not the room+field duplicate check.
    const extra = await registry.addCapability({
      type: 'metric_extra',
      label: 'Extra',
      kind: 'sensor',
    });
    expect(extra.ok).toBe(true);
    const eleventh = await registry.addDevice({
      name: 'Cảm biến 11',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['metric_extra'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.error.code).toBe('validation');
      expect(eleventh.error.message).toContain('maximum of 10 sensor metrics');
    }
    // Nothing was persisted and the room still holds exactly 10.
    expect(
      registry.getDevices().filter(device => device.roomId === roomA),
    ).toHaveLength(10);
    expect(
      registry.getDevices().filter(device => device.name === 'Cảm biến 11'),
    ).toHaveLength(0);
  });

  it('accepts exactly 10 relay devices in one room and rejects the 11th', async () => {
    for (let slot = 1; slot <= 10; slot++) {
      await addRelayDevice(registry, roomA, slot as 1, `Rơ le ${slot}`);
    }
    const eleventh = await registry.addDevice({
      name: 'Rơ le 11',
      roomId: roomA,
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 1 },
    });
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.error.message).toContain('maximum of 10 relay devices');
    }
    expect(
      registry.getDevices().filter(device => device.roomId === roomA),
    ).toHaveLength(10);
  });

  it('treats rooms independently: room B accepts devices after room A is full', async () => {
    for (let n = 1; n <= 10; n++) {
      await addSensorDevice(registry, roomA, `Khách ${n}`);
    }
    // Room A is full — room B must remain unaffected.
    await addSensorDevice(registry, roomB, 'Ngủ 1');
    const rejected = await registry.addDevice({
      name: 'Khách 11',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(rejected.ok).toBe(false);
    expect(
      registry.getDevices().filter(device => device.roomId === roomB),
    ).toHaveLength(1);
  });

  it('rejects the 11th device move into a full room (update/move quota)', async () => {
    for (let n = 1; n <= 10; n++) {
      await addSensorDevice(registry, roomA, `Khách ${n}`);
    }
    const mover = await addSensorDevice(registry, roomB, 'Ngủ di chuyển');
    // Give the mover a metric NOT registered in room A so the move trips
    // the projected quota, not the room+field duplicate check.
    const moved = await registry.addCapability({
      type: 'metric_mover',
      label: 'Mover',
      kind: 'sensor',
    });
    expect(moved.ok).toBe(true);
    await registry.updateDevice(mover.id, { capabilities: ['metric_mover'] });

    const result = await registry.updateDevice(mover.id, { roomId: roomA });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toContain('maximum of 10 sensor metrics');
    }
    // The device stays in room B.
    expect(registry.findDevice(mover.id)?.roomId).toBe(roomB);
  });

  it('allows a move that keeps the device in a room with free capacity', async () => {
    await addSensorDevice(registry, roomA, 'Khách 1');
    const mover = await addSensorDevice(registry, roomB, 'Ngủ di chuyển');
    // Distinct metric for the mover so the move trips nothing but capacity
    // (which has room) — not the room+field duplicate check.
    const field = await registry.addCapability({
      type: 'metric_move',
      label: 'Move',
      kind: 'sensor',
    });
    expect(field.ok).toBe(true);
    await registry.updateDevice(mover.id, { capabilities: ['metric_move'] });
    const result = await registry.updateDevice(mover.id, { roomId: roomA });
    expect(result.ok).toBe(true);
    expect(registry.findDevice(mover.id)?.roomId).toBe(roomA);
  });

  it('excluding the edited device itself: re-saving a device in a full room is allowed', async () => {
    for (let n = 1; n <= 10; n++) {
      await addSensorDevice(registry, roomA, `Khách ${n}`);
    }
    const tenth = registry
      .getDevices()
      .filter(device => device.roomId === roomA)[9]!;
    const result = await registry.updateDevice(tenth.id, {
      name: 'Khách 10 (đổi tên)',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a new device pointing at a room that does not exist', async () => {
    const result = await registry.addDevice({
      name: 'Bóng ma',
      roomId: 'room-ghost',
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('does not exist');
    }
    expect(registry.getDevices()).toHaveLength(0);
  });

  it('rejects moving a device into a room that does not exist', async () => {
    const device = await addSensorDevice(registry, roomA);
    const result = await registry.updateDevice(device.id, {
      roomId: 'room-ghost',
    });
    expect(result.ok).toBe(false);
    expect(registry.findDevice(device.id)?.roomId).toBe(roomA);
  });

  it('still allows explicitly unassigning a device (legacy management)', async () => {
    const device = await addSensorDevice(registry, roomA);
    const result = await registry.updateDevice(device.id, {
      roomId: undefined,
    });
    expect(result.ok).toBe(true);
    expect(registry.findDevice(device.id)?.roomId).toBeUndefined();
  });

  it('loads an over-capacity persisted snapshot but refuses to worsen it', async () => {
    // Legacy snapshot: 11 DISTINCT metric registrations in one room
    // (e.g. pre-quota data) — over the projected cap of 10.
    const legacyFields = [
      'temperature',
      'humidity',
      'pressure',
      'soil_moisture',
      'dew_point',
      'heat_index',
      'co2',
      'pm25',
      'tvoc',
      'voltage',
      'current',
    ];
    const overCapacity = {
      rooms: [
        { id: 'room-legacy', name: 'Phòng cũ', order: 0 },
        { id: 'room-other', name: 'Phòng khác', order: 1 },
      ],
      devices: legacyFields.map((field, n) => ({
        id: `legacy-${n}`,
        name: `Cảm biến ${n}`,
        roomId: 'room-legacy',
        type: 'sensor',
        capabilities: [field],
        binding: { kind: 'telemetry-sensor' },
      })),
      capabilities: [
        ...BUILT_IN_CAPABILITIES,
        ...legacyFields
          .filter(field => field !== 'temperature' && field !== 'humidity')
          .map(field => ({ type: field, label: field, kind: 'sensor' })),
      ],
    };
    mockGetItem.mockResolvedValue(JSON.stringify(overCapacity));
    const made = makeRegistry();
    await made.registry.load();
    // Loadable: the 11 legacy devices survived.
    expect(made.registry.getDevices()).toHaveLength(11);

    // Mutations may not worsen the violating room: adding another sensor on
    // an already-registered field is rejected (the room is over quota, so
    // no field addition could be legal anyway).
    const rejected = await made.registry.addDevice({
      name: 'Thêm nữa',
      roomId: 'room-legacy',
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(rejected.ok).toBe(false);

    // A move into the violating room is rejected too.
    const elsewhere = await addSensorDevice(
      made.registry,
      'room-other',
      'Khác',
    );
    const moveIn = await made.registry.updateDevice(elsewhere.id, {
      roomId: 'room-legacy',
    });
    expect(moveIn.ok).toBe(false);
  });
});

describe('room-scoped relay slots (1..10)', () => {
  let registry: DeviceRegistryServiceImpl;
  let roomA: string;
  let roomB: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    const made = makeRegistry();
    registry = made.registry;
    await registry.load();
    roomA = await addRoom(registry, 'Phòng khách');
    roomB = await addRoom(registry, 'Phòng ngủ');
  });

  it('accepts the same slot in different rooms (no aliasing)', async () => {
    await addRelayDevice(registry, roomA, 1, 'Đèn khách');
    await addRelayDevice(registry, roomB, 1, 'Đèn ngủ');
    const relays = registry
      .getDevices()
      .filter(d => d.binding.kind === 'relay');
    expect(relays).toHaveLength(2);
    expect(relays.map(d => d.roomId).sort()).toEqual([roomA, roomB].sort());
  });

  it('rejects a duplicate slot within the same room', async () => {
    await addRelayDevice(registry, roomA, 1, 'Đèn khách');
    const duplicate = await registry.addDevice({
      name: 'Đèn trùng',
      roomId: roomA,
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 1 },
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.message).toContain('slot 1 is already used');
    }
  });

  it('rejects a duplicate slot created by moving a device into the room', async () => {
    await addRelayDevice(registry, roomA, 2, 'Quạt khách');
    const mover = await addRelayDevice(registry, roomB, 5, 'Quạt ngủ');
    const result = await registry.updateDevice(mover.id, {
      roomId: roomA,
      binding: { kind: 'relay', index: 2 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('slot 2 is already used');
    }
    expect(registry.findDevice(mover.id)?.roomId).toBe(roomB);
  });

  it('allows moving a device within its own room onto its own slot (self-exclusion)', async () => {
    const device = await addRelayDevice(registry, roomA, 3, 'Bơm');
    const result = await registry.updateDevice(device.id, {
      name: 'Bơm mới',
    });
    expect(result.ok).toBe(true);
    expect(registry.findDevice(device.id)?.name).toBe('Bơm mới');
  });

  it('accepts every slot 1..10 as a free slot per room', async () => {
    for (let slot = 1; slot <= 10; slot++) {
      const result = await registry.addDevice({
        name: `Rơ le ${slot}`,
        roomId: roomA,
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: slot as 1 },
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe('DeviceRegistryServiceImpl capability catalog', () => {
  let registry: DeviceRegistryServiceImpl;
  let isCapabilityInUse: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    isCapabilityInUse = jest.fn(() => false);
    registry = makeRegistry({ isCapabilityInUse }).registry;
    await registry.load();
  });

  it('getCapabilities returns the migrated built-ins after load', () => {
    expect(registry.getCapabilities()).toEqual(BUILT_IN_CAPABILITIES);
  });

  it('addCapability validates and persists a new catalog entry', async () => {
    const result = await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
      unit: 'hPa',
      color: '#5e35b1',
      icon: 'speedometer-outline',
    });
    expect(result.ok).toBe(true);
    expect(registry.getCapabilities()).toHaveLength(4);
    expect(registry.getCapabilities()[3]).toEqual({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
      unit: 'hPa',
      color: '#5e35b1',
      icon: 'speedometer-outline',
    });
    expect(mockSetItem).toHaveBeenCalled();
  });

  it('addCapability rejects a duplicate type', async () => {
    const result = await registry.addCapability({
      type: 'temperature',
      label: 'Nhiệt độ 2',
      kind: 'sensor',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
    expect(registry.getCapabilities()).toHaveLength(3);
  });

  it('addCapability rejects an invalid definition', async () => {
    const result = await registry.addCapability({
      type: '',
      label: 'X',
      kind: 'sensor',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });

  it('updateCapability patches a definition (type immutable)', async () => {
    const result = await registry.updateCapability('temperature', {
      color: '#ff5722',
    });
    expect(result.ok).toBe(true);
    const updated = registry
      .getCapabilities()
      .find(def => def.type === 'temperature');
    expect(updated?.color).toBe('#ff5722');
    expect(updated?.label).toBe('Nhiệt độ');
  });

  it('updateCapability rejects an unknown type', async () => {
    const result = await registry.updateCapability('ghost', { label: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
  });

  it('removeCapability rejects when a device still declares it', async () => {
    await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
    });
    // New devices require a room — create one first.
    await registry.addRoom('Phòng X');
    const roomId = registry.getRooms()[0]!.id;
    await registry.addDevice({
      name: 'Cảm biến',
      roomId,
      type: 'sensor',
      capabilities: ['pressure'],
      binding: { kind: 'telemetry-sensor' },
    });
    const result = await registry.removeCapability('pressure');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toMatch(/device/);
    }
    expect(registry.getCapabilities()).toHaveLength(4);
  });

  it('removeCapability rejects when the injected predicate says in use', async () => {
    await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
    });
    isCapabilityInUse.mockReturnValue(true);
    const result = await registry.removeCapability('pressure');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toMatch(/widget/);
    }
    expect(isCapabilityInUse).toHaveBeenCalledWith('pressure');
  });

  it('removeCapability rejects a locked built-in capability', async () => {
    const result = await registry.removeCapability('temperature');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toMatch(/built-in/);
    }
    expect(registry.getCapabilities()).toHaveLength(3);
  });

  it('removeCapability removes an unused custom capability', async () => {
    await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
    });
    const result = await registry.removeCapability('pressure');
    expect(result.ok).toBe(true);
    expect(registry.getCapabilities()).toHaveLength(3);
  });

  it('removeCapability rejects an unknown type', async () => {
    const result = await registry.removeCapability('ghost');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
  });

  it('a device can declare a custom capability once it is in the catalog', async () => {
    await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
    });
    await registry.addRoom('Phòng X');
    const roomId = registry.getRooms()[0]!.id;
    const result = await registry.addDevice({
      name: 'Cảm biến áp suất',
      roomId,
      type: 'sensor',
      capabilities: ['pressure'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(result.ok).toBe(true);
    expect(registry.getDevices()[0].capabilities).toEqual(['pressure']);
  });
});

describe('DeviceRegistryServiceImpl removeRoomWithMigration (CP5)', () => {
  let registry: DeviceRegistryServiceImpl;
  let migrateWidgetsFromRoom: jest.Mock;

  /** Two rooms + a device in the first room (helper for the migration tests). */
  async function seedTwoRoomsWithDevice() {
    await registry.addRoom('Phòng khách');
    await registry.addRoom('Phòng ngủ');
    const [roomA] = registry.getRooms();
    await registry.addDevice({
      name: 'Đèn',
      roomId: roomA!.id,
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 1 },
    });
    return { roomA: roomA!, roomB: registry.getRooms()[1]! };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    migrateWidgetsFromRoom = jest.fn(() => Promise.resolve(ok(undefined)));
    registry = makeRegistry({ migrateWidgetsFromRoom }).registry;
    await registry.load();
  });

  it('move: devices move to the target room and widgets migrate too', async () => {
    const { roomA, roomB } = await seedTwoRoomsWithDevice();

    const result = await registry.removeRoomWithMigration(roomA.id, {
      kind: 'move',
      roomId: roomB.id,
    });
    expect(result.ok).toBe(true);
    expect(registry.getRooms()).toHaveLength(1);
    expect(registry.getDevices()[0].roomId).toBe(roomB.id);
    // The devices commit happens first, then the widget applier runs with the
    // removed room id and the target room id.
    expect(migrateWidgetsFromRoom).toHaveBeenCalledTimes(1);
    expect(migrateWidgetsFromRoom).toHaveBeenCalledWith(roomA.id, roomB.id);
  });

  it('unassign: devices become roomless and widgets become global', async () => {
    const { roomA } = await seedTwoRoomsWithDevice();

    const result = await registry.removeRoomWithMigration(roomA.id, {
      kind: 'unassign',
    });
    expect(result.ok).toBe(true);
    expect(registry.getRooms()).toHaveLength(1);
    expect(registry.getDevices()[0].roomId).toBeUndefined();
    expect(migrateWidgetsFromRoom).toHaveBeenCalledWith(roomA.id, null);
  });

  it('rejects a move when the target room cannot fit the migrated devices', async () => {
    await registry.addRoom('Phòng nguồn');
    await registry.addRoom('Phòng đích');
    const source = registry.getRooms()[0]!.id;
    const target = registry.getRooms()[1]!.id;
    // Fill the target to the sensor cap (distinct fields per registration).
    for (let n = 1; n <= 10; n++) {
      await addSensorDevice(registry, target, `Đích ${n}`);
    }
    // One sensor in the source room.
    await addSensorDevice(registry, source, 'Nguồn 1');

    const result = await registry.removeRoomWithMigration(source, {
      kind: 'move',
      roomId: target,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toMatch(/10 sensor units/);
    }
    // Both rooms still exist; nothing migrated.
    expect(registry.getRooms()).toHaveLength(2);
    expect(registry.getDevices().some(d => d.name === 'Nguồn 1')).toBe(true);
    expect(migrateWidgetsFromRoom).not.toHaveBeenCalled();
  });

  it('rejects an unknown room id without migrating', async () => {
    const result = await registry.removeRoomWithMigration('ghost', {
      kind: 'unassign',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
    expect(migrateWidgetsFromRoom).not.toHaveBeenCalled();
  });

  it('rejects moving a room into itself', async () => {
    const { roomA } = await seedTwoRoomsWithDevice();
    const result = await registry.removeRoomWithMigration(roomA.id, {
      kind: 'move',
      roomId: roomA.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
    expect(registry.getRooms()).toHaveLength(2);
    expect(migrateWidgetsFromRoom).not.toHaveBeenCalled();
  });

  it('rejects moving devices to a room that does not exist', async () => {
    const { roomA } = await seedTwoRoomsWithDevice();
    const result = await registry.removeRoomWithMigration(roomA.id, {
      kind: 'move',
      roomId: 'ghost',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
    expect(registry.getRooms()).toHaveLength(2);
    expect(migrateWidgetsFromRoom).not.toHaveBeenCalled();
  });

  it('succeeds without an injected widget applier (roomless fallback)', async () => {
    const bare = makeRegistry();
    await bare.registry.load();
    await bare.registry.addRoom('Phòng khách');
    const [room] = bare.registry.getRooms();

    const result = await bare.registry.removeRoomWithMigration(room!.id, {
      kind: 'unassign',
    });
    expect(result.ok).toBe(true);
    expect(bare.registry.getRooms()).toHaveLength(0);
  });
});

describe('addCapability strict machine-key validation (CP-R4)', () => {
  let registry: DeviceRegistryServiceImpl;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    const made = makeRegistry();
    registry = made.registry;
    await registry.load();
  });

  it('accepts a valid ASCII machine key', async () => {
    const result = await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
      unit: 'hPa',
    });
    expect(result.ok).toBe(true);
    expect(registry.getCapabilities().some(c => c.type === 'pressure')).toBe(
      true,
    );
  });

  it('rejects a Vietnamese/non-ASCII machine key', async () => {
    const result = await registry.addCapability({
      type: 'áp-suất',
      label: 'Áp suất',
      kind: 'sensor',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
    expect(registry.getCapabilities().some(c => c.type === 'áp-suất')).toBe(
      false,
    );
  });

  it('rejects a key with hyphens', async () => {
    const result = await registry.addCapability({
      type: 'pressure-value',
      label: 'Pressure Value',
      kind: 'sensor',
    });
    expect(result.ok).toBe(false);
    expect(
      registry.getCapabilities().some(c => c.type === 'pressure-value'),
    ).toBe(false);
  });

  it('rejects an uppercase key', async () => {
    const result = await registry.addCapability({
      type: 'Pressure',
      label: 'Pressure',
      kind: 'sensor',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a digit-starting key', async () => {
    const result = await registry.addCapability({
      type: '1pressure',
      label: 'Pressure',
      kind: 'sensor',
    });
    expect(result.ok).toBe(false);
  });

  it('still rejects duplicate keys even with valid format', async () => {
    await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất',
      kind: 'sensor',
    });
    const result = await registry.addCapability({
      type: 'pressure',
      label: 'Áp suất 2',
      kind: 'sensor',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });
});

describe('updateCapability legacy compatibility (CP-R4)', () => {
  it('can update metadata of a legacy non-ASCII keyed capability', async () => {
    jest.clearAllMocks();
    // Pre-populate storage with a snapshot containing a legacy key
    const legacySnapshot = {
      rooms: [],
      devices: [],
      capabilities: [
        ...BUILT_IN_CAPABILITIES,
        { type: 'áp-suất', label: 'Áp suất', kind: 'sensor', unit: 'hPa' },
      ],
    };
    mockGetItem.mockResolvedValue(JSON.stringify(legacySnapshot));
    mockSetItem.mockResolvedValue(undefined);
    const made = makeRegistry();
    const reg = made.registry;
    await reg.load();

    const result = await reg.updateCapability('áp-suất', {
      label: 'Áp suất mới',
    });
    expect(result.ok).toBe(true);
    const cap = reg.getCapabilities().find(c => c.type === 'áp-suất');
    expect(cap?.label).toBe('Áp suất mới');
  });
});

describe('legacy over-capacity tolerance (non-worsening mutations, fix cycle 1)', () => {
  let registry: DeviceRegistryServiceImpl;
  const OVER_ROOM = 'room-legacy';

  /**
   * Persisted legacy snapshot: 11 DISTINCT metric registrations in ONE room
   * (over the projected cap of 10). All fields exist in the carried catalog
   * so non-worsening mutations (rename) stay possible.
   */
  function legacyOverCapacitySnapshot() {
    const fields = [
      'temperature',
      'humidity',
      'pressure',
      'soil_moisture',
      'dew_point',
      'heat_index',
      'co2',
      'pm25',
      'tvoc',
      'voltage',
      'current',
    ];
    return {
      rooms: [{ id: OVER_ROOM, name: 'Phòng đầy', order: 0 }],
      devices: fields.map((field, n) => ({
        id: `legacy-${n}`,
        name: `Cảm biến ${n}`,
        roomId: OVER_ROOM,
        type: 'sensor',
        capabilities: [field],
        binding: { kind: 'telemetry-sensor' },
      })),
      capabilities: [
        ...BUILT_IN_CAPABILITIES,
        ...fields
          .filter(field => field !== 'temperature' && field !== 'humidity')
          .map(field => ({ type: field, label: field, kind: 'sensor' })),
        // A free 12th metric for rejection fixtures.
        { type: 'illuminance', label: 'Ánh sáng', kind: 'sensor' },
      ],
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify(legacyOverCapacitySnapshot()));
    mockSetItem.mockResolvedValue(undefined);
    const made = makeRegistry();
    registry = made.registry;
    await registry.load();
    // A second room exists so move/rename flows have a destination.
    await registry.addRoom('Phòng B');
  });

  it('loads the 11-metric legacy room (loadable + manageable)', () => {
    expect(
      registry.getDevices().filter(device => device.roomId === OVER_ROOM),
    ).toHaveLength(11);
  });

  it('allows a same-room rename — the mutation does not worsen the count', async () => {
    const first = registry.getDevices()[0]!;
    const result = await registry.updateDevice(first.id, {
      name: 'Cảm biến đổi tên',
    });
    expect(result.ok).toBe(true);
    expect(registry.findDevice(first.id)?.name).toBe('Cảm biến đổi tên');
    // Still exactly 11 projected metrics in the room — nothing worsened.
    expect(
      registry.getDevices().filter(device => device.roomId === OVER_ROOM),
    ).toHaveLength(11);
  });

  it('rejects an extra metric on a device inside the over-capacity room (would worsen the projected count)', async () => {
    // Multi-capability records are legacy-read-compatible; a NEW write must
    // register exactly one metric, and any extra metric would push the
    // over-capacity room from 11 to 12 projected registrations.
    const first = registry.getDevices()[0]!;
    const result = await registry.updateDevice(first.id, {
      capabilities: ['temperature', 'humidity'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('exactly one metric');
    }
  });

  it('still rejects ADDING a 12th metric registration to the over-capacity room', async () => {
    const result = await registry.addDevice({
      name: 'Cảm biến 12',
      roomId: OVER_ROOM,
      type: 'sensor',
      capabilities: ['illuminance'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('maximum of 10 sensor metrics');
    }
    expect(
      registry.getDevices().filter(device => device.roomId === OVER_ROOM),
    ).toHaveLength(11);
  });

  it("still rejects MOVING another room's device into the over-capacity room", async () => {
    const roomB = registry.getRooms().find(room => room.id !== OVER_ROOM)!.id;
    const elsewhere = await registry.addDevice({
      name: 'Cảm biến khác',
      roomId: roomB,
      type: 'sensor',
      capabilities: ['illuminance'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(elsewhere.ok).toBe(true);
    const mover = registry
      .getDevices()
      .find(device => device.name === 'Cảm biến khác')!;
    const result = await registry.updateDevice(mover.id, {
      roomId: OVER_ROOM,
    });
    expect(result.ok).toBe(false);
    // The device stays in its own room.
    expect(registry.findDevice(mover.id)?.roomId).toBe(roomB);
  });
});

describe('room-deletion move relay-slot uniqueness (fix cycle 1)', () => {
  let registry: DeviceRegistryServiceImpl;
  let migrateWidgetsFromRoom: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    migrateWidgetsFromRoom = jest.fn(() => Promise.resolve(ok(undefined)));
    const made = makeRegistry({ migrateWidgetsFromRoom });
    registry = made.registry;
    await registry.load();
    await registry.addRoom('Phòng A');
    await registry.addRoom('Phòng B');
  });

  it('rejects a move whose relay slot collides in the target room and persists nothing', async () => {
    const roomA = registry.getRooms()[0]!.id;
    const roomB = registry.getRooms()[1]!.id;
    await addRelayDevice(registry, roomA, 1, 'Đèn A');
    await addRelayDevice(registry, roomB, 1, 'Đèn B');

    const roomsBefore = registry.getRooms();
    const devicesBefore = registry.getDevices();

    const result = await registry.removeRoomWithMigration(roomA, {
      kind: 'move',
      roomId: roomB,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toContain('slot 1 is already used');
    }
    // ATOMIC: rooms and devices are exactly as before (nothing committed).
    expect(registry.getRooms()).toEqual(roomsBefore);
    expect(registry.getDevices()).toEqual(devicesBefore);
    // The source room still holds its relay.
    expect(
      registry.getDevices().filter(device => device.roomId === roomA),
    ).toHaveLength(1);
    expect(migrateWidgetsFromRoom).not.toHaveBeenCalled();
  });

  it('moves multiple relays whose slots are free in the target room (slots preserved)', async () => {
    const roomA = registry.getRooms()[0]!.id;
    const roomB = registry.getRooms()[1]!.id;
    await addRelayDevice(registry, roomA, 2, 'Quạt A');
    await addRelayDevice(registry, roomA, 5, 'Bơm A');
    await addRelayDevice(registry, roomB, 1, 'Đèn B');

    const result = await registry.removeRoomWithMigration(roomA, {
      kind: 'move',
      roomId: roomB,
    });
    expect(result.ok).toBe(true);
    const relays = registry
      .getDevices()
      .filter(
        device => device.roomId === roomB && device.binding.kind === 'relay',
      );
    const slots = relays.map(device =>
      device.binding.kind === 'relay' ? device.binding.index : 0,
    );
    expect(slots.sort()).toEqual([1, 2, 5]);
    expect(registry.getRooms()).toHaveLength(1);
    expect(migrateWidgetsFromRoom).toHaveBeenCalledWith(roomA, roomB);
  });

  it('detects a collision between two moving relays atomically (legacy duplicate-slot source)', async () => {
    // Legacy snapshot with a duplicate slot in ONE source room (loadable —
    // uniqueness is enforced on mutations, not on load).
    const legacy = {
      rooms: [
        { id: 'room-a', name: 'Phòng A', order: 0 },
        { id: 'room-b', name: 'Phòng B', order: 1 },
      ],
      devices: [
        {
          id: 'legacy-r1',
          name: 'Quạt A1',
          roomId: 'room-a',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 3 },
        },
        {
          id: 'legacy-r2',
          name: 'Quạt A2',
          roomId: 'room-a',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 3 },
        },
      ],
      capabilities: [...BUILT_IN_CAPABILITIES],
    };
    mockGetItem.mockResolvedValue(JSON.stringify(legacy));
    const made = makeRegistry({ migrateWidgetsFromRoom });
    await made.registry.load();

    const roomsBefore = made.registry.getRooms();
    const devicesBefore = made.registry.getDevices();

    const result = await made.registry.removeRoomWithMigration('room-a', {
      kind: 'move',
      roomId: 'room-b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('slot 3 is already used');
    }
    expect(made.registry.getRooms()).toEqual(roomsBefore);
    expect(made.registry.getDevices()).toEqual(devicesBefore);
    expect(migrateWidgetsFromRoom).not.toHaveBeenCalled();
  });
});

describe('room-first creation (approved room-sensor rework)', () => {
  let registry: DeviceRegistryServiceImpl;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    registry = makeRegistry().registry;
    await registry.load();
  });

  it('addRoom persists the room AND returns it (the UI opens it immediately)', async () => {
    const result = await registry.addRoom('Phòng làm việc');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // The created room carries a fresh id the caller can navigate to.
    expect(result.value.name).toBe('Phòng làm việc');
    expect(result.value.id).toEqual(expect.any(String));
    // It is part of the registry + the mirrored store snapshot.
    expect(registry.getRooms().some(room => room.id === result.value!.id)).toBe(
      true,
    );
    expect(
      registry
        .getStore()
        .getState()
        .snapshot.rooms.some(r => r.id === result.value!.id),
    ).toBe(true);
    // It persisted.
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(mockSetItem.mock.calls[0]![1] as string);
    expect(
      persisted.rooms.some(
        (room: { id: string }) => room.id === result.value!.id,
      ),
    ).toBe(true);
  });

  it('addRoom rejects an invalid name without persisting (truthful failure feedback)', async () => {
    const result = await registry.addRoom('   ');
    expect(result.ok).toBe(false);
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(registry.getRooms()).toHaveLength(3); // seed rooms only
  });
});

describe('room+field sensor uniqueness (service-authoritative)', () => {
  let registry: DeviceRegistryServiceImpl;
  let roomA: string;
  let roomB: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(JSON.stringify({ rooms: [], devices: [] }));
    mockSetItem.mockResolvedValue(undefined);
    registry = makeRegistry().registry;
    await registry.load();
    roomA = await addRoom(registry, 'Phòng khách');
    roomB = await addRoom(registry, 'Phòng ngủ');
  });

  it('rejects a duplicate {roomId, field} without persisting; another room may register the same field', async () => {
    await registry.addDevice({
      name: 'Nhiệt độ 1',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    const duplicate = await registry.addDevice({
      name: 'Nhiệt độ 2',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.message).toContain(
        'already registered in this room',
      );
    }
    // Same field in ANOTHER room is fine.
    const otherRoom = await registry.addDevice({
      name: 'Nhiệt độ ngủ',
      roomId: roomB,
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(otherRoom.ok).toBe(true);
  });

  it('rejects a move that would duplicate the target room field', async () => {
    await registry.addDevice({
      name: 'Nhiệt độ A',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    await registry.addDevice({
      name: 'Độ ẩm A',
      roomId: roomA,
      type: 'sensor',
      capabilities: ['humidity'],
      binding: { kind: 'telemetry-sensor' },
    });
    const humB = await registry.addDevice({
      name: 'Độ ẩm B',
      roomId: roomB,
      type: 'sensor',
      capabilities: ['humidity'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(humB.ok).toBe(true);
    const result = await registry.updateDevice(
      registry.getDevices().find(d => d.name === 'Độ ẩm B')!.id,
      { roomId: roomA },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('already registered in this room');
    }
  });
});

describe('binding-level sensor removal (approved lifecycle)', () => {
  let registry: DeviceRegistryServiceImpl;
  let bus: InMemoryEventBus;

  const LEGACY_ROOM = 'room-a';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSetItem.mockResolvedValue(undefined);
    // Legacy multi-capability record (temperature + humidity) — injected via
    // the repository mock because addDevice now enforces one field.
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        rooms: [{ id: LEGACY_ROOM, name: 'Phòng khách', order: 0 }],
        devices: [
          {
            id: 'sensor-legacy',
            name: 'Cảm biến legacy',
            roomId: LEGACY_ROOM,
            type: 'sensor',
            capabilities: ['temperature', 'humidity'],
            binding: { kind: 'telemetry-sensor' },
          },
        ],
        capabilities: [...BUILT_IN_CAPABILITIES],
      }),
    );
    const made = makeRegistry();
    registry = made.registry;
    bus = made.bus;
    await registry.load();
  });

  it('addDevice enforces exactly one metric even when legacy records exist', async () => {
    const rejected = await registry.addDevice({
      name: 'Thử nhiều chỉ số',
      roomId: LEGACY_ROOM,
      type: 'sensor',
      capabilities: ['temperature', 'humidity'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.message).toContain('exactly one metric');
    }
  });

  it('removes ONE projected metric of a legacy record; siblings survive', async () => {
    const events: {
      removedDeviceIds: readonly string[];
      removedBindings: readonly { deviceId: string; capability: string }[];
    }[] = [];
    bus.subscribe('devices:changed', e => events.push(e));

    const result = await registry.removeDeviceCapability(
      'sensor-legacy',
      'temperature',
    );
    expect(result.ok).toBe(true);

    // The device SURVIVES with only its sibling metric.
    const survivor = registry.findDevice('sensor-legacy')!;
    expect(survivor).toBeDefined();
    expect(survivor.capabilities).toEqual(['humidity']);

    // The event carries the exact binding removal, NOT a device removal.
    expect(events).toHaveLength(1);
    expect(events[0]!.removedDeviceIds).toEqual([]);
    expect(events[0]!.removedBindings).toEqual([
      { deviceId: 'sensor-legacy', capability: 'temperature' },
    ]);
  });

  it('removing the LAST capability cascades to a whole-device removal', async () => {
    await registry.removeDeviceCapability('sensor-legacy', 'temperature');
    const events: { removedDeviceIds: readonly string[] }[] = [];
    bus.subscribe('devices:changed', e => events.push(e));

    const result = await registry.removeDeviceCapability(
      'sensor-legacy',
      'humidity',
    );
    expect(result.ok).toBe(true);
    expect(registry.findDevice('sensor-legacy')).toBeUndefined();
    expect(events[events.length - 1]!.removedDeviceIds).toEqual([
      'sensor-legacy',
    ]);
  });

  it('rejects unknown devices, unknown fields and relay devices', async () => {
    expect((await registry.removeDeviceCapability('ghost', 'x')).ok).toBe(
      false,
    );
    const relay = await registry.addDevice({
      name: 'Đèn',
      roomId: LEGACY_ROOM,
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 1 },
    });
    expect(relay.ok).toBe(true);
    const relayDevice = registry
      .getDevices()
      .find(device => device.binding.kind === 'relay')!;
    expect(
      (await registry.removeDeviceCapability(relayDevice.id, 'switch')).ok,
    ).toBe(false);
    expect(
      (await registry.removeDeviceCapability('sensor-legacy', 'pressure')).ok,
    ).toBe(false);
  });
});

describe('legacy multi-capability non-worsening updates (fix cycle 1)', () => {
  const LEGACY_ROOM = 'room-legacy';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSetItem.mockResolvedValue(undefined);
    // A LOADED legacy multi-capability record (temperature + humidity),
    // exactly as an old snapshot would carry it (catalog includes a third
    // sensor field so worsening-addition attempts trip the invariant, not
    // the catalog check).
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        rooms: [{ id: LEGACY_ROOM, name: 'Phòng cũ', order: 0 }],
        devices: [
          {
            id: 'sensor-legacy',
            name: 'Cảm biến legacy',
            roomId: LEGACY_ROOM,
            type: 'sensor',
            capabilities: ['temperature', 'humidity'],
            binding: { kind: 'telemetry-sensor' },
          },
        ],
        capabilities: [
          ...BUILT_IN_CAPABILITIES,
          { type: 'illuminance', label: 'Ánh sáng', kind: 'sensor' },
        ],
      }),
    );
  });

  async function makeLoaded() {
    const made = makeRegistry();
    await made.registry.load();
    return made.registry;
  }

  it('renaming a loaded legacy multi-capability record succeeds and persists', async () => {
    const registry = await makeLoaded();
    const result = await registry.updateDevice('sensor-legacy', {
      name: 'Cảm biến legacy (đổi tên)',
    });
    expect(result.ok).toBe(true);
    expect(registry.findDevice('sensor-legacy')?.name).toBe(
      'Cảm biến legacy (đổi tên)',
    );
    // Persisted with the rename; capabilities untouched.
    const persisted = JSON.parse(mockSetItem.mock.calls.at(-1)![1] as string);
    const saved = persisted.devices.find(
      (d: { id: string }) => d.id === 'sensor-legacy',
    );
    expect(saved.name).toBe('Cảm biến legacy (đổi tên)');
    expect(saved.capabilities).toEqual(['temperature', 'humidity']);
    // Projection still shows TWO logical sensors (one per field).
    const projected = projectSensorRegistrations(
      registry.getDevices(),
      registry.getCapabilities(),
    ).filter(r => r.roomId === LEGACY_ROOM);
    expect(projected.map(r => r.field)).toEqual(['temperature', 'humidity']);
  });

  it('adding another field to the legacy record still fails (worsening multi-field write)', async () => {
    const registry = await makeLoaded();
    const result = await registry.updateDevice('sensor-legacy', {
      capabilities: ['temperature', 'humidity', 'illuminance'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('exactly one metric');
    }
  });

  it('moving the legacy multi-capability record to another room still fails', async () => {
    const registry = await makeLoaded();
    await registry.addRoom('Phòng B');
    const target = registry
      .getRooms()
      .find(room => room.id !== LEGACY_ROOM)!.id;
    const result = await registry.updateDevice('sensor-legacy', {
      roomId: target,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('exactly one metric');
    }
    expect(registry.findDevice('sensor-legacy')?.roomId).toBe(LEGACY_ROOM);
  });

  it('collapsing the legacy record to exactly one field is allowed (non-worsening)', async () => {
    const registry = await makeLoaded();
    const result = await registry.updateDevice('sensor-legacy', {
      capabilities: ['temperature'],
    });
    expect(result.ok).toBe(true);
    expect(registry.findDevice('sensor-legacy')?.capabilities).toEqual([
      'temperature',
    ]);
  });

  it('one-field creation stays enforced while legacy records exist', async () => {
    const registry = await makeLoaded();
    const rejected = await registry.addDevice({
      name: 'Mới',
      roomId: LEGACY_ROOM,
      type: 'sensor',
      capabilities: ['temperature', 'humidity'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.message).toContain('exactly one metric');
    }
  });
});

describe('room board code binding (board-discovery-binding)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
  });

  async function makeLoaded() {
    const made = makeRegistry();
    await made.registry.load();
    return made.registry;
  }

  it('addRoom persists a room WITH its board code', async () => {
    const registry = await makeLoaded();
    const result = await registry.addRoom('Phòng khách', 'board-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe('board-1');
    }
    expect(
      registry.getRooms().find(room => room.code === 'board-1')?.name,
    ).toBe('Phòng khách');
  });

  it('addRoom without code keeps the unbound (seed demo) shape', async () => {
    const registry = await makeLoaded();
    const result = await registry.addRoom('Phòng demo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBeUndefined();
    }
  });

  it('addRoom rejects a code already bound by another room', async () => {
    const registry = await makeLoaded();
    expect((await registry.addRoom('A', 'board-1')).ok).toBe(true);
    const result = await registry.addRoom('B', 'board-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toContain('board-1');
    }
    // Nothing was applied: B does not exist.
    expect(registry.getRooms().some(room => room.name === 'B')).toBe(false);
  });

  it('addRoom rejects an invalid code format (schema authority)', async () => {
    const registry = await makeLoaded();
    for (const code of ['kitchen 1', 'phòng-khách', 'a/b', 'a+b']) {
      const result = await registry.addRoom('X', code);
      expect(result.ok).toBe(false);
    }
    expect(registry.getRooms().some(room => room.name === 'X')).toBe(false);
  });

  it('updateRoom can BIND a code to an unbound room', async () => {
    const registry = await makeLoaded();
    const id = await addRoom(registry, 'Phòng A');
    const result = await registry.updateRoom(id, { code: 'board-9' });
    expect(result.ok).toBe(true);
    expect(registry.getRooms().find(room => room.id === id)?.code).toBe(
      'board-9',
    );
  });

  it('updateRoom can CHANGE a bound room to a free code (board swap)', async () => {
    const registry = await makeLoaded();
    const id = await addRoom(registry, 'Phòng A');
    await registry.updateRoom(id, { code: 'board-1' });
    const result = await registry.updateRoom(id, { code: 'board-2' });
    expect(result.ok).toBe(true);
    expect(registry.getRooms().find(room => room.id === id)?.code).toBe(
      'board-2',
    );
  });

  it('updateRoom can CLEAR the code (unbind) via explicit undefined', async () => {
    const registry = await makeLoaded();
    const id = await addRoom(registry, 'Phòng A');
    await registry.updateRoom(id, { code: 'board-1' });
    const result = await registry.updateRoom(id, { code: undefined });
    expect(result.ok).toBe(true);
    expect(
      registry.getRooms().find(room => room.id === id)?.code,
    ).toBeUndefined();
  });

  it('updateRoom rejects a code already bound by ANOTHER room', async () => {
    const registry = await makeLoaded();
    const a = await addRoom(registry, 'A');
    const b = await addRoom(registry, 'B');
    expect((await registry.updateRoom(a, { code: 'board-1' })).ok).toBe(true);
    const result = await registry.updateRoom(b, { code: 'board-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('board-1');
    }
    // B stays unbound; A keeps the board.
    expect(
      registry.getRooms().find(room => room.id === b)?.code,
    ).toBeUndefined();
    expect(registry.getRooms().find(room => room.id === a)?.code).toBe(
      'board-1',
    );
  });

  it('updateRoom rejects an invalid code format', async () => {
    const registry = await makeLoaded();
    const id = await addRoom(registry, 'Phòng A');
    const result = await registry.updateRoom(id, { code: 'phòng-1' });
    expect(result.ok).toBe(false);
  });
});

describe('rebindRoomBoard — atomic board transfer (fix cycle 2)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
  });

  async function makeLoaded() {
    const made = makeRegistry();
    await made.registry.load();
    return made.registry;
  }

  /** Two rooms; A bound to board-1, B unbound. */
  async function makeBoundPair() {
    const registry = await makeLoaded();
    const a = await addRoom(registry, 'Phòng A');
    const b = await addRoom(registry, 'Phòng B');
    expect((await registry.updateRoom(a, { code: 'board-1' })).ok).toBe(true);
    return { registry, a, b };
  }

  /** No two rooms in the CURRENT snapshot share a code (the invariant). */
  function expectNoSharedCode(registry: DeviceRegistryServiceImpl) {
    const codes = registry
      .getRooms()
      .flatMap(room => (room.code ? [room.code] : []));
    expect(new Set(codes).size).toBe(codes.length);
  }

  it('transfers board-1 from A to B in ONE write: A unbound, B bound', async () => {
    const { registry, a, b } = await makeBoundPair();
    // Count only THIS operation's persist (setup already wrote snapshots).
    mockSetItem.mockClear();

    const result = await registry.rebindRoomBoard('board-1', b);

    expect(result.ok).toBe(true);
    expect(
      registry.getRooms().find(room => room.id === a)?.code,
    ).toBeUndefined();
    expect(registry.getRooms().find(room => room.id === b)?.code).toBe(
      'board-1',
    );
    expectNoSharedCode(registry);
    // Atomicity: exactly ONE persisted snapshot carries the final state.
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(mockSetItem.mock.calls[0]![1] as string) as {
      rooms: { id: string; code?: string }[];
    };
    const byId = new Map(persisted.rooms.map(room => [room.id, room.code]));
    expect(byId.get(a)).toBeUndefined();
    expect(byId.get(b)).toBe('board-1');
  });

  it("DISPLACES the target room's previous code (released, not shared)", async () => {
    const { registry, a, b } = await makeBoundPair();
    // B was bound to board-2 before the transfer.
    expect((await registry.updateRoom(b, { code: 'board-2' })).ok).toBe(true);

    const result = await registry.rebindRoomBoard('board-1', b);

    expect(result.ok).toBe(true);
    const codes = registry
      .getRooms()
      .flatMap(room => (room.code ? [room.code] : []))
      .sort();
    // board-2 released (nowhere), board-1 lives on B only, A unbound.
    expect(codes).toEqual(['board-1']);
    expect(
      registry.getRooms().find(room => room.id === a)?.code,
    ).toBeUndefined();
    expect(registry.getRooms().find(room => room.id === b)?.code).toBe(
      'board-1',
    );
    expectNoSharedCode(registry);
  });

  it('binds an UNASSIGNED board to the target (no current holder)', async () => {
    const { registry, b } = await makeBoundPair();

    const result = await registry.rebindRoomBoard('board-9', b);

    expect(result.ok).toBe(true);
    expect(registry.getRooms().find(room => room.id === b)?.code).toBe(
      'board-9',
    );
    expectNoSharedCode(registry);
  });

  it('re-assigning a board to its CURRENT room is a no-op success', async () => {
    const { registry, a } = await makeBoundPair();
    mockSetItem.mockClear();

    const result = await registry.rebindRoomBoard('board-1', a);

    expect(result.ok).toBe(true);
    // Nothing changed → no pointless persist/broadcast cycle.
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(registry.getRooms().find(room => room.id === a)?.code).toBe(
      'board-1',
    );
  });

  it('rejects an unknown target room (not-found) leaving state untouched', async () => {
    const { registry, a } = await makeBoundPair();

    const result = await registry.rebindRoomBoard('board-1', 'room-ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
    expect(registry.getRooms().find(room => room.id === a)?.code).toBe(
      'board-1',
    );
  });

  it('rejects an invalid code format leaving state untouched', async () => {
    const { registry, a, b } = await makeBoundPair();

    const result = await registry.rebindRoomBoard('phòng 1', b);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
    // Failure = zero mutation: A keeps board-1, B stays unbound.
    expect(registry.getRooms().find(room => room.id === a)?.code).toBe(
      'board-1',
    );
    expect(
      registry.getRooms().find(room => room.id === b)?.code,
    ).toBeUndefined();
  });

  it('rejects an empty/whitespace code (the assign flow always carries one)', async () => {
    const { registry, b } = await makeBoundPair();

    const result = await registry.rebindRoomBoard('   ', b);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });

  it('a FAILED persist leaves the previous binding state untouched', async () => {
    const { registry, a, b } = await makeBoundPair();
    mockSetItem.mockRejectedValueOnce(new Error('storage full'));

    const result = await registry.rebindRoomBoard('board-1', b);

    expect(result.ok).toBe(false);
    // The in-memory snapshot still shows A bound (nothing applied).
    expect(registry.getRooms().find(room => room.id === a)?.code).toBe(
      'board-1',
    );
    expect(
      registry.getRooms().find(room => room.id === b)?.code,
    ).toBeUndefined();
  });
});
