/**
 * DashboardServiceImpl tests (Template model).
 *
 * Verifies: seed/stamp/migration loads (idempotent, never reseeding valid
 * data), Template CRUD + duplicate (fresh ids) + last-delete guard +
 * deterministic selection fallback, atomic commit rollback, room-reference
 * add/reorder/duplicate/remove, room-scoped widget operations (add/apply/
 * duplicate-to-room/move-to-room with room-compatible bindings and
 * uniqueness), retired/duplicate load migrations, custom unknown-field
 * round-trip, device cascades, and the History room-selection seam.
 */

import { InMemoryEventBus } from '@core/eventbus';
import { createLogger } from '@core/logger';
import { err, Errors, ok, type Result } from '@core/errors';
import { FakeClock } from '@core/time';

import type {
  DashboardsFile,
  LegacyDashboardsFile,
} from '../domain/dashboardSchema';
import { parseDashboardsFile } from '../domain/dashboardSchema';
import { defaultDashboardsFile } from '../domain/seeds';
import type { DashboardRepository } from '../data/dashboardRepository';
import { createDefaultRegistry } from '@modules/widgets/api';
import type { WidgetConfig } from '@modules/widgets/api';
import type { CapabilityDef, Room } from '@modules/devices/api';
import { DashboardServiceImpl } from './dashboardService';
import { findSectionSlot } from '../domain/sectionPlacement';
import { validateLayout } from '../domain/layout';

type LegacyWidget =
  LegacyDashboardsFile['dashboards'][number]['widgets'][number];

// widgetTypes pulls the devices barrel (→ AsyncStorage) transitively — pin
// the native module as the other dashboard tests do.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

// Section placement is the add-path's slot authority: keep the REAL
// implementation by default and let the AD7 fault-injection test stub one
// call with a corrupt result (a bad remap must fail loudly, never write).
jest.mock('../domain/sectionPlacement', () => ({
  ...jest.requireActual('../domain/sectionPlacement'),
  findSectionSlot: jest.fn(
    jest.requireActual('../domain/sectionPlacement').findSectionSlot,
  ),
}));

/** Deterministic in-memory repository with injectable save failures. */
class FakeRepository implements DashboardRepository {
  savedPayloads: string[] = [];
  remainingSaveFailures = 0;

  constructor(private stored: string | null = null) {}

  async load(): Promise<
    Result<import('../data/dashboardRepository').LoadedDashboardsFile>
  > {
    if (this.stored === null) {
      return ok({ kind: 'seed' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.stored);
    } catch {
      return ok({ kind: 'seed' });
    }
    const result = parseDashboardsFile(parsed);
    if (!result.ok) {
      return ok({ kind: 'seed' });
    }
    return ok({
      kind: 'file',
      file: result.value,
      migratedFromLegacy: result.migrated,
    });
  }

  async save(file: DashboardsFile): Promise<Result<void>> {
    if (this.remainingSaveFailures > 0) {
      this.remainingSaveFailures -= 1;
      return err(Errors.unknown('storage down'));
    }
    this.savedPayloads.push(JSON.stringify(file));
    this.stored = JSON.stringify(file);
    return ok(undefined);
  }
}

const CAPABILITIES: readonly CapabilityDef[] = [
  {
    type: 'temperature',
    label: 'Nhiệt độ',
    kind: 'sensor',
    unit: '°C',
    builtin: true,
  },
  {
    type: 'humidity',
    label: 'Độ ẩm',
    kind: 'sensor',
    unit: '%',
    builtin: true,
  },
  { type: 'switch', label: 'Công tắc', kind: 'switch', builtin: true },
];

const ROOMS: readonly Room[] = [
  { id: 'room-living', name: 'Phòng khách', order: 0 },
  { id: 'room-bedroom', name: 'Phòng ngủ', order: 1 },
  { id: 'room-kitchen', name: 'Bếp', order: 2 },
];

function makeService(options?: {
  stored?: string | null;
  roomExists?: (roomId: string) => boolean;
  getRooms?: () => readonly Room[];
  getDeviceRoom?: (deviceId: string) => string | undefined;
}) {
  const clock = new FakeClock();
  const repository = new FakeRepository(options?.stored ?? null);
  const bus = new InMemoryEventBus(createLogger('test'));
  const service = new DashboardServiceImpl({
    repository,
    registry: createDefaultRegistry(),
    bus,
    logger: createLogger('test'),
    clock,
    roomExists:
      options?.roomExists ?? (id => ROOMS.some(room => room.id === id)),
    getRooms: options?.getRooms ?? (() => ROOMS),
    getCapabilities: () => CAPABILITIES,
    getDeviceRoom:
      options?.getDeviceRoom ??
      (deviceId => {
        if (
          deviceId.startsWith('sensor-living') ||
          deviceId.startsWith('relay-living') ||
          // The seed bindings live in Phòng khách.
          [
            'sensor-temp-01',
            'sensor-hum-01',
            'relay-1',
            'relay-2',
            'relay-3',
          ].includes(deviceId)
        ) {
          return 'room-living';
        }
        if (
          deviceId.startsWith('sensor-bedroom') ||
          deviceId.startsWith('relay-bedroom') ||
          // The bedroom seed bindings (demo-three-rooms).
          [
            'sensor-temp-02',
            'sensor-hum-02',
            'relay-4',
            'relay-5',
            'relay-6',
          ].includes(deviceId)
        ) {
          return 'room-bedroom';
        }
        // The kitchen seed bindings (demo-three-rooms).
        if (
          [
            'sensor-temp-03',
            'sensor-hum-03',
            'relay-7',
            'relay-8',
            'relay-9',
          ].includes(deviceId)
        ) {
          return 'room-kitchen';
        }
        return undefined;
      }),
  });
  // Start the clock at a non-zero instant so `updatedAt` stamps are
  // distinguishable from the 0 sentinel.
  clock.advance(1000);
  return { bus, clock, repository, service };
}

/** A minimal valid widget factory for current-file fixtures. */
function widget(
  id: string,
  roomId?: string,
  overrides: Partial<WidgetConfig> = {},
): WidgetConfig {
  return {
    id,
    type: 'sensor-value',
    roomId,
    binding: { deviceId: `sensor-living-${id}`, capability: 'temperature' },
    layout: { x: 0, y: 0, width: 1, height: 1 },
    ...overrides,
  };
}

describe('load: seed, stamping, idempotence, storage', () => {
  it('seeds one Template on first run, stamps updatedAt and persists once', async () => {
    const { repository, service } = makeService();
    await service.load();
    expect(service.getTemplates()).toHaveLength(1);
    expect(service.getActiveTemplateId()).toBe('main');
    expect(service.getActiveTemplate().updatedAt).toBe(0 + 1000);
    // The seed template owns the THREE room references (demo-three-rooms),
    // each with the 2-sensor + 3-switch demo layout.
    const rooms = service.getActiveTemplate().rooms;
    expect(rooms).toHaveLength(3);
    expect(rooms.map(room => room.roomId)).toEqual([
      'room-living',
      'room-bedroom',
      'room-kitchen',
    ]);
    expect(rooms.map(room => room.order)).toEqual([0, 1, 2]);
    for (const reference of rooms) {
      expect(reference.widgets.map(w => w.type)).toEqual([
        'sensor-value',
        'sensor-value',
        'switch',
        'switch',
        'switch',
      ]);
    }
    // Phòng khách keeps its original seed ids + the w-pump addition.
    expect(rooms[0]!.widgets.map(w => w.id)).toEqual([
      'w-temp',
      'w-hum',
      'w-light',
      'w-fan',
      'w-pump',
    ]);
    expect(repository.savedPayloads).toHaveLength(1);
  });

  it('loads a valid current file WITHOUT writing (idempotent reload)', async () => {
    const file = defaultDashboardsFile();
    file.templates[0]!.updatedAt = 1234;
    const { repository, service } = makeService({
      stored: JSON.stringify(file),
    });
    await service.load();
    expect(service.getTemplates()[0]!.updatedAt).toBe(1234);
    expect(repository.savedPayloads).toHaveLength(0);

    // Second load: still no write (idempotent).
    await service.load();
    expect(repository.savedPayloads).toHaveLength(0);
  });

  it('stamps a zero updatedAt (seed/migration) exactly once', async () => {
    const file = defaultDashboardsFile(); // updatedAt: 0
    const { repository, service } = makeService({
      stored: JSON.stringify(file),
    });
    await service.load();
    expect(service.getActiveTemplate().updatedAt).toBe(1000);
    expect(repository.savedPayloads).toHaveLength(1);
    await service.load();
    expect(repository.savedPayloads).toHaveLength(1); // no re-write
  });

  it('maps a storage load failure to a Result error', async () => {
    const failing: DashboardRepository = {
      load: async () => err(Errors.unknown('disk error')),
      save: async () => ok(undefined),
    };
    const bus = new InMemoryEventBus(createLogger('test'));
    const broken = new DashboardServiceImpl({
      repository: failing,
      registry: createDefaultRegistry(),
      bus,
      logger: createLogger('test'),
      clock: new FakeClock(),
    });
    const result = await broken.load();
    expect(result.ok).toBe(false);
  });

  it('migrates a LEGACY file: registry-ordered references, stamped, persisted once', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-legacy',
          name: 'Cũ',
          widgets: [
            widget('w-k', 'room-kitchen', {
              binding: {
                deviceId: 'sensor-living-x',
                capability: 'temperature',
              },
            }),
            widget('w-l', 'room-living'),
          ],
        },
      ],
      activeId: 'dash-legacy',
      activeRoomId: 'room-living',
    };
    const { repository, service } = makeService({
      stored: JSON.stringify(legacy),
    });
    await service.load();
    const template = service.findTemplate('dash-legacy')!;
    expect(template).toBeDefined();
    expect(template.name).toBe('Cũ');
    // Ordered references follow the devices registry order.
    expect(template.rooms.map(r => r.roomId)).toEqual([
      'room-living',
      'room-kitchen',
    ]);
    expect(template.rooms.map(r => r.order)).toEqual([0, 1]);
    // Widgets preserved (ids/bindings/layouts) inside their rooms.
    expect(template.rooms[0]!.widgets.map(w => w.id)).toEqual(['w-l']);
    expect(template.rooms[1]!.widgets.map(w => w.id)).toEqual(['w-k']);
    expect(template.updatedAt).toBe(1000);
    // The History seam survives.
    expect(service.getActiveRoomId()).toBe('room-living');
    // Persisted exactly once (the migrated snapshot).
    expect(repository.savedPayloads).toHaveLength(1);
    // Idempotent: a reload of the migrated file writes nothing.
    await service.load();
    expect(repository.savedPayloads).toHaveLength(1);
  });

  it('folds legacy roomless widgets into the first reference (roomId mirror)', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-g',
          name: 'G',
          widgets: [
            widget('w-room', 'room-bedroom'),
            { ...widget('w-free'), roomId: undefined } as LegacyWidget,
          ],
        },
      ],
      activeId: 'dash-g',
      activeRoomId: null,
    };
    const { service } = makeService({ stored: JSON.stringify(legacy) });
    await service.load();
    const template = service.findTemplate('dash-g')!;
    expect(template.rooms.map(r => r.roomId)).toEqual(['room-bedroom']);
    const widgets = template.rooms[0]!.widgets;
    expect(widgets.map(w => w.id)).toEqual(['w-room', 'w-free']);
    expect(widgets[1]!.roomId).toBe('room-bedroom');
  });

  it('keeps unknown custom widget types/fields through load + save', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-c',
          name: 'C',
          widgets: [
            {
              id: 'w-vendor',
              type: 'vendor-camera-panel',
              roomId: 'room-living',
              layout: { x: 0, y: 0, width: 2, height: 2 },
              config: { stream: 'rtsp://cam/main' },
              vendorVersion: '2.1.0',
            } as unknown as WidgetConfig,
          ],
        },
      ],
      activeId: 'dash-c',
      activeRoomId: null,
    };
    const { repository, service } = makeService({
      stored: JSON.stringify(legacy),
    });
    await service.load();
    const kept = service.findTemplate('dash-c')!.rooms[0]!.widgets[0]!;
    expect(kept.type).toBe('vendor-camera-panel');
    expect((kept as Record<string, unknown>).config).toEqual({
      stream: 'rtsp://cam/main',
    });
    expect((kept as Record<string, unknown>).vendorVersion).toBe('2.1.0');
    // Persisted snapshot keeps the fields byte-for-byte.
    expect(repository.savedPayloads[0]).toContain('"vendorVersion":"2.1.0"');
    expect(repository.savedPayloads[0]).toContain('vendor-camera-panel');
  });

  it('removes retired built-in types from a CURRENT file (custom types pinned)', async () => {
    const file = defaultDashboardsFile();
    file.templates[0]!.rooms[0]!.widgets.push(
      widget('w-retired', 'room-living', {
        type: 'connection',
        binding: undefined,
      }),
      widget('w-vendor', 'room-living', {
        type: 'vendor-camera-panel',
        binding: undefined,
      }),
    );
    file.templates[0]!.updatedAt = 55;
    const { service } = makeService({ stored: JSON.stringify(file) });
    await service.load();
    const widgets = service.getActiveTemplate().rooms[0]!.widgets;
    expect(widgets.some(w => w.type === 'connection')).toBe(false);
    expect(widgets.some(w => w.type === 'vendor-camera-panel')).toBe(true);
  });

  it('removes the RETIRED room-device-list overview once, idempotently (custom types pinned)', async () => {
    const file = defaultDashboardsFile();
    file.templates[0]!.rooms[0]!.widgets.push(
      widget('w-list', 'room-living', {
        type: 'room-device-list',
        binding: undefined,
      }),
      widget('w-vendor', 'room-living', {
        type: 'vendor-camera-panel',
        binding: undefined,
      }),
    );
    file.templates[0]!.updatedAt = 55;
    const { repository, service } = makeService({
      stored: JSON.stringify(file),
    });
    await service.load();
    const widgets = service.getActiveTemplate().rooms[0]!.widgets;
    expect(widgets.some(w => w.type === 'room-device-list')).toBe(false);
    // The unknown custom type is NEVER erased by the retired cleanup.
    expect(widgets.some(w => w.type === 'vendor-camera-panel')).toBe(true);
    // The approved seed widgets are untouched.
    expect(widgets.some(w => w.id === 'w-temp')).toBe(true);
    // Removed exactly once: the cleanup persisted through the load
    // write-through…
    expect(repository.savedPayloads).toHaveLength(1);
    // …and a second load is a no-op (idempotent, nothing new to write).
    await service.load();
    expect(repository.savedPayloads).toHaveLength(1);
    expect(
      service
        .getActiveTemplate()
        .rooms[0]!.widgets.some(w => w.type === 'room-device-list'),
    ).toBe(false);
  });

  it('deduplicates exact approved placements per room (first wins)', async () => {
    const file = defaultDashboardsFile();
    file.templates[0]!.rooms[0]!.widgets.push(
      widget('w-dup', 'room-living', {
        binding: { deviceId: 'sensor-temp-01', capability: 'temperature' },
        layout: { x: 0, y: 9, width: 1, height: 1 },
      }),
    );
    file.templates[0]!.updatedAt = 55;
    const { service } = makeService({ stored: JSON.stringify(file) });
    await service.load();
    const widgets = service.getActiveTemplate().rooms[0]!.widgets;
    const temps = widgets.filter(
      w =>
        w.type === 'sensor-value' &&
        w.binding?.deviceId === 'sensor-temp-01' &&
        w.binding?.capability === 'temperature',
    );
    expect(temps).toHaveLength(1);
    expect(temps[0]!.id).toBe('w-temp'); // first occurrence wins
  });

  it('keeps an unknown-room reference (never drops placements)', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-u',
          name: 'U',
          widgets: [widget('w-x', 'room-ghost')],
        },
      ],
      activeId: 'dash-u',
      activeRoomId: null,
    };
    const { service } = makeService({ stored: JSON.stringify(legacy) });
    await service.load();
    const rooms = service.findTemplate('dash-u')!.rooms;
    expect(rooms.map(r => r.roomId)).toEqual(['room-ghost']);
    expect(rooms[0]!.widgets.map(w => w.id)).toEqual(['w-x']);
  });
});

describe('Template CRUD', () => {
  let context: ReturnType<typeof makeService>;
  let service: DashboardServiceImpl;
  let repository: FakeRepository;

  beforeEach(async () => {
    context = makeService();
    service = context.service;
    repository = context.repository;
    await service.load();
  });

  it('createTemplate validates the name, becomes active and persists', async () => {
    const empty = await service.createTemplate('   ');
    expect(empty.ok).toBe(false);

    const created = await service.createTemplate('Tầng 2');
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.id).toBe('tpl-1');
      expect(created.value.name).toBe('Tầng 2');
      expect(created.value.rooms).toEqual([]);
      expect(created.value.updatedAt).toBe(1000);
    }
    expect(service.getActiveTemplateId()).toBe('tpl-1');
    expect(repository.savedPayloads).toHaveLength(2); // seed + create
  });

  it('renameTemplate changes the name and bumps updatedAt (others untouched)', async () => {
    await service.createTemplate('A');
    context.clock.advance(500);
    const before = service.findTemplate('main')!;
    const result = await service.renameTemplate('main', 'Nhà chính');
    expect(result.ok).toBe(true);
    const renamed = service.findTemplate('main')!;
    expect(renamed.name).toBe('Nhà chính');
    expect(renamed.updatedAt).toBe(before.updatedAt + 500);
    expect(service.findTemplate('tpl-1')!.updatedAt).toBe(1000);
  });

  it('renameTemplate rejects empty names and unknown ids', async () => {
    expect((await service.renameTemplate('main', ' ')).ok).toBe(false);
    expect((await service.renameTemplate('ghost', 'X')).ok).toBe(false);
  });

  it('duplicateTemplate deep-copies layouts with FRESH ids and shared rooms', async () => {
    context.clock.advance(100);
    const copy = await service.duplicateTemplate('main');
    expect(copy.ok).toBe(true);
    if (!copy.ok) {
      return;
    }
    expect(copy.value.id).toBe('tpl-1');
    expect(copy.value.name).toBe('Trang chủ (bản sao)');
    const source = service.findTemplate('main')!;
    expect(copy.value.rooms.map(r => r.roomId)).toEqual(
      source.rooms.map(r => r.roomId),
    );
    const sourceWidgets = source.rooms[0]!.widgets;
    const copyWidgets = copy.value.rooms[0]!.widgets;
    expect(copyWidgets.map(w => w.id)).not.toEqual(
      sourceWidgets.map(w => w.id),
    );
    expect(copyWidgets.map(w => [w.type, w.binding, { ...w.layout }])).toEqual(
      sourceWidgets.map(w => [w.type, w.binding, { ...w.layout }]),
    );
    // Physical room references are shared (model 1A), widget ids are not.
    expect(copyWidgets.every(w => w.roomId === 'room-living')).toBe(true);
    // Selection unchanged; copy gets its own timestamp (clock +100).
    expect(service.getActiveTemplateId()).toBe('main');
    expect(copy.value.updatedAt).toBe(1100);
  });

  it('later edits to a duplicate never mutate the source Template', async () => {
    const copy = await service.duplicateTemplate('main');
    if (!copy.ok) {
      return;
    }
    await service.renameTemplate(copy.value.id, 'Bản sao riêng');
    await service.removeRoomReference(copy.value.id, 'room-living');
    const source = service.findTemplate('main')!;
    expect(source.name).toBe('Trang chủ');
    // The seed's three references survive the copy's private removal.
    expect(source.rooms).toHaveLength(3);
    expect(service.findTemplate(copy.value.id)!.rooms).toHaveLength(2);
  });

  it('deleteTemplate protects the last Template and falls back deterministically', async () => {
    const only = await service.deleteTemplate('main');
    expect(only.ok).toBe(false);

    await service.createTemplate('A'); // tpl-1, becomes active
    await service.createTemplate('B'); // tpl-2, becomes active
    // Delete the ACTIVE template → fallback to the first remaining.
    const result = await service.deleteTemplate('tpl-2');
    expect(result.ok).toBe(true);
    expect(service.getActiveTemplateId()).toBe('main');

    // Delete a NON-active template → active selection unchanged (tpl-3 was
    // created last and became active).
    await service.createTemplate('C'); // tpl-3 (active)
    await service.deleteTemplate('main');
    expect(service.getActiveTemplateId()).toBe('tpl-3');
    expect((await service.deleteTemplate('ghost')).ok).toBe(false);
  });

  it('commit failures are atomic: the file and selection stay unchanged', async () => {
    repository.remainingSaveFailures = 1;
    const before = service.getTemplates();
    const result = await service.createTemplate('Sập');
    expect(result.ok).toBe(false);
    expect(service.getTemplates()).toEqual(before);
    expect(service.getActiveTemplateId()).toBe('main');
    // A retry after storage recovers succeeds.
    const retried = await service.createTemplate('Sập');
    expect(retried.ok).toBe(true);
  });

  it('setActiveTemplate switches selection without touching updatedAt', async () => {
    await service.createTemplate('A');
    context.clock.advance(100);
    const before = service.findTemplate('main')!.updatedAt;
    await service.setActiveTemplate('main');
    expect(service.getActiveTemplateId()).toBe('main');
    expect(service.findTemplate('main')!.updatedAt).toBe(before);
    expect((await service.setActiveTemplate('ghost')).ok).toBe(false);
  });
});

describe('room references', () => {
  let context: ReturnType<typeof makeService>;
  let service: DashboardServiceImpl;

  beforeEach(async () => {
    context = makeService();
    service = context.service;
    await service.load();
  });

  it('addRoomReference appends an empty layout; duplicates and unknown rooms rejected', async () => {
    // The seed already references every room — drop Bếp and re-add it to
    // exercise the append path (appends at the END, order = length).
    await service.removeRoomReference('main', 'room-kitchen');
    const okResult = await service.addRoomReference('main', 'room-kitchen');
    expect(okResult.ok).toBe(true);
    const template = service.findTemplate('main')!;
    expect(template.rooms.map(r => r.roomId)).toEqual([
      'room-living',
      'room-bedroom',
      'room-kitchen',
    ]);
    expect(template.rooms[2]!.widgets).toEqual([]);
    expect(template.rooms[2]!.order).toBe(2);

    expect((await service.addRoomReference('main', 'room-kitchen')).ok).toBe(
      false,
    );
    expect((await service.addRoomReference('main', 'room-ghost')).ok).toBe(
      false,
    );
    expect((await service.addRoomReference('ghost', 'room-kitchen')).ok).toBe(
      false,
    );
  });

  it('removeRoomReference removes only that reference/layout', async () => {
    await service.createTemplate('T2'); // tpl-1
    await service.addRoomReference('tpl-1', 'room-living');
    const result = await service.removeRoomReference('main', 'room-living');
    expect(result.ok).toBe(true);
    // The OTHER references (bedroom/kitchen) survive in the same Template.
    expect(service.findTemplate('main')!.rooms.map(r => r.roomId)).toEqual([
      'room-bedroom',
      'room-kitchen',
    ]);
    // The other Template keeps its reference (physical room untouched).
    expect(service.findTemplate('tpl-1')!.rooms[0]!.roomId).toBe('room-living');
    expect((await service.removeRoomReference('main', 'room-living')).ok).toBe(
      false,
    );
  });

  it('removeRoomReference drops the removed room layout with the reference', async () => {
    const template = service.findTemplate('main')!;
    expect(template.rooms[0]!.widgets).toHaveLength(5);
    await service.removeRoomReference('main', 'room-living');
    expect(service.findTemplate('main')!.rooms).toHaveLength(2);
    // The other references (bedroom/kitchen) keep their layouts.
    for (const reference of service.findTemplate('main')!.rooms) {
      expect(reference.widgets).toHaveLength(5);
    }
  });

  it('reorderRoomReferences accepts a permutation and rejects anything else', async () => {
    // The seed already references all three rooms (orders 0/1/2).
    const template = () => service.findTemplate('main')!;

    const noOp = await service.reorderRoomReferences('main', [
      'room-living',
      'room-bedroom',
      'room-kitchen',
    ]);
    expect(noOp.ok).toBe(true);

    const reorder = await service.reorderRoomReferences('main', [
      'room-kitchen',
      'room-living',
      'room-bedroom',
    ]);
    expect(reorder.ok).toBe(true);
    expect(template().rooms.map(r => r.roomId)).toEqual([
      'room-kitchen',
      'room-living',
      'room-bedroom',
    ]);
    expect(template().rooms.map(r => r.order)).toEqual([0, 1, 2]);

    // Not a permutation: missing room.
    expect(
      (
        await service.reorderRoomReferences('main', [
          'room-kitchen',
          'room-living',
        ])
      ).ok,
    ).toBe(false);
    // Duplicated id.
    expect(
      (
        await service.reorderRoomReferences('main', [
          'room-kitchen',
          'room-kitchen',
          'room-living',
        ])
      ).ok,
    ).toBe(false);
    // Unknown room.
    expect(
      (
        await service.reorderRoomReferences('main', [
          'room-ghost',
          'room-living',
          'room-bedroom',
        ])
      ).ok,
    ).toBe(false);
    // The rejected reorder mutated nothing.
    expect(template().rooms.map(r => r.roomId)).toEqual([
      'room-kitchen',
      'room-living',
      'room-bedroom',
    ]);
  });

  it('duplicateRoomReference copies the layout with fresh widget ids', async () => {
    await service.createTemplate('T2'); // tpl-1
    const result = await service.duplicateRoomReference(
      'main',
      'room-living',
      'tpl-1',
    );
    expect(result.ok).toBe(true);
    const source = service.findTemplate('main')!.rooms[0]!;
    const copy = service.findTemplate('tpl-1')!.rooms[0]!;
    expect(copy.roomId).toBe('room-living');
    expect(copy.widgets.map(w => w.id)).not.toEqual(
      source.widgets.map(w => w.id),
    );
    expect(copy.widgets.map(w => w.type)).toEqual(
      source.widgets.map(w => w.type),
    );
    // Source untouched.
    expect(
      service.findTemplate('main')!.rooms[0]!.widgets.map(w => w.id),
    ).toEqual(source.widgets.map(w => w.id));
  });

  it('duplicateRoomReference rejects same-template and existing memberships', async () => {
    expect(
      (await service.duplicateRoomReference('main', 'room-living', 'main')).ok,
    ).toBe(false);
    await service.createTemplate('T2');
    await service.addRoomReference('tpl-1', 'room-living');
    expect(
      (await service.duplicateRoomReference('main', 'room-living', 'tpl-1')).ok,
    ).toBe(false);
    // The rejected duplicate mutated nothing.
    expect(service.findTemplate('tpl-1')!.rooms[0]!.widgets).toHaveLength(0);
  });
});

describe('widget operations', () => {
  let context: ReturnType<typeof makeService>;
  let service: DashboardServiceImpl;
  let store: ReturnType<DashboardServiceImpl['getStore']>;

  beforeEach(async () => {
    context = makeService();
    service = context.service;
    store = service.getStore();
    await service.load();
  });

  it('addWidget places in a free slot at the first supported size', async () => {
    const result = await service.addWidget('main', 'room-living', {
      type: 'sensor-value',
      binding: { deviceId: 'sensor-living-9', capability: 'temperature' },
      roomId: 'room-living',
    });
    expect(result.ok).toBe(true);
    const room = service.findTemplate('main')!.rooms[0]!;
    const added = room.widgets.find(
      w => w.binding?.deviceId === 'sensor-living-9',
    )!;
    // Section-scoped placement: the new sensor lands DIRECTLY under the
    // env row (Nhiệt độ/Độ ẩm) — not below the devices section's rows.
    expect(added.layout).toMatchObject({ x: 0, y: 1, width: 1, height: 1 });
    // The devices band shifted one absolute row down (visual-neutral).
    expect(room.widgets.find(w => w.id === 'w-light')!.layout).toMatchObject({
      x: 0,
      y: 2,
    });
    expect(room.widgets.find(w => w.id === 'w-fan')!.layout).toMatchObject({
      x: 1,
      y: 2,
    });
    expect(room.widgets.find(w => w.id === 'w-pump')!.layout).toMatchObject({
      x: 0,
      y: 3,
    });
    expect(room.widgets.find(w => w.id === 'w-temp')!.layout).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(room.widgets.find(w => w.id === 'w-hum')!.layout).toMatchObject({
      x: 1,
      y: 0,
    });
  });

  it('addWidget rejects unknown types, unsupported sizes, cross-room bindings and duplicates', async () => {
    expect(
      (
        await service.addWidget('main', 'room-living', {
          type: 'nope',
          roomId: 'room-living',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await service.addWidget('main', 'room-living', {
          type: 'switch',
          size: '2x2',
        })
      ).ok,
    ).toBe(false);
    // Binding source belongs to another room → rejected by the
    // room-authoritative check.
    expect(
      (
        await service.addWidget('main', 'room-living', {
          type: 'sensor-value',
          binding: {
            deviceId: 'sensor-bedroom-1',
            capability: 'temperature',
          },
          roomId: 'room-living',
        })
      ).ok,
    ).toBe(false);
    // Exact duplicate of the seed temperature card.
    expect(
      (
        await service.addWidget('main', 'room-living', {
          type: 'sensor-value',
          binding: {
            deviceId: 'sensor-temp-01',
            capability: 'temperature',
          },
          roomId: 'room-living',
        })
      ).ok,
    ).toBe(false);
    // Unknown room/template.
    expect(
      (await service.addWidget('main', 'room-ghost', { type: 'switch' })).ok,
    ).toBe(false);
    expect(
      (await service.addWidget('ghost', 'room-living', { type: 'switch' })).ok,
    ).toBe(false);
  });

  it('addWidget in draft mode appends to the draft and does not persist', async () => {
    store.getState().enterEdit('main', 'room-living');
    const result = await service.addWidget('main', 'room-living', {
      type: 'sensor-value',
      binding: { deviceId: 'sensor-living-9', capability: 'temperature' },
      roomId: 'room-living',
    });
    expect(result.ok).toBe(true);
    const draft = store.getState().draftWidgets!;
    expect(draft.some(w => w.binding?.deviceId === 'sensor-living-9')).toBe(
      true,
    );
    // Persisted layout unchanged (no commit for the draft add).
    expect(
      service
        .findTemplate('main')!
        .rooms[0]!.widgets.some(w => w.binding?.deviceId === 'sensor-living-9'),
    ).toBe(false);
  });

  it('applyLayout replaces one room atomically and stamps updatedAt', async () => {
    const template = service.findTemplate('main')!;
    const widgets = template.rooms[0]!.widgets;
    const edited = widgets.map(w =>
      w.id === 'w-temp' ? { ...w, title: 'Nhiệt độ PK' } : w,
    );
    context.clock.advance(250);
    const result = await service.applyLayout('main', 'room-living', edited);
    expect(result.ok).toBe(true);
    const after = service.findTemplate('main')!;
    expect(after.rooms[0]!.widgets.find(w => w.id === 'w-temp')!.title).toBe(
      'Nhiệt độ PK',
    );
    expect(after.updatedAt).toBe(template.updatedAt + 250);
    // Unknown custom fields survive Save.
    const withCustom = [
      ...edited,
      {
        ...widget('w-custom', 'room-living', {
          layout: { x: 0, y: 5, width: 2, height: 2 },
        }),
        type: 'vendor-camera-panel',
        binding: undefined,
        config: { a: 1 },
        vendorVersion: 3,
      } as unknown as WidgetConfig,
    ];
    // Unknown/custom types are preserved verbatim through applyLayout.
    const customResult = await service.applyLayout(
      'main',
      'room-living',
      withCustom,
    );
    expect(customResult.ok).toBe(true);
    const saved = service
      .findTemplate('main')!
      .rooms[0]!.widgets.find(w => w.id === 'w-custom')!;
    expect(saved.type).toBe('vendor-camera-panel');
    expect((saved as Record<string, unknown>).config).toEqual({ a: 1 });
    expect((saved as Record<string, unknown>).vendorVersion).toBe(3);
  });

  it('applyLayout rejects invalid layouts and mutates nothing', async () => {
    const template = service.findTemplate('main')!;
    const widgets = template.rooms[0]!.widgets;

    // Cross-room binding.
    const crossRoom = widgets.map(w =>
      w.id === 'w-temp'
        ? {
            ...w,
            binding: {
              deviceId: 'sensor-bedroom-1',
              capability: 'temperature',
            },
          }
        : w,
    );
    expect(
      (await service.applyLayout('main', 'room-living', crossRoom)).ok,
    ).toBe(false);

    // Duplicate placement.
    const dup = [
      ...widgets,
      widget('w-dup', 'room-living', {
        binding: { deviceId: 'sensor-temp-01', capability: 'temperature' },
        layout: { x: 1, y: 5, width: 1, height: 1 },
      }),
    ];
    expect((await service.applyLayout('main', 'room-living', dup)).ok).toBe(
      false,
    );

    // Overlap.
    const overlap = widgets.map(
      (w): WidgetConfig =>
        w.id === 'w-hum'
          ? { ...w, layout: { x: 0, y: 0, width: 1, height: 1 } }
          : w,
    );
    expect((await service.applyLayout('main', 'room-living', overlap)).ok).toBe(
      false,
    );

    // Wrong-room widget in the list.
    const wrongRoom = [...widgets, widget('w-other', 'room-bedroom')];
    expect(
      (await service.applyLayout('main', 'room-living', wrongRoom)).ok,
    ).toBe(false);

    // Nothing changed.
    expect(service.findTemplate('main')!.rooms[0]!.widgets).toEqual(widgets);
    expect(service.findTemplate('main')!.updatedAt).toBe(template.updatedAt);
  });

  it('duplicateWidgetToRoom copies with a fresh id and a compatible binding', async () => {
    // The seed already references room-bedroom (demo-three-rooms).
    // A bedroom-bound sensor card cannot be copied into the living room's
    // layout... and a living-room-bound card CAN be copied into the bedroom
    // reference only when its binding matches that room. Build a
    // bedroom-compatible card first via the bedroom reference.
    const bedroomTemplate = service.findTemplate('main')!;
    const bedroomRef = bedroomTemplate.rooms.find(
      r => r.roomId === 'room-bedroom',
    )!;
    expect(bedroomRef).toBeDefined();

    // Seed a compatible source in the bedroom reference via applyLayout.
    const source = widget('w-bed-src', 'room-bedroom', {
      binding: { deviceId: 'sensor-bedroom-1', capability: 'temperature' },
      layout: { x: 0, y: 0, width: 1, height: 1 },
    });
    await service.applyLayout('main', 'room-bedroom', [source]);

    // Copy the living-room temperature card into the bedroom: its binding
    // device belongs to the living room → rejected.
    const living = service.findTemplate('main')!.rooms[0]!;
    const livingTemp = living.widgets.find(w => w.id === 'w-temp')!;
    expect(
      (
        await service.duplicateWidgetToRoom(
          'main',
          'room-living',
          livingTemp.id,
          'room-bedroom',
        )
      ).ok,
    ).toBe(false);

    // Copy the bedroom card into the living room: binding belongs to the
    // bedroom → rejected.
    expect(
      (
        await service.duplicateWidgetToRoom(
          'main',
          'room-bedroom',
          'w-bed-src',
          'room-living',
        )
      ).ok,
    ).toBe(false);

    // An UNBOUND widget (no binding — here an unknown custom type) is
    // compatible with every room: duplicate the bedroom card into the
    // living room with a fresh id.
    const unboundCard: WidgetConfig = {
      ...widget('w-bed-list', 'room-bedroom'),
      type: 'vendor-camera-panel',
      binding: undefined,
      layout: { x: 0, y: 1, width: 2, height: 1 },
    };
    await service.applyLayout('main', 'room-bedroom', [source, unboundCard]);
    const copyResult = await service.duplicateWidgetToRoom(
      'main',
      'room-bedroom',
      'w-bed-list',
      'room-living',
    );
    expect(copyResult.ok).toBe(true);
    const livingWidgets = service.findTemplate('main')!.rooms[0]!.widgets;
    const copied = livingWidgets.find(w => w.type === 'vendor-camera-panel')!;
    expect(copied.roomId).toBe('room-living');
    expect(copied.id).not.toBe('w-bed-list');
    // The source room keeps its placement.
    expect(
      service
        .findTemplate('main')!
        .rooms.find(r => r.roomId === 'room-bedroom')!
        .widgets.some(w => w.id === 'w-bed-list'),
    ).toBe(true);
  });

  it('moveWidgetToRoom validates the destination first, then moves atomically', async () => {
    // The seed already references room-bedroom (demo-three-rooms).
    const unbound = {
      ...widget('w-list', 'room-living'),
      type: 'vendor-camera-panel',
      binding: undefined,
      // The seed pump card occupies (0,2) — the unbound fixture lands on
      // the next free living-room row.
      layout: { x: 0, y: 3, width: 2, height: 1 },
    } as WidgetConfig;
    const living = service.findTemplate('main')!.rooms[0]!.widgets;
    await service.applyLayout('main', 'room-living', [...living, unbound]);

    const result = await service.moveWidgetToRoom(
      'main',
      'room-living',
      'w-list',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);
    const template = service.findTemplate('main')!;
    expect(
      template.rooms
        .find(r => r.roomId === 'room-living')!
        .widgets.some(w => w.id === 'w-list'),
    ).toBe(false);
    const moved = template.rooms
      .find(r => r.roomId === 'room-bedroom')!
      .widgets.find(w => w.id === 'w-list')!;
    expect(moved.roomId).toBe('room-bedroom');

    // Incompatible move (living-room binding → bedroom): nothing changes.
    const before = service.findTemplate('main')!;
    expect(
      (
        await service.moveWidgetToRoom(
          'main',
          'room-living',
          'w-temp',
          'room-bedroom',
        )
      ).ok,
    ).toBe(false);
    expect(service.findTemplate('main')!).toEqual(before);
  });
});

describe('section-scoped placement (band re-pack, AD2/AD6/AD7)', () => {
  /**
   * The user's log layout (plan evidence): env = Nhiệt độ/Độ ẩm (row 0),
   * devices = Quạt 2x1 (row 1) + w-1/w-2 (row 2) — plus a SECOND room
   * reference whose widgets must stay byte-identical through every
   * room-scoped remap (the R1 pin).
   */
  function logLayoutFile(): DashboardsFile {
    const base = defaultDashboardsFile();
    const living = base.templates[0]!.rooms[0]!;
    return {
      ...base,
      templates: [
        {
          ...base.templates[0]!,
          rooms: [
            {
              ...living,
              widgets: [
                {
                  id: 'w-temp',
                  type: 'sensor-value',
                  roomId: 'room-living',
                  binding: {
                    deviceId: 'sensor-temp-01',
                    capability: 'temperature',
                  },
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                  id: 'w-hum',
                  type: 'sensor-value',
                  roomId: 'room-living',
                  binding: {
                    deviceId: 'sensor-hum-01',
                    capability: 'humidity',
                  },
                  layout: { x: 1, y: 0, width: 1, height: 1 },
                },
                {
                  id: 'w-fan',
                  type: 'switch',
                  roomId: 'room-living',
                  binding: { deviceId: 'relay-2', capability: 'switch' },
                  layout: { x: 0, y: 1, width: 2, height: 1 },
                },
                {
                  id: 'w-1',
                  type: 'switch',
                  roomId: 'room-living',
                  binding: { deviceId: 'relay-living-a', capability: 'switch' },
                  layout: { x: 0, y: 2, width: 1, height: 1 },
                },
                {
                  id: 'w-2',
                  type: 'switch',
                  roomId: 'room-living',
                  binding: { deviceId: 'relay-living-b', capability: 'switch' },
                  layout: { x: 1, y: 2, width: 1, height: 1 },
                },
              ],
            },
            {
              roomId: 'room-bedroom',
              order: 1,
              widgets: [
                {
                  id: 'w-bed-temp',
                  type: 'sensor-value',
                  roomId: 'room-bedroom',
                  binding: {
                    deviceId: 'sensor-bedroom-1',
                    capability: 'temperature',
                  },
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                  id: 'w-bed-light',
                  type: 'switch',
                  roomId: 'room-bedroom',
                  binding: {
                    deviceId: 'relay-bedroom-1',
                    capability: 'switch',
                  },
                  layout: { x: 0, y: 1, width: 1, height: 1 },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  const ADD_INPUT = {
    type: 'sensor-value',
    binding: { deviceId: 'sensor-living-9', capability: 'temperature' },
    roomId: 'room-living',
  } as const;

  it('persisted add: the new sensor lands at env row 1, the devices band shifts, other rooms are byte-identical', async () => {
    const { repository, service } = makeService({
      stored: JSON.stringify(logLayoutFile()),
    });
    await service.load();
    const before = service.findTemplate('main')!;
    const writesBefore = repository.savedPayloads.length;

    const result = await service.addWidget('main', 'room-living', ADD_INPUT);
    expect(result.ok).toBe(true);

    const after = service.findTemplate('main')!;
    const living = after.rooms.find(r => r.roomId === 'room-living')!;
    const byId = (id: string) => living.widgets.find(w => w.id === id)!;
    // The new sensor: env-local row 1 — directly under Nhiệt độ/Độ ẩm.
    expect(
      living.widgets.find(w => w.binding?.deviceId === 'sensor-living-9')!
        .layout,
    ).toEqual({ x: 0, y: 1, width: 1, height: 1 });
    // The devices band shifted one absolute row down; every local row is
    // unchanged (visual-neutral re-pack).
    expect(byId('w-temp').layout.y).toBe(0);
    expect(byId('w-hum').layout.y).toBe(0);
    expect(byId('w-fan').layout).toEqual({ x: 0, y: 2, width: 2, height: 1 });
    expect(byId('w-1').layout).toEqual({ x: 0, y: 3, width: 1, height: 1 });
    expect(byId('w-2').layout).toEqual({ x: 1, y: 3, width: 1, height: 1 });
    // The resulting persisted room list passes validateLayout (AC 3).
    expect(validateLayout(living.widgets).ok).toBe(true);
    // Other rooms: byte-identical widgets (ids + coords + order) and the
    // same room object reference (the remap never touched them).
    expect(after.rooms.find(r => r.roomId === 'room-bedroom')).toBe(
      before.rooms.find(r => r.roomId === 'room-bedroom'),
    );
    // Exactly one new persisted write (the add commit).
    expect(repository.savedPayloads.length).toBe(writesBefore + 1);
  });

  it('draft add: same placement in the draft; other rooms keep object identity and order; nothing persists', async () => {
    const { repository, service } = makeService({
      stored: JSON.stringify(logLayoutFile()),
    });
    await service.load();
    const service_store = service.getStore();
    service_store.getState().enterEdit('main', 'room-living');
    const draftBefore = service_store.getState().draftWidgets!;
    const bedroomBefore = draftBefore.filter(w => w.roomId === 'room-bedroom');
    const writesBefore = repository.savedPayloads.length;

    const result = await service.addWidget('main', 'room-living', ADD_INPUT);
    expect(result.ok).toBe(true);

    const draft = service_store.getState().draftWidgets!;
    const added = draft.find(w => w.binding?.deviceId === 'sensor-living-9')!;
    expect(added.layout).toEqual({ x: 0, y: 1, width: 1, height: 1 });
    expect(draft.find(w => w.id === 'w-fan')!.layout.y).toBe(2);
    expect(draft.find(w => w.id === 'w-1')!.layout.y).toBe(3);
    expect(draft.find(w => w.id === 'w-2')!.layout.y).toBe(3);
    expect(draft.find(w => w.id === 'w-temp')!.layout.y).toBe(0);
    // Other rooms' draft widgets: same objects, same relative order.
    expect(draft.filter(w => w.roomId === 'room-bedroom')).toEqual(
      bedroomBefore,
    );
    for (const widget of bedroomBefore) {
      expect(draft.find(w => w.id === widget.id)).toBe(widget);
    }
    // Nothing was persisted for a draft add.
    expect(repository.savedPayloads.length).toBe(writesBefore);
    // And the persisted layout is untouched.
    expect(
      service
        .findTemplate('main')!
        .rooms[0]!.widgets.some(w => w.binding?.deviceId === 'sensor-living-9'),
    ).toBe(false);
  });

  it('identity (R4 pin): the same input produces the same placement on both paths', async () => {
    const persisted = makeService({ stored: JSON.stringify(logLayoutFile()) });
    await persisted.service.load();
    const draftRun = makeService({ stored: JSON.stringify(logLayoutFile()) });
    await draftRun.service.load();
    draftRun.service.getStore().getState().enterEdit('main', 'room-living');

    await persisted.service.addWidget('main', 'room-living', ADD_INPUT);
    await draftRun.service.addWidget('main', 'room-living', ADD_INPUT);

    const persistedLiving = persisted.service
      .findTemplate('main')!
      .rooms.find(r => r.roomId === 'room-living')!;
    const draftLiving = draftRun.service
      .getStore()
      .getState()
      .draftWidgets!.filter(w => w.roomId === 'room-living');
    // Identical end-state: ids, coords, order.
    expect(draftLiving).toEqual(persistedLiving.widgets);
  });

  it('empty-section add: the first env widget lands at (0,0) and the devices section shifts behind it', async () => {
    const file = logLayoutFile();
    // Strip the room's sensors → the env section is empty (rebuilt, never
    // mutated in place).
    const template = file.templates[0]!;
    const living = template.rooms[0]!;
    const stripped: DashboardsFile = {
      ...file,
      templates: [
        {
          ...template,
          rooms: [
            {
              ...living,
              widgets: living.widgets.filter(w => w.type !== 'sensor-value'),
            },
            template.rooms[1]!,
          ],
        },
      ],
    };
    const { service } = makeService({ stored: JSON.stringify(stripped) });
    await service.load();

    const result = await service.addWidget('main', 'room-living', ADD_INPUT);
    expect(result.ok).toBe(true);
    const after = service
      .findTemplate('main')!
      .rooms.find(r => r.roomId === 'room-living')!;
    expect(
      after.widgets.find(w => w.binding?.deviceId === 'sensor-living-9')!
        .layout,
    ).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    // The devices band (its extent was 2 rows) shifted exactly the new
    // widget's height down: fan 2x1 to y 1, w-1/w-2 to y 2 — local rows
    // unchanged (fan local 0, w-1/w-2 local 1).
    expect(after.widgets.find(w => w.id === 'w-fan')!.layout.y).toBe(1);
    expect(after.widgets.find(w => w.id === 'w-1')!.layout.y).toBe(2);
    expect(after.widgets.find(w => w.id === 'w-2')!.layout.y).toBe(2);
  });

  it('a corrupt placement result fails the add loudly without any write (AD7 fault injection)', async () => {
    const { repository, service } = makeService({
      stored: JSON.stringify(logLayoutFile()),
    });
    await service.load();
    const writesBefore = repository.savedPayloads.length;
    const overlapping = {
      id: 'w-corrupt',
      type: 'switch',
      roomId: 'room-living',
      binding: { deviceId: 'relay-1', capability: 'switch' },
      layout: { x: 0, y: 0, width: 1, height: 1 },
    };
    // Stub ONE placement call with an overlapping remap (a hypothetical
    // bad band shift) — the pre-write guard must reject it.
    (findSectionSlot as jest.Mock).mockImplementationOnce(() => ({
      slot: { x: 0, y: 0 },
      widgets: [overlapping],
    }));
    const failed = await service.addWidget('main', 'room-living', ADD_INPUT);
    expect(failed.ok).toBe(false);
    // No corrupted write reached the repository.
    expect(repository.savedPayloads.length).toBe(writesBefore);

    // The draft write path is guarded the same way.
    service.getStore().getState().enterEdit('main', 'room-living');
    const draftBefore = service.getStore().getState().draftWidgets;
    (findSectionSlot as jest.Mock).mockImplementationOnce(() => ({
      slot: { x: 0, y: 0 },
      widgets: [overlapping],
    }));
    const failedDraft = await service.addWidget(
      'main',
      'room-living',
      ADD_INPUT,
    );
    expect(failedDraft.ok).toBe(false);
    expect(service.getStore().getState().draftWidgets).toBe(draftBefore);
    expect(repository.savedPayloads.length).toBe(writesBefore);
  });
});

describe('section-scoped cross-room placement (ADR-019 follow-up)', () => {
  /**
   * ISSUE-012.2 fixtures: `room-bedroom` is the cross-room TARGET. The
   * source card is a bedroom-bound widget living in the LIVING reference
   * (the device was moved to the bedroom — the legitimate duplicate/move
   * source: the binding belongs to the TARGET room, so the operation is
   * compatible). The persisted file is crafted directly; the load-time
   * migrations never re-validate binding-room authority.
   */

  /** Target room whose DEVICES section occupies row 0 (env section empty). */
  function devicesBandTargetFile(): DashboardsFile {
    const base = defaultDashboardsFile();
    const template = base.templates[0]!;
    return {
      ...base,
      templates: [
        {
          ...template,
          rooms: [
            {
              roomId: 'room-living',
              order: 0,
              widgets: [
                {
                  id: 'w-bed-sensor',
                  type: 'sensor-value',
                  roomId: 'room-living',
                  binding: {
                    deviceId: 'sensor-bedroom-1',
                    capability: 'temperature',
                  },
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
              ],
            },
            {
              roomId: 'room-bedroom',
              order: 1,
              widgets: [
                {
                  id: 'w-bed-fan',
                  type: 'switch',
                  roomId: 'room-bedroom',
                  binding: {
                    deviceId: 'relay-bedroom-1',
                    capability: 'switch',
                  },
                  layout: { x: 0, y: 0, width: 2, height: 1 },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  /** Target room with an ENV band (row 0) in front of its devices band. */
  function envBandTargetFile(): DashboardsFile {
    const base = defaultDashboardsFile();
    const template = base.templates[0]!;
    return {
      ...base,
      templates: [
        {
          ...template,
          rooms: [
            {
              roomId: 'room-living',
              order: 0,
              widgets: [
                {
                  id: 'w-bed-switch',
                  type: 'switch',
                  roomId: 'room-living',
                  binding: {
                    deviceId: 'relay-bedroom-2',
                    capability: 'switch',
                  },
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
              ],
            },
            {
              roomId: 'room-bedroom',
              order: 1,
              widgets: [
                {
                  id: 'w-bed-temp',
                  type: 'sensor-value',
                  roomId: 'room-bedroom',
                  binding: {
                    deviceId: 'sensor-bedroom-1',
                    capability: 'temperature',
                  },
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                  id: 'w-bed-fan',
                  type: 'switch',
                  roomId: 'room-bedroom',
                  binding: {
                    deviceId: 'relay-bedroom-1',
                    capability: 'switch',
                  },
                  layout: { x: 0, y: 1, width: 2, height: 1 },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  it('duplicate a sensor into a room whose devices band owns row 0: the copy lands in the env band and the devices band shifts down', async () => {
    const { repository, service } = makeService({
      stored: JSON.stringify(devicesBandTargetFile()),
    });
    await service.load();
    const before = service.findTemplate('main')!;
    const writesBefore = repository.savedPayloads.length;

    const result = await service.duplicateWidgetToRoom(
      'main',
      'room-living',
      'w-bed-sensor',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);

    const after = service.findTemplate('main')!;
    const bedroom = after.rooms.find(r => r.roomId === 'room-bedroom')!;
    const copy = bedroom.widgets.find(w => w.id !== 'w-bed-fan')!;
    expect(copy.id).not.toBe('w-bed-sensor');
    expect(copy.roomId).toBe('room-bedroom');
    // The copy landed at the ENVIRONMENT section's band cell (row 0) — NOT
    // in the first free UNIFIED cell below the devices band (the old
    // sinking behavior would place it at y 1 and shift nothing).
    expect(copy.layout).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    // The env band grew by the copy's height → the devices band shifted
    // exactly one row down (visual-neutral re-pack).
    expect(bedroom.widgets.find(w => w.id === 'w-bed-fan')!.layout).toEqual({
      x: 0,
      y: 1,
      width: 2,
      height: 1,
    });
    expect(validateLayout(bedroom.widgets).ok).toBe(true);
    // The source room's slice is untouched; exactly one new persisted write.
    expect(after.rooms.find(r => r.roomId === 'room-living')!.widgets).toEqual(
      before.rooms.find(r => r.roomId === 'room-living')!.widgets,
    );
    expect(repository.savedPayloads.length).toBe(writesBefore + 1);
  });

  it('duplicate a switch into a room with an env band: the copy lands after the devices band extent', async () => {
    const { service } = makeService({
      stored: JSON.stringify(envBandTargetFile()),
    });
    await service.load();

    const result = await service.duplicateWidgetToRoom(
      'main',
      'room-living',
      'w-bed-switch',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);

    const bedroom = service
      .findTemplate('main')!
      .rooms.find(r => r.roomId === 'room-bedroom')!;
    const copy = bedroom.widgets.find(
      w => w.id !== 'w-bed-temp' && w.id !== 'w-bed-fan',
    )!;
    expect(copy.type).toBe('switch');
    // Devices-local first free cell: behind the 2x1 fan (local row 1) →
    // absolute y = envExtent (1) + 1 = 2 — NOT the unified free cell
    // (1,0) inside the env band.
    expect(copy.layout).toEqual({ x: 0, y: 2, width: 1, height: 1 });
    // A devices placement never shifts the bands before it: the env band
    // and the existing devices row keep their coordinates.
    expect(bedroom.widgets.find(w => w.id === 'w-bed-temp')!.layout.y).toBe(0);
    expect(bedroom.widgets.find(w => w.id === 'w-bed-fan')!.layout.y).toBe(1);
    expect(validateLayout(bedroom.widgets).ok).toBe(true);
  });

  it('move in draft mode: section-aware landing + source removal in the SAME atomic draft update', async () => {
    const { repository, service } = makeService({
      stored: JSON.stringify(devicesBandTargetFile()),
    });
    await service.load();
    const store = service.getStore();
    store.getState().enterEdit('main', 'room-living');
    const draftBefore = store.getState().draftWidgets!;
    const writesBefore = repository.savedPayloads.length;
    const setDraftSpy = jest.spyOn(store.getState(), 'setDraftWidgets');

    const result = await service.moveWidgetToRoom(
      'main',
      'room-living',
      'w-bed-sensor',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);

    // Exactly ONE draft update carried the whole move (no torn state).
    expect(setDraftSpy).toHaveBeenCalledTimes(1);
    const payload = setDraftSpy.mock.calls[0]![0];
    // The single payload already holds BOTH sides: the target room's
    // band-remapped slice + the moved widget, and no source-room card.
    const payloadMoved = payload.find(w => w.id === 'w-bed-sensor')!;
    expect(payloadMoved.roomId).toBe('room-bedroom');
    expect(payloadMoved.layout).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(payload.find(w => w.id === 'w-bed-fan')!.layout.y).toBe(1);
    expect(payload.some(w => w.roomId === 'room-living')).toBe(false);

    const draft = store.getState().draftWidgets!;
    expect(draft.find(w => w.id === 'w-bed-sensor')!.roomId).toBe(
      'room-bedroom',
    );
    expect(draft.filter(w => w.roomId === 'room-living')).toHaveLength(0);
    expect(validateLayout(draft).ok).toBe(true);
    expect(draft).not.toBe(draftBefore);
    // Draft-only: nothing was persisted.
    expect(repository.savedPayloads.length).toBe(writesBefore);
  });

  it('a corrupt target placement fails loudly with the draft AND the persisted file untouched (AD7)', async () => {
    const { repository, service } = makeService({
      stored: JSON.stringify(devicesBandTargetFile()),
    });
    await service.load();
    const before = service.findTemplate('main')!;
    const writesBefore = repository.savedPayloads.length;
    // A hypothetical bad band shift: the slot collides with the unshifted
    // devices band. The pre-write guard must reject it on the COMMIT path.
    const corruptPlacement = {
      slot: { x: 0, y: 0 },
      widgets: [
        {
          id: 'w-bed-fan',
          type: 'switch',
          roomId: 'room-bedroom',
          binding: { deviceId: 'relay-bedroom-1', capability: 'switch' },
          layout: { x: 0, y: 0, width: 2, height: 1 },
        },
      ],
    };
    (findSectionSlot as jest.Mock).mockImplementationOnce(
      () => corruptPlacement,
    );
    const failedCopy = await service.duplicateWidgetToRoom(
      'main',
      'room-living',
      'w-bed-sensor',
      'room-bedroom',
    );
    expect(failedCopy.ok).toBe(false);
    expect(service.findTemplate('main')).toEqual(before);
    expect(repository.savedPayloads.length).toBe(writesBefore);

    // The draft write path is guarded the same way (no write at all).
    const store = service.getStore();
    store.getState().enterEdit('main', 'room-living');
    const draftBefore = store.getState().draftWidgets;
    (findSectionSlot as jest.Mock).mockImplementationOnce(
      () => corruptPlacement,
    );
    const failedMove = await service.moveWidgetToRoom(
      'main',
      'room-living',
      'w-bed-sensor',
      'room-bedroom',
    );
    expect(failedMove.ok).toBe(false);
    expect(store.getState().draftWidgets).toBe(draftBefore);
    expect(repository.savedPayloads.length).toBe(writesBefore);
  });

  it('migrateWidgetsFromRoom merge: a colliding mover lands section-aware in the merge target', async () => {
    const base = defaultDashboardsFile();
    const template = base.templates[0]!;
    const file: DashboardsFile = {
      ...base,
      templates: [
        {
          ...template,
          rooms: [
            {
              roomId: 'room-living',
              order: 0,
              widgets: [
                {
                  // Collides with the bedroom switch band at row 0 after
                  // the retarget — the mover that needs relocation.
                  id: 'w-mv-temp',
                  type: 'sensor-value',
                  roomId: 'room-living',
                  binding: {
                    deviceId: 'sensor-temp-01',
                    capability: 'temperature',
                  },
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                  // Collides after the first relocation shifted the
                  // devices band down.
                  id: 'w-mv-light',
                  type: 'switch',
                  roomId: 'room-living',
                  binding: { deviceId: 'relay-1', capability: 'switch' },
                  layout: { x: 0, y: 1, width: 1, height: 1 },
                },
              ],
            },
            {
              roomId: 'room-bedroom',
              order: 1,
              widgets: [
                {
                  // The merge TARGET's devices section occupies row 0
                  // (env section empty) — the "sinking" trap.
                  id: 'w-bed-fan',
                  type: 'switch',
                  roomId: 'room-bedroom',
                  binding: {
                    deviceId: 'relay-bedroom-1',
                    capability: 'switch',
                  },
                  layout: { x: 0, y: 0, width: 2, height: 1 },
                },
              ],
            },
          ],
        },
      ],
    };
    const { service } = makeService({ stored: JSON.stringify(file) });
    await service.load();

    const result = await service.migrateWidgetsFromRoom(
      'room-living',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);

    const merged = service.findTemplate('main')!;
    expect(merged.rooms.map(r => r.roomId)).toEqual(['room-bedroom']);
    const byId = (id: string) =>
      merged.rooms[0]!.widgets.find(w => w.id === id)!;
    // w-mv-temp collided with the devices band → relocated to the ENV
    // section's first free cell (0,0) — NOT the first free UNIFIED cell
    // below the band — and the devices band shifted one row down.
    expect(byId('w-mv-temp')!.layout).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(byId('w-bed-fan')!.layout).toEqual({
      x: 0,
      y: 1,
      width: 2,
      height: 1,
    });
    // w-mv-light then collided with the shifted band → lands behind the
    // devices band's extent (devices-local row 1 → absolute y 2).
    expect(byId('w-mv-light')!.layout).toEqual({
      x: 0,
      y: 2,
      width: 1,
      height: 1,
    });
    expect(validateLayout(merged.rooms[0]!.widgets).ok).toBe(true);
  });
});

describe('cascades (devices ownership)', () => {
  let context: ReturnType<typeof makeService>;
  let service: DashboardServiceImpl;

  beforeEach(async () => {
    context = makeService();
    service = context.service;
    await service.load();
    await service.createTemplate('T2'); // tpl-1
    await service.addRoomReference('tpl-1', 'room-living');
    await service.applyLayout('tpl-1', 'room-living', [
      widget('w-t2-a', 'room-living', {
        binding: { deviceId: 'sensor-temp-01', capability: 'temperature' },
        layout: { x: 0, y: 0, width: 1, height: 1 },
      }),
      widget('w-t2-b', 'room-living', {
        type: 'switch',
        binding: { deviceId: 'relay-living-1', capability: 'switch' },
        layout: { x: 1, y: 0, width: 1, height: 1 },
      }),
    ]);
  });

  it('removeWidgetsForDevice cleans every Template and compacts', async () => {
    const result = await service.removeWidgetsForDevice('sensor-temp-01');
    expect(result.ok).toBe(true);
    expect(
      service
        .findTemplate('main')!
        .rooms[0]!.widgets.some(w => w.binding?.deviceId === 'sensor-temp-01'),
    ).toBe(false);
    expect(
      service
        .findTemplate('tpl-1')!
        .rooms[0]!.widgets.some(w => w.binding?.deviceId === 'sensor-temp-01'),
    ).toBe(false);
    // The sibling relay card survives.
    expect(
      service
        .findTemplate('tpl-1')!
        .rooms[0]!.widgets.some(w => w.id === 'w-t2-b'),
    ).toBe(true);
  });

  it('removeWidgetsForBinding removes only the exact binding', async () => {
    const result = await service.removeWidgetsForBinding(
      'sensor-temp-01',
      'humidity',
    );
    expect(result.ok).toBe(true);
    // w-temp binds temperature, not humidity → untouched.
    expect(
      service
        .findTemplate('main')!
        .rooms[0]!.widgets.some(w => w.id === 'w-temp'),
    ).toBe(true);
  });

  it('migrateWidgetsFromRoom retargets references when devices move', async () => {
    // Drop main's existing bedroom reference so the migration takes the
    // SIMPLE retarget path (no merge target with pre-existing widgets).
    await service.removeRoomReference('main', 'room-bedroom');
    const result = await service.migrateWidgetsFromRoom(
      'room-living',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);
    const template = service.findTemplate('main')!;
    expect(template.rooms.map(r => r.roomId)).toEqual([
      'room-bedroom',
      'room-kitchen',
    ]);
    expect(template.rooms[0]!.widgets.map(w => w.id)).toEqual([
      'w-temp',
      'w-hum',
      'w-light',
      'w-fan',
      'w-pump',
    ]);
    expect(
      template.rooms[0]!.widgets.every(w => w.roomId === 'room-bedroom'),
    ).toBe(true);
    // tpl-1 also referenced room-living → retargeted (keeps its layout).
    expect(service.findTemplate('tpl-1')!.rooms[0]!.roomId).toBe(
      'room-bedroom',
    );
  });

  it('migrateWidgetsFromRoom merges into an existing target reference with relocation', async () => {
    // The seed already references room-bedroom (demo-three-rooms): migrate
    // living → bedroom and the retargeted widgets MERGE into the existing
    // reference (colliders relocated), tpl-1 retargets simply.
    const result = await service.migrateWidgetsFromRoom(
      'room-living',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);
    const template = service.findTemplate('main')!;
    // The merge target lands LAST (the service rebuilds the reference list
    // with the merged room appended) — Bếp keeps the first position.
    expect(template.rooms.map(r => r.roomId)).toEqual([
      'room-kitchen',
      'room-bedroom',
    ]);
    // All ten placements survive the merge (seed 5 + migrated 5).
    expect(template.rooms[1]!.widgets).toHaveLength(10);
    expect(validateLayout(template.rooms[1]!.widgets).ok).toBe(true);
  });

  it('migrateWidgetsFromRoom(null) removes the reference (physical room gone)', async () => {
    const result = await service.migrateWidgetsFromRoom('room-living', null);
    expect(result.ok).toBe(true);
    // The OTHER seed references (bedroom/kitchen) survive in main.
    expect(service.findTemplate('main')!.rooms.map(r => r.roomId)).toEqual([
      'room-bedroom',
      'room-kitchen',
    ]);
    expect(service.findTemplate('tpl-1')!.rooms).toEqual([]);
  });
});

describe('History room-selection seam', () => {
  it('setActiveRoom validates, is idempotent and never touches updatedAt', async () => {
    const { service, clock } = makeService();
    await service.load();
    const before = service.getActiveTemplate().updatedAt;
    clock.advance(500);
    const invalid = await service.setActiveRoom('room-ghost');
    expect(invalid.ok).toBe(false);
    const valid = await service.setActiveRoom('room-bedroom');
    expect(valid.ok).toBe(true);
    expect(service.getActiveRoomId()).toBe('room-bedroom');
    expect(service.getActiveTemplate().updatedAt).toBe(before);
  });
});

describe('draft cross-room operations (duplicate/move atomicity)', () => {
  let context: ReturnType<typeof makeService>;
  let service: DashboardServiceImpl;
  let store: ReturnType<DashboardServiceImpl['getStore']>;
  let repository: FakeRepository;

  beforeEach(async () => {
    context = makeService();
    service = context.service;
    store = service.getStore();
    repository = context.repository;
    await service.load();
    // The seed already references room-bedroom (demo-three-rooms) — the
    // cross-room destination exists out of the box.
    // The movable UNBOUND card (no binding — unknown custom type): the
    // established move fixture (unbound widgets are room-agnostic). The
    // seed pump card occupies (0,2) — the fixture lands on the next free
    // living-room row.
    const living = service.findTemplate('main')!.rooms[0]!.widgets;
    await service.applyLayout('main', 'room-living', [
      ...living,
      {
        ...widget('w-list', 'room-living'),
        type: 'vendor-camera-panel',
        binding: undefined,
        layout: { x: 0, y: 3, width: 2, height: 1 },
      } as WidgetConfig,
    ]);
    store.getState().enterEdit('main', 'room-living');
  });

  it('duplicate in draft mode: draft-only add, NO persistence before Save', async () => {
    const savesBefore = repository.savedPayloads.length;
    const result = await service.duplicateWidgetToRoom(
      'main',
      'room-living',
      'w-list',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);
    // The draft captured the destination add (fresh id, room mirror) —
    // found by its vendor type (the seed bedroom cards are the built-ins).
    const draft = store.getState().draftWidgets!;
    const copy = draft.find(
      w => w.roomId === 'room-bedroom' && w.type === 'vendor-camera-panel',
    );
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe('w-list');
    expect(copy!.id.startsWith('w-')).toBe(true);
    expect(copy!.type).toBe('vendor-camera-panel');
    // Nothing was persisted, and the source room's draft slice is intact.
    expect(repository.savedPayloads).toHaveLength(savesBefore);
    expect(
      service
        .findTemplate('main')!
        .rooms.find(r => r.roomId === 'room-living')!
        .widgets.some(w => w.id === 'w-list'),
    ).toBe(true);
    // The PERSISTED bedroom layout never saw the copy (the seed's five
    // demo widgets are its only content until Save).
    expect(
      service
        .findTemplate('main')!
        .rooms.find(r => r.roomId === 'room-bedroom')!.widgets,
    ).toHaveLength(5);
  });

  it('move in draft mode: source removal + destination add in the draft, NO persistence', async () => {
    const savesBefore = repository.savedPayloads.length;
    const result = await service.moveWidgetToRoom(
      'main',
      'room-living',
      'w-list',
      'room-bedroom',
    );
    expect(result.ok).toBe(true);
    const draft = store.getState().draftWidgets!;
    expect(draft.some(w => w.id === 'w-list')).toBe(true);
    expect(draft.find(w => w.id === 'w-list')!.roomId === 'room-bedroom').toBe(
      true,
    );
    // The source widget left the edited room's draft slice (a later Save
    // can never re-apply it as a duplicate).
    expect(
      draft.filter(w => w.roomId === 'room-living' && w.id === 'w-list'),
    ).toHaveLength(0);
    expect(repository.savedPayloads).toHaveLength(savesBefore);
  });

  it('Cancel discards the draft duplicate/move (nothing was ever persisted)', async () => {
    const savesBefore = repository.savedPayloads.length;
    await service.duplicateWidgetToRoom(
      'main',
      'room-living',
      'w-list',
      'room-bedroom',
    );
    await service.moveWidgetToRoom(
      'main',
      'room-living',
      'w-list',
      'room-bedroom',
    );
    store.getState().cancelEdit();
    expect(store.getState().editMode).toBe(false);
    expect(store.getState().draftWidgets).toBeNull();
    // The persisted Template never saw any of it (the seed's five demo
    // widgets remain the bedroom's only content).
    const template = service.findTemplate('main')!;
    expect(
      template.rooms
        .find(r => r.roomId === 'room-bedroom')!
        .widgets.some(
          w => w.id === 'w-list' || w.type === 'vendor-camera-panel',
        ),
    ).toBe(false);
    expect(
      template.rooms
        .find(r => r.roomId === 'room-living')!
        .widgets.some(w => w.id === 'w-list'),
    ).toBe(true);
    expect(repository.savedPayloads).toHaveLength(savesBefore);
  });

  it('Save (applyTemplateLayouts) commits the draft end-state atomically (move)', async () => {
    const before = service.findTemplate('main')!.updatedAt;
    context.clock.advance(300);
    await service.moveWidgetToRoom(
      'main',
      'room-living',
      'w-list',
      'room-bedroom',
    );
    // Save = the route's seam: group the FULL draft by room and commit once.
    const draft = store.getState().draftWidgets!;
    const layouts = service.findTemplate('main')!.rooms.map(room => ({
      roomId: room.roomId,
      widgets: draft.filter(w => w.roomId === room.roomId),
    }));
    const result = await service.applyTemplateLayouts('main', layouts);
    expect(result.ok).toBe(true);
    const template = service.findTemplate('main')!;
    // Source removed exactly once, destination holds the moved placement
    // alongside the seed's five demo widgets.
    expect(
      template.rooms
        .find(r => r.roomId === 'room-living')!
        .widgets.some(w => w.id === 'w-list'),
    ).toBe(false);
    const bedroom = template.rooms.find(
      r => r.roomId === 'room-bedroom',
    )!.widgets;
    expect(bedroom).toHaveLength(6);
    const moved = bedroom.find(w => w.id === 'w-list')!;
    expect(moved.roomId).toBe('room-bedroom');
    expect(moved.type).toBe('vendor-camera-panel');
    expect(template.updatedAt).toBe(before + 300);
    store.getState().cancelEdit();
  });

  it('Save (applyTemplateLayouts) commits the draft end-state atomically (duplicate)', async () => {
    await service.duplicateWidgetToRoom(
      'main',
      'room-living',
      'w-list',
      'room-bedroom',
    );
    const draft = store.getState().draftWidgets!;
    const layouts = service.findTemplate('main')!.rooms.map(room => ({
      roomId: room.roomId,
      widgets: draft.filter(w => w.roomId === room.roomId),
    }));
    const result = await service.applyTemplateLayouts('main', layouts);
    expect(result.ok).toBe(true);
    const template = service.findTemplate('main')!;
    // The source stays; the destination holds only the FRESH copy (plus
    // the seed's five demo widgets).
    expect(
      template.rooms
        .find(r => r.roomId === 'room-living')!
        .widgets.some(w => w.id === 'w-list'),
    ).toBe(true);
    const bedroom = template.rooms.find(
      r => r.roomId === 'room-bedroom',
    )!.widgets;
    expect(bedroom).toHaveLength(6);
    const freshCopy = bedroom.find(w => w.type === 'vendor-camera-panel')!;
    expect(freshCopy.id).not.toBe('w-list');
    expect(freshCopy.roomId).toBe('room-bedroom');
    store.getState().cancelEdit();
  });

  it('an invalid draft destination mutates neither draft nor persistence', async () => {
    const draftBefore = store.getState().draftWidgets!;
    const savesBefore = repository.savedPayloads.length;
    // A living-room-bound sensor can never live in the bedroom.
    const result = await service.moveWidgetToRoom(
      'main',
      'room-living',
      'w-temp',
      'room-bedroom',
    );
    expect(result.ok).toBe(false);
    expect(store.getState().draftWidgets).toEqual(draftBefore);
    expect(repository.savedPayloads).toHaveLength(savesBefore);
  });

  it('a stale draft (different Template scope) is rejected by the service draft seam', async () => {
    // The draft is scoped to 'main'; a call for another Template must take
    // the PERSISTED path semantics — not silently read the stale draft.
    await service.createTemplate('T2'); // tpl-1 (active)
    await service.addRoomReference('tpl-1', 'room-living');
    // The editor draft is still open for 'main' — a tpl-1 operation does
    // not see it (draftActive requires the same Template scope).
    const result = await service.duplicateWidgetToRoom(
      'tpl-1',
      'room-living',
      'w-none',
      'room-living',
    );
    expect(result.ok).toBe(false);
  });
});

describe('applyTemplateLayouts (atomic multi-room commit)', () => {
  let context: ReturnType<typeof makeService>;
  let service: DashboardServiceImpl;
  let repository: FakeRepository;

  beforeEach(async () => {
    context = makeService();
    service = context.service;
    repository = context.repository;
    await service.load();
    // The seed already references room-bedroom (demo-three-rooms).
  });

  it('replaces several rooms in ONE commit with a single updatedAt touch', async () => {
    const before = service.findTemplate('main')!.updatedAt;
    context.clock.advance(400);
    const template = service.findTemplate('main')!;
    const living = template.rooms.find(
      r => r.roomId === 'room-living',
    )!.widgets;
    const result = await service.applyTemplateLayouts('main', [
      {
        roomId: 'room-living',
        widgets: living.filter(w => w.id !== 'w-temp'),
      },
      {
        roomId: 'room-bedroom',
        widgets: [
          widget('w-b1', 'room-bedroom', {
            binding: { deviceId: 'sensor-bedroom-1', capability: 'humidity' },
          }),
        ],
      },
    ]);
    expect(result.ok).toBe(true);
    const after = service.findTemplate('main')!;
    expect(
      after.rooms
        .find(r => r.roomId === 'room-living')!
        .widgets.some(w => w.id === 'w-temp'),
    ).toBe(false);
    expect(
      after.rooms
        .find(r => r.roomId === 'room-bedroom')!
        .widgets.map(w => w.id),
    ).toEqual(['w-b1']);
    expect(after.updatedAt).toBe(before + 400);
    expect(repository.savedPayloads).toHaveLength(2); // seed + commit
  });

  it('rejects unknown rooms, duplicate roomIds and invalid layouts (nothing persisted)', async () => {
    const before = service.findTemplate('main')!;
    const savesBefore = repository.savedPayloads.length;
    const living = before.rooms.find(r => r.roomId === 'room-living')!.widgets;
    expect(
      (
        await service.applyTemplateLayouts('main', [
          { roomId: 'room-ghost', widgets: [] },
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await service.applyTemplateLayouts('main', [
          { roomId: 'room-living', widgets: living },
          { roomId: 'room-living', widgets: [] },
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await service.applyTemplateLayouts('main', [
          {
            roomId: 'room-living',
            widgets: [
              ...living,
              widget('w-x', 'room-living', {
                layout: { x: 0, y: 0, width: 1, height: 1 },
              }),
            ],
          },
        ])
      ).ok,
    ).toBe(false); // overlaps w-temp at (0,0)
    expect(service.findTemplate('main')!).toEqual(before);
    expect(repository.savedPayloads).toHaveLength(savesBefore);
  });
});

describe('legacy migration finalization (registry-aware)', () => {
  it('replaces the all-roomless sentinel with the FIRST registry room (widgets visible)', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-free',
          name: 'Free',
          widgets: [{ ...widget('w-free'), roomId: undefined } as LegacyWidget],
        },
      ],
      activeId: 'dash-free',
      activeRoomId: null,
    };
    const { service, repository } = makeService({
      stored: JSON.stringify(legacy),
    });
    await service.load();
    const template = service.findTemplate('dash-free')!;
    // Registry order: room-living (order 0) wins; the sentinel is gone.
    expect(template.rooms.map(r => r.roomId)).toEqual(['room-living']);
    expect(template.rooms[0]!.widgets.map(w => w.id)).toEqual(['w-free']);
    expect(template.rooms[0]!.widgets[0]!.roomId).toBe('room-living');
    // The room strip of the view can resolve it (no dangling reference).
    expect(
      template.rooms.every(r => ROOMS.some(room => room.id === r.roomId)),
    ).toBe(true);
    // Persisted once, and the persisted snapshot has no sentinel.
    expect(repository.savedPayloads).toHaveLength(1);
    expect(repository.savedPayloads[0]).not.toContain('__global__');
  });

  it('merges the sentinel into the existing first-room reference', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-mix',
          name: 'Mix',
          widgets: [
            widget('w-roomed', 'room-living'),
            { ...widget('w-free'), roomId: undefined } as LegacyWidget,
          ],
        },
      ],
      activeId: 'dash-mix',
      activeRoomId: null,
    };
    const { service } = makeService({ stored: JSON.stringify(legacy) });
    await service.load();
    const template = service.findTemplate('dash-mix')!;
    expect(template.rooms.map(r => r.roomId)).toEqual(['room-living']);
    // The roomless placement joined the host reference (appended last,
    // mirror adopted) — one reference, both widgets, no duplicates.
    expect(template.rooms[0]!.widgets.map(w => w.id)).toEqual([
      'w-roomed',
      'w-free',
    ]);
    expect(template.rooms[0]!.widgets[1]!.roomId).toBe('room-living');
  });

  it('keeps the sentinel when NO physical room exists (never drops widgets)', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-orphan',
          name: 'Orphan',
          widgets: [{ ...widget('w-free'), roomId: undefined } as LegacyWidget],
        },
      ],
      activeId: 'dash-orphan',
      activeRoomId: null,
    };
    const { service } = makeService({
      stored: JSON.stringify(legacy),
      getRooms: () => [],
      roomExists: () => false,
    });
    await service.load();
    const template = service.findTemplate('dash-orphan')!;
    expect(template.rooms.map(r => r.roomId)).toEqual(['__global__']);
    expect(template.rooms[0]!.widgets.map(w => w.id)).toEqual(['w-free']);
  });

  it('retains the legacy active room as an EMPTY reference when it had no widgets', async () => {
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-active',
          name: 'Active',
          widgets: [widget('w-l', 'room-living')],
        },
      ],
      activeId: 'dash-active',
      activeRoomId: 'room-bedroom',
    };
    const { service } = makeService({ stored: JSON.stringify(legacy) });
    await service.load();
    const template = service.findTemplate('dash-active')!;
    // Registry-ordered references + the retained empty active selection.
    expect(template.rooms.map(r => r.roomId)).toEqual([
      'room-living',
      'room-bedroom',
    ]);
    expect(
      template.rooms.find(r => r.roomId === 'room-bedroom')!.widgets,
    ).toEqual([]);
  });

  it('retained room lands at its REGISTRY position (before widget rooms) + idempotent reload', async () => {
    // Legacy widgets ONLY in room-kitchen (registry order 2); the old
    // active selection is room-living (registry order 0). The retained
    // empty reference must sort BEFORE the widget-bearing room — appending
    // it at the end produced [kitchen, living], contradicting AC9.
    const legacy: LegacyDashboardsFile = {
      dashboards: [
        {
          id: 'dash-order',
          name: 'Order',
          widgets: [widget('w-k', 'room-kitchen')],
        },
      ],
      activeId: 'dash-order',
      activeRoomId: 'room-living',
    };
    const { repository, service } = makeService({
      stored: JSON.stringify(legacy),
    });
    await service.load();
    const template = service.findTemplate('dash-order')!;
    // Registry order across ALL retained references: living (0) first.
    expect(template.rooms.map(r => r.roomId)).toEqual([
      'room-living',
      'room-kitchen',
    ]);
    expect(template.rooms.map(r => r.order)).toEqual([0, 1]);
    expect(template.rooms[0]!.widgets).toEqual([]);
    expect(template.rooms[1]!.widgets.map(w => w.id)).toEqual(['w-k']);
    // Persisted once; the reload writes nothing and the order is stable.
    expect(repository.savedPayloads).toHaveLength(1);
    await service.load();
    expect(repository.savedPayloads).toHaveLength(1);
    expect(
      service.findTemplate('dash-order')!.rooms.map(r => r.roomId),
    ).toEqual(['room-living', 'room-kitchen']);
  });

  it('write-through: in-memory cleanups of a CURRENT snapshot persist once, reload is a no-op', async () => {
    const file = defaultDashboardsFile();
    file.templates[0]!.rooms[0]!.widgets.push(
      widget('w-retired', 'room-living', {
        type: 'connection',
        binding: undefined,
      }),
    );
    file.templates[0]!.updatedAt = 55;
    const { repository, service } = makeService({
      stored: JSON.stringify(file),
    });
    await service.load();
    const widgets = service.getActiveTemplate().rooms[0]!.widgets;
    expect(widgets.some(w => w.type === 'connection')).toBe(false);
    // The cleanup wrote through exactly once…
    expect(repository.savedPayloads).toHaveLength(1);
    // …and the second load of the persisted snapshot writes nothing.
    await service.load();
    expect(repository.savedPayloads).toHaveLength(1);
  });

  it('unaffected Templates keep their updatedAt after a device cascade', async () => {
    const { service, clock } = makeService();
    await service.load();
    await service.createTemplate('T2'); // tpl-1 (active)
    await service.addRoomReference('tpl-1', 'room-living');
    await service.applyLayout('tpl-1', 'room-living', [
      widget('w-t2-a', 'room-living', {
        binding: { deviceId: 'sensor-temp-01', capability: 'temperature' },
        layout: { x: 0, y: 0, width: 1, height: 1 },
      }),
      widget('w-t2-b', 'room-living', {
        type: 'switch',
        binding: { deviceId: 'relay-living-1', capability: 'switch' },
        layout: { x: 1, y: 0, width: 1, height: 1 },
      }),
    ]);
    await service.createTemplate('T3'); // tpl-2 — UNAFFECTED device set
    await service.addRoomReference('tpl-2', 'room-bedroom');
    await service.applyLayout('tpl-2', 'room-bedroom', [
      widget('w-t3-a', 'room-bedroom', {
        binding: { deviceId: 'sensor-bedroom-1', capability: 'humidity' },
        layout: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ]);
    const mainBefore = service.findTemplate('main')!.updatedAt;
    const t2Before = service.findTemplate('tpl-1')!.updatedAt;
    const t3Before = service.findTemplate('tpl-2')!.updatedAt;
    clock.advance(700);
    await service.removeWidgetsForDevice('sensor-temp-01');
    // main + tpl-1 owned sensor-temp-01 widgets → touched; tpl-2 untouched.
    expect(service.findTemplate('main')!.updatedAt).toBe(mainBefore + 700);
    expect(service.findTemplate('tpl-1')!.updatedAt).toBe(t2Before + 700);
    expect(service.findTemplate('tpl-2')!.updatedAt).toBe(t3Before);
    // Same contract for the binding-level cascade: tpl-2 owns the removed
    // metric (touched), main does not.
    clock.advance(100);
    await service.removeWidgetsForBinding('sensor-bedroom-1', 'humidity');
    expect(service.findTemplate('tpl-2')!.updatedAt).toBe(t3Before + 800);
    expect(service.findTemplate('main')!.updatedAt).toBe(mainBefore + 700);
  });
});

describe('swapDraftBindings through the service store (registry+catalog guards)', () => {
  let context: ReturnType<typeof makeService>;
  let service: DashboardServiceImpl;
  let store: ReturnType<DashboardServiceImpl['getStore']>;

  beforeEach(async () => {
    context = makeService();
    service = context.service;
    store = service.getStore();
    await service.load();
    store.getState().enterEdit('main', 'room-living');
  });

  it('a same-kind swap works and the atomic Save still accepts the draft', async () => {
    // w-temp (temperature) ↔ w-hum (humidity): both sensor-value.
    expect(store.getState().swapDraftBindings('w-temp', 'w-hum')).toBe(true);
    const draft = store.getState().draftWidgets!;
    expect(draft.find(w => w.id === 'w-temp')!.binding).toEqual({
      deviceId: 'sensor-hum-01',
      capability: 'humidity',
    });
    expect(draft.find(w => w.id === 'w-hum')!.binding).toEqual({
      deviceId: 'sensor-temp-01',
      capability: 'temperature',
    });
    // Uniqueness stays authoritative and SATISFIED → Save succeeds.
    const layouts = service.findTemplate('main')!.rooms.map(room => ({
      roomId: room.roomId,
      widgets: draft.filter(w => w.roomId === room.roomId),
    }));
    const result = await service.applyTemplateLayouts('main', layouts);
    expect(result.ok).toBe(true);
  });

  it('a kind-INCOMPATIBLE swap is rejected by the registry+catalog guard', () => {
    // w-temp (sensor-value) ↔ w-light (switch): the sensor cannot receive
    // a switch source — rejected BEFORE the draft mutates.
    const before = store.getState().draftWidgets;
    expect(store.getState().swapDraftBindings('w-temp', 'w-light')).toBe(false);
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('a cross-room swap is rejected by the room-scoped uniqueness class', async () => {
    // The seed already references room-bedroom (demo-three-rooms).
    // Give the bedroom reference a sensor widget so BOTH ids exist in the
    // draft (the rejection must come from the ROOM check, not the id
    // lookup).
    const bedroomSource = widget('w-bed-temp', 'room-bedroom', {
      binding: { deviceId: 'sensor-bedroom-1', capability: 'temperature' },
      layout: { x: 0, y: 0, width: 1, height: 1 },
    });
    await service.applyLayout('main', 'room-bedroom', [bedroomSource]);
    store.getState().enterEdit('main', 'room-living');
    const before = store.getState().draftWidgets;
    expect(store.getState().swapDraftBindings('w-temp', 'w-bed-temp')).toBe(
      false,
    );
    expect(store.getState().draftWidgets).toBe(before);
  });
});
