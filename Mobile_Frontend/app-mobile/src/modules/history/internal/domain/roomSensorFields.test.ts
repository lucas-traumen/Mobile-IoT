/**
 * roomSensorFields tests (approved room-sensor contract).
 *
 * Verifies: the Flux field list for a room = the room's PROJECTED sensor
 * registrations (one visible sensor = one metric; a legacy multi-capability
 * board contributes each of its capabilities; relay devices excluded);
 * `null` = no valid active room (empty); unique + stable order; a room
 * without registrations → empty; and the `historyQueryForRoom` value object
 * (fields + roomId, null short-circuit).
 */

import type { CapabilityDef, Device } from '@modules/devices/api';
import type { WidgetConfig } from '@modules/widgets/api';

import { historyQueryForRoom, sensorFieldsForRoom } from './roomSensorFields';

// The devices facade transitively imports the devices repository
// (async-storage) — storage is not under test here.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const CAPABILITIES: readonly CapabilityDef[] = [
  { type: 'temperature', label: 'Nhiệt độ', kind: 'sensor', unit: '°C' },
  { type: 'humidity', label: 'Độ ẩm', kind: 'sensor', unit: '%' },
  { type: 'switch', label: 'Công tắc', kind: 'switch' },
  { type: 'pressure', label: 'Áp suất', kind: 'sensor', unit: 'hPa' },
];

const DEVICES: readonly Device[] = [
  {
    id: 'sensor-01',
    name: 'Cảm biến phòng khách',
    roomId: 'room-living',
    type: 'sensor',
    capabilities: ['temperature', 'humidity'], // legacy multi-metric board
    binding: { kind: 'telemetry-sensor' },
  },
  {
    id: 'relay-1',
    name: 'Đèn phòng khách',
    roomId: 'room-living',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 1 },
  },
  {
    id: 'sensor-02',
    name: 'Cảm biến bếp',
    roomId: 'room-kitchen',
    type: 'sensor',
    capabilities: ['temperature', 'pressure'],
    binding: { kind: 'telemetry-sensor' },
  },
  {
    id: 'sensor-free',
    name: 'Cảm biến chưa xếp phòng',
    type: 'sensor',
    capabilities: ['humidity'],
    binding: { kind: 'telemetry-sensor' },
  },
];

describe('sensorFieldsForRoom (projected registrations)', () => {
  it('returns the room sensor fields (relay devices excluded)', () => {
    expect(sensorFieldsForRoom(DEVICES, CAPABILITIES, 'room-living')).toEqual([
      'temperature',
      'humidity',
    ]);
  });

  it('includes custom catalog capabilities of the room', () => {
    expect(sensorFieldsForRoom(DEVICES, CAPABILITIES, 'room-kitchen')).toEqual([
      'temperature',
      'pressure',
    ]);
  });

  it('null = no valid active room → empty (no room-level Tất cả)', () => {
    expect(sensorFieldsForRoom(DEVICES, CAPABILITIES, null)).toEqual([]);
  });

  it('returns an empty list for a room without sensor devices', () => {
    const roomOnlyRelays: readonly Device[] = [
      {
        id: 'relay-9',
        name: 'Rơ le',
        roomId: 'room-empty',
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: 2 },
      },
    ];
    expect(
      sensorFieldsForRoom(roomOnlyRelays, CAPABILITIES, 'room-empty'),
    ).toEqual([]);
    expect(sensorFieldsForRoom([], CAPABILITIES, 'room-living')).toEqual([]);
  });

  it('ignores device capabilities absent from the sensor catalog', () => {
    const device: Device = {
      id: 'sensor-x',
      name: 'Kỳ lạ',
      roomId: 'room-living',
      type: 'sensor',
      capabilities: ['temperature', 'switch', 'mystery'],
      binding: { kind: 'telemetry-sensor' },
    };
    expect(sensorFieldsForRoom([device], CAPABILITIES, 'room-living')).toEqual([
      'temperature',
    ]);
  });

  it('the same field in another room does not leak into this room', () => {
    const devices: readonly Device[] = [
      {
        id: 's-a',
        name: 'Nhiệt độ A',
        roomId: 'room-a',
        type: 'sensor',
        capabilities: ['temperature'],
        binding: { kind: 'telemetry-sensor' },
      },
      {
        id: 's-b',
        name: 'Nhiệt độ B',
        roomId: 'room-b',
        type: 'sensor',
        capabilities: ['temperature'],
        binding: { kind: 'telemetry-sensor' },
      },
    ];
    expect(sensorFieldsForRoom(devices, CAPABILITIES, 'room-a')).toEqual([
      'temperature',
    ]);
    expect(sensorFieldsForRoom(devices, CAPABILITIES, 'room-b')).toEqual([
      'temperature',
    ]);
  });
});

describe('historyQueryForRoom (roomId + _field identity)', () => {
  it('builds the query object with the room fields + the roomId filter', () => {
    expect(
      historyQueryForRoom(DEVICES, CAPABILITIES, 'room-living', '24h'),
    ).toEqual({
      measurement: 'sensors',
      range: '24h',
      fields: ['temperature', 'humidity'],
      roomId: 'room-living',
    });
  });

  it('fields come from projected registrations (duplicates collapse)', () => {
    const twoSensors: readonly Device[] = [
      ...DEVICES,
      {
        id: 'sensor-01b',
        name: 'Nhiệt độ phụ phòng khách',
        roomId: 'room-living',
        type: 'sensor',
        capabilities: ['temperature'],
        binding: { kind: 'telemetry-sensor' },
      },
    ];
    const query = historyQueryForRoom(
      twoSensors,
      CAPABILITIES,
      'room-living',
      '1h',
    );
    // The field list stays unique per room (one temperature series), while
    // the projected registration count would be 3 (2×temp + humidity).
    expect(query?.fields).toEqual(['temperature', 'humidity']);
  });

  it('returns null for a room without registered sensors (no query issued)', () => {
    expect(
      historyQueryForRoom(
        [DEVICES[1]!, DEVICES[3]!],
        CAPABILITIES,
        'room-living',
        '1h',
      ),
    ).toBeNull();
  });

  it('returns null when there is no valid active room', () => {
    expect(historyQueryForRoom(DEVICES, CAPABILITIES, null, '7d')).toBeNull();
  });

  it('tags a bound room with its board CODE while scoping fields by the internal id (3e)', () => {
    const query = historyQueryForRoom(
      DEVICES,
      CAPABILITIES,
      'room-living',
      '24h',
      'board-1',
    );
    expect(query).toEqual({
      measurement: 'sensors',
      range: '24h',
      // Fields STILL come from the registrations matched by the INTERNAL
      // room id — only the tag filter identity changes.
      fields: ['temperature', 'humidity'],
      // The Influx `roomId` tag carries the board code (Influx M11 writes
      // roomId = deviceId ESP = code).
      roomId: 'board-1',
    });
  });

  it('defaults the tag identity to the room id (unbound rooms unchanged)', () => {
    const withTag = historyQueryForRoom(
      DEVICES,
      CAPABILITIES,
      'room-living',
      '1h',
      'room-living',
    );
    const withoutTag = historyQueryForRoom(
      DEVICES,
      CAPABILITIES,
      'room-living',
      '1h',
    );
    expect(withTag).toEqual(withoutTag);
    expect(withTag?.roomId).toBe('room-living');
  });

  it('carries the boardId tag + null roomId for a board-bound room (boards contract v2)', () => {
    const query = historyQueryForRoom(
      DEVICES,
      CAPABILITIES,
      'room-living',
      '24h',
      undefined,
      'board-1',
    );
    expect(query).toEqual({
      measurement: 'sensors',
      range: '24h',
      // Fields STILL come from the registrations matched by the INTERNAL
      // room id — only the tag identity changes.
      fields: ['temperature', 'humidity'],
      roomId: null,
      boardId: 'board-1',
    });
  });

  it('keeps the exact current behavior when no boardCode is passed', () => {
    const legacy = historyQueryForRoom(
      DEVICES,
      CAPABILITIES,
      'room-living',
      '24h',
      'board-1',
    );
    const extended = historyQueryForRoom(
      DEVICES,
      CAPABILITIES,
      'room-living',
      '24h',
      'board-1',
      undefined,
    );
    expect(extended).toEqual(legacy);
    expect(extended?.boardId).toBeUndefined();
  });
});

/** Saved-layout fixtures bind to the current device and capability together. */
function sensorWidget(
  deviceId: string,
  capability: string,
  overrides: Partial<WidgetConfig> = {},
): WidgetConfig {
  return {
    id: `${deviceId}-${capability}`,
    type: 'sensor-value',
    roomId: 'room-living',
    binding: { deviceId, capability },
    layout: { x: 0, y: 0, width: 1, height: 1 },
    ...overrides,
  };
}

describe('saved room layout selection', () => {
  it('uses saved sensor bindings, deduplicated in registration order', () => {
    const widgets = [
      sensorWidget('sensor-01', 'humidity'),
      sensorWidget('sensor-01', 'temperature'),
      sensorWidget('sensor-01', 'humidity', { id: 'humidity-copy' }),
    ];
    expect(
      sensorFieldsForRoom(DEVICES, CAPABILITIES, 'room-living', widgets),
    ).toEqual(['temperature', 'humidity']);
    expect(
      sensorFieldsForRoom(DEVICES, CAPABILITIES, 'room-living', [widgets[0]!]),
    ).toEqual(['humidity']);
  });

  it.each([[], null])(
    'explicit empty or missing saved scope %p never falls back',
    widgets => {
      expect(
        sensorFieldsForRoom(DEVICES, CAPABILITIES, 'room-living', widgets),
      ).toEqual([]);
      expect(
        historyQueryForRoom(
          DEVICES,
          CAPABILITIES,
          'room-living',
          '24h',
          undefined,
          'board-1',
          widgets,
        ),
      ).toBeNull();
    },
  );

  it('rejects stale, cross-room, wrong-capability, unbound and non-sensor widgets', () => {
    const widgets = [
      sensorWidget('deleted-device', 'temperature'),
      sensorWidget('sensor-02', 'temperature'), // same field, different room
      sensorWidget('sensor-free', 'humidity'),
      sensorWidget('sensor-01', 'pressure'), // device does not register it
      sensorWidget('relay-1', 'temperature'),
      sensorWidget('sensor-01', 'switch'),
      sensorWidget('sensor-01', 'mystery'),
      sensorWidget('sensor-01', 'humidity', { type: 'switch' }),
      sensorWidget('sensor-01', 'humidity', { type: 'custom-widget' }),
      sensorWidget('sensor-01', 'humidity', { binding: undefined }),
      sensorWidget('sensor-01', 'humidity', { roomId: 'room-kitchen' }),
      sensorWidget('sensor-01', 'humidity', { roomId: undefined }),
    ];
    expect(
      sensorFieldsForRoom(DEVICES, CAPABILITIES, 'room-living', widgets),
    ).toEqual([]);
    expect(sensorFieldsForRoom(DEVICES, CAPABILITIES, null, widgets)).toEqual(
      [],
    );
  });

  it('selects custom sensor fields and preserves both board and legacy tag identity', () => {
    const widgets = [
      sensorWidget('sensor-02', 'pressure', { roomId: 'room-kitchen' }),
    ];
    expect(
      sensorFieldsForRoom(DEVICES, CAPABILITIES, 'room-kitchen', widgets),
    ).toEqual(['pressure']);
    expect(
      historyQueryForRoom(
        DEVICES,
        CAPABILITIES,
        'room-kitchen',
        '1h',
        'legacy-code',
        undefined,
        widgets,
      ),
    ).toEqual({
      measurement: 'sensors',
      range: '1h',
      fields: ['pressure'],
      roomId: 'legacy-code',
    });
    expect(
      historyQueryForRoom(
        DEVICES,
        CAPABILITIES,
        'room-kitchen',
        '1h',
        undefined,
        'board-kitchen',
        widgets,
      ),
    ).toEqual({
      measurement: 'sensors',
      range: '1h',
      fields: ['pressure'],
      roomId: null,
      boardId: 'board-kitchen',
    });
  });
});
