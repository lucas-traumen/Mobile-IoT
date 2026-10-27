/**
 * Dashboard schema tests — Template file validation + legacy migration.
 *
 * Covers: current-file parsing (structure, uniqueness invariants, widget
 * roomId mirror), legacy-file parsing and the deterministic structural
 * migration (grouping by concrete room, first-seen order, global fold,
 * unknown-field preservation, updatedAt stamp = 0), and the discriminating
 * `parseDashboardsFile` entry point.
 */

import {
  MIGRATION_GLOBAL_ROOM_ID,
  migrateLegacyDashboardsFile,
  type LegacyDashboardsFile,
  parseCurrentDashboardsFile,
  parseDashboardsFile,
  parseLegacyDashboardsFile,
} from './dashboardSchema';

// widgetTypes imports CapabilitySchema from @modules/devices/api, which pulls
// AsyncStorage transitively — pin the native module as the devices tests do.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

type LegacyWidget =
  LegacyDashboardsFile['dashboards'][number]['widgets'][number];

const widget = (
  id: string,
  overrides: Record<string, unknown> = {},
): LegacyWidget => ({
  id,
  type: 'sensor-value',
  roomId: 'room-a',
  binding: { deviceId: 'sensor-01', capability: 'temperature' },
  layout: { x: 0, y: 0, width: 1, height: 1 },
  ...overrides,
});

const currentFile = {
  templates: [
    {
      id: 'tpl-1',
      name: 'Nhà tầng 1',
      updatedAt: 100,
      rooms: [
        {
          roomId: 'room-a',
          order: 0,
          widgets: [widget('w-1')],
        },
        {
          roomId: 'room-b',
          order: 1,
          widgets: [],
        },
      ],
    },
  ],
  activeId: 'tpl-1',
  activeRoomId: null,
};

describe('parseCurrentDashboardsFile', () => {
  it('accepts a valid Template file', () => {
    const result = parseCurrentDashboardsFile(currentFile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.templates).toHaveLength(1);
      expect(result.value.templates[0]!.rooms.map(r => r.roomId)).toEqual([
        'room-a',
        'room-b',
      ]);
    }
  });

  it('defaults activeRoomId to null when absent', () => {
    const result = parseCurrentDashboardsFile({
      ...currentFile,
      activeRoomId: undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.activeRoomId).toBeNull();
    }
  });

  it('rejects duplicate template ids', () => {
    const result = parseCurrentDashboardsFile({
      ...currentFile,
      templates: [
        ...currentFile.templates,
        { ...currentFile.templates[0]!, id: 'tpl-1', name: 'Khác' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('Duplicate template id');
    }
  });

  it('rejects an activeId that does not exist', () => {
    const result = parseCurrentDashboardsFile({
      ...currentFile,
      activeId: 'tpl-gone',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('does not exist');
    }
  });

  it('rejects a room referenced more than once in one Template', () => {
    const result = parseCurrentDashboardsFile({
      ...currentFile,
      templates: [
        {
          ...currentFile.templates[0]!,
          rooms: [
            {
              roomId: 'room-a',
              order: 0,
              widgets: [widget('w-1')],
            },
            {
              roomId: 'room-a',
              order: 1,
              widgets: [],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('more than once');
    }
  });

  it('rejects a widget whose roomId mirror mismatches its reference', () => {
    const result = parseCurrentDashboardsFile({
      ...currentFile,
      templates: [
        {
          ...currentFile.templates[0]!,
          rooms: [
            {
              roomId: 'room-a',
              order: 0,
              widgets: [widget('w-1', { roomId: 'room-b' })],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('does not match its room');
    }
  });

  it('rejects duplicate widget ids across rooms of one Template', () => {
    const result = parseCurrentDashboardsFile({
      ...currentFile,
      templates: [
        {
          ...currentFile.templates[0]!,
          rooms: [
            { roomId: 'room-a', order: 0, widgets: [widget('w-1')] },
            { roomId: 'room-b', order: 1, widgets: [widget('w-1')] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('duplicate widget id');
    }
  });

  it('rejects malformed widgets inside a room', () => {
    const result = parseCurrentDashboardsFile({
      ...currentFile,
      templates: [
        {
          ...currentFile.templates[0]!,
          rooms: [
            {
              roomId: 'room-a',
              order: 0,
              widgets: [
                widget('w-bad', {
                  layout: { x: 0, y: 0, width: 9, height: 1 },
                }),
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe('migrateLegacyDashboardsFile', () => {
  it('groups widgets by concrete room preserving first-seen order', () => {
    const legacy = {
      dashboards: [
        {
          id: 'dash-1',
          name: 'Trang chủ',
          widgets: [
            widget('w-1', { roomId: 'room-b' }),
            widget('w-2', { roomId: 'room-a' }),
            widget('w-3', { roomId: 'room-b' }),
          ],
        },
      ],
      activeId: 'dash-1',
      activeRoomId: null,
    };
    const file = migrateLegacyDashboardsFile(legacy);
    expect(file.templates[0]!.rooms.map(r => r.roomId)).toEqual([
      'room-b',
      'room-a',
    ]);
    expect(file.templates[0]!.rooms[0]!.widgets.map(w => w.id)).toEqual([
      'w-1',
      'w-3',
    ]);
    expect(file.templates[0]!.rooms.map(r => r.order)).toEqual([0, 1]);
  });

  it('folds roomless (global) widgets into the FIRST reference', () => {
    const legacy = {
      dashboards: [
        {
          id: 'dash-1',
          name: 'Trang chủ',
          widgets: [
            widget('w-1', { roomId: 'room-a' }),
            widget('w-global', { roomId: undefined }),
          ],
        },
      ],
      activeId: 'dash-1',
      activeRoomId: null,
    };
    const file = migrateLegacyDashboardsFile(legacy);
    expect(file.templates[0]!.rooms).toHaveLength(1);
    expect(file.templates[0]!.rooms[0]!.roomId).toBe('room-a');
    expect(file.templates[0]!.rooms[0]!.widgets.map(w => w.id)).toEqual([
      'w-1',
      'w-global',
    ]);
    // The folded widget adopts the host reference's roomId (mirror-field
    // invariant: widget.roomId === enclosing reference roomId).
    expect(file.templates[0]!.rooms[0]!.widgets[1]!.roomId).toBe('room-a');
  });

  it('keeps a dashboard with ONLY roomless widgets under the sentinel room', () => {
    const legacy = {
      dashboards: [
        {
          id: 'dash-1',
          name: 'Trang chủ',
          widgets: [widget('w-1', { roomId: undefined })],
        },
      ],
      activeId: 'dash-1',
      activeRoomId: null,
    };
    const file = migrateLegacyDashboardsFile(legacy);
    expect(file.templates[0]!.rooms[0]!.roomId).toBe(MIGRATION_GLOBAL_ROOM_ID);
    expect(file.templates[0]!.rooms[0]!.widgets.map(w => w.id)).toEqual([
      'w-1',
    ]);
  });

  it('preserves ids, bindings, titles, layouts and UNKNOWN custom fields', () => {
    const legacy = {
      dashboards: [
        {
          id: 'dash-1',
          name: 'Trang chủ',
          widgets: [
            widget('w-custom', {
              type: 'vendor-camera-panel',
              config: { stream: 'rtsp://cam/main' },
              vendorVersion: '2.1.0',
            }),
            widget('w-titled', { title: 'Tùy chỉnh' }),
          ],
        },
      ],
      activeId: 'dash-1',
      activeRoomId: 'room-a',
    };
    const file = migrateLegacyDashboardsFile(legacy);
    const widgets = file.templates[0]!.rooms[0]!.widgets;
    expect(widgets[0]!.type).toBe('vendor-camera-panel');
    expect(widgets[0]!.config).toEqual({ stream: 'rtsp://cam/main' });
    expect(widgets[0]!.vendorVersion).toBe('2.1.0');
    expect(widgets[1]!.title).toBe('Tùy chỉnh');
    // The History compatibility seam survives untouched.
    expect(file.activeRoomId).toBe('room-a');
  });

  it('stamps updatedAt = 0 (the service sets the real Clock time)', () => {
    const legacy = {
      dashboards: [{ id: 'd', name: 'N', widgets: [] }],
      activeId: 'd',
      activeRoomId: null,
    };
    expect(migrateLegacyDashboardsFile(legacy).templates[0]!.updatedAt).toBe(0);
  });

  it('is deterministic (same input → equal output)', () => {
    const legacy = {
      dashboards: [
        {
          id: 'dash-1',
          name: 'Trang chủ',
          widgets: [widget('w-1'), widget('w-2', { roomId: 'room-b' })],
        },
      ],
      activeId: 'dash-1',
      activeRoomId: null,
    };
    expect(migrateLegacyDashboardsFile(legacy)).toEqual(
      migrateLegacyDashboardsFile(legacy),
    );
  });
});

describe('parseLegacyDashboardsFile', () => {
  it('accepts the predecessor shape and rejects malformed ones', () => {
    expect(
      parseLegacyDashboardsFile({
        dashboards: [{ id: 'd', name: 'N', widgets: [] }],
        activeId: 'd',
      }).ok,
    ).toBe(true);
    expect(
      parseLegacyDashboardsFile({
        dashboards: [{ id: 'd', name: 'N', widgets: [] }],
        activeId: 'other',
      }).ok,
    ).toBe(false);
  });
});

describe('parseDashboardsFile (discriminating entry)', () => {
  it('parses a current file without migrating', () => {
    const result = parseDashboardsFile(currentFile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(false);
    }
  });

  it('parses a legacy file and migrates it structurally', () => {
    const result = parseDashboardsFile({
      dashboards: [
        {
          id: 'dash-1',
          name: 'Trang chủ',
          widgets: [widget('w-1', { roomId: 'room-x' })],
        },
      ],
      activeId: 'dash-1',
      activeRoomId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(true);
      expect(result.value.templates[0]!.rooms[0]!.roomId).toBe('room-x');
    }
  });

  it('reports errors for garbage input without guessing a shape', () => {
    const result = parseDashboardsFile({ nope: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
    expect(parseDashboardsFile('not an object').ok).toBe(false);
    expect(parseDashboardsFile(null).ok).toBe(false);
  });
});
