/**
 * Section-scoped widget placement (band re-pack) — the pure placement
 * domain for the TWO dashboard sections ("Môi trường" = `sensor-value`,
 * "Thiết bị" = every other type; the split authority is `sectionKeyOf`).
 *
 * Absolute coordinate model (AD2): contiguous per-section bands — the
 * environment band first (starting at row 0), the devices band after it.
 * `packSectionBands` preserves each section's LOCAL rows (local row =
 * `y − sectionBase` is invariant under a constant per-section shift), so a
 * re-pack is visual-neutral: every screen renders each section as its own
 * grid rebased by `sectionBaseY`, and shifting a whole band changes no
 * card's visible row, no grid shell height, no label. Interleaved legacy
 * layouts (possible from past drags) are normalized lazily whenever the
 * helpers run — no data migration.
 *
 * `findSectionSlot` scans the TARGET section's local grid row-major (the
 * same order users see) for the first in-bounds free cell and shifts the
 * FOLLOWING band down when the placement grows the target band. The result
 * is collision-free in absolute coordinates: the new/resized widget lands
 * in its OWN section's grid — never "sinking" below rows that visually
 * belong to the other section or below empty cells.
 *
 * Room-scoped contract (AD6): the helpers accept ONLY one room's widgets —
 * a plain widget list is not assignable to the parameter type. The only
 * way to produce a {@link SameRoomWidgets} value is {@link sameRoomWidgets},
 * which IS the roomId filter, so the call sites' discipline (filter →
 * compute on the room subset → `spliceRoomWidgets` the remapped slice back
 * into the flat draft) makes a cross-room remap mistake unrepresentable:
 * every other room's widgets keep their identity and relative order.
 *
 * Bounds/column rules are identical to `findFreeSlot`: 2 columns,
 * row-major scan, 1000-row cap. Collision checks use the existing
 * `collides`/`inBounds` primitives (AD3).
 *
 * Pure + platform-independent.
 */

import { WIDGET_GRID_COLUMNS } from '@core/constants';

import type { WidgetConfig } from '@modules/widgets/api';

import { collides, inBounds, type GridCell } from './gridGeometry';
import { sectionKeyOf, type WidgetSectionKey } from './sectionGroups';

/** Brand marker of {@link SameRoomWidgets} (AD6 — single-room scope). */
declare const sameRoomBrand: unique symbol;

/**
 * A widget list scoped to ONE room. Not constructible from a flat
 * multi-room draft: the only way in is {@link sameRoomWidgets}, which
 * performs the roomId filter — a placement helper can therefore never
 * remap another room's widgets by accident.
 */
export type SameRoomWidgets = readonly WidgetConfig[] & {
  readonly [sameRoomBrand]: 'single-room';
};

/**
 * Filter a (possibly flat, multi-room) widget list down to ONE room's
 * widgets — the structural entry point (AD6) for every section-placement
 * call.
 *
 * @param roomId - the room whose widgets the caller is about to remap.
 * @param widgets - any widget list (a flat draft, a room slice, ...).
 */
export function sameRoomWidgets(
  roomId: string,
  widgets: readonly WidgetConfig[],
): SameRoomWidgets {
  // The runtime value is exactly the filtered list; the brand exists for
  // the type system only (the `unknown` hop is the standard way to attach
  // a phantom marker to a plain array — no `any` involved).
  return widgets.filter(
    widget => widget.roomId === roomId,
  ) as unknown as SameRoomWidgets;
}

/**
 * Replace ONE room's widgets inside a (possibly flat, multi-room) list —
 * the shared filter→compute→splice-back discipline (AD6): every OTHER
 * room's widget keeps its object identity and relative order, and the
 * room's replacement slice is dropped in at the first position the room
 * previously occupied (a room absent from the input is appended at the
 * end). Pure — never mutates the input.
 *
 * @param widgets - the flat list (e.g. the whole draft).
 * @param roomId - the room whose slice is replaced.
 * @param replacement - the room's complete new widget list.
 */
export function spliceRoomWidgets(
  widgets: readonly WidgetConfig[],
  roomId: string,
  replacement: readonly WidgetConfig[],
): WidgetConfig[] {
  const result: WidgetConfig[] = [];
  let inserted = false;
  for (const widget of widgets) {
    if (widget.roomId !== roomId) {
      result.push(widget);
      continue;
    }
    if (!inserted) {
      result.push(...replacement);
      inserted = true;
    }
  }
  if (!inserted) {
    result.push(...replacement);
  }
  return result;
}

/** The env/devices band split of one room's widget list (input order kept). */
function splitBySection(widgets: readonly WidgetConfig[]): {
  environment: WidgetConfig[];
  devices: WidgetConfig[];
} {
  const environment: WidgetConfig[] = [];
  const devices: WidgetConfig[] = [];
  for (const widget of widgets) {
    if (sectionKeyOf(widget.type) === 'environment') {
      environment.push(widget);
    } else {
      devices.push(widget);
    }
  }
  return { environment, devices };
}

/**
 * Minimum absolute row of a section's widgets — its band base
 * (`sectionBaseY` semantics; `null` when the section is empty).
 */
function bandBase(widgets: readonly WidgetConfig[]): number | null {
  let base: number | null = null;
  for (const widget of widgets) {
    if (base === null || widget.layout.y < base) {
      base = widget.layout.y;
    }
  }
  return base;
}

/**
 * Row span of a section's band measured from `base`: max(local row +
 * height) over its widgets (`0` when empty).
 */
function bandExtent(widgets: readonly WidgetConfig[], base: number): number {
  let extent = 0;
  for (const widget of widgets) {
    extent = Math.max(extent, widget.layout.y - base + widget.layout.height);
  }
  return extent;
}

/**
 * Normalize one room's widgets into contiguous per-section bands (AD2):
 * the environment band occupies rows `[0, envExtent)`, the devices band
 * `[envExtent, envExtent + devicesExtent)` — each section's LOCAL rows
 * (`y − sectionBase`) preserved exactly, so the re-pack never changes a
 * card's section-local position. Widgets whose row is unchanged keep their
 * object identity; shifted widgets are shallow copies.
 *
 * @param roomWidgets - ONE room's widgets (see {@link sameRoomWidgets}).
 */
export function packSectionBands(
  roomWidgets: SameRoomWidgets,
): readonly WidgetConfig[] {
  const { environment, devices } = splitBySection(roomWidgets);
  const envBase = bandBase(environment);
  const devBase = bandBase(devices);
  const envExtent = envBase === null ? 0 : bandExtent(environment, envBase);
  return roomWidgets.map(widget => {
    const isEnvironment = sectionKeyOf(widget.type) === 'environment';
    // `base` is non-null for a section that owns this very widget.
    const base = isEnvironment ? envBase : devBase;
    if (base === null) {
      return widget;
    }
    const nextY = (isEnvironment ? 0 : envExtent) + (widget.layout.y - base);
    return nextY === widget.layout.y
      ? widget
      : { ...widget, layout: { ...widget.layout, y: nextY } };
  });
}

/** A found placement: the absolute slot + the band-shifted room list. */
export interface SectionPlacement {
  /** The free cell in ABSOLUTE coordinates (in-bounds, collision-free). */
  readonly slot: { readonly x: number; readonly y: number };
  /**
   * The room's widgets after the band re-pack: interleavings normalized
   * and — when the placement grows the environment band — the devices band
   * shifted down. The new/resized widget is NOT part of this list; the
   * caller inserts it (appended for add, at the original slice index for
   * resize) before any write.
   */
  readonly widgets: readonly WidgetConfig[];
}

/**
 * Find the first free cell of `type`'s OWN section (row-major local scan,
 * 2 columns, 1000-row cap — the `findFreeSlot` rules) and return it with
 * the band-shifted room list (AD3).
 *
 * Caller contract: `roomWidgets` is ONE room's list WITHOUT the
 * new/resized widget — a widget never blocks its own slot.
 *
 * @param roomWidgets - ONE room's widgets (see {@link sameRoomWidgets}).
 * @param type - the widget TYPE the slot is for (decides the section via
 *   `sectionKeyOf`).
 * @param width - requested column span (1|2).
 * @param height - requested row span (1|2).
 * @returns `null` when the section's local grid has no free cell within
 *   the 1000-row scan cap.
 */
export function findSectionSlot(
  roomWidgets: SameRoomWidgets,
  type: string,
  width: 1 | 2,
  height: 1 | 2,
): SectionPlacement | null {
  const packed = packSectionBands(roomWidgets);
  const { environment, devices } = splitBySection(packed);
  const section: WidgetSectionKey = sectionKeyOf(type);
  const envBase = bandBase(environment);
  const envExtent = envBase === null ? 0 : bandExtent(environment, envBase);
  // After packSectionBands the devices band starts exactly at envExtent
  // (its minimum local row is 0 by construction).
  const target = {
    widgets: section === 'environment' ? environment : devices,
    bandStart: section === 'environment' ? 0 : envExtent,
    extent:
      section === 'environment'
        ? envExtent
        : devices.length === 0
        ? 0
        : bandExtent(devices, envExtent),
  };
  // Section-local occupancy: local row = absolute y − bandStart.
  const occupied: readonly GridCell[] = target.widgets.map(widget => ({
    x: widget.layout.x,
    y: widget.layout.y - target.bandStart,
    width: widget.layout.width,
    height: widget.layout.height,
  }));
  for (let row = 0; row < 1000; row++) {
    for (let x = 0; x <= WIDGET_GRID_COLUMNS - width; x++) {
      const candidate: GridCell = { x, y: row, width, height };
      if (
        inBounds(candidate) &&
        !occupied.some(cell => collides(cell, candidate))
      ) {
        // Growing the environment band pushes the devices band down (the
        // devices band is the LAST band — growing it needs no shift).
        const growth = Math.max(0, row + height - target.extent);
        return {
          slot: { x, y: target.bandStart + row },
          widgets:
            section === 'environment' && growth > 0
              ? packed.map(widget =>
                  sectionKeyOf(widget.type) === 'devices'
                    ? {
                        ...widget,
                        layout: {
                          ...widget.layout,
                          y: widget.layout.y + growth,
                        },
                      }
                    : widget,
                )
              : packed,
        };
      }
    }
  }
  return null;
}
