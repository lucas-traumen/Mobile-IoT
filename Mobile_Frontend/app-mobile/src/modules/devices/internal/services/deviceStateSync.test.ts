/**
 * DeviceStateSync tests (approved room/field telemetry contract + the
 * boards-command failure bridge).
 *
 * Verifies the bridge: `telemetry:received` (`{roomId, field, value}`) →
 * ONLY the registrations matching BOTH the room and the field update
 * (no cross-room fan-out); relay:feedback / relay:command → switch =
 * ON/OFF for the matching room-scoped slot AND clear any stale command
 * error; `relay:commandFailed` → the optimistic value rolls back to the
 * pre-command state (or clears to unknown) and the per-capability command
 * error is stored. Idempotent start/stop.
 */

import type { SensorTelemetry } from '@modules/telemetry/api';
import type { RelayCommandFailure } from '@core/events';
import { InMemoryEventBus } from '@core/eventbus';
import { createLogger } from '@core/logger';

import type { CapabilityDef, Device, Room } from '../domain/devices';
import { BUILT_IN_CAPABILITIES } from '../domain/devices';
import { capabilityKey } from '../domain/devices';
import { seedDevices } from '../domain/seeds';
import { createDeviceStateStore } from '../data/deviceStateStore';
import { DeviceStateSync } from './deviceStateSync';

function makeSync() {
  const bus = new InMemoryEventBus(createLogger('test'));
  const registry = {
    getDevices: jest.fn((): readonly Device[] => seedDevices().devices),
    getCapabilities: (): readonly CapabilityDef[] => BUILT_IN_CAPABILITIES,
  };
  const store = createDeviceStateStore(() => 42);
  const sync = new DeviceStateSync({
    bus,
    registry,
    store,
    logger: createLogger('test'),
  });
  return { bus, registry, store, sync };
}

function reading(overrides: Partial<SensorTelemetry> = {}): SensorTelemetry {
  return {
    roomId: 'room-living',
    field: 'temperature',
    value: 26.3,
    ...overrides,
  };
}

describe('DeviceStateSync — room/field telemetry dispatch', () => {
  it('updates only the registration matching the exact room and field', () => {
    const { bus, store, sync } = makeSync();
    sync.start();

    bus.emit('telemetry:received', reading());

    expect(
      store.getState().values[capabilityKey('sensor-temp-01', 'temperature')],
    ).toEqual({ value: 26.3, updatedAt: 42 });
    // The humidity registration of the same room is untouched.
    expect(
      store.getState().values[capabilityKey('sensor-hum-01', 'humidity')],
    ).toBeUndefined();
  });

  it('never fans a message into another room (multi-room isolation)', () => {
    const { bus, store, sync } = makeSync();
    sync.start();

    bus.emit('telemetry:received', reading({ roomId: 'room-bedroom' }));

    // Only the bedroom registration moves; living stays empty.
    expect(
      store.getState().values[capabilityKey('sensor-temp-02', 'temperature')],
    ).toEqual({ value: 26.3, updatedAt: 42 });
    expect(
      store.getState().values[capabilityKey('sensor-temp-01', 'temperature')],
    ).toBeUndefined();
  });

  it('ignores fields no device in the room registers', () => {
    const { bus, store, sync } = makeSync();
    sync.start();

    bus.emit('telemetry:received', reading({ field: 'pressure', value: 1013 }));

    expect(store.getState().values).toEqual({});
  });

  it('ignores fields that are not sensor-kind catalog capabilities', () => {
    const bus = new InMemoryEventBus(createLogger('test'));
    const store = createDeviceStateStore(() => 42);
    const sensor: Device = {
      id: 's1',
      name: 'Nhiệt độ',
      roomId: 'r1',
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    };
    const sync = new DeviceStateSync({
      bus,
      registry: {
        getDevices: () => [sensor],
        getCapabilities: () => BUILT_IN_CAPABILITIES, // no `voltage`
      },
      store,
      logger: createLogger('test'),
    });
    sync.start();

    bus.emit('telemetry:received', reading({ roomId: 'r1', field: 'voltage' }));

    expect(store.getState().values).toEqual({});
  });

  it('maps a custom catalog sensor field to the matching registration', () => {
    const bus = new InMemoryEventBus(createLogger('test'));
    const store = createDeviceStateStore(() => 42);
    const pressureSensor: Device = {
      id: 'sensor-pressure-01',
      name: 'Áp suất',
      roomId: 'r1',
      type: 'sensor',
      capabilities: ['pressure'],
      binding: { kind: 'telemetry-sensor' },
    };
    const catalog: readonly CapabilityDef[] = [
      ...BUILT_IN_CAPABILITIES,
      { type: 'pressure', label: 'Áp suất', kind: 'sensor', unit: 'hPa' },
    ];
    const sync = new DeviceStateSync({
      bus,
      registry: {
        getDevices: () => [pressureSensor],
        getCapabilities: () => catalog,
      },
      store,
      logger: createLogger('test'),
    });
    sync.start();

    bus.emit(
      'telemetry:received',
      reading({ roomId: 'r1', field: 'pressure', value: 1013 }),
    );

    expect(
      store.getState().values[capabilityKey('sensor-pressure-01', 'pressure')],
    ).toEqual({ value: 1013, updatedAt: 42 });
  });
});

describe('DeviceStateSync — room-scoped relay dispatch (unchanged contract)', () => {
  it('maps relay:feedback to switch=true for the addressed room+slot only', () => {
    const { bus, store, sync } = makeSync();
    sync.start();

    bus.emit('relay:feedback', {
      roomId: 'room-living',
      index: 2,
      state: 'ON',
    });

    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')].value,
    ).toBe(true);
    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')].updatedAt,
    ).toBe(42);
    // The seed now carries the SAME slots 1..3 in EVERY room — feedback
    // addressed to room-living must not touch the bedroom/kitchen relay
    // devices (room-scoped dispatch, demo-three-rooms).
    expect(
      store.getState().values[capabilityKey('relay-1', 'switch')],
    ).toBeUndefined();
    expect(
      store.getState().values[capabilityKey('relay-4', 'switch')],
    ).toBeUndefined();
    expect(
      store.getState().values[capabilityKey('relay-5', 'switch')],
    ).toBeUndefined();
    expect(
      store.getState().values[capabilityKey('relay-7', 'switch')],
    ).toBeUndefined();
  });

  it('maps relay:command to switch=false for OFF (optimistic)', () => {
    const { bus, store, sync } = makeSync();
    sync.start();

    bus.emit('relay:command', {
      roomId: 'room-living',
      index: 3,
      state: 'OFF',
    });

    expect(
      store.getState().values[capabilityKey('relay-3', 'switch')].value,
    ).toBe(false);
  });

  it('ignores relay events for another room even with the same slot', () => {
    const bus = new InMemoryEventBus(createLogger('test'));
    const store = createDeviceStateStore(() => 42);
    const livingRelay: Device = {
      id: 'relay-living-2',
      name: 'Quạt khách',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 2 },
    };
    const sync = new DeviceStateSync({
      bus,
      registry: {
        getDevices: () => [livingRelay],
        getCapabilities: () => BUILT_IN_CAPABILITIES,
      },
      store,
      logger: createLogger('test'),
    });
    sync.start();

    // Same slot (2) but a different room: the living-room device must not move.
    bus.emit('relay:command', {
      roomId: 'room-bedroom',
      index: 2,
      state: 'ON',
    });
    expect(store.getState().values).toEqual({});

    bus.emit('relay:feedback', {
      roomId: 'room-living',
      index: 2,
      state: 'ON',
    });
    expect(
      store.getState().values[capabilityKey('relay-living-2', 'switch')].value,
    ).toBe(true);
  });

  it('ignores feedback for a channel no device is bound to', () => {
    const bus = new InMemoryEventBus(createLogger('test'));
    const store = createDeviceStateStore(() => 42);
    const sensorOnly: Device = {
      id: 'sensor-temp-01',
      name: 'Nhiệt độ',
      roomId: 'room-living',
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    };
    const sync = new DeviceStateSync({
      bus,
      registry: {
        getDevices: () => [sensorOnly],
        getCapabilities: () => BUILT_IN_CAPABILITIES,
      },
      store,
      logger: createLogger('test'),
    });
    sync.start();

    bus.emit('relay:command', { roomId: 'room-living', index: 1, state: 'ON' });

    // No relay device is registered → no switch value anywhere.
    expect(store.getState().values).toEqual({});
  });

  it('start() is idempotent: no stacked handlers', () => {
    const { bus, store, sync } = makeSync();
    sync.start();
    sync.start();
    sync.start();

    bus.emit('telemetry:received', reading({ value: 20 }));

    // If handlers stacked, the value would be the same anyway — so assert the
    // number of subscribers did not grow by checking stop() fully clears.
    sync.stop();
    sync.stop();
    bus.emit('telemetry:received', reading({ value: 99 }));
    expect(
      store.getState().values[capabilityKey('sensor-temp-01', 'temperature')],
    ).toEqual({ value: 20, updatedAt: 42 });
  });
});

describe('DeviceStateSync — board-code identity routing (board-discovery-binding)', () => {
  /** A bound room: MQTT identity 'board-1', internal id 'room-living'. */
  const boundRoom: Room = {
    id: 'room-living',
    name: 'Phòng khách',
    order: 0,
    code: 'board-1',
  };
  /** An UNBOUND room (seed demo): identity = the internal id. */
  const unboundRoom: Room = {
    id: 'room-bedroom',
    name: 'Phòng ngủ',
    order: 1,
  };

  function makeSyncWithRooms(
    rooms: readonly Room[],
    devices: readonly Device[],
  ) {
    const bus = new InMemoryEventBus(createLogger('test'));
    const store = createDeviceStateStore(() => 42);
    const sync = new DeviceStateSync({
      bus,
      registry: {
        getDevices: () => devices,
        getCapabilities: (): readonly CapabilityDef[] => BUILT_IN_CAPABILITIES,
      },
      getRooms: () => rooms,
      store,
      logger: createLogger('test'),
    });
    return { bus, store, sync };
  }

  const boundSensor: Device = {
    id: 'sensor-temp-01',
    name: 'Nhiệt độ',
    roomId: 'room-living',
    type: 'sensor',
    capabilities: ['temperature'],
    binding: { kind: 'telemetry-sensor' },
  };
  const boundRelay: Device = {
    id: 'relay-2',
    name: 'Quạt',
    roomId: 'room-living',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 2 },
  };

  it('dispatches a reading whose roomId is the room CODE to that room (3c)', () => {
    const { bus, store, sync } = makeSyncWithRooms([boundRoom], [boundSensor]);
    sync.start();

    // The wire roomId is the board code — NOT the internal room id.
    bus.emit(
      'telemetry:received',
      reading({ roomId: 'board-1', field: 'temperature', value: 25.1 }),
    );

    expect(
      store.getState().values[capabilityKey('sensor-temp-01', 'temperature')],
    ).toEqual({ value: 25.1, updatedAt: 42 });
  });

  it('still dispatches by internal id for code-less rooms (regression, 3c)', () => {
    const bedroomSensor: Device = {
      ...boundSensor,
      id: 'sensor-temp-02',
      roomId: 'room-bedroom',
    };
    const { bus, store, sync } = makeSyncWithRooms(
      [boundRoom, unboundRoom],
      [boundSensor, bedroomSensor],
    );
    sync.start();

    bus.emit('telemetry:received', reading({ roomId: 'room-bedroom' }));

    expect(
      store.getState().values[capabilityKey('sensor-temp-02', 'temperature')],
    ).toEqual({ value: 26.3, updatedAt: 42 });
    // The bound room's device is untouched.
    expect(
      store.getState().values[capabilityKey('sensor-temp-01', 'temperature')],
    ).toBeUndefined();
  });

  it('dispatches a bound room reading by code, never leaking to an id twin', () => {
    // Room whose id EQUALS another room's code: the code match must win.
    const idTwinRoom: Room = {
      id: 'board-1',
      name: 'Phòng trùng mã',
      order: 2,
    };
    const twinSensor: Device = {
      ...boundSensor,
      id: 'sensor-twin',
      roomId: 'board-1',
    };
    const { bus, store, sync } = makeSyncWithRooms(
      [boundRoom, idTwinRoom],
      [boundSensor, twinSensor],
    );
    sync.start();

    bus.emit('telemetry:received', reading({ roomId: 'board-1' }));

    expect(
      store.getState().values[capabilityKey('sensor-temp-01', 'temperature')],
    ).toEqual({ value: 26.3, updatedAt: 42 });
    expect(
      store.getState().values[capabilityKey('sensor-twin', 'temperature')],
    ).toBeUndefined();
  });

  it('resolves relay:feedback sent under the room CODE to the slot device (3d)', () => {
    const { bus, store, sync } = makeSyncWithRooms([boundRoom], [boundRelay]);
    sync.start();

    bus.emit('relay:feedback', {
      roomId: 'board-1',
      index: 2,
      state: 'ON',
    });

    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')].value,
    ).toBe(true);
  });

  it('resolves relay:command sent under the internal id for unbound rooms (regression)', () => {
    const bedroomRelay: Device = {
      ...boundRelay,
      id: 'relay-bedroom-2',
      roomId: 'room-bedroom',
    };
    const { bus, store, sync } = makeSyncWithRooms(
      [boundRoom, unboundRoom],
      [bedroomRelay],
    );
    sync.start();

    bus.emit('relay:command', {
      roomId: 'room-bedroom',
      index: 2,
      state: 'OFF',
    });

    expect(
      store.getState().values[capabilityKey('relay-bedroom-2', 'switch')].value,
    ).toBe(false);
  });

  it('an unknown wire identity dispatches nothing (no guessing)', () => {
    const { bus, store, sync } = makeSyncWithRooms(
      [boundRoom, unboundRoom],
      [boundSensor, boundRelay],
    );
    sync.start();

    bus.emit('telemetry:received', reading({ roomId: 'ghost-board' }));
    bus.emit('relay:feedback', {
      roomId: 'ghost-board',
      index: 1,
      state: 'ON',
    });

    expect(store.getState().values).toEqual({});
  });
});

describe('DeviceStateSync — relay command failure bridge (boards-topic-contract-v2)', () => {
  const room: Room = { id: 'room-living', name: 'Phòng khách', order: 0 };
  const relay: Device = {
    id: 'relay-2',
    name: 'Quạt',
    roomId: 'room-living',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 2 },
  };

  function makeFailureSync() {
    const bus = new InMemoryEventBus(createLogger('test'));
    const store = createDeviceStateStore(() => 42);
    const sync = new DeviceStateSync({
      bus,
      registry: {
        getDevices: (): readonly Device[] => [relay],
        getCapabilities: (): readonly CapabilityDef[] => BUILT_IN_CAPABILITIES,
      },
      getRooms: () => [room],
      store,
      logger: createLogger('test'),
    });
    sync.start();
    return { bus, store, sync };
  }

  const failure = (
    overrides: {
      roomId?: string;
      index?: number;
      attempted?: 'ON' | 'OFF';
      previous?: 'ON' | 'OFF' | null;
    } = {},
  ): RelayCommandFailure => ({
    roomId: overrides.roomId ?? 'room-living',
    index: (overrides.index ?? 2) as 1,
    attempted: overrides.attempted ?? 'ON',
    previous:
      overrides.previous !== undefined ? overrides.previous : ('OFF' as const),
    error: { code: 'timeout' as const, message: 'đã hết thời gian chờ' },
  });

  it('restores the KNOWN pre-command state and stores the error', () => {
    const { bus, store } = makeFailureSync();

    // The optimistic command already flipped the value to true.
    bus.emit('relay:command', {
      roomId: 'room-living',
      index: 2,
      state: 'ON',
    });
    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')].value,
    ).toBe(true);

    bus.emit(
      'relay:commandFailed',
      failure({ attempted: 'ON', previous: 'OFF' }),
    );

    // Rolled back to the pre-command state (previous known: OFF).
    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')].value,
    ).toBe(false);
    expect(store.getState().getCommandError('relay-2', 'switch')).toBe(
      'đã hết thời gian chờ',
    );
  });

  it('clears the value to UNKNOWN when the pre-command state was unknown', () => {
    const { bus, store } = makeFailureSync();

    bus.emit('relay:command', {
      roomId: 'room-living',
      index: 2,
      state: 'ON',
    });
    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')],
    ).toBeTruthy();

    bus.emit('relay:commandFailed', failure({ previous: null }));

    // Honest unknown: the capability value is GONE, not an invented false.
    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')],
    ).toBeUndefined();
    expect(store.getState().getCommandError('relay-2', 'switch')).toBe(
      'đã hết thời gian chờ',
    );
  });

  it('ignores failures for another room / slot', () => {
    const { bus, store } = makeFailureSync();

    bus.emit('relay:commandFailed', failure({ roomId: 'ghost' }));
    bus.emit('relay:commandFailed', failure({ index: 3 }));

    expect(store.getState().values).toEqual({});
    expect(store.getState().getCommandError('relay-2', 'switch')).toBeNull();
  });

  it('a matching relay:command clears a stale error (next success clears)', () => {
    const { bus, store } = makeFailureSync();
    bus.emit('relay:commandFailed', failure());
    expect(store.getState().getCommandError('relay-2', 'switch')).toBeTruthy();

    bus.emit('relay:command', { roomId: 'room-living', index: 2, state: 'ON' });

    expect(store.getState().getCommandError('relay-2', 'switch')).toBeNull();
    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')].value,
    ).toBe(true);
  });

  it('a matching relay:feedback clears a stale error', () => {
    const { bus, store } = makeFailureSync();
    bus.emit('relay:commandFailed', failure());
    expect(store.getState().getCommandError('relay-2', 'switch')).toBeTruthy();

    bus.emit('relay:feedback', {
      roomId: 'room-living',
      index: 2,
      state: 'OFF',
    });

    expect(store.getState().getCommandError('relay-2', 'switch')).toBeNull();
    expect(
      store.getState().values[capabilityKey('relay-2', 'switch')].value,
    ).toBe(false);
  });

  it('a command/feedback for ANOTHER room/slot does not clear the error', () => {
    const { bus, store } = makeFailureSync();
    bus.emit('relay:commandFailed', failure());
    expect(store.getState().getCommandError('relay-2', 'switch')).toBeTruthy();

    bus.emit('relay:command', { roomId: 'ghost', index: 2, state: 'ON' });
    bus.emit('relay:feedback', {
      roomId: 'room-living',
      index: 3,
      state: 'ON',
    });

    expect(store.getState().getCommandError('relay-2', 'switch')).toBeTruthy();
  });
});
