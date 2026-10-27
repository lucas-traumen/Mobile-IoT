/**
 * End-to-end regression for `dashboard-widget-resize-not-persisted`.
 *
 * User report: in the room dashboard editor, set a switch (Đèn) to 2x1,
 * save — the outside Dashboard view still renders it 1x1.
 *
 * This spec walks the REAL seams end to end (no unit shortcut):
 * 1. the draft resize the editor route performs
 *    (`hierarchyRoutes.onDraftResize` → `dashboardStore.resizeWidget`),
 * 2. the Save commit the route performs (the exact `saveDraft`
 *    room-regrouping → `DashboardServiceImpl.applyTemplateLayouts` with the
 *    real validation and a mocked repository),
 * 3. an app-restart reload from the same mocked repository (schema parse +
 *    every load-time migration, legacy normalization included),
 * 4. the view-model flow mapping the outside view renders
 *    (`smartFlowLayout` full-width row for the resized card).
 *
 * The seeded room is the exact demo seed shape (`seeds.ts`): an environment
 * band (2 sensor-value 1x1 side by side) + a devices band (3 switch 1x1:
 * Đèn, Quạt, Bơm).
 */

import { InMemoryEventBus } from '@core/eventbus';
import { createLogger } from '@core/logger';
import { ok, type Result } from '@core/errors';
import { FakeClock } from '@core/time';

import type { DashboardsFile } from './domain/dashboardSchema';
import { parseDashboardsFile } from './domain/dashboardSchema';
import { defaultDashboardsFile } from './domain/seeds';
import type {
  DashboardRepository,
  LoadedDashboardsFile,
} from './data/dashboardRepository';
import { createDefaultRegistry } from '@modules/widgets/api';
import type { WidgetConfig } from '@modules/widgets/api';
import type { CapabilityDef, Room } from '@modules/devices/api';
import { DashboardServiceImpl } from './services/dashboardService';
import { computeSmartViewMetrics, smartFlowLayout } from './domain/gridMetrics';
import { groupWidgets } from './domain/sectionGroups';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

/** Deterministic in-memory repository (mocked persistence seam). */
class FakeRepository implements DashboardRepository {
  stored: string | null = null;

  async load(): Promise<Result<LoadedDashboardsFile>> {
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
    this.stored = JSON.stringify(file);
    return ok(undefined);
  }
}

const CAPABILITIES: readonly CapabilityDef[] = [
  {
    type: 'switch',
    label: 'Công tắc',
    kind: 'switch',
    builtin: true,
  },
];

const ROOMS: readonly Room[] = [
  { id: 'room-living', name: 'Phòng khách', order: 0 },
  { id: 'room-bedroom', name: 'Phòng ngủ', order: 1 },
  { id: 'room-kitchen', name: 'Bếp', order: 2 },
];

/** Device-room resolver matching the seed bindings (all in Phòng khách). */
function seedDeviceRoom(deviceId: string): string | undefined {
  const living = [
    'sensor-temp-01',
    'sensor-hum-01',
    'relay-1',
    'relay-2',
    'relay-3',
  ];
  return living.includes(deviceId) ? 'room-living' : undefined;
}

function makeHarness(repository: FakeRepository): DashboardServiceImpl {
  const service = new DashboardServiceImpl({
    repository,
    registry: createDefaultRegistry(),
    bus: new InMemoryEventBus(createLogger('test')),
    logger: createLogger('test'),
    clock: new FakeClock(),
    roomExists: id => ROOMS.some(room => room.id === id),
    getRooms: () => ROOMS,
    getCapabilities: () => CAPABILITIES,
    getDeviceRoom: seedDeviceRoom,
  });
  return service;
}

describe('dashboard-widget-resize-not-persisted (end-to-end repro)', () => {
  it('resize Đèn to 2x1 → draft → save → reload → view rows keep width 2', async () => {
    // Seed + first session.
    const repository = new FakeRepository();
    const service = makeHarness(repository);
    await service.load();
    expect(service.findTemplate('main')).toBeDefined();

    // 1. The editor route seam: open the draft, resize w-light (Đèn).
    const store = service.getStore();
    store.getState().enterEdit('main', 'room-living');
    const resizeOk = store.getState().resizeWidget('w-light', '2x1');
    expect(resizeOk).toBe(true);
    const draft = store.getState().draftWidgets;
    expect(draft).not.toBeNull();
    const draftLight = draft!.find(w => w.id === 'w-light');
    expect(draftLight).toBeDefined();
    expect(draftLight!.layout.width).toBe(2);
    expect(draftLight!.layout.height).toBe(1);

    // 2. Save: the exact `saveDraft` regrouping → the atomic commit seam.
    const template = service.findTemplate('main')!;
    const layouts = template.rooms.map(room => ({
      roomId: room.roomId,
      widgets: draft!.filter(widget => widget.roomId === room.roomId),
    }));
    const saved = await service.applyTemplateLayouts('main', layouts);
    expect(saved.ok).toBe(true);

    // 3. Reload from the same mocked repository (app restart): schema parse
    //    + load migrations must keep the user's resized layout.
    const restarted = makeHarness(repository);
    await restarted.load();
    const persistedRoom = restarted
      .findTemplate('main')!
      .rooms.find(room => room.roomId === 'room-living');
    expect(persistedRoom).toBeDefined();
    const persistedLight = persistedRoom!.widgets.find(w => w.id === 'w-light');
    expect(persistedLight).toBeDefined();
    expect(persistedLight!.layout.width).toBe(2);
    expect(persistedLight!.layout.height).toBe(1);

    // 4. The outside view model: the devices section's flow rows must
    //    contain a full-width row for the resized card.
    const metrics = computeSmartViewMetrics(800, false);
    const sections = groupWidgets(persistedRoom!.widgets);
    const { rows } = smartFlowLayout(sections.devices, metrics);
    expect(rows.some(row => row.full === 'w-light')).toBe(true);
  });

  it('seeds the demo shape this regression models', () => {
    const file = defaultDashboardsFile();
    const living = file.templates[0]!.rooms.find(
      room => room.roomId === 'room-living',
    )!;
    const byId = new Map(living.widgets.map(w => [w.id, w]));
    expect(byId.get('w-light')!.layout).toEqual({
      x: 0,
      y: 1,
      width: 1,
      height: 1,
    });
    expect(byId.get('w-fan')!.layout).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
    expect(byId.get('w-pump')!.layout).toEqual({
      x: 0,
      y: 2,
      width: 1,
      height: 1,
    });
  });

  it('a saved user resize that re-creates the legacy coordinates is NOT rewritten on load', async () => {
    // The reachable user sequence this bug report came from: remove Bơm,
    // resize Quạt to 2x1 (the section relocation lands it on the EXACT
    // legacy fan coordinates {0,2,2,1}), resize Đèn to 2x1 (in place — the
    // EXACT legacy light coordinates {0,1,2,1}), save. The legacy-seed
    // normalization compared coordinates/bindings only, so it could not
    // distinguish this legitimate user layout from the untouched
    // pre-Template seed pair and rewrote BOTH cards back to 1x1 on the
    // next load — the user's saved resize silently disappeared.
    const file = defaultDashboardsFile();
    const template = file.templates[0]!;
    const living = template.rooms.find(room => room.roomId === 'room-living')!;
    const userResized: WidgetConfig[] = living.widgets
      .filter(widget => widget.id !== 'w-pump')
      .map(widget => {
        if (widget.id === 'w-light') {
          return {
            ...widget,
            layout: { x: 0, y: 1, width: 2 as const, height: 1 as const },
          };
        }
        if (widget.id === 'w-fan') {
          return {
            ...widget,
            layout: { x: 0, y: 2, width: 2 as const, height: 1 as const },
          };
        }
        return widget;
      });
    const stored: DashboardsFile = {
      ...file,
      templates: [
        {
          ...template,
          updatedAt: 1,
          rooms: template.rooms.map(room =>
            room.roomId === 'room-living'
              ? { ...room, widgets: userResized }
              : room,
          ),
        },
      ],
    };

    // Load the user-shaped persisted snapshot (a CURRENT Template-model
    // file — `migratedFromLegacy` false).
    const repository = new FakeRepository();
    repository.stored = JSON.stringify(stored);
    const service = makeHarness(repository);
    await service.load();

    const persistedRoom = service
      .findTemplate('main')!
      .rooms.find(room => room.roomId === 'room-living')!;
    expect(persistedRoom.widgets.find(w => w.id === 'w-light')!.layout).toEqual(
      { x: 0, y: 1, width: 2, height: 1 },
    );
    expect(persistedRoom.widgets.find(w => w.id === 'w-fan')!.layout).toEqual({
      x: 0,
      y: 2,
      width: 2,
      height: 1,
    });
    // The normalization must not fire on a current file at all: with the
    // user layout preserved and nothing else to migrate, the load persists
    // nothing (the stored snapshot stays byte-identical).
    expect(JSON.parse(repository.stored!)).toEqual(stored);
  });
});
