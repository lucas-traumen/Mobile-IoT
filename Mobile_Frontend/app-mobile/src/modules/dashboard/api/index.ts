/**
 * Dashboard module — public facade.
 *
 * The only entry point other modules may use. Everything else lives in
 * `internal/` and must not be imported across modules (enforced by
 * `eslint-plugin-boundaries`).
 *
 * Exposes the pure layout engine, the persistence schemas + seeds (including
 * the legacy-migration entry points), the AsyncStorage repository and the
 * dashboard service (Template CRUD/duplicate, ordered physical-room
 * references, room-scoped widget editing with registry validation +
 * cascades). Also exports the shared room-navigation dialog
 * (`RoomListModal` — the Dashboard and History Smart Home headers open it).
 */

import type { Result } from '@core/errors';

import type { WidgetSize } from '@modules/widgets/api';

import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import type { AddWidgetInput } from '../internal/services/dashboardService';
import type { DashboardStore } from '../internal/ui/dashboardStore';
import type { WidgetConfig } from '@modules/widgets/api';

/** Layout engine helpers (pure, all returns {@link Result} on failure). */
export {
  applyMove,
  applyResize,
  collides,
  compactVertical,
  findFreeSlot,
  inBounds,
  SIZE_DIMENSIONS,
  validateLayout,
} from '../internal/domain/layout';
export type { GridCell } from '../internal/domain/layout';
/** Grid pixel-math helpers (pure, UI layout — screen-agnostic). */
export {
  computeGridMetrics,
  computeSmartViewMetrics,
  FALLBACK_GRID_CANVAS_WIDTH,
  GRID_GAP,
  GRID_PADDING,
  GRID_ROW_HEIGHT,
  GRID_ROW_HEIGHT_MAX,
  gridContentHeight,
  isNarrowCanvas,
  pixelRect,
  resolveCanvasWidth,
  SMART_VIEW_GAP,
  SMART_VIEW_INSET_NARROW,
  SMART_VIEW_INSET_WIDE,
  SMART_VIEW_MAX_CONTENT_WIDTH,
  SMART_VIEW_SENSOR_ROW_HEIGHT,
  smartFlowLayout,
  STACKED_BREAKPOINT,
  snapToGrid,
  VIEW_DEVICE_ROW_HEIGHT,
  viewCardHeight,
  viewRowHeight,
} from '../internal/domain/gridMetrics';
export type {
  GridPixelRect,
  SmartFlowRow,
} from '../internal/domain/gridMetrics';
/**
 * Dashboards persistence schemas + parsing (Template model). `Dashboard*`
 * types describe the CURRENT persisted shape; `Legacy*` types describe the
 * pre-Template shape that {@link parseDashboardsFile} migrates from.
 */
export type {
  DashboardTemplate,
  DashboardsFile,
  LegacyDashboard,
  LegacyDashboardsFile,
  ParsedDashboardsFile,
  TemplateRoom,
} from '../internal/domain/dashboardSchema';
export {
  DashboardTemplateSchema,
  DashboardsFileSchema,
  LegacyDashboardSchema,
  LegacyDashboardsFileSchema,
  MIGRATION_GLOBAL_ROOM_ID,
  migrateLegacyDashboardsFile,
  parseCurrentDashboardsFile,
  parseDashboardsFile,
  parseLegacyDashboardsFile,
  TemplateRoomSchema,
} from '../internal/domain/dashboardSchema';
/** First-run seed + constants. */
export {
  DEFAULT_DASHBOARD_ID,
  DEFAULT_DASHBOARD_NAME,
  defaultDashboardsFile,
} from '../internal/domain/seeds';
/** Pure room filter helper (null → all; id → room widgets + global widgets). */
export { filterWidgetsForRoom } from '../internal/domain/roomFilter';
/**
 * Pure section grouping: visible widgets → environment ("Môi trường":
 * sensor-value) / devices ("Thiết bị": switch + others) groups + each
 * section's rebase row and compact content height, so a screen can render a
 * label directly above its own grid. There is no Dashboard
 * `history-chart` section — History is a derived tab (approved room-sensor
 * rework).
 */
export {
  groupWidgets,
  sectionBaseY,
  sectionContentHeight,
} from '../internal/domain/sectionGroups';
/** AsyncStorage persistence adapter (load discriminates legacy/current). */
export type {
  DashboardRepository,
  LoadedDashboardsFile,
} from '../internal/data/dashboardRepository';
export { AsyncStorageDashboardRepository } from '../internal/data/dashboardRepository';
/** Dashboard service. */
export { DashboardServiceImpl } from '../internal/services/dashboardService';
/** Inputs for the service's widget operations. */
export type {
  AddWidgetInput,
  GetCapabilities,
  GetDeviceRoom,
  GetRooms,
  RoomExists,
} from '../internal/services/dashboardService';
/** Dashboard mirror store. */
export { createDashboardStore } from '../internal/ui/dashboardStore';
export type { DashboardStore } from '../internal/ui/dashboardStore';
/**
 * The reusable centered full room-list dialog (D3 extraction): opened by
 * the Dashboard tab's Smart Home header menu button AND the History tab's
 * header menu button (history-smart-home-redesign). Strictly
 * presentational/controlled — the host owns visibility + selection.
 */
export { RoomListModal } from '../ui/RoomListModal';

/**
 * Dashboard service — Template/room-reference CRUD + widget editing.
 *
 * Every mutation validates against the widget registry, applies the pure
 * layout engine, persists atomically through the repository, stamps the
 * touched Template's `updatedAt` and publishes `dashboards:changed
 * { activeId }`. Physical rooms remain owned by the devices module —
 * Templates reference them; duplication never clones rooms/devices/MQTT/
 * History identities.
 */
export interface DashboardService {
  /** The zustand store mirrored to the UI (subscribe for re-renders). */
  getStore(): DashboardStore;
  /** Load the persisted file (seeds defaults on first run; migrates legacy). */
  load(): Promise<Result<void>>;
  /** All Templates. */
  getTemplates(): readonly DashboardTemplate[];
  /** The active Template id. */
  getActiveTemplateId(): string;
  /** The active Template (deterministic first-Template fallback). */
  getActiveTemplate(): DashboardTemplate;
  /** Find a Template by id (undefined when unknown). */
  findTemplate(id: string): DashboardTemplate | undefined;
  /** Create a Template (id generated); becomes active. Returns it. */
  createTemplate(name: string): Promise<Result<DashboardTemplate>>;
  /** Rename a Template (display name only). */
  renameTemplate(id: string, name: string): Promise<Result<void>>;
  /**
   * Duplicate a Template (fresh Template/widget ids; rooms referenced, not
   * cloned). Returns the created copy.
   */
  duplicateTemplate(id: string): Promise<Result<DashboardTemplate>>;
  /**
   * Delete a Template. Rejected when it is the last one; the first
   * remaining Template becomes active when the active one was deleted.
   */
  deleteTemplate(id: string): Promise<Result<void>>;
  /** Set the Template the Dashboard tab opens on (must exist). */
  setActiveTemplate(id: string): Promise<Result<void>>;
  /** The History compatibility room selection (`null` = none). */
  getActiveRoomId(): string | null;
  /** Set the History room selection (validated against the devices registry). */
  setActiveRoom(id: string | null): Promise<Result<void>>;
  /** Add a physical-room reference to a Template (at most once). */
  addRoomReference(templateId: string, roomId: string): Promise<Result<void>>;
  /**
   * Remove a room REFERENCE (and its layout) from one Template — the
   * physical room itself is untouched.
   */
  removeRoomReference(
    templateId: string,
    roomId: string,
  ): Promise<Result<void>>;
  /** Reorder one Template's room references (permutation input required). */
  reorderRoomReferences(
    templateId: string,
    orderedRoomIds: readonly string[],
  ): Promise<Result<void>>;
  /**
   * Duplicate a room reference (fresh widget ids) into a different Template.
   */
  duplicateRoomReference(
    templateId: string,
    roomId: string,
    targetTemplateId: string,
  ): Promise<Result<void>>;
  /** Add a widget to one Template-room layout (draft-aware). */
  addWidget(
    templateId: string,
    roomId: string,
    input: AddWidgetInput,
  ): Promise<Result<void>>;
  /** Replace ONE Template-room layout atomically (draft commit). */
  applyLayout(
    templateId: string,
    roomId: string,
    widgets: readonly WidgetConfig[],
  ): Promise<Result<void>>;
  /**
   * Replace SEVERAL Template-room layouts in ONE atomic commit (the draft
   * editor's commit seam: a cross-room draft move/duplicate persists its
   * source + destination end-state together — both apply or neither does).
   */
  applyTemplateLayouts(
    templateId: string,
    layouts: readonly {
      readonly roomId: string;
      readonly widgets: readonly WidgetConfig[];
    }[],
  ): Promise<Result<void>>;
  /** Duplicate a widget into a different room of the same Template. */
  duplicateWidgetToRoom(
    templateId: string,
    sourceRoomId: string,
    widgetId: string,
    targetRoomId: string,
  ): Promise<Result<void>>;
  /** Move a widget to a different room of the same Template (atomic). */
  moveWidgetToRoom(
    templateId: string,
    sourceRoomId: string,
    widgetId: string,
    targetRoomId: string,
  ): Promise<Result<void>>;
  /** CP5 cascade: retarget/remove references for a deleted physical room. */
  migrateWidgetsFromRoom(
    fromId: string,
    toId: string | null,
  ): Promise<Result<void>>;
  /** Remove every widget bound to a device (across all Templates). */
  removeWidgetsForDevice(deviceId: string): Promise<Result<void>>;
  /** Remove every widget bound to one device capability (across all). */
  removeWidgetsForBinding(
    deviceId: string,
    capability: string,
  ): Promise<Result<void>>;
}

/**
 * The {@link WidgetSize} re-export keeps the service input types
 * self-contained for consumers that build add inputs.
 */
export type { WidgetSize };
