/**
 * Dashboard store — zustand ViewModel mirroring the Templates file.
 *
 * The service pushes the persisted file into this store after every
 * mutation so screens re-render without polling.
 *
 * Draft edit mode: `enterEdit(templateId, roomId)` copies ALL widgets of
 * that Template (every room reference included) into `draftWidgets` and
 * fixes the draft's scope to exactly ONE Template-room layout
 * (`editorTemplateId` + `editorRoomId`). Move/resize/remove/rename/rebind —
 * plus the two explicit swap seams (bindings: fix cycle 7 G; positions:
 * fix cycle 8 L) — mutate the draft synchronously via the pure layout
 * engine (a rejected mutation leaves the draft untouched, which visually
 * snaps the card back).
 * `cancelEdit` discards the draft; persisting happens through the service's
 * atomic commit seams (`applyTemplateLayouts` — the whole draft end-state —
 * or `applyLayout` for a single room). After a successful Save the editor
 * intentionally STAYS OPEN with a clean draft (it mirrors the persisted
 * layout); Hủy/back/tab-leave restore the exact pre-edit layout, unknown
 * custom fields included.
 *
 * One draft owns one Template-room layout: there is deliberately no
 * "switch the room being edited mid-draft" seam — a different room opens a
 * different edit screen with its own draft (the official one-level-per-
 * screen hierarchy).
 */

import { create } from 'zustand';

import type { WidgetConfig, WidgetSize } from '@modules/widgets/api';

import type {
  DashboardTemplate,
  DashboardsFile,
} from '../domain/dashboardSchema';
import {
  applyMove,
  applyResize,
  collides,
  compactVertical,
  inBounds,
  SIZE_DIMENSIONS,
  widgetsShareVisibleScope,
  type GridCell,
} from '../domain/layout';
import { sectionKeyOf } from '../domain/sectionGroups';

interface DashboardUiState {
  /** All persisted Templates. */
  templates: DashboardTemplate[];
  /** Id of the active Template (Dashboard-level selection). */
  activeId: string;
  /**
   * History compatibility seam: the shared physical-room selection used by
   * the History tab (`null` = none). The Settings stack's management
   * navigation never derives from it.
   */
  activeRoomId: string | null;
  /** True while the user is editing one Template-room layout (transient). */
  editMode: boolean;
  /**
   * Working copy of the edited Template's widgets while `editMode` is true
   * (`null` when not editing). Holds ALL widgets — other room references
   * included — so a Save preserves them; the editor UI filters by
   * `editorRoomId`.
   */
  draftWidgets: WidgetConfig[] | null;
  /** Template being edited while a draft is open. */
  editorTemplateId: string | null;
  /** Room reference being edited while a draft is open. */
  editorRoomId: string | null;
  /** Replace the whole file (called by the service after mutations). */
  setFile(file: DashboardsFile): void;
  /**
   * Start editing: copies the widgets of `templateId` into the draft and
   * records `roomId` as the room reference being edited. Re-entering the
   * SAME scope is a no-op (the live draft is kept). A STALE draft from a
   * DIFFERENT Template/room (left over from a pop that bypassed the
   * discard guard) is REPLACED deterministically — a new editor never
   * edits on top of another scope's widgets. Unknown Template/room → no-op.
   */
  enterEdit(templateId: string, roomId: string): void;
  /** Discard the draft and leave edit mode. */
  cancelEdit(): void;
  /** Move a draft widget to (x, y); rejected moves leave the draft as-is. */
  moveWidget(widgetId: string, x: number, y: number): boolean;
  /** Resize a draft widget to a supported size; rejects when blocked. */
  resizeWidget(widgetId: string, size: WidgetSize): boolean;
  /** Remove a draft widget (the layout compacts vertically, room-aware). */
  removeWidget(widgetId: string): void;
  /**
   * Set a draft widget's display title (empty string clears it). No-op
   * outside edit mode / for unknown widgets.
   */
  renameDraftWidget(widgetId: string, title: string): void;
  /**
   * Rebind a draft widget to another device capability. No-op outside edit
   * mode / for unknown widgets.
   */
  rebindDraftWidget(
    widgetId: string,
    deviceId: string,
    capability: string,
  ): void;
  /**
   * Swap the bindings of TWO draft widgets of the SAME Template-room (fix
   * cycle 7, item G — the explicit resolution path for the room's
   * one-source-per-room uniqueness rule: the two widgets exchange device +
   * capability; titles/positions/layouts are untouched and the binding
   * MULTISET of the room is preserved, so uniqueness trivially still
   * holds for both).
   *
   * Deterministic contract — `false` (draft untouched) when:
   * - no draft is open, either id is unknown, or both ids are equal,
   * - the widgets live in DIFFERENT rooms (a cross-room swap could hand a
   *   binding to a room its device does not belong to),
   * - either widget holds NO binding (swapping "nothing" is meaningless
   *   and would produce an invalid unbound bound-type widget),
   * - a `canAcceptBinding` guard is wired and REJECTS either direction
   *   (a widget type cannot accept the other's binding capability — e.g.
   *   a sensor-value receiving a switch source).
   *
   * Persist-time authority is unchanged: the swap mutates the DRAFT only;
   * the atomic Save re-validates everything.
   */
  swapDraftBindings(widgetIdA: string, widgetIdB: string): boolean;
  /**
   * Swap the POSITIONS of two draft widgets (fix cycle 8, item L — the
   * drag-to-swap drop resolution): the two widgets EXCHANGE layout origins
   * (x/y only — type, size, binding, title and every other field stay on
   * their own widget), so dropping dragged card A onto card B exchanges
   * their places.
   *
   * Deterministic contract — `false` (draft untouched) when:
   * - no draft is open, either id is unknown, or both ids are equal,
   * - the widgets live in DIFFERENT rooms (a drag happens inside one
   *   room reference's grid; a cross-room position swap is meaningless),
   * - the widgets belong to DIFFERENT dashboard sections (type-based via
   *   `sectionKeyOf` — "Môi trường" = sensor-value, "Thiết bị" = the rest;
   *   a cross-section drop target stays rejected exactly like today's
   *   plain-move overlap rejection),
   * - EITHER resulting placement is invalid — out of the 2-column bounds,
   *   overlapping a THIRD widget of the same visible scope, or overlapping
   *   the other participant — with spans respected (a 1x1↔2x2 exchange
   *   only succeeds when BOTH results fit), mirroring the persist-time
   *   `validateLayout` authority.
   *
   * Draft-level only: the atomic Save re-validates and persists; a `false`
   * return leaves the draft byte-identical (the caller snaps the cards
   * back — the same rejection UX as a rejected move).
   */
  swapDraftPositions(widgetIdA: string, widgetIdB: string): boolean;
  /**
   * Append a widget to the draft (built + placed by the service).
   */
  addDraftWidget(widget: WidgetConfig): void;
  /**
   * Replace the WHOLE draft in one atomic update (the service's cross-room
   * draft operations — a draft move removes the source placement and adds
   * the destination placement in the SAME update, so a torn intermediate
   * state is impossible). No-op outside edit mode.
   */
  setDraftWidgets(widgets: readonly WidgetConfig[]): void;
  /** All Templates (convenience selector). */
  getTemplates(): DashboardTemplate[];
  /** The active Template id. */
  getActiveId(): string;
  /** The History compatibility room selection. */
  getActiveRoomId(): string | null;
}

/**
 * Authoritative store guards (wired by the dashboard service): the
 * room-scoped rebind check keeps a draft rebind from binding a room-scoped
 * widget to a device of a different room — the store alone has no devices
 * knowledge, so the service injects the predicate.
 */
export interface DashboardStoreGuards {
  /**
   * `true` when the widget (living in `widgetRoomId`) may rebind to
   * `deviceId`. When omitted, rebinds are unrestricted (legacy behavior for
   * plain store consumers).
   */
  readonly canRebindToRoom?: (
    widgetRoomId: string | null | undefined,
    deviceId: string,
  ) => boolean;
  /**
   * `true` when a widget of `widgetType` may bind `capability` (registry
   * definition + catalog rules). When omitted, binding-kind compatibility
   * is unrestricted (legacy behavior for plain store consumers).
   */
  readonly canAcceptBinding?: (
    widgetType: string,
    capability: string,
  ) => boolean;
}

/** Create the dashboard UI zustand store. */
export function createDashboardStore(
  initial: DashboardsFile,
  guards?: DashboardStoreGuards,
) {
  return create<DashboardUiState>((set, get) => ({
    templates: initial.templates,
    activeId: initial.activeId,
    activeRoomId: initial.activeRoomId ?? null,
    editMode: false,
    draftWidgets: null,
    editorTemplateId: null,
    editorRoomId: null,
    setFile: file => {
      set({
        templates: file.templates,
        activeId: file.activeId,
        activeRoomId: file.activeRoomId ?? null,
      });
    },
    enterEdit: (templateId, roomId) => {
      const template = get().templates.find(t => t.id === templateId);
      if (!template || !template.rooms.some(room => room.roomId === roomId)) {
        return;
      }
      if (
        get().editMode &&
        get().editorTemplateId === templateId &&
        get().editorRoomId === roomId
      ) {
        // Same scope: keep the live draft (idempotent re-entry).
        return;
      }
      // Fresh scope — or a STALE draft from a different Template/room, which
      // is replaced (the stale scope's editor route is gone; there is no UI
      // left to confirm a discard on, and the replacement never persists).
      const seeded = template.rooms.flatMap(room =>
        room.widgets.map(widget => ({ ...widget })),
      );
      set({
        editMode: true,
        editorTemplateId: templateId,
        editorRoomId: roomId,
        draftWidgets: seeded,
      });
    },
    cancelEdit: () => {
      set({
        editMode: false,
        draftWidgets: null,
        editorTemplateId: null,
        editorRoomId: null,
      });
    },
    moveWidget: (widgetId, x, y) => {
      const draft = get().draftWidgets;
      if (!draft) {
        return false;
      }
      const moved = applyMove(draft, widgetId, x, y);
      if (!moved.ok) {
        return false;
      }
      set({ draftWidgets: moved.value });
      return true;
    },
    resizeWidget: (widgetId, size) => {
      const draft = get().draftWidgets;
      if (!draft) {
        return false;
      }
      const widget = draft.find(w => w.id === widgetId);
      if (!widget) {
        return false;
      }
      const dims = SIZE_DIMENSIONS[size];
      const resized = applyResize(draft, widgetId, dims.width, dims.height);
      if (!resized.ok) {
        return false;
      }
      set({ draftWidgets: resized.value });
      return true;
    },
    removeWidget: widgetId => {
      const draft = get().draftWidgets;
      if (!draft) {
        return;
      }
      set({
        draftWidgets: compactVertical(draft.filter(w => w.id !== widgetId)),
      });
    },
    renameDraftWidget: (widgetId, title) => {
      const draft = get().draftWidgets;
      if (!draft) {
        return;
      }
      const trimmed = title.trim();
      set({
        draftWidgets: draft.map(w =>
          w.id === widgetId
            ? { ...w, title: trimmed.length > 0 ? trimmed : undefined }
            : w,
        ),
      });
    },
    rebindDraftWidget: (widgetId, deviceId, capability) => {
      const draft = get().draftWidgets;
      if (!draft) {
        return;
      }
      const widget = draft.find(w => w.id === widgetId);
      if (!widget) {
        return;
      }
      // Room-scoped binding authority: a cross-room rebind is rejected
      // WITHOUT mutating the draft — the UI filters candidates, and the
      // service re-validates at persist time; this guard keeps the draft
      // clean for programmatic callers too.
      if (
        guards?.canRebindToRoom &&
        !guards.canRebindToRoom(widget.roomId, deviceId)
      ) {
        return;
      }
      set({
        draftWidgets: draft.map(w =>
          w.id === widgetId ? { ...w, binding: { deviceId, capability } } : w,
        ),
      });
    },
    swapDraftBindings: (widgetIdA, widgetIdB) => {
      const draft = get().draftWidgets;
      if (!draft) {
        return false;
      }
      const a = draft.find(w => w.id === widgetIdA);
      const b = draft.find(w => w.id === widgetIdB);
      if (!a || !b || a.id === b.id) {
        return false;
      }
      // Room-scoped uniqueness class: only two widgets of the SAME
      // Template-room may swap — a cross-room swap could hand a binding to
      // a room its device does not belong to.
      if (a.roomId !== b.roomId) {
        return false;
      }
      // Swapping requires BOTH widgets to hold a binding: the exchange must
      // not produce an unbound bound-type widget.
      if (!a.binding || !b.binding) {
        return false;
      }
      // Binding-kind compatibility: each receiving type must accept the
      // OTHER's binding capability (e.g. a sensor-value cannot receive a
      // switch source). Rejected WITHOUT mutating the draft.
      if (guards?.canAcceptBinding) {
        if (
          !guards.canAcceptBinding(a.type, b.binding.capability) ||
          !guards.canAcceptBinding(b.type, a.binding.capability)
        ) {
          return false;
        }
      }
      set({
        draftWidgets: draft.map(w =>
          w.id === a.id
            ? { ...w, binding: b.binding }
            : w.id === b.id
            ? { ...w, binding: a.binding }
            : w,
        ),
      });
      return true;
    },
    swapDraftPositions: (widgetIdA, widgetIdB) => {
      const draft = get().draftWidgets;
      if (!draft) {
        return false;
      }
      const a = draft.find(w => w.id === widgetIdA);
      const b = draft.find(w => w.id === widgetIdB);
      if (!a || !b || a.id === b.id) {
        return false;
      }
      // One drag lives inside ONE room reference's grid — a cross-room
      // position exchange has no meaning (each room owns its layout).
      if (a.roomId !== b.roomId) {
        return false;
      }
      // Type-based sections: a cross-section exchange would visually move a
      // card into the other section ("Môi trường"/"Thiết bị") — rejected,
      // so a cross-section drop target behaves exactly like today's
      // rejected plain move.
      if (sectionKeyOf(a.type) !== sectionKeyOf(b.type)) {
        return false;
      }
      // Exchange ONLY the origins; each size travels with its own widget.
      const aNew: GridCell = {
        x: b.layout.x,
        y: b.layout.y,
        width: a.layout.width,
        height: a.layout.height,
      };
      const bNew: GridCell = {
        x: a.layout.x,
        y: a.layout.y,
        width: b.layout.width,
        height: b.layout.height,
      };
      // BOTH resulting placements must be valid — in bounds and not
      // overlapping each other (spans respected: a 1x1↔2x2 exchange only
      // succeeds when both results fit).
      if (!inBounds(aNew) || !inBounds(bNew) || collides(aNew, bNew)) {
        return false;
      }
      // …and neither result may overlap a THIRD widget of the same visible
      // scope (same-room/global — the same collision class `applyMove`
      // enforces for plain moves).
      const third = draft.filter(
        w => w.id !== a.id && w.id !== b.id && widgetsShareVisibleScope(a, w),
      );
      if (
        third.some(w => collides(w.layout, aNew) || collides(w.layout, bNew))
      ) {
        return false;
      }
      set({
        draftWidgets: draft.map(w =>
          w.id === a.id
            ? { ...w, layout: { ...w.layout, x: aNew.x, y: aNew.y } }
            : w.id === b.id
            ? { ...w, layout: { ...w.layout, x: bNew.x, y: bNew.y } }
            : w,
        ),
      });
      return true;
    },
    addDraftWidget: widget => {
      const draft = get().draftWidgets;
      if (!draft) {
        return;
      }
      set({ draftWidgets: [...draft, widget] });
    },
    setDraftWidgets: widgets => {
      if (!get().editMode) {
        return;
      }
      set({ draftWidgets: [...widgets] });
    },
    getTemplates: () => get().templates,
    getActiveId: () => get().activeId,
    getActiveRoomId: () => get().activeRoomId,
  }));
}

/** The zustand store instance shape returned by {@link createDashboardStore}. */
export type DashboardStore = ReturnType<typeof createDashboardStore>;
