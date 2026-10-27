/**
 * Devices domain tests — schemas, constraints, seeds.
 *
 * Verifies:
 * - DeviceSchema valid/invalid + binding↔capability constraint.
 * - DevicesSnapshotSchema duplicate-id detection + capability catalog.
 * - Capability catalog parse migration (old snapshot → built-ins) + round-trip.
 * - Custom capability types are accepted by DeviceSchema.
 * - Seed shape (3 rooms + one sensor per room + 3 relays in Phòng khách).
 * - parseDevicesSnapshot error shape.
 * - Legacy icon enrichment (scope amendment 3): seed-id map, missing-field-
 *   only, custom devices untouched, idempotent.
 */

import type { Device, DevicesSnapshot, Room } from './devices';
import {
  BUILT_IN_CAPABILITIES,
  CapabilityDefSchema,
  CapabilityMachineKeySchema,
  DeviceSchema,
  DevicesSnapshotSchema,
  RoomSchema,
  boardAssignment,
  capabilityTypeFromLabel,
  countRoomCategory,
  countRoomSensors,
  deviceCapabilityOptions,
  enrichLegacyDeviceIcons,
  mqttRoomIdOf,
  parseDevicesSnapshot,
  projectSensorRegistrations,
  resolveRoomByMqttId,
  roomCapacityWorseningError,
  sensorFieldTakenInRoom,
} from './devices';
import { seedDevices } from './seeds';

function sensorDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: 'sensor-1',
    name: 'Cảm biến',
    type: 'sensor',
    capabilities: ['temperature', 'humidity'],
    binding: { kind: 'telemetry-sensor' },
    ...overrides,
  };
}

function relayDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: 'relay-1',
    name: 'Đèn',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 1 },
    ...overrides,
  };
}

describe('DeviceSchema', () => {
  it('accepts a valid telemetry-sensor device', () => {
    const result = DeviceSchema.safeParse(sensorDevice());
    expect(result.success).toBe(true);
  });

  it('accepts a valid relay device', () => {
    const result = DeviceSchema.safeParse(relayDevice());
    expect(result.success).toBe(true);
  });

  it('rejects a relay device without exactly the switch capability', () => {
    const withTemp = relayDevice({ capabilities: ['switch', 'temperature'] });
    expect(DeviceSchema.safeParse(withTemp).success).toBe(false);

    const empty = relayDevice({ capabilities: [] });
    expect(DeviceSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects a telemetry-sensor exposing switch', () => {
    const withSwitch = sensorDevice({ capabilities: ['switch'] });
    expect(DeviceSchema.safeParse(withSwitch).success).toBe(false);
  });

  it('rejects a relay binding with index outside 1..10', () => {
    const below = relayDevice({
      binding: { kind: 'relay', index: 0 as 1 },
    });
    expect(DeviceSchema.safeParse(below).success).toBe(false);

    const above = relayDevice({
      binding: { kind: 'relay', index: 11 as 1 },
    });
    expect(DeviceSchema.safeParse(above).success).toBe(false);
  });

  it('accepts relay bindings across the whole 1..10 slot range', () => {
    for (let slot = 1; slot <= 10; slot++) {
      const device = relayDevice({
        binding: { kind: 'relay', index: slot as 1 },
      });
      expect(DeviceSchema.safeParse(device).success).toBe(true);
    }
  });

  it('rejects missing/empty name and id', () => {
    expect(DeviceSchema.safeParse(sensorDevice({ name: '' })).success).toBe(
      false,
    );
    expect(DeviceSchema.safeParse(sensorDevice({ id: '' })).success).toBe(
      false,
    );
  });

  it('accepts a custom (catalog) capability string on a sensor', () => {
    const withPressure = sensorDevice({
      capabilities: ['temperature', 'pressure'],
    });
    expect(DeviceSchema.safeParse(withPressure).success).toBe(true);
  });

  it('rejects empty capability strings', () => {
    const withEmpty = sensorDevice({ capabilities: [''] });
    expect(DeviceSchema.safeParse(withEmpty).success).toBe(false);
  });
});

describe('DevicesSnapshotSchema', () => {
  it('accepts a snapshot with unique ids', () => {
    const snapshot = {
      rooms: [{ id: 'room-1', name: 'Phòng khách', order: 0 }],
      devices: [sensorDevice(), relayDevice()],
    };
    expect(DevicesSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('rejects duplicate device ids', () => {
    const snapshot = {
      rooms: [],
      devices: [sensorDevice({ id: 'x' }), relayDevice({ id: 'x' })],
    };
    expect(DevicesSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects duplicate room ids', () => {
    const snapshot = {
      rooms: [
        { id: 'r', name: 'A', order: 0 },
        { id: 'r', name: 'B', order: 1 },
      ],
      devices: [],
    };
    expect(DevicesSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('round-trips locally deleted board codes when they are unbound', () => {
    const result = DevicesSnapshotSchema.safeParse({
      rooms: [{ id: 'room-1', name: 'Phòng khách', order: 0 }],
      devices: [],
      deletedBoardCodes: ['board-1'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deletedBoardCodes).toEqual(['board-1']);
    }
  });

  it('allows a hidden board code to remain bound to a room', () => {
    const result = DevicesSnapshotSchema.safeParse({
      rooms: [{ id: 'room-1', name: 'Phòng khách', order: 0, code: 'board-1' }],
      devices: [],
      deletedBoardCodes: ['board-1'],
    });

    expect(result.success).toBe(true);
  });

  it.each([['board-1', 'board-1'], [''], ['board/1'], ['a'.repeat(33)]])(
    'rejects duplicate or invalid deletion markers %j',
    (...deletedBoardCodes) => {
      expect(
        DevicesSnapshotSchema.safeParse({
          rooms: [],
          devices: [],
          deletedBoardCodes,
        }).success,
      ).toBe(false);
    },
  );

  it('migrates a snapshot without capabilities to the built-in catalog', () => {
    // Old persisted file: no `capabilities` field at all.
    const result = DevicesSnapshotSchema.safeParse({
      rooms: [],
      devices: [sensorDevice()],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(BUILT_IN_CAPABILITIES);
    }
  });

  it('round-trips a snapshot with an explicit catalog', () => {
    const catalog = [
      ...BUILT_IN_CAPABILITIES,
      { type: 'pressure', label: 'Áp suất', kind: 'sensor', unit: 'hPa' },
    ];
    const result = DevicesSnapshotSchema.safeParse({
      rooms: [],
      devices: [sensorDevice({ capabilities: ['pressure'] })],
      capabilities: catalog,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(catalog);
    }
  });

  it('rejects duplicate capability types in the catalog', () => {
    const result = DevicesSnapshotSchema.safeParse({
      rooms: [],
      devices: [],
      capabilities: [
        { type: 'pressure', label: 'Áp suất', kind: 'sensor' },
        { type: 'pressure', label: 'Áp suất 2', kind: 'sensor' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a capability definition with an invalid kind', () => {
    const result = DevicesSnapshotSchema.safeParse({
      rooms: [],
      devices: [],
      capabilities: [{ type: 'pressure', label: 'Áp suất', kind: 'valve' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('deviceCapabilityOptions', () => {
  it('offers only switch for relay bindings', () => {
    expect(deviceCapabilityOptions({ kind: 'relay', index: 2 })).toEqual([
      'switch',
    ]);
  });

  it('offers temperature + humidity for sensors', () => {
    expect(deviceCapabilityOptions({ kind: 'telemetry-sensor' })).toEqual([
      'temperature',
      'humidity',
    ]);
  });
});

describe('per-device icon (scope amendment 2)', () => {
  it('accepts an optional per-device icon glyph', () => {
    const result = DeviceSchema.safeParse({
      ...relayDevice(),
      icon: 'bulb-outline',
    });
    expect(result.success).toBe(true);
    expect(result.success ? result.data.icon : undefined).toBe('bulb-outline');
  });

  it('keeps persisted snapshots WITHOUT the field parsing identically (backwards compat)', () => {
    // A pre-amendment-2 persisted record carries no `icon` key at all.
    const legacy = {
      id: 'relay-legacy',
      name: 'Đèn cũ',
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 4 },
    };
    const result = DeviceSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(legacy);
      expect('icon' in result.data).toBe(false);
    }
    // …and the full snapshot parse round-trips it unchanged too.
    const snapshot = parseDevicesSnapshot({
      rooms: [{ id: 'room-1', name: 'Phòng', order: 0 }],
      devices: [legacy],
    });
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.devices[0]).toEqual(legacy);
    }
  });
});

describe('seedDevices', () => {
  it('seeds 3 rooms + separate temperature/humidity sensors per room + three relays per room', () => {
    const seed = seedDevices();
    expect(seed.rooms.map(room => room.name)).toEqual([
      'Phòng khách',
      'Phòng ngủ',
      'Bếp',
    ]);
    expect(seed.rooms[0]).toEqual({
      id: 'room-living',
      name: 'Phòng khách',
      order: 0,
      icon: 'home-outline',
    });
    expect(seed.rooms[1].icon).toBe('bed-outline');
    expect(seed.rooms[2].icon).toBe('restaurant-outline');
    // Look devices up by stable seed id: array order is an implementation
    // detail, so future seed insertions must not require re-indexing here.
    const byId = new Map(seed.devices.map(device => [device.id, device]));
    // Room-sensor rework: one logical sensor record per metric (6) +
    // demo-three-rooms: THREE relays per room Đèn/Quạt/Bơm (9).
    expect(seed.devices).toHaveLength(15);
    expect(byId.get('sensor-temp-01')).toEqual({
      id: 'sensor-temp-01',
      name: 'Nhiệt độ',
      roomId: 'room-living',
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(byId.get('sensor-hum-01')).toEqual({
      id: 'sensor-hum-01',
      name: 'Độ ẩm',
      roomId: 'room-living',
      type: 'sensor',
      capabilities: ['humidity'],
      binding: { kind: 'telemetry-sensor' },
    });
    expect(byId.get('sensor-temp-02')?.roomId).toBe('room-bedroom');
    expect(byId.get('sensor-temp-02')?.capabilities).toEqual(['temperature']);
    expect(byId.get('sensor-hum-02')?.roomId).toBe('room-bedroom');
    expect(byId.get('sensor-hum-02')?.capabilities).toEqual(['humidity']);
    expect(byId.get('sensor-temp-03')?.roomId).toBe('room-kitchen');
    expect(byId.get('sensor-hum-03')?.roomId).toBe('room-kitchen');
    expect(byId.get('relay-1')).toEqual({
      id: 'relay-1',
      name: 'Đèn',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      // Per-device glyph (scope amendment 2): the lamp no longer duplicates
      // the capability switch glyph.
      icon: 'bulb-outline',
      binding: { kind: 'relay', index: 1 },
    });
    expect(byId.get('relay-2')?.name).toBe('Quạt');
    // Per-device glyph (scope amendment 3): the REAL fan glyph from
    // MaterialCommunityIcons (`fan` — replaces the amendment-2 interim
    // `aperture-outline` substitute).
    expect(byId.get('relay-2')?.icon).toBe('fan');
    expect(byId.get('relay-2')?.binding).toEqual({ kind: 'relay', index: 2 });
    expect(byId.get('relay-3')?.name).toBe('Bơm');
    // Bơm keeps the capability fallback (no per-device glyph).
    expect(byId.get('relay-3')?.icon).toBeUndefined();
    expect(byId.get('relay-3')?.binding).toEqual({ kind: 'relay', index: 3 });
    // Demo-three-rooms: Phòng ngủ (relay-4..6) and Bếp (relay-7..9) get the
    // SAME Đèn/Quạt/Bơm triple with room-scoped slots 1..3 — equal slots in
    // separate rooms never alias.
    for (const [id, roomId] of [
      ['relay-4', 'room-bedroom'],
      ['relay-5', 'room-bedroom'],
      ['relay-6', 'room-bedroom'],
      ['relay-7', 'room-kitchen'],
      ['relay-8', 'room-kitchen'],
      ['relay-9', 'room-kitchen'],
    ] as const) {
      expect(byId.get(id)?.roomId).toBe(roomId);
      expect(byId.get(id)?.type).toBe('relay');
      expect(byId.get(id)?.capabilities).toEqual(['switch']);
    }
    expect(byId.get('relay-4')).toEqual({
      id: 'relay-4',
      name: 'Đèn',
      roomId: 'room-bedroom',
      type: 'relay',
      capabilities: ['switch'],
      icon: 'bulb-outline',
      binding: { kind: 'relay', index: 1 },
    });
    expect(byId.get('relay-5')?.name).toBe('Quạt');
    expect(byId.get('relay-5')?.icon).toBe('fan');
    expect(byId.get('relay-5')?.binding).toEqual({ kind: 'relay', index: 2 });
    expect(byId.get('relay-6')?.name).toBe('Bơm');
    expect(byId.get('relay-6')?.icon).toBeUndefined();
    expect(byId.get('relay-6')?.binding).toEqual({ kind: 'relay', index: 3 });
    expect(byId.get('relay-7')).toEqual({
      id: 'relay-7',
      name: 'Đèn',
      roomId: 'room-kitchen',
      type: 'relay',
      capabilities: ['switch'],
      icon: 'bulb-outline',
      binding: { kind: 'relay', index: 1 },
    });
    expect(byId.get('relay-8')?.name).toBe('Quạt');
    expect(byId.get('relay-8')?.icon).toBe('fan');
    expect(byId.get('relay-8')?.binding).toEqual({ kind: 'relay', index: 2 });
    expect(byId.get('relay-9')?.name).toBe('Bơm');
    expect(byId.get('relay-9')?.icon).toBeUndefined();
    expect(byId.get('relay-9')?.binding).toEqual({ kind: 'relay', index: 3 });
    // Sensors span the three rooms; every seeded room owns exactly its
    // 2-sensor + 3-relay demo set.
    for (const id of [
      'sensor-temp-01',
      'sensor-hum-01',
      'relay-1',
      'relay-2',
      'relay-3',
    ]) {
      expect(byId.get(id)?.roomId).toBe('room-living');
    }
    expect(seed.devices.filter(d => d.roomId === 'room-living')).toHaveLength(
      5,
    );
    expect(seed.devices.filter(d => d.roomId === 'room-bedroom')).toHaveLength(
      5,
    );
    expect(seed.devices.filter(d => d.roomId === 'room-kitchen')).toHaveLength(
      5,
    );
    // Room-scoped relay-slot uniqueness: the three relays of EACH room sit
    // on slots 1..3 exactly once.
    const slotsByRoom = new Map<string, number[]>();
    for (const device of seed.devices) {
      const { roomId, binding } = device;
      if (binding.kind === 'relay' && roomId !== undefined) {
        const slots = slotsByRoom.get(roomId) ?? [];
        slots.push(binding.index);
        slotsByRoom.set(roomId, slots);
      }
    }
    expect(slotsByRoom.size).toBe(3);
    for (const slots of slotsByRoom.values()) {
      expect([...slots].sort()).toEqual([1, 2, 3]);
    }
    // Every seed sensor registers EXACTLY one metric (room-sensor rework).
    for (const device of seed.devices) {
      if (device.binding.kind === 'telemetry-sensor') {
        expect(device.capabilities).toHaveLength(1);
      }
    }
  });

  it('the seed validates against the snapshot schema', () => {
    expect(DevicesSnapshotSchema.safeParse(seedDevices()).success).toBe(true);
  });

  it('the seed catalog is the built-in catalog', () => {
    expect(seedDevices().capabilities).toEqual(BUILT_IN_CAPABILITIES);
  });
});

describe('parseDevicesSnapshot', () => {
  it('returns errors with dotted paths for invalid input', () => {
    const result = parseDevicesSnapshot({ rooms: [{ id: '' }], devices: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns the parsed value for valid input', () => {
    const result = parseDevicesSnapshot(seedDevices());
    expect(result.ok).toBe(true);
  });
});

describe('capabilityTypeFromLabel (CP5)', () => {
  it('slugs a Vietnamese label into a stable type key', () => {
    expect(capabilityTypeFromLabel('Áp suất', [])).toBe('áp-suất');
    expect(capabilityTypeFromLabel('CO2 trong nhà', [])).toBe('co2-trong-nhà');
  });

  it('keeps the label case-insensitive', () => {
    expect(capabilityTypeFromLabel('ÁP SUẤT', [])).toBe('áp-suất');
  });

  it('deduplicates against existing types with a numeric suffix', () => {
    expect(capabilityTypeFromLabel('Áp suất', ['áp-suất'])).toBe('áp-suất-2');
    expect(capabilityTypeFromLabel('Áp suất', ['áp-suất', 'áp-suất-2'])).toBe(
      'áp-suất-3',
    );
  });

  it('falls back to a generic key for punctuation-only labels', () => {
    expect(capabilityTypeFromLabel('---', [])).toBe('cap');
    expect(capabilityTypeFromLabel('---', ['cap'])).toBe('cap-2');
  });
});

describe('CapabilityMachineKeySchema (CP-R4)', () => {
  it('accepts valid ASCII machine keys', () => {
    expect(CapabilityMachineKeySchema.safeParse('pressure').success).toBe(true);
    expect(CapabilityMachineKeySchema.safeParse('temperature').success).toBe(
      true,
    );
    expect(CapabilityMachineKeySchema.safeParse('co2_level').success).toBe(
      true,
    );
    expect(CapabilityMachineKeySchema.safeParse('a').success).toBe(true);
    expect(CapabilityMachineKeySchema.safeParse('abc123').success).toBe(true);
  });

  it('rejects Vietnamese/non-ASCII keys', () => {
    expect(CapabilityMachineKeySchema.safeParse('áp-suất').success).toBe(false);
    expect(CapabilityMachineKeySchema.safeParse('nhiệt-độ').success).toBe(
      false,
    );
  });

  it('rejects keys with hyphens or spaces', () => {
    expect(CapabilityMachineKeySchema.safeParse('pressure-value').success).toBe(
      false,
    );
    expect(CapabilityMachineKeySchema.safeParse('my key').success).toBe(false);
  });

  it('rejects uppercase or digit-starting keys', () => {
    expect(CapabilityMachineKeySchema.safeParse('Pressure').success).toBe(
      false,
    );
    expect(CapabilityMachineKeySchema.safeParse('1pressure').success).toBe(
      false,
    );
    expect(CapabilityMachineKeySchema.safeParse('_pressure').success).toBe(
      false,
    );
  });

  it('rejects empty strings', () => {
    expect(CapabilityMachineKeySchema.safeParse('').success).toBe(false);
  });
});

describe('CapabilityDefSchema legacy compatibility (CP-R4)', () => {
  it('still accepts legacy non-ASCII keys for snapshot parsing', () => {
    const result = CapabilityDefSchema.safeParse({
      type: 'áp-suất',
      label: 'Áp suất',
      kind: 'sensor',
    });
    // Lenient schema accepts legacy keys for read compatibility
    expect(result.success).toBe(true);
  });

  it('accepts valid ASCII keys through the lenient schema too', () => {
    const result = CapabilityDefSchema.safeParse({
      type: 'pressure',
      label: 'Pressure',
      kind: 'sensor',
    });
    expect(result.success).toBe(true);
  });
});

describe('projectSensorRegistrations (room-sensor rework)', () => {
  const catalog = BUILT_IN_CAPABILITIES;

  it('projects ONE registration per telemetry-device sensor capability', () => {
    const devices = [
      sensorDevice({ id: 's1', roomId: 'r1' }), // temperature + humidity
      relayDevice({ id: 'x1', roomId: 'r1' }),
    ];
    const projected = projectSensorRegistrations(devices, catalog);
    expect(projected).toEqual([
      {
        deviceId: 's1',
        roomId: 'r1',
        field: 'temperature',
        deviceName: 'Cảm biến',
      },
      {
        deviceId: 's1',
        roomId: 'r1',
        field: 'humidity',
        deviceName: 'Cảm biến',
      },
    ]);
  });

  it('a one-field sensor projects exactly one registration', () => {
    const devices = [
      sensorDevice({ id: 's1', roomId: 'r1', capabilities: ['temperature'] }),
    ];
    expect(projectSensorRegistrations(devices, catalog)).toEqual([
      {
        deviceId: 's1',
        roomId: 'r1',
        field: 'temperature',
        deviceName: 'Cảm biến',
      },
    ]);
  });

  it('ignores relay devices and non-sensor capabilities', () => {
    const devices = [
      relayDevice({ id: 'x1', roomId: 'r1' }),
      sensorDevice({ id: 's1', roomId: 'r1', capabilities: ['switch'] }),
    ];
    expect(projectSensorRegistrations(devices, catalog)).toEqual([]);
  });
});

describe('countRoomSensors (projected metric quota)', () => {
  const catalog = BUILT_IN_CAPABILITIES;

  it('counts temperature + humidity of a legacy multi-capability record as 2/10', () => {
    const devices = [
      sensorDevice({ id: 's1', roomId: 'r1' }),
      relayDevice({ id: 'x1', roomId: 'r1' }),
    ];
    expect(countRoomSensors(devices, catalog, 'r1')).toBe(2);
    expect(countRoomCategory(devices, catalog, 'r1', 'sensor')).toBe(2);
    expect(countRoomCategory(devices, catalog, 'r1', 'relay')).toBe(1);
  });

  it('the same field in a different room is independent', () => {
    const devices = [
      sensorDevice({ id: 's1', roomId: 'r1', capabilities: ['temperature'] }),
      sensorDevice({ id: 's2', roomId: 'r2', capabilities: ['temperature'] }),
    ];
    expect(countRoomSensors(devices, catalog, 'r1')).toBe(1);
    expect(countRoomSensors(devices, catalog, 'r2')).toBe(1);
  });
});

describe('sensorFieldTakenInRoom (room+field uniqueness)', () => {
  const catalog = BUILT_IN_CAPABILITIES;

  it('is true when the room already registers the field', () => {
    const devices = [
      sensorDevice({ id: 's1', roomId: 'r1', capabilities: ['temperature'] }),
    ];
    expect(sensorFieldTakenInRoom(devices, catalog, 'r1', 'temperature')).toBe(
      true,
    );
  });

  it('is false for another room or another field', () => {
    const devices = [
      sensorDevice({ id: 's1', roomId: 'r1', capabilities: ['temperature'] }),
    ];
    expect(sensorFieldTakenInRoom(devices, catalog, 'r2', 'temperature')).toBe(
      false,
    );
    expect(sensorFieldTakenInRoom(devices, catalog, 'r1', 'humidity')).toBe(
      false,
    );
  });

  it('excludes the edited device', () => {
    const devices = [
      sensorDevice({ id: 's1', roomId: 'r1', capabilities: ['temperature'] }),
    ];
    expect(
      sensorFieldTakenInRoom(devices, catalog, 'r1', 'temperature', 's1'),
    ).toBe(false);
  });
});

describe('roomCapacityWorseningError (projected sensor quota)', () => {
  const catalog = BUILT_IN_CAPABILITIES;
  const full = (roomId: string): Device[] =>
    Array.from({ length: 5 }, (_, i) =>
      sensorDevice({
        id: `s${i}`,
        roomId,
        capabilities: ['temperature', 'humidity'], // 5 devices = 10 metrics
      }),
    );

  it('rejects the eleventh projected metric in a full room', () => {
    const devices = full('r1');
    const next = sensorDevice({
      id: 'new',
      roomId: 'r1',
      capabilities: ['temperature'],
    });
    expect(roomCapacityWorseningError(devices, next, catalog, 'r1')).toContain(
      'maximum of 10 sensor metrics',
    );
  });

  it('allows non-worsening edits inside a legacy over-capacity room', () => {
    const devices = [
      ...full('r1'),
      sensorDevice({ id: 'extra', roomId: 'r1', capabilities: ['pressure'] }),
    ];
    // 11 metrics already; renaming the extra device must stay allowed.
    const renamed = sensorDevice({
      id: 'extra',
      roomId: 'r1',
      name: 'Đã đổi tên',
      capabilities: ['pressure'],
    });
    expect(
      roomCapacityWorseningError(devices, renamed, catalog, 'r1', 'extra'),
    ).toBeNull();
  });

  it('relay quota keeps counting device records', () => {
    const devices = Array.from({ length: 10 }, (_, i) =>
      relayDevice({
        id: `x${i}`,
        roomId: 'r1',
        binding: { kind: 'relay', index: (i % 10) + 1 } as Device['binding'],
      }),
    );
    const next = relayDevice({
      id: 'new',
      roomId: 'r1',
      binding: { kind: 'relay', index: 10 },
    });
    // Slot 10 already taken by x9 → but this helper is quota-only; slot
    // uniqueness is a separate check. The quota itself rejects #11.
    expect(roomCapacityWorseningError(devices, next, catalog, 'r1')).toContain(
      'maximum of 10 relay devices',
    );
  });
});

describe('enrichLegacyDeviceIcons (scope amendment 3 — legacy icon migration)', () => {
  /** A legacy snapshot: the seed relays WITHOUT the (then-unknown) icon
   * field, plus a user-created custom device. */
  function legacySnapshot(): DevicesSnapshot {
    return {
      rooms: [{ id: 'room-living', name: 'Phòng khách', order: 0 }],
      devices: [
        {
          id: 'relay-1',
          name: 'Đèn',
          roomId: 'room-living',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 1 },
        },
        {
          id: 'relay-2',
          name: 'Quạt',
          roomId: 'room-living',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 2 },
        },
        {
          id: 'custom-1',
          name: 'Máy người dùng tự tạo',
          roomId: 'room-living',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 4 },
        },
      ],
      capabilities: BUILT_IN_CAPABILITIES,
    };
  }

  it('enriches ONLY the known seed ids (relay-1 → bulb, relay-2 → fan)', () => {
    const enriched = enrichLegacyDeviceIcons(legacySnapshot());
    const byId = new Map(enriched.devices.map(device => [device.id, device]));
    expect(byId.get('relay-1')?.icon).toBe('bulb-outline');
    // relay-2 gets the REAL fan glyph (MaterialCommunityIcons) — the same
    // glyph fresh seeds carry.
    expect(byId.get('relay-2')?.icon).toBe('fan');
  });

  it('never touches custom devices (capability fallback stays)', () => {
    const enriched = enrichLegacyDeviceIcons(legacySnapshot());
    const custom = enriched.devices.find(device => device.id === 'custom-1');
    expect(custom?.icon).toBeUndefined();
    // Every other field of the custom device is byte-identical.
    const original = legacySnapshot().devices.find(
      device => device.id === 'custom-1',
    );
    expect(custom).toEqual(original);
  });

  it('never overwrites an existing (or user-customized) icon value', () => {
    const snapshot = legacySnapshot();
    const withIcons: DevicesSnapshot = {
      ...snapshot,
      devices: snapshot.devices.map(device =>
        device.id === 'relay-1' ? { ...device, icon: 'sunny-outline' } : device,
      ),
    };
    const enriched = enrichLegacyDeviceIcons(withIcons);
    expect(enriched.devices.find(device => device.id === 'relay-1')?.icon).toBe(
      'sunny-outline',
    );
    // relay-2 (still missing) is filled; relay-1 is untouched.
    expect(enriched.devices.find(device => device.id === 'relay-2')?.icon).toBe(
      'fan',
    );
  });

  it('is IDEMPOTENT: enriching an enriched snapshot returns it unchanged', () => {
    const once = enrichLegacyDeviceIcons(legacySnapshot());
    const twice = enrichLegacyDeviceIcons(once);
    expect(twice).toEqual(once);
    // Structurally: the second pass returns the SAME object (no-op path).
    expect(twice).toBe(once);
  });

  it('returns the input identity when nothing needs filling', () => {
    const snapshot = legacySnapshot();
    // A snapshot where BOTH seed relays already carry their icons (plus
    // the custom device, not in the map) → pure no-op, same object back.
    const complete: DevicesSnapshot = {
      ...snapshot,
      devices: snapshot.devices.map(device =>
        device.id === 'relay-1'
          ? { ...device, icon: 'bulb-outline' }
          : device.id === 'relay-2'
          ? { ...device, icon: 'fan' }
          : device,
      ),
    };
    expect(enrichLegacyDeviceIcons(complete)).toBe(complete);
  });

  it('treats an EMPTY-STRING icon as missing (it is not a glyph)', () => {
    const snapshot = legacySnapshot();
    const emptyIcon: DevicesSnapshot = {
      ...snapshot,
      devices: snapshot.devices.map(device =>
        device.id === 'relay-1' ? { ...device, icon: '' } : device,
      ),
    };
    const enriched = enrichLegacyDeviceIcons(emptyIcon);
    expect(enriched.devices.find(device => device.id === 'relay-1')?.icon).toBe(
      'bulb-outline',
    );
  });

  it('preserves every other device field when filling the icon', () => {
    const snapshot = legacySnapshot();
    const enriched = enrichLegacyDeviceIcons(snapshot);
    const original = snapshot.devices.find(device => device.id === 'relay-2');
    const migrated = enriched.devices.find(device => device.id === 'relay-2');
    expect(migrated).toEqual({ ...original, icon: 'fan' });
    // The snapshot shape (rooms/catalog) is untouched (same references).
    expect(enriched.rooms).toBe(snapshot.rooms);
    expect(enriched.capabilities).toBe(snapshot.capabilities);
  });

  it('the enriched snapshot still validates against the snapshot schema', () => {
    expect(
      DevicesSnapshotSchema.safeParse(enrichLegacyDeviceIcons(legacySnapshot()))
        .success,
    ).toBe(true);
  });
});

describe('room board code (board-discovery-binding)', () => {
  const baseRoom = { id: 'room-1', name: 'Phòng khách', order: 0 };

  it('parses a room WITHOUT code (migration-safe: old snapshots unchanged)', () => {
    expect(RoomSchema.safeParse(baseRoom).success).toBe(true);
  });

  it('accepts a valid ASCII code (letters, digits, underscore, dash)', () => {
    for (const code of ['0', 'board-1', 'kitchen_esp32', 'A9_-']) {
      expect(RoomSchema.safeParse({ ...baseRoom, code }).success).toBe(true);
    }
  });

  it('rejects invalid codes (spaces, Vietnamese, weird characters, too long)', () => {
    for (const code of [
      'kitchen 1',
      'phòng khách',
      'bội#1',
      'a/b',
      'a+b',
      'a.b',
      '',
      'x'.repeat(33),
    ]) {
      expect(RoomSchema.safeParse({ ...baseRoom, code }).success).toBe(false);
    }
  });

  it('rejects TWO rooms binding the SAME code in one snapshot', () => {
    const snapshot = {
      rooms: [
        { ...baseRoom, code: 'board-1' },
        { id: 'room-2', name: 'Phòng ngủ', order: 1, code: 'board-1' },
      ],
      devices: [],
      capabilities: BUILT_IN_CAPABILITIES,
    };
    const result = DevicesSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it('accepts distinct codes and code-less rooms side by side', () => {
    const snapshot = {
      rooms: [
        { ...baseRoom, code: 'board-1' },
        { id: 'room-2', name: 'Phòng ngủ', order: 1 },
      ],
      devices: [],
      capabilities: BUILT_IN_CAPABILITIES,
    };
    expect(DevicesSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('mqttRoomIdOf prefers the code and falls back to the internal id', () => {
    expect(mqttRoomIdOf({ ...baseRoom, code: 'board-1' })).toBe('board-1');
    expect(mqttRoomIdOf(baseRoom)).toBe('room-1');
  });

  it('resolveRoomByMqttId matches by code FIRST, then by id (backward compat)', () => {
    const rooms: readonly Room[] = [
      { ...baseRoom, code: 'shared' },
      { id: 'room-2', name: 'Phòng ngủ', order: 1 },
      { id: 'shared', name: 'Phòng id trùng', order: 2 },
    ];
    // Code match wins even when another room's id equals the code.
    expect(resolveRoomByMqttId(rooms, 'shared')?.id).toBe('room-1');
    // A code-less room still resolves by its internal id (seed demo fallback).
    expect(resolveRoomByMqttId(rooms, 'room-2')?.id).toBe('room-2');
    // Unknown identity → undefined.
    expect(resolveRoomByMqttId(rooms, 'ghost')).toBeUndefined();
  });

  it('boardAssignment maps every code-bearing room into a code → room Map', () => {
    const rooms: readonly Room[] = [
      { ...baseRoom, code: 'board-1' },
      { id: 'room-2', name: 'Phòng ngủ', order: 1 },
      { id: 'room-3', name: 'Nhà bếp', order: 2, code: 'board-2' },
    ];
    const assignment = boardAssignment(rooms);
    expect(assignment.size).toBe(2);
    expect(assignment.get('board-1')?.id).toBe('room-1');
    expect(assignment.get('board-2')?.id).toBe('room-3');
    expect(assignment.has('room-2')).toBe(false);
  });
});
