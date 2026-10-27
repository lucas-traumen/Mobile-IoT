/**
 * Dashboard service — owns the persisted Templates file (CRUD + widget
 * editing) behind one deep interface.
 *
 * Model 1A (approved): a Template is a presentation/layout profile over the
 * SAME physical smart home. Physical rooms are owned by the devices module;
 * Templates own ORDERED room references + per-reference widget layouts.
 * Duplicating a Template/room copies only ids/layouts — never physical
 * rooms, devices, MQTT topics or History identities.
 *
 * Every mutation:
 * 1. validates against the widget registry (`type` must exist, binding must
 *    satisfy `validateWidgetBinding` + the room-authoritative check, size
 *    must be supported),
 * 2. applies the pure layout engine (section-scoped placement via
 *    findSectionSlot / applyMove / applyResize / compactVertical),
 * 3. persists through the repository (one atomic save — nothing is applied
 *    on error),
 * 4. updates the mirror store + publishes `dashboards:changed { activeId }`,
 * 5. stamps the touched Template's `updatedAt` (Clock-injected) — the latest
 *    successful Template-owned mutation (metadata, membership/order or
 *    widget-layout save). Selection changes, shared physical-room renames
 *    and live MQTT readings never touch it.
 *
 * Load-time migrations (deterministic, idempotent, never over valid data):
 * - retired built-in widget types are removed across every Template room
 *   with the minimal migration-specific layout repair (custom/unknown
 *   widgets keep their exact coordinates),
 * - exact-duplicate approved placements are deduplicated (first wins),
 * - untouched legacy seed relay layouts are normalized (legacy-migrated
 *   files only — the condition cannot distinguish the seed pair from a
 *   user layout that re-created the same cells through the editor),
 * - a LEGACY (pre-Template) file — already structurally migrated by the
 *   schema layer — has its room references re-ordered by the devices
 *   registry order and its `updatedAt` stamped; the migrated snapshot is
 *   persisted once (a storage failure keeps the in-memory truth and the
 *   next load retries; the persisted file is only ever replaced, never
 *   reseeded),
 * - a Template with `updatedAt === 0` (first-run seed / migration) gets the
 *   real Clock timestamp.
 */

import type { EventBus } from '@core/eventbus';
import { err, Errors, ok, type Result } from '@core/errors';
import type { Logger } from '@core/logger';
import type { Clock } from '@core/time';

import type { CapabilityType, Room } from '@modules/devices/api';
import type {
  WidgetConfig,
  WidgetRegistry,
  WidgetSize,
} from '@modules/widgets/api';
import {
  effectiveCapabilities,
  validateWidgetBinding,
} from '@modules/widgets/api';
import { dedupeWidgets, duplicateWidgetError } from '@modules/widgets/api';
import type { CapabilityDef } from '@modules/devices/api';

import {
  MIGRATION_GLOBAL_ROOM_ID,
  type DashboardTemplate,
  type DashboardsFile,
  type TemplateRoom,
} from '../domain/dashboardSchema';
import {
  defaultDashboardsFile,
  normalizeLegacySeedLayouts,
} from '../domain/seeds';
import {
  collides,
  compactVertical,
  SIZE_DIMENSIONS,
  validateLayout,
  widgetsShareVisibleScope,
} from '../domain/layout';
import { repairLayoutAfterRemoval } from '../domain/migrationLayout';
import {
  findSectionSlot,
  sameRoomWidgets,
  spliceRoomWidgets,
} from '../domain/sectionPlacement';
import type { DashboardRepository } from '../data/dashboardRepository';
import type { DashboardStore } from '../ui/dashboardStore';
import { createDashboardStore } from '../ui/dashboardStore';

/** Input for adding a widget (id/layout are computed by the service). */
export interface AddWidgetInput {
  readonly type: string;
  readonly title?: string;
  /** Room the widget belongs to (the Template room reference — required). */
  readonly roomId?: string;
  readonly binding?: {
    readonly deviceId: string;
    readonly capability: CapabilityType;
  };
  /**
   * Requested grid size. Must be supported by the widget definition; when
   * omitted the definition's first supported size is used.
   */
  readonly size?: WidgetSize;
}

/**
 * Room existence check injected by the composition root (rooms are owned by
 * the devices module). When absent, roomId validation is skipped.
 */
export type RoomExists = (roomId: string) => boolean;

/**
 * Room list supplier injected by the composition root (devices module).
 * Provides the physical-room ORDER used to sort migrated room references.
 */
export type GetRooms = () => readonly Room[];

/**
 * Capability catalog supplier injected by the composition root (the catalog
 * is owned by the devices module). Lets binding validation accept
 * user-defined capabilities. When absent only the static
 * `supportedCapabilities` are accepted.
 */
export type GetCapabilities = () => readonly CapabilityDef[];

/**
 * Device-room resolver injected by the composition root: the room-scoped
 * binding authority needs to know which room a device belongs to
 * (`undefined` = device unknown, e.g. a lost binding). When absent the
 * cross-room rebind validation is skipped (legacy store consumers/tests).
 */
export type GetDeviceRoom = (deviceId: string) => string | undefined;

/**
 * Widget types retired from the registry. They can never be added again
 * (the registry no longer defines them) and are stripped from any persisted
 * file at load time — WITHOUT rendering as `UnsupportedWidget`.
 */
const RETIRED_WIDGET_TYPES: readonly string[] = [
  'connection',
  'history-chart',
  'room-device-list',
];

/**
 * Dashboard service — public operations over the persisted Templates file.
 */
export class DashboardServiceImpl {
  private readonly repository: DashboardRepository;
  private readonly registry: WidgetRegistry;
  private readonly bus: EventBus;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly roomExists?: RoomExists;
  private readonly getRooms?: GetRooms;
  private readonly getCapabilities?: GetCapabilities;
  private readonly getDeviceRoom?: GetDeviceRoom;
  private file: DashboardsFile;
  private readonly store: DashboardStore;
  private idCounter = 0;

  constructor(options: {
    repository: DashboardRepository;
    registry: WidgetRegistry;
    bus: EventBus;
    logger: Logger;
    /** Clock for deterministic `updatedAt` stamps (injected at the root). */
    clock: Clock;
    /** Optional room existence predicate (wired to the devices registry). */
    roomExists?: RoomExists;
    /** Optional room list (wired to the devices registry — migration order). */
    getRooms?: GetRooms;
    /** Optional capability catalog (wired to the devices registry). */
    getCapabilities?: GetCapabilities;
    /**
     * Optional device-room resolver (wired to the devices registry) —
     * powers the authoritative room-scoped binding validation.
     */
    getDeviceRoom?: GetDeviceRoom;
  }) {
    this.repository = options.repository;
    this.registry = options.registry;
    this.bus = options.bus;
    this.logger = options.logger;
    this.clock = options.clock;
    this.roomExists = options.roomExists;
    this.getRooms = options.getRooms;
    this.getCapabilities = options.getCapabilities;
    this.getDeviceRoom = options.getDeviceRoom;
    this.file = defaultDashboardsFile();
    this.store = createDashboardStore(this.file, {
      canRebindToRoom: this.canRebindToRoom,
      canAcceptBinding: this.canAcceptBinding,
    });
  }

  /**
   * Authoritative room-scoped binding check: a room-scoped widget may only
   * bind a device that belongs to the SAME physical room (the binding source
   * must belong to the target physical room). Devices with an unknown room
   * (lost binding) are allowed — that is exactly the state the rebind picker
   * repairs. The UI filters candidates; the store draft guard no-ops
   * cross-room rebinds; THIS is the persist-time authority.
   */
  private canRebindToRoom = (
    widgetRoomId: string | null | undefined,
    deviceId: string,
  ): boolean => {
    if (!widgetRoomId || !this.getDeviceRoom) {
      return true;
    }
    const deviceRoom = this.getDeviceRoom(deviceId);
    // Unknown device → the lost-binding state; allow (capability/binding
    // rules still apply, and the repair picker lists existing devices only).
    if (!deviceRoom) {
      return true;
    }
    return deviceRoom === widgetRoomId;
  };

  /**
   * Binding-kind compatibility for the draft swap seam (fix cycle 7 G): a
   * widget of `widgetType` may only RECEIVE a binding whose capability its
   * registry definition accepts (built-in `supportedCapabilities` ∪
   * catalog-kind projections). Unknown custom types are NOT swap-capable —
   * they have no registry rules to validate the received binding against.
   * The swap never bypasses binding validation; the atomic Save
   * re-validates everything anyway.
   */
  private canAcceptBinding = (
    widgetType: string,
    capability: string,
  ): boolean => {
    const def = this.registry.get(widgetType);
    if (!def) {
      return false;
    }
    return effectiveCapabilities(def, this.catalog()).includes(
      capability as CapabilityType,
    );
  };

  /** The capability catalog for binding validation (empty when not wired). */
  private catalog(): readonly CapabilityDef[] {
    return this.getCapabilities ? this.getCapabilities() : [];
  }

  /** Current Clock timestamp (epoch millis). */
  private now(): number {
    return this.clock.nowMillis();
  }

  /** Copy of a Template with a fresh `updatedAt` (a Template-owned mutation). */
  private touch(template: DashboardTemplate): DashboardTemplate {
    return { ...template, updatedAt: this.now() };
  }

  /**
   * Which survivor types the LOAD MIGRATION may relocate: registered
   * built-ins only. Unknown/custom widget types are pinned — their
   * coordinates/title/binding/config survive migration EXACTLY.
   */
  private readonly isRegisteredWidget = (widget: WidgetConfig): boolean =>
    this.registry.get(widget.type) !== undefined;

  /** The zustand store mirrored to the UI (subscribe for re-renders). */
  getStore(): DashboardStore {
    return this.store;
  }

  /**
   * Load the persisted file (seeds defaults on first run).
   *
   * Runs the deterministic, idempotent migrations documented on the class
   * (retired types → exact-duplicate dedupe → legacy seed normalization →
   * registry-order references + sentinel retargeting for migrated legacy
   * files → `updatedAt` stamps). When ANYTHING changed — seed, migration
   * cleanup, legacy finalization or stamping — the migrated snapshot is
   * persisted EXACTLY ONCE (changed-detection by reference inequality);
   * a storage failure never crashes the load — the migrated file still
   * drives the UI, the failure is logged, and the next `load()` retries
   * the rewrite. Loading an already-migrated file persists nothing
   * (idempotent: second load = no write).
   */
  async load(): Promise<Result<void>> {
    const result = await this.repository.load();
    if (!result.ok) {
      return result;
    }
    let changed = result.value.kind === 'seed';
    let loaded: DashboardsFile;
    if (result.value.kind === 'seed') {
      loaded = defaultDashboardsFile();
    } else {
      loaded = this.migrateLoadedFile(
        result.value.file,
        result.value.migratedFromLegacy,
      );
      // Reference inequality = the migration actually changed the snapshot
      // (migrateLoadedFile returns the SAME reference when nothing changed),
      // so in-memory cleanups write through exactly once and a second load
      // of the persisted result is a no-op.
      changed = loaded !== result.value.file;
    }
    // Stamp Templates whose `updatedAt` is still 0 (first-run seed or
    // migration) with the real Clock time — a Template-owned creation event.
    let stamped = false;
    loaded = {
      ...loaded,
      templates: loaded.templates.map(template => {
        if (template.updatedAt !== 0) {
          return template;
        }
        stamped = true;
        return { ...template, updatedAt: this.now() };
      }),
    };
    changed = changed || stamped;
    if (changed) {
      const saved = await this.repository.save(loaded);
      if (!saved.ok) {
        this.logger.warn(
          'Dashboards: seeded/migrated snapshot could not be persisted; keeping it in memory (will retry on next load)',
          saved.error,
        );
      }
    }
    this.file = loaded;
    this.store.getState().setFile(this.file);
    this.alignIdCounter();
    this.logger.info(
      `Dashboards: loaded ${this.file.templates.length} templates (active "${this.file.activeId}")`,
    );
    return ok(undefined);
  }

  /**
   * Content-level migrations for a loaded file: retired-type removal, exact
   * duplicate removal and legacy seed normalization — applied PER ROOM
   * REFERENCE (uniqueness and layouts are room-scoped in the Template
   * model). Then, for a legacy-migrated file, room references are
   * re-ordered by the devices registry order (known rooms first, unknown
   * rooms keep their migrated order at the end), the
   * {@link MIGRATION_GLOBAL_ROOM_ID} sentinel is finalized against the
   * registry (see {@link finalizeLegacyRooms}) and the legacy shared active
   * room selection is retained as an empty reference when the active
   * Template has no widgets for it.
   */
  private migrateLoadedFile(
    file: DashboardsFile,
    migratedFromLegacy: boolean,
  ): DashboardsFile {
    // Reference-equality change detection (same pattern as the cascade
    // mutations): `.map()` always builds new arrays, so "unchanged" is
    // tracked per room/template with flags, never by array identity.
    let contentChanged = false;
    const cleaned: DashboardTemplate[] = file.templates.map(template => {
      let templateChanged = false;
      const rooms = template.rooms.map(room => {
        let widgets: readonly WidgetConfig[] = room.widgets;
        // Retired built-ins (deterministic, minimal repair, custom widgets
        // pinned).
        const retired = widgets.filter(w =>
          RETIRED_WIDGET_TYPES.includes(w.type),
        );
        if (retired.length > 0) {
          widgets = repairLayoutAfterRemoval(
            widgets.filter(w => !RETIRED_WIDGET_TYPES.includes(w.type)),
            retired,
            this.isRegisteredWidget,
          );
        }
        // Exact-duplicate approved placements (first occurrence wins, same
        // migration-specific repair as before).
        const deduped = dedupeWidgets(widgets);
        if (deduped !== widgets) {
          const removed = widgets.filter(w => !deduped.includes(w));
          widgets = repairLayoutAfterRemoval(
            deduped,
            removed,
            this.isRegisteredWidget,
          );
        }
        // Untouched legacy seed relay arrangement → side-by-side. LEGACY-
        // MIGRATED FILES ONLY (`migratedFromLegacy`): the stacked relay
        // arrangement can only enter persistence through the pre-Template
        // seed, and the "untouched" condition compares coordinates and
        // bindings only — it cannot distinguish that seed pair from a user
        // layout that legitimately re-created the exact same cells through
        // supported editor operations (remove Bơm → resize Quạt to 2x1 —
        // the relocation lands on the legacy fan cell → resize Đèn to 2x1
        // in place). Running the rewrite on EVERY load destroyed exactly
        // such a saved resize on the next load
        // (dashboard-widget-resize-not-persisted). The repository flag is
        // true exactly when the parsed snapshot came from the legacy shape
        // — the only situation this migration exists for (a storage-failure
        // retry re-parses the same legacy snapshot and re-runs it; the
        // normalized result persisted once never re-matches afterwards).
        if (migratedFromLegacy) {
          widgets = normalizeLegacySeedLayouts(widgets);
        }
        if (widgets === room.widgets) {
          return room;
        }
        templateChanged = true;
        return { ...room, widgets: [...widgets] };
      });
      if (!templateChanged) {
        return template;
      }
      contentChanged = true;
      return { ...template, rooms };
    });
    // Sentinel finalization is registry-aware and self-healing: it runs for
    // EVERY load (a sentinel can only be resolved once a physical room
    // exists), persists once via the load changed-detection, and is a no-op
    // afterwards.
    const finalized: DashboardsFile = contentChanged
      ? { ...file, templates: cleaned }
      : file;
    const sentinelRetargeted = this.retargetMigrationSentinel(finalized);
    if (!migratedFromLegacy) {
      return sentinelRetargeted;
    }
    const reordered: DashboardTemplate[] = sentinelRetargeted.templates.map(
      template => {
        // The retained legacy active room is added FIRST, then the WHOLE
        // reference set is re-ordered by the devices registry and
        // re-indexed — the empty reference lands at its REGISTRY position
        // among the widget-bearing rooms (appending it at the end produced
        // a non-registry order when the old active room sorts earlier).
        const withActiveRoom =
          template.id === file.activeId
            ? this.retainLegacyActiveRoom(template.rooms, file.activeRoomId)
            : template.rooms;
        return {
          ...template,
          rooms: this.reindexRooms(
            this.sortRoomsByRegistryOrder(withActiveRoom),
          ),
        };
      },
    );
    return { ...sentinelRetargeted, templates: reordered };
  }

  /**
   * Replace the structural-migration sentinel room reference
   * ({@link MIGRATION_GLOBAL_ROOM_ID}) with the FIRST registry room when
   * one exists — the pure schema migration cannot know the registry, so
   * this registry-aware finalization keeps migrated widgets VISIBLE and
   * correctly room-scoped. When the Template already references the target
   * room the sentinel widgets MERGE into it (appended last, adopting the
   * host roomId so the mirror invariant holds). When NO physical room
   * exists at all the sentinel reference is KEPT so no widget placement is
   * ever dropped (documented edge: the widgets stay in the Template and
   * become reachable as soon as the retarget can run against a non-empty
   * registry). Returns the SAME file reference when nothing changed.
   */
  private retargetMigrationSentinel(file: DashboardsFile): DashboardsFile {
    const firstRoom = this.getRooms
      ? [...this.getRooms()].sort((a, b) => a.order - b.order)[0]
      : undefined;
    let changed = false;
    const templates = file.templates.map(template => {
      const sentinel = template.rooms.find(
        room => room.roomId === MIGRATION_GLOBAL_ROOM_ID,
      );
      if (!sentinel) {
        return template;
      }
      if (!firstRoom) {
        return template;
      }
      changed = true;
      const adopted = sentinel.widgets.map(widget => ({
        ...widget,
        roomId: firstRoom.id,
      }));
      const host = template.rooms.find(room => room.roomId === firstRoom.id);
      if (host) {
        // Merge: the sentinel widgets join the existing reference (last).
        return {
          ...template,
          rooms: this.reindexRooms(
            template.rooms
              .filter(room => room.roomId !== MIGRATION_GLOBAL_ROOM_ID)
              .map(room =>
                room.roomId === firstRoom.id
                  ? { ...room, widgets: [...room.widgets, ...adopted] }
                  : room,
              ),
          ),
        };
      }
      return {
        ...template,
        rooms: this.reindexRooms(
          template.rooms.map(room =>
            room.roomId === MIGRATION_GLOBAL_ROOM_ID
              ? { ...room, roomId: firstRoom.id, widgets: adopted }
              : room,
          ),
        ),
      };
    });
    return changed ? { ...file, templates } : file;
  }

  /**
   * Legacy active-selection retention: the OLD shared active room that had
   * NO widgets still becomes an EMPTY room reference of the active Template
   * (the old Dashboard view selected it — the migrated Template must keep
   * showing it). The caller re-orders the WHOLE reference set by the
   * devices registry afterwards, so the retained room lands at its registry
   * position (never unconditionally last). Only real registry rooms are
   * retained; `null`/unknown selections are ignored. Returns the input
   * array unchanged when nothing applies.
   */
  private retainLegacyActiveRoom(
    rooms: readonly TemplateRoom[],
    activeRoomId: string | null,
  ): TemplateRoom[] {
    if (!activeRoomId || !this.roomExists?.(activeRoomId)) {
      return [...rooms];
    }
    if (rooms.some(room => room.roomId === activeRoomId)) {
      return [...rooms];
    }
    return [
      ...rooms,
      {
        roomId: activeRoomId,
        order: rooms.length,
        widgets: [],
      },
    ];
  }

  /**
   * Sort room references: rooms known to the devices registry come first in
   * REGISTRY ORDER; unknown rooms (no registry record) keep their current
   * relative order afterwards. Deterministic + total (never drops a
   * reference).
   */
  private sortRoomsByRegistryOrder(
    rooms: readonly TemplateRoom[],
  ): TemplateRoom[] {
    if (!this.getRooms || rooms.length <= 1) {
      return [...rooms];
    }
    const registryOrder = new Map<string, number>();
    [...this.getRooms()]
      .sort((a, b) => a.order - b.order)
      .forEach((room, index) => registryOrder.set(room.id, index));
    return [...rooms].sort((a, b) => {
      const rankA = registryOrder.get(a.roomId);
      const rankB = registryOrder.get(b.roomId);
      if (rankA !== undefined && rankB !== undefined) {
        return rankA - rankB;
      }
      if (rankA !== undefined) {
        return -1;
      }
      if (rankB !== undefined) {
        return 1;
      }
      return 0;
    });
  }

  /** Re-index the `order` field of a template's room references 0..n-1. */
  private reindexRooms(rooms: readonly TemplateRoom[]): TemplateRoom[] {
    return rooms.map((room, index) =>
      room.order === index ? room : { ...room, order: index },
    );
  }

  /** Align the id counter with persisted ids (widgets + templates). */
  private alignIdCounter(): void {
    let max = 0;
    const scan = (id: string): void => {
      for (const prefix of ['w', 'tpl'] as const) {
        const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
        if (match) {
          max = Math.max(max, Number(match[1]));
        }
      }
    };
    for (const template of this.file.templates) {
      scan(template.id);
      for (const room of template.rooms) {
        for (const widget of room.widgets) {
          scan(widget.id);
        }
      }
    }
    this.idCounter = max;
  }

  /** All Templates. */
  getTemplates(): readonly DashboardTemplate[] {
    return this.file.templates;
  }

  /** The active Template id. */
  getActiveTemplateId(): string {
    return this.file.activeId;
  }

  /**
   * The active Template — deterministically the first one when the active
   * id is inconsistent (never `undefined`; the last Template is protected).
   */
  getActiveTemplate(): DashboardTemplate {
    return (
      this.file.templates.find(t => t.id === this.file.activeId) ??
      this.file.templates[0]
    );
  }

  /** Find a Template by id (`undefined` when unknown). */
  findTemplate(id: string): DashboardTemplate | undefined {
    return this.file.templates.find(t => t.id === id);
  }

  /** The History compatibility room selection (`null` = none). */
  getActiveRoomId(): string | null {
    return this.file.activeRoomId ?? null;
  }

  /**
   * Set the History compatibility room selection (`null` = none). Non-null
   * ids must exist in the devices registry (injected predicate). This is a
   * file-level selection change — no Template `updatedAt` is touched.
   */
  async setActiveRoom(id: string | null): Promise<Result<void>> {
    if (id !== null && this.roomExists && !this.roomExists(id)) {
      return err(Errors.notFound(`Room "${id}" does not exist`));
    }
    if ((this.file.activeRoomId ?? null) === id) {
      return ok(undefined);
    }
    return this.commit({ ...this.file, activeRoomId: id });
  }

  /**
   * Create a Template (id generated) with zero room references; it becomes
   * the active Template. Returns the created Template so the UI can open
   * its room list after persistence succeeds.
   */
  async createTemplate(name: string): Promise<Result<DashboardTemplate>> {
    if (name.trim().length === 0) {
      return err(Errors.validation('Template name is required'));
    }
    const template: DashboardTemplate = {
      id: this.nextId('tpl'),
      name: name.trim(),
      updatedAt: this.now(),
      rooms: [],
    };
    const next: DashboardsFile = {
      ...this.file,
      templates: [...this.file.templates, template],
      activeId: template.id,
    };
    const committed = await this.commit(next);
    return committed.ok ? ok(template) : committed;
  }

  /** Rename a Template (display name only). */
  async renameTemplate(id: string, name: string): Promise<Result<void>> {
    if (name.trim().length === 0) {
      return err(Errors.validation('Template name is required'));
    }
    if (!this.findTemplate(id)) {
      return err(Errors.notFound(`Template "${id}" does not exist`));
    }
    return this.commit(
      this.withTemplate(id, template =>
        this.touch({ ...template, name: name.trim() }),
      ),
    );
  }

  /**
   * Duplicate a Template: deep-copies ordered room references and per-room
   * widget layouts with a fresh Template id and FRESH widget ids. Physical
   * rooms, devices, MQTT topics and History identities are only referenced,
   * never cloned. Selection is unchanged. The copy gets its own `updatedAt`.
   */
  async duplicateTemplate(id: string): Promise<Result<DashboardTemplate>> {
    const source = this.findTemplate(id);
    if (!source) {
      return err(Errors.notFound(`Template "${id}" does not exist`));
    }
    const copy: DashboardTemplate = {
      id: this.nextId('tpl'),
      name: `${source.name} (bản sao)`,
      updatedAt: this.now(),
      rooms: source.rooms.map(room => ({
        ...room,
        widgets: room.widgets.map(widget => ({
          ...widget,
          id: this.nextId('w'),
        })),
      })),
    };
    const next: DashboardsFile = {
      ...this.file,
      templates: [...this.file.templates, copy],
    };
    const committed = await this.commit(next);
    return committed.ok ? ok(copy) : committed;
  }

  /**
   * Delete a Template.
   *
   * The last Template is protected (the Dashboard always has a valid root
   * object). Deleting the active Template re-points the selection
   * deterministically to the first remaining Template.
   */
  async deleteTemplate(id: string): Promise<Result<void>> {
    if (!this.file.templates.some(t => t.id === id)) {
      return err(Errors.notFound(`Template "${id}" does not exist`));
    }
    if (this.file.templates.length === 1) {
      return err(Errors.validation('Cannot delete the last template'));
    }
    const remaining = this.file.templates.filter(t => t.id !== id);
    const wasActive = this.file.activeId === id;
    const next: DashboardsFile = {
      ...this.file,
      templates: remaining,
      activeId: wasActive ? remaining[0]!.id : this.file.activeId,
    };
    return this.commit(next);
  }

  /** Set the active Template (must exist). No `updatedAt` is touched. */
  async setActiveTemplate(id: string): Promise<Result<void>> {
    if (!this.file.templates.some(t => t.id === id)) {
      return err(Errors.notFound(`Template "${id}" does not exist`));
    }
    if (this.file.activeId === id) {
      return ok(undefined);
    }
    return this.commit({ ...this.file, activeId: id });
  }

  /**
   * Add a physical-room reference to a Template. The Template may reference
   * a physical room at most once (existing membership is rejected, never
   * silently merged); the room must exist in the devices registry. The new
   * reference starts with an empty widget layout at the end of the order.
   */
  async addRoomReference(
    templateId: string,
    roomId: string,
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    if (this.roomExists && !this.roomExists(roomId)) {
      return err(Errors.notFound(`Room "${roomId}" does not exist`));
    }
    if (template.rooms.some(room => room.roomId === roomId)) {
      return err(
        Errors.validation(
          `Template "${templateId}" already references room "${roomId}"`,
        ),
      );
    }
    return this.commit(
      this.withTemplate(templateId, template =>
        this.touch({
          ...template,
          rooms: [
            ...template.rooms,
            { roomId, order: template.rooms.length, widgets: [] },
          ],
        }),
      ),
    );
  }

  /**
   * Remove a room REFERENCE (and its widget layout) from one Template. The
   * physical room, its devices, MQTT state and Influx history survive
   * unchanged — destructive physical-room management remains in Settings.
   */
  async removeRoomReference(
    templateId: string,
    roomId: string,
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    if (!template.rooms.some(room => room.roomId === roomId)) {
      return err(
        Errors.notFound(
          `Template "${templateId}" does not reference room "${roomId}"`,
        ),
      );
    }
    return this.commit(
      this.withTemplate(templateId, template =>
        this.touch({
          ...template,
          rooms: this.reindexRooms(
            template.rooms.filter(room => room.roomId !== roomId),
          ),
        }),
      ),
    );
  }

  /**
   * Reorder the room references of ONE Template. `orderedRoomIds` must be a
   * permutation of the currently referenced rooms (same set, no
   * duplicates) — any other input is rejected without mutating anything.
   */
  async reorderRoomReferences(
    templateId: string,
    orderedRoomIds: readonly string[],
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    const current = template.rooms.map(room => room.roomId);
    const sameSet =
      orderedRoomIds.length === current.length &&
      new Set(orderedRoomIds).size === orderedRoomIds.length &&
      orderedRoomIds.every(id => current.includes(id));
    if (!sameSet) {
      return err(
        Errors.validation(
          'Reorder input must be a permutation of the referenced rooms',
        ),
      );
    }
    if (orderedRoomIds.every((id, index) => id === current[index])) {
      return ok(undefined);
    }
    const byRoom = new Map(template.rooms.map(room => [room.roomId, room]));
    const rooms = this.reindexRooms(
      orderedRoomIds.map(roomId => byRoom.get(roomId)!),
    );
    return this.commit(
      this.withTemplate(templateId, template =>
        this.touch({ ...template, rooms }),
      ),
    );
  }

  /**
   * Duplicate a room reference (with its widget layout, FRESH widget ids)
   * into a DIFFERENT Template. The physical room, its devices and protocol
   * identities are only referenced, never cloned. The target Template must
   * not already reference the room (membership stays unique).
   */
  async duplicateRoomReference(
    templateId: string,
    roomId: string,
    targetTemplateId: string,
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    const target = this.findTemplate(targetTemplateId);
    if (!target) {
      return err(
        Errors.notFound(`Template "${targetTemplateId}" does not exist`),
      );
    }
    if (targetTemplateId === templateId) {
      return err(
        Errors.validation('Choose a different Template to duplicate into'),
      );
    }
    const sourceRoom = template.rooms.find(room => room.roomId === roomId);
    if (!sourceRoom) {
      return err(
        Errors.notFound(
          `Template "${templateId}" does not reference room "${roomId}"`,
        ),
      );
    }
    if (target.rooms.some(room => room.roomId === roomId)) {
      return err(
        Errors.validation(
          `Template "${targetTemplateId}" already references room "${roomId}"`,
        ),
      );
    }
    const copy: TemplateRoom = {
      roomId,
      order: target.rooms.length,
      widgets: sourceRoom.widgets.map(widget => ({
        ...widget,
        id: this.nextId('w'),
      })),
    };
    return this.commit(
      this.withTemplate(targetTemplateId, target =>
        this.touch({
          ...target,
          rooms: [...target.rooms, copy],
        }),
      ),
    );
  }

  /**
   * Add a widget to one Template-room layout.
   *
   * The widget type must be registered, its binding must satisfy the
   * definition rules AND the room-authoritative check (the binding source
   * must belong to the room), and its size must be supported. The first
   * supported size is placed at the first free cell of the widget's OWN
   * dashboard section (section-scoped band re-pack: the other section's
   * same-room widgets shift their ABSOLUTE rows so the placement is
   * collision-free, while every widget's visible section-local row stays
   * unchanged). A `validateLayout` guard runs on the resulting room list
   * before ANY write (AD7) — a bad remap fails loudly, never persists.
   *
   * While the matching draft edit is open (same Template + room), the widget
   * is added to the draft instead of the persisted layout (slot computed
   * against the draft, room-scoped: other rooms' draft widgets stay
   * byte-identical); it becomes durable only when the draft is committed
   * via {@link applyLayout}.
   */
  async addWidget(
    templateId: string,
    roomId: string,
    input: AddWidgetInput,
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    const room = template.rooms.find(r => r.roomId === roomId);
    if (!room) {
      return err(
        Errors.notFound(
          `Template "${templateId}" does not reference room "${roomId}"`,
        ),
      );
    }
    if (
      input.roomId !== undefined &&
      this.roomExists &&
      !this.roomExists(input.roomId)
    ) {
      return err(Errors.notFound(`Room "${input.roomId}" does not exist`));
    }
    const def = this.registry.get(input.type);
    if (!def) {
      return err(Errors.validation(`Unknown widget type "${input.type}"`));
    }
    if (def.supportedSizes.length === 0) {
      return err(
        Errors.validation(`Widget type "${input.type}" has no supported sizes`),
      );
    }
    // Honor the user-selected size; reject unsupported requests.
    let size = def.supportedSizes[0];
    if (input.size !== undefined) {
      if (!def.supportedSizes.includes(input.size)) {
        return err(
          Errors.validation(
            `Size "${input.size}" is not supported by widget type "${input.type}"`,
          ),
        );
      }
      size = input.size;
    }
    const sizeDims = SIZE_DIMENSIONS[size];
    // Draft mode: place against the working copy, not the persisted layout.
    const state = this.store.getState();
    const draftActive =
      state.editMode &&
      state.editorTemplateId === templateId &&
      state.editorRoomId === roomId;
    const draft = draftActive ? state.draftWidgets : null;
    const base = draft ?? room.widgets;
    // Section-scoped placement (band re-pack): the slot is computed on
    // THIS room's widgets only (AD6 — `sameRoomWidgets` is the structural
    // roomId filter), and the other section's same-room band shifts as
    // needed so the widget lands at its own section's first free cell.
    const placement = findSectionSlot(
      sameRoomWidgets(roomId, base),
      input.type,
      sizeDims.width,
      sizeDims.height,
    );
    if (placement === null) {
      return err(Errors.validation('No free space on this dashboard'));
    }
    const widget: WidgetConfig = {
      id: this.nextId('w'),
      type: input.type,
      title: input.title as string | undefined,
      roomId,
      binding: input.binding ? { ...input.binding } : undefined,
      layout: { x: placement.slot.x, y: placement.slot.y, ...sizeDims },
    };
    const bindingResult = validateWidgetBinding(def, widget, this.catalog());
    if (!bindingResult.ok) {
      return err(Errors.validation(bindingResult.error));
    }
    const roomError = this.bindingRoomError(widget);
    if (!roomError.ok) {
      return err(Errors.validation(roomError.error));
    }
    // Approved uniqueness invariant: within the room, a sensor-value
    // binding or a switch binding appears at most once — checked against
    // the working list.
    const duplicateError = duplicateWidgetError(base, widget);
    if (duplicateError !== null) {
      return err(Errors.validation(duplicateError));
    }
    // AD7 pre-write invariant: the resulting room widget list (band-remapped
    // + the new widget) must be a valid layout before ANY write — draft or
    // commit. A corrupt remap returns a truthful error, never a write.
    const nextRoomWidgets: readonly WidgetConfig[] = [
      ...placement.widgets,
      widget,
    ];
    const validity = validateLayout(nextRoomWidgets);
    if (!validity.ok) {
      return err(Errors.validation(validity.error));
    }
    if (draft) {
      // ONE atomic draft update: the room's band-remapped slice + the new
      // widget replace the room's slice in place — other rooms' widgets
      // and their relative order are untouched (AD6).
      state.setDraftWidgets(spliceRoomWidgets(draft, roomId, nextRoomWidgets));
      return ok(undefined);
    }
    return this.commit(
      this.withTemplate(templateId, template =>
        this.touch({
          ...template,
          rooms: template.rooms.map(r =>
            r.roomId === roomId ? { ...r, widgets: [...nextRoomWidgets] } : r,
          ),
        }),
      ),
    );
  }

  /**
   * Validate one room's widget set against the registry and the approved
   * invariants (binding rules, room-authoritative binding, supported size,
   * per-room uniqueness, layout validity). Unknown custom types are pinned
   * (registry rules cannot apply; room/uniqueness/layout checks still hold).
   * Returns `ok` or the first validation error.
   */
  private validateRoomWidgets(
    roomId: string,
    widgets: readonly WidgetConfig[],
  ): Result<void> {
    for (const widget of widgets) {
      const def = this.registry.get(widget.type);
      if (!def) {
        // Unknown custom widget type: pinned and preserved (acceptance
        // criterion — custom types survive parse/load/save/draft). Registry
        // binding/size rules cannot apply to an undefined definition; the
        // room/uniqueness/layout checks below still hold.
        if (widget.roomId !== roomId) {
          return err(
            Errors.validation(
              `Widget "${widget.id}" does not belong to room "${roomId}"`,
            ),
          );
        }
        continue;
      }
      const bindingResult = validateWidgetBinding(def, widget, this.catalog());
      if (!bindingResult.ok) {
        return err(Errors.validation(bindingResult.error));
      }
      const roomError = this.bindingRoomError(widget);
      if (!roomError.ok) {
        return err(Errors.validation(roomError.error));
      }
      const size = `${widget.layout.width}x${widget.layout.height}`;
      if (!def.supportedSizes.includes(size as WidgetSize)) {
        return err(
          Errors.validation(
            `Size "${size}" is not supported by widget type "${widget.type}"`,
          ),
        );
      }
      if (widget.roomId !== roomId) {
        return err(
          Errors.validation(
            `Widget "${widget.id}" does not belong to room "${roomId}"`,
          ),
        );
      }
    }
    // Approved uniqueness invariant (authoritative even when the UI fails):
    // the incoming layout may not introduce exact duplicates.
    for (let i = 0; i < widgets.length; i++) {
      const duplicateError = duplicateWidgetError(
        widgets.slice(0, i),
        widgets[i]!,
      );
      if (duplicateError !== null) {
        return err(Errors.validation(duplicateError));
      }
    }
    const validity = validateLayout(widgets);
    if (!validity.ok) {
      return err(Errors.validation(validity.error));
    }
    return ok(undefined);
  }

  /**
   * Replace ONE Template-room layout atomically (draft edit commit).
   *
   * Validates every widget against the registry (type known, binding rules,
   * room-authoritative binding, size supported), checks the approved
   * uniqueness invariant, validates the whole room layout (unique ids,
   * bounds, no overlaps), then persists + publishes. Other room references
   * and other Templates are untouched (byte-equivalent). Nothing is applied
   * on any error.
   */
  async applyLayout(
    templateId: string,
    roomId: string,
    widgets: readonly WidgetConfig[],
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    if (!template.rooms.some(room => room.roomId === roomId)) {
      return err(
        Errors.notFound(
          `Template "${templateId}" does not reference room "${roomId}"`,
        ),
      );
    }
    const valid = this.validateRoomWidgets(roomId, widgets);
    if (!valid.ok) {
      return valid;
    }
    return this.commit(
      this.withTemplate(templateId, template =>
        this.touch({
          ...template,
          rooms: template.rooms.map(room =>
            room.roomId === roomId ? { ...room, widgets: [...widgets] } : room,
          ),
        }),
      ),
    );
  }

  /**
   * Replace SEVERAL Template-room layouts in ONE atomic commit (the draft
   * editor's commit seam for cross-room draft operations: a draft move/
   * duplicate changes the source AND the destination room, so the whole
   * draft end-state persists together — both rooms apply or NEITHER does).
   *
   * Every listed room must be a reference of the Template (each at most
   * once) and its widget set passes the same validation as
   * {@link applyLayout}. Unlisted room references keep their persisted
   * layouts. One `updatedAt` touch, one repository save, one publish.
   */
  async applyTemplateLayouts(
    templateId: string,
    layouts: readonly {
      readonly roomId: string;
      readonly widgets: readonly WidgetConfig[];
    }[],
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    const roomIds = new Set<string>();
    for (const layout of layouts) {
      if (roomIds.has(layout.roomId)) {
        return err(
          Errors.validation(
            `Room "${layout.roomId}" appears more than once in the draft`,
          ),
        );
      }
      roomIds.add(layout.roomId);
      if (!template.rooms.some(room => room.roomId === layout.roomId)) {
        return err(
          Errors.notFound(
            `Template "${templateId}" does not reference room "${layout.roomId}"`,
          ),
        );
      }
      const valid = this.validateRoomWidgets(layout.roomId, layout.widgets);
      if (!valid.ok) {
        return valid;
      }
    }
    return this.commit(
      this.withTemplate(templateId, current =>
        this.touch({
          ...current,
          rooms: current.rooms.map(room => {
            const layout = layouts.find(item => item.roomId === room.roomId);
            return layout ? { ...room, widgets: [...layout.widgets] } : room;
          }),
        }),
      ),
    );
  }

  /**
   * Duplicate a widget (FRESH id) from one room reference into a DIFFERENT
   * room reference of the SAME Template. The binding source must belong to
   * the TARGET physical room and the placement must not duplicate an
   * existing one there. Failure is atomic — neither room is touched.
   *
   * The copy lands at its OWN dashboard section's first free cell of the
   * target room (section-scoped band re-pack, ADR-019 follow-up) — never
   * below the other section's band or visually-empty cells.
   *
   * DRAFT-AWARE: while a draft edit of this Template is open the operation
   * is validated against and applied to the WORKING COPY (source removal /
   * destination add live only in the draft) — nothing persists until the
   * draft commit ({@link applyTemplateLayouts}); `Hủy` discards both sides.
   */
  async duplicateWidgetToRoom(
    templateId: string,
    sourceRoomId: string,
    widgetId: string,
    targetRoomId: string,
  ): Promise<Result<void>> {
    return this.copyWidgetAcrossRooms(
      templateId,
      sourceRoomId,
      widgetId,
      targetRoomId,
      true,
    );
  }

  /**
   * Move a widget from one room reference to a DIFFERENT room reference of
   * the SAME Template. The binding source must belong to the TARGET
   * physical room; the destination placement must validate BEFORE the
   * source placement is removed — both changes commit atomically or not at
   * all.
   *
   * The moved widget lands at its OWN dashboard section's first free cell
   * of the target room (section-scoped band re-pack, ADR-019 follow-up) —
   * never below the other section's band or visually-empty cells.
   *
   * DRAFT-AWARE (see {@link duplicateWidgetToRoom}): with a matching draft
   * open, the source removal + destination add happen ONLY in the draft —
   * a later `Hủy` discards them, `Lưu` persists both rooms in ONE atomic
   * commit.
   */
  async moveWidgetToRoom(
    templateId: string,
    sourceRoomId: string,
    widgetId: string,
    targetRoomId: string,
  ): Promise<Result<void>> {
    return this.copyWidgetAcrossRooms(
      templateId,
      sourceRoomId,
      widgetId,
      targetRoomId,
      false,
    );
  }

  /**
   * Shared implementation of duplicate-to-room / move-to-room. The TARGET
   * placement is section-scoped (ADR-019 follow-up): the widget lands in
   * its own dashboard section of the target room (band re-pack), and the
   * full resulting list is validated before ANY draft/commit write.
   */
  private async copyWidgetAcrossRooms(
    templateId: string,
    sourceRoomId: string,
    widgetId: string,
    targetRoomId: string,
    freshId: boolean,
  ): Promise<Result<void>> {
    const template = this.findTemplate(templateId);
    if (!template) {
      return err(Errors.notFound(`Template "${templateId}" does not exist`));
    }
    const sourceRoom = template.rooms.find(
      room => room.roomId === sourceRoomId,
    );
    if (!sourceRoom) {
      return err(
        Errors.notFound(
          `Template "${templateId}" does not reference room "${sourceRoomId}"`,
        ),
      );
    }
    const targetRoom = template.rooms.find(
      room => room.roomId === targetRoomId,
    );
    if (!targetRoom) {
      return err(
        Errors.notFound(
          `Template "${templateId}" does not reference room "${targetRoomId}"`,
        ),
      );
    }
    if (sourceRoomId === targetRoomId) {
      return err(
        Errors.validation('Choose a different room for this operation'),
      );
    }
    // Draft mode: validate against the WORKING COPY when a draft of this
    // Template is open (the operation spans two rooms — the draft holds all
    // of them). Without a matching draft the persisted rooms are the base.
    const state = this.store.getState();
    const draftActive = state.editMode && state.editorTemplateId === templateId;
    const draft = draftActive ? state.draftWidgets : null;
    const source = draft
      ? draft.find(w => w.id === widgetId && w.roomId === sourceRoomId)
      : sourceRoom.widgets.find(w => w.id === widgetId);
    if (!source) {
      return err(Errors.notFound(`Widget "${widgetId}" does not exist`));
    }
    const targetBase = draft
      ? draft.filter(w => w.roomId === targetRoomId)
      : targetRoom.widgets;
    // The binding source must belong to the TARGET physical room (an
    // unbound widget is compatible with any room). This is the explicit
    // compatibility requirement for duplicate/move — the UI offers only
    // compatible rooms, the service is the authority.
    if (source.binding && this.getDeviceRoom) {
      const deviceRoom = this.getDeviceRoom(source.binding.deviceId);
      if (deviceRoom && deviceRoom !== targetRoomId) {
        return err(
          Errors.validation(
            `The bound device does not belong to room "${targetRoomId}"`,
          ),
        );
      }
    }
    // Section-scoped placement in the TARGET room (ADR-019 follow-up,
    // ISSUE-012.2): the widget lands at its OWN dashboard section's first
    // free cell (band re-pack) — never below the other section's band or
    // visually-empty cells (the same discipline as addWidget/applyResize).
    const placement = findSectionSlot(
      sameRoomWidgets(targetRoomId, targetBase),
      source.type,
      source.layout.width,
      source.layout.height,
    );
    if (placement === null) {
      return err(
        Errors.validation(
          `No free space for this widget in room "${targetRoomId}"`,
        ),
      );
    }
    const candidate: WidgetConfig = {
      ...source,
      id: freshId ? this.nextId('w') : source.id,
      roomId: targetRoomId,
      layout: {
        ...source.layout,
        x: placement.slot.x,
        y: placement.slot.y,
      },
    };
    const duplicateError = duplicateWidgetError(targetBase, candidate);
    if (duplicateError !== null) {
      return err(Errors.validation(duplicateError));
    }
    // The target room's next slice: the band-remapped room list (WITHOUT
    // the new widget) + the candidate appended.
    const nextTargetWidgets: readonly WidgetConfig[] = [
      ...placement.widgets,
      candidate,
    ];
    // AD7 pre-write invariant: the FULL resulting list must be a valid
    // layout before ANY write — draft or commit. For a move the source
    // room's slice (without the widget) is part of that list.
    if (draft) {
      // ONE atomic draft update — the target slice replacement and (for
      // move) the source removal in the SAME array. The source widget is
      // removed BEFORE the splice: a move's candidate reuses its id.
      const nextDraft = spliceRoomWidgets(
        freshId ? draft : draft.filter(w => w.id !== widgetId),
        targetRoomId,
        nextTargetWidgets,
      );
      const validity = validateLayout(nextDraft);
      if (!validity.ok) {
        return err(Errors.validation(validity.error));
      }
      state.setDraftWidgets(nextDraft);
      return ok(undefined);
    }
    // One atomic commit: destination add + (for move) source removal —
    // validated over the FULL room union before the write.
    const nextRooms = template.rooms.map(room => {
      if (room.roomId === targetRoomId) {
        return { ...room, widgets: [...nextTargetWidgets] };
      }
      if (room.roomId === sourceRoomId && !freshId) {
        return {
          ...room,
          widgets: room.widgets.filter(w => w.id !== widgetId),
        };
      }
      return room;
    });
    const commitValidity = validateLayout(
      nextRooms.flatMap(room => room.widgets),
    );
    if (!commitValidity.ok) {
      return err(Errors.validation(commitValidity.error));
    }
    return this.commit(
      this.withTemplate(templateId, t =>
        this.touch({ ...t, rooms: nextRooms }),
      ),
    );
  }

  /**
   * Retarget / remove Template room references when a PHYSICAL room is
   * deleted through the devices registry (CP5 cascade).
   *
   * - `toId` non-null (devices moved to another room): every reference to
   *   `fromId` is retargeted to `toId`; when a Template already references
   *   `toId` the two references merge and colliding movers are relocated
   *   to their OWN dashboard section's first free cell of the merge
   *   target (section-scoped band re-pack, ADR-019 follow-up;
   *   deterministic, original order).
   * - `toId === null` (devices unassigned): the reference (and its widget
   *   layout) is removed from every Template — a Template cannot reference
   *   a physical room that no longer exists.
   *
   * The devices registry rolls its own deletion back when this fails, so
   * failures here are safe to surface as-is.
   */
  async migrateWidgetsFromRoom(
    fromId: string,
    toId: string | null,
  ): Promise<Result<void>> {
    const affected = this.file.templates.some(template =>
      template.rooms.some(room => room.roomId === fromId),
    );
    if (!affected) {
      return ok(undefined);
    }
    const templates: DashboardTemplate[] = [];
    for (const template of this.file.templates) {
      const fromRef = template.rooms.find(room => room.roomId === fromId);
      if (!fromRef) {
        templates.push(template);
        continue;
      }
      if (toId === null) {
        // The physical room is gone — the reference (and its layout) goes
        // with it. Devices/MQTT/History identity is unaffected.
        templates.push(
          this.touch({
            ...template,
            rooms: this.reindexRooms(
              template.rooms.filter(room => room.roomId !== fromId),
            ),
          }),
        );
        continue;
      }
      const toRef = template.rooms.find(room => room.roomId === toId);
      if (!toRef) {
        // Simple retarget: keep the reference's order position, swap the
        // room id (widgets keep their coordinates).
        templates.push(
          this.touch({
            ...template,
            rooms: template.rooms.map(room =>
              room.roomId === fromId
                ? {
                    ...room,
                    roomId: toId,
                    widgets: room.widgets.map(w => ({ ...w, roomId: toId })),
                  }
                : room,
            ),
          }),
        );
        continue;
      }
      // Merge into the existing target reference: retargeted widgets that
      // collide are relocated to the first free room-scoped slot.
      const movers = fromRef.widgets.map(w => ({ ...w, roomId: toId }));
      let working = [...toRef.widgets, ...movers];
      for (const moved of movers) {
        const others = working.filter(
          o => o.id !== moved.id && widgetsShareVisibleScope(moved, o),
        );
        if (!others.some(o => collides(o.layout, moved.layout))) {
          continue;
        }
        // Section-scoped relocation in the merge target (ADR-019
        // follow-up, ISSUE-012.2): the mover lands at its OWN section's
        // first free cell (band re-pack) — never below the other section's
        // band. `placement.widgets` is the band-remapped room list WITHOUT
        // the mover.
        const placement = findSectionSlot(
          sameRoomWidgets(
            toId,
            working.filter(o => o.id !== moved.id),
          ),
          moved.type,
          moved.layout.width,
          moved.layout.height,
        );
        if (placement === null) {
          return err(
            Errors.validation(
              `No free space to migrate widget "${moved.id}" into room "${toId}"`,
            ),
          );
        }
        // Every widget of `working` belongs to the target room, so the
        // splice IS the room slice replacement: band-remapped list + the
        // mover at its new section-local slot.
        working = spliceRoomWidgets(working, toId, [
          ...placement.widgets,
          {
            ...moved,
            layout: {
              ...moved.layout,
              x: placement.slot.x,
              y: placement.slot.y,
            },
          },
        ]);
      }
      const validity = validateLayout(working);
      if (!validity.ok) {
        return err(Errors.validation(validity.error));
      }
      templates.push(
        this.touch({
          ...template,
          rooms: this.reindexRooms([
            ...template.rooms.filter(
              room => room.roomId !== fromId && room.roomId !== toId,
            ),
            { ...toRef, widgets: working },
          ]),
        }),
      );
    }
    return this.commit({ ...this.file, templates });
  }

  /**
   * Remove every widget binding a removed device (across all Templates),
   * compacting each affected room layout. Cascade for `devices:changed`.
   * ONLY Templates whose own content changed are touched — an unaffected
   * Template keeps its `updatedAt` (a Template-owned mutation stamp).
   */
  async removeWidgetsForDevice(deviceId: string): Promise<Result<void>> {
    let changed = false;
    const templates = this.file.templates.map(template => {
      let templateChanged = false;
      const rooms = template.rooms.map(room => {
        const kept = room.widgets.filter(w => w.binding?.deviceId !== deviceId);
        if (kept.length === room.widgets.length) {
          return room;
        }
        templateChanged = true;
        return { ...room, widgets: compactVertical(kept) };
      });
      if (!templateChanged) {
        return template;
      }
      changed = true;
      return this.touch({ ...template, rooms });
    });
    if (!changed) {
      return ok(undefined);
    }
    return this.commit({ ...this.file, templates });
  }

  /**
   * Remove every widget bound to ONE exact device capability (across all
   * Templates), compacting each affected room layout (approved binding-level
   * cascade): removing one projected sensor metric of a surviving legacy
   * multi-capability device cleans only that metric's widgets — sibling
   * metrics stay. ONLY Templates whose own content changed are touched.
   */
  async removeWidgetsForBinding(
    deviceId: string,
    capability: string,
  ): Promise<Result<void>> {
    let changed = false;
    const templates = this.file.templates.map(template => {
      let templateChanged = false;
      const rooms = template.rooms.map(room => {
        const kept = room.widgets.filter(
          w =>
            !(
              w.binding?.deviceId === deviceId &&
              w.binding?.capability === capability
            ),
        );
        if (kept.length === room.widgets.length) {
          return room;
        }
        templateChanged = true;
        return { ...room, widgets: compactVertical(kept) };
      });
      if (!templateChanged) {
        return template;
      }
      changed = true;
      return this.touch({ ...template, rooms });
    });
    if (!changed) {
      return ok(undefined);
    }
    return this.commit({ ...this.file, templates });
  }

  /** Map a template id through an update (missing id → file unchanged). */
  private withTemplate(
    templateId: string,
    update: (template: DashboardTemplate) => DashboardTemplate,
  ): DashboardsFile {
    return {
      ...this.file,
      templates: this.file.templates.map(template =>
        template.id === templateId ? update(template) : template,
      ),
    };
  }

  /** Cross-room binding validation error for one widget, `null` when OK. */
  private bindingRoomError(widget: WidgetConfig): Result<void, string> {
    if (!widget.binding) {
      return ok(undefined);
    }
    if (!this.canRebindToRoom(widget.roomId, widget.binding.deviceId)) {
      return err(
        `Widget "${widget.id}" is bound to a device from another room — rebind to a device of the widget's own room`,
      );
    }
    return ok(undefined);
  }

  private async commit(next: DashboardsFile): Promise<Result<void>> {
    const saved = await this.repository.save(next);
    if (!saved.ok) {
      return saved;
    }
    this.file = next;
    this.store.getState().setFile(next);
    this.logger.info(
      `Dashboards: committed ${next.templates.length} templates (active "${next.activeId}")`,
    );
    this.bus.emit('dashboards:changed', { activeId: next.activeId });
    return ok(undefined);
  }

  /** Generate a stable, unique id: `<prefix>-<counter>`. */
  private nextId(prefix: 'tpl' | 'w'): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }
}
