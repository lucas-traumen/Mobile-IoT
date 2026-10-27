/**
 * Dashboard seed tests (`defaultDashboardsFile`, demo-three-rooms).
 *
 * Verifies the first-run Template seed: the zod schema accepts it, 'Trang
 * chủ' references ALL THREE seeded rooms in order, every room owns its
 * 2-sensor + 3-switch demo layout (band-model conformant: the env band at
 * row 0, the devices band contiguous behind it, no collisions), Phòng khách
 * keeps its original four widget ids/positions plus the new w-pump, and
 * every widget binding points at a REAL seeded device (the devices seed is
 * the binding authority — read through its public api facade).
 */

import { seedDevices } from '@modules/devices/api';

import { validateLayout } from './layout';
import { parseDashboardsFile } from './dashboardSchema';
import { sectionKeyOf } from './sectionGroups';
import { defaultDashboardsFile } from './seeds';

// The devices facade transitively requires AsyncStorage (devices api) —
// pin the native module the same way the other cross-module tests do.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

/** The seed Template ('Trang chủ'). */
function seedTemplate() {
  return defaultDashboardsFile().templates[0]!;
}

/** Look one room reference up by physical room id. */
function roomRef(roomId: string) {
  const reference = seedTemplate().rooms.find(
    candidate => candidate.roomId === roomId,
  );
  expect(reference).toBeDefined();
  return reference!;
}

describe('defaultDashboardsFile (demo-three-rooms)', () => {
  it('the seed validates against the persisted file schema', () => {
    const parsed = parseDashboardsFile(defaultDashboardsFile());
    expect(parsed.ok).toBe(true);
  });

  it('seeds ONE Template whose room references cover all THREE rooms in order', () => {
    const file = defaultDashboardsFile();
    expect(file.templates).toHaveLength(1);
    expect(file.templates[0]!.id).toBe('main');
    expect(file.templates[0]!.name).toBe('Trang chủ');
    expect(file.templates[0]!.rooms.map(room => room.roomId)).toEqual([
      'room-living',
      'room-bedroom',
      'room-kitchen',
    ]);
    expect(file.templates[0]!.rooms.map(room => room.order)).toEqual([0, 1, 2]);
  });

  it('every referenced room owns exactly the 2-sensor + 3-switch demo layout', () => {
    for (const reference of seedTemplate().rooms) {
      expect(reference.widgets).toHaveLength(5);
      const sensors = reference.widgets.filter(
        widget => widget.type === 'sensor-value',
      );
      const switches = reference.widgets.filter(
        widget => widget.type === 'switch',
      );
      expect(sensors).toHaveLength(2);
      expect(switches).toHaveLength(3);
    }
  });

  it('keeps the Phòng khách seed arrangement + appends w-pump (regression pin)', () => {
    const living = roomRef('room-living');
    const byId = new Map(living.widgets.map(widget => [widget.id, widget]));
    expect(living.widgets.map(widget => widget.id)).toEqual([
      'w-temp',
      'w-hum',
      'w-light',
      'w-fan',
      'w-pump',
    ]);
    // The four original cards keep their EXACT seed positions/bindings.
    expect(byId.get('w-temp')!.layout).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(byId.get('w-temp')!.binding).toEqual({
      deviceId: 'sensor-temp-01',
      capability: 'temperature',
    });
    expect(byId.get('w-hum')!.layout).toEqual({
      x: 1,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(byId.get('w-hum')!.binding).toEqual({
      deviceId: 'sensor-hum-01',
      capability: 'humidity',
    });
    expect(byId.get('w-light')!.layout).toEqual({
      x: 0,
      y: 1,
      width: 1,
      height: 1,
    });
    expect(byId.get('w-light')!.binding).toEqual({
      deviceId: 'relay-1',
      capability: 'switch',
    });
    expect(byId.get('w-fan')!.layout).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
    expect(byId.get('w-fan')!.binding).toEqual({
      deviceId: 'relay-2',
      capability: 'switch',
    });
    // The pump card: the third devices-band slot, bound to relay-3.
    expect(byId.get('w-pump')!.layout).toEqual({
      x: 0,
      y: 2,
      width: 1,
      height: 1,
    });
    expect(byId.get('w-pump')!.binding).toEqual({
      deviceId: 'relay-3',
      capability: 'switch',
    });
  });

  it('seeds the Phòng ngủ and Bếp layouts with stable ids and per-room bindings', () => {
    const expected = [
      {
        roomId: 'room-bedroom',
        prefix: 'w-bed',
        temp: 'sensor-temp-02',
        hum: 'sensor-hum-02',
        relays: ['relay-4', 'relay-5', 'relay-6'],
      },
      {
        roomId: 'room-kitchen',
        prefix: 'w-kitchen',
        temp: 'sensor-temp-03',
        hum: 'sensor-hum-03',
        relays: ['relay-7', 'relay-8', 'relay-9'],
      },
    ] as const;
    for (const expectation of expected) {
      const reference = roomRef(expectation.roomId);
      const byId = new Map(
        reference.widgets.map(widget => [widget.id, widget]),
      );
      expect(reference.widgets.map(widget => widget.id)).toEqual([
        `${expectation.prefix}-temp`,
        `${expectation.prefix}-hum`,
        `${expectation.prefix}-light`,
        `${expectation.prefix}-fan`,
        `${expectation.prefix}-pump`,
      ]);
      expect(byId.get(`${expectation.prefix}-temp`)!.layout).toEqual({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      });
      expect(byId.get(`${expectation.prefix}-temp`)!.binding).toEqual({
        deviceId: expectation.temp,
        capability: 'temperature',
      });
      expect(byId.get(`${expectation.prefix}-hum`)!.layout).toEqual({
        x: 1,
        y: 0,
        width: 1,
        height: 1,
      });
      expect(byId.get(`${expectation.prefix}-hum`)!.binding).toEqual({
        deviceId: expectation.hum,
        capability: 'humidity',
      });
      expect(byId.get(`${expectation.prefix}-light`)!.binding).toEqual({
        deviceId: expectation.relays[0],
        capability: 'switch',
      });
      expect(byId.get(`${expectation.prefix}-fan`)!.binding).toEqual({
        deviceId: expectation.relays[1],
        capability: 'switch',
      });
      expect(byId.get(`${expectation.prefix}-pump`)!.binding).toEqual({
        deviceId: expectation.relays[2],
        capability: 'switch',
      });
      // Same band shape as Phòng khách: env row 0, devices rows 1..2.
      expect(byId.get(`${expectation.prefix}-light`)!.layout).toEqual({
        x: 0,
        y: 1,
        width: 1,
        height: 1,
      });
      expect(byId.get(`${expectation.prefix}-fan`)!.layout).toEqual({
        x: 1,
        y: 1,
        width: 1,
        height: 1,
      });
      expect(byId.get(`${expectation.prefix}-pump`)!.layout).toEqual({
        x: 0,
        y: 2,
        width: 1,
        height: 1,
      });
    }
  });

  it('every room layout is collision-free and band-model conformant', () => {
    for (const reference of seedTemplate().rooms) {
      // Unique ids + in-bounds + no overlaps (room-scoped visibility).
      expect(validateLayout(reference.widgets).ok).toBe(true);
      // ADR-019 section bands per room: env starts at row 0, the devices
      // band starts EXACTLY at the env extent (contiguous, no gap).
      const env = reference.widgets.filter(
        widget => sectionKeyOf(widget.type) === 'environment',
      );
      const devices = reference.widgets.filter(
        widget => sectionKeyOf(widget.type) === 'devices',
      );
      expect(env.length).toBeGreaterThan(0);
      expect(devices.length).toBeGreaterThan(0);
      expect(env.every(widget => widget.layout.y === 0)).toBe(true);
      const envExtent = Math.max(
        ...env.map(widget => widget.layout.y + widget.layout.height),
      );
      expect(Math.min(...devices.map(widget => widget.layout.y))).toBe(
        envExtent,
      );
    }
  });

  it('binds every widget to a REAL seeded device with a compatible capability', () => {
    const deviceById = new Map(
      seedDevices().devices.map(device => [device.id, device]),
    );
    for (const reference of seedTemplate().rooms) {
      for (const widget of reference.widgets) {
        expect(widget.roomId).toBe(reference.roomId);
        const binding = widget.binding;
        expect(binding).toBeDefined();
        const device = deviceById.get(binding!.deviceId);
        expect(device).toBeDefined();
        // The binding authority: the device lives in the SAME room and
        // registers the bound capability.
        expect(device!.roomId).toBe(reference.roomId);
        expect(device!.capabilities).toContain(binding!.capability);
      }
    }
  });

  it('keeps widget ids unique across the whole Template', () => {
    const ids = seedTemplate().rooms.flatMap(room =>
      room.widgets.map(widget => widget.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
