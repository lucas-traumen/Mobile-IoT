/**
 * Dashboard layout engine — pure grid math for the constrained 2-column grid.
 *
 * The grid has `WIDGET_GRID_COLUMNS` (2) columns; a widget occupies 1 or 2
 * columns/rows. All functions are pure (input array → output array/result)
 * and return {@link Result} with a human-readable error message on reject —
 * never throw, never mutate the input.
 *
 * The grid primitives ({@link GridCell}, {@link collides}, {@link inBounds})
 * live in `gridGeometry.ts` and are re-exported here unchanged (every
 * existing import path keeps working). Section-scoped placement (band
 * re-pack) lives in `sectionPlacement.ts`; `applyResize`'s relocation
 * fallback uses it for widgets that belong to a room.
 */

import { WIDGET_GRID_COLUMNS } from '@core/constants';
import { err, ok, type Result } from '@core/errors';

import type { WidgetConfig, WidgetSize } from '@modules/widgets/api';

import { collides, inBounds, type GridCell } from './gridGeometry';
import {
  findSectionSlot,
  sameRoomWidgets,
  spliceRoomWidgets,
} from './sectionPlacement';

export { collides, inBounds } from './gridGeometry';
export type { GridCell } from './gridGeometry';

/** Grid dimensions for each supported size (literal 1|2 per axis). */
export const SIZE_DIMENSIONS: Record<
  WidgetSize,
  { width: 1 | 2; height: 1 | 2 }
> = {
  '1x1': { width: 1, height: 1 },
  '2x1': { width: 2, height: 1 },
  '1x2': { width: 1, height: 2 },
  '2x2': { width: 2, height: 2 },
};

/**
 * CP-R3: Two widgets share visible scope (and therefore can collide) when:
 * - Either is global (roomId === undefined): global widgets are visible in
 *   every room, so they collide with all other widgets.
 * - Both have the same non-empty roomId: room-specific widgets only collide
 *   within their own room.
 * Different non-empty roomIds never collide (independent coordinate spaces).
 */
export function widgetsShareVisibleScope(
  a: { roomId?: string },
  b: { roomId?: string },
): boolean {
  if (a.roomId === undefined || b.roomId === undefined) return true;
  return a.roomId === b.roomId;
}

/**
 * Find the first free position for a widget of the given size.
 *
 * Scan order: rows ascending (`y`), then columns ascending (`x`). The first
 * `{x,y}` whose cell does not collide with any widget (and is in bounds) is
 * returned. `null` when there is no free space.
 */
export function findFreeSlot(
  widgets: readonly WidgetConfig[],
  width: 1 | 2,
  height: 1 | 2,
  roomId?: string,
): { x: number; y: number } | null {
  // CP-R3: only check collision against widgets sharing visible scope.
  const scopeWidgets = widgets.filter(w =>
    widgetsShareVisibleScope({ roomId }, w),
  );
  for (let y = 0; y < 1000; y++) {
    for (let x = 0; x <= WIDGET_GRID_COLUMNS - width; x++) {
      const candidate: GridCell = { x, y, width, height };
      if (
        inBounds(candidate) &&
        !scopeWidgets.some(w => collides(w.layout, candidate))
      ) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * Move a widget to a target position (bounds + overlap rejection).
 *
 * @param widgets - current widgets (unchanged on error).
 * @param widgetId - id of the widget to move.
 * @param x - target column.
 * @param y - target row.
 * @returns the new widgets array with the widget moved; `err` when the target
 *   is out of bounds or collides with another widget.
 */
export function applyMove(
  widgets: readonly WidgetConfig[],
  widgetId: string,
  x: number,
  y: number,
): Result<WidgetConfig[], string> {
  const target = widgets.find(w => w.id === widgetId);
  if (!target) {
    return err(`Widget "${widgetId}" does not exist`);
  }
  const size: WidgetConfig['layout'] = { ...target.layout, x, y };
  if (!inBounds(size)) {
    return err(
      `Position (${x}, ${y}) is out of bounds for a ${size.width}x${size.height} widget`,
    );
  }
  // CP-R3: only check collision against widgets sharing visible scope.
  const others = widgets.filter(
    w => w.id !== widgetId && widgetsShareVisibleScope(target, w),
  );
  if (others.some(w => collides(w.layout, size))) {
    return err(`Position (${x}, ${y}) overlaps another widget`);
  }
  return ok(
    widgets.map(w => (w.id === widgetId ? { ...w, layout: { ...size } } : w)),
  );
}

/**
 * Resize a widget to a new grid size.
 *
 * Keeps the current position when the new size fits there. Otherwise the
 * relocation is SECTION-SCOPED for widgets that belong to a room (the
 * room + section context derive from the target widget itself): the slot
 * is the first free cell of the widget's OWN section and the other
 * section's same-room band shifts as needed (band re-pack) — the widget
 * never relocates to the unified-space bottom. Widgets WITHOUT a room (the
 * CP-R3 global scope — impossible in the Template model) keep the unified
 * {@link findFreeSlot} search, since a section band is undefined for a
 * widget visible in every room. The fallback result is validated with
 * {@link validateLayout} over the FULL list before it is returned (AD7) —
 * the room-scoped placement cannot see the CP-R3 global scope, so a
 * cross-scope collision (e.g. a roomless widget on the relocated cell)
 * fails loudly with the input list untouched. Rejects when neither is
 * possible.
 *
 * @param widgets - current widgets (unchanged on error).
 * @param widgetId - id of the widget to resize.
 * @param width - new width (1|2).
 * @param height - new height (1|2).
 * @returns the new widgets array with the resized widget; `err` when no free
 *   spot exists for the new size.
 */
export function applyResize(
  widgets: readonly WidgetConfig[],
  widgetId: string,
  width: 1 | 2,
  height: 1 | 2,
): Result<WidgetConfig[], string> {
  const target = widgets.find(w => w.id === widgetId);
  if (!target) {
    return err(`Widget "${widgetId}" does not exist`);
  }
  const { x, y } = target.layout;
  const resized: WidgetConfig['layout'] = { x, y, width, height };

  if (inBounds(resized)) {
    // CP-R3: only check collision against widgets sharing visible scope.
    const others = widgets.filter(
      w => w.id !== widgetId && widgetsShareVisibleScope(target, w),
    );
    if (!others.some(w => collides(w.layout, resized))) {
      return ok(
        widgets.map(w =>
          w.id === widgetId ? { ...w, layout: { ...resized } } : w,
        ),
      );
    }
  }
  if (target.roomId !== undefined) {
    // Section-scoped relocation (room-scoped band re-pack, AD6): compute
    // the slot + the band-shifted room slice on THIS room's widgets only
    // (without the target — it never blocks its own slot), then splice the
    // slice back into the flat list; every other room's widget keeps its
    // identity and relative order.
    const roomWidgets = widgets.filter(w => w.roomId === target.roomId);
    const roomIndex = roomWidgets.findIndex(w => w.id === widgetId);
    const rest = roomWidgets.filter(w => w.id !== widgetId);
    const placement = findSectionSlot(
      sameRoomWidgets(target.roomId, rest),
      target.type,
      width,
      height,
    );
    if (placement === null) {
      return err(
        `No free spot for a ${width}x${height} widget (current position is blocked)`,
      );
    }
    const replacement = [...placement.widgets];
    replacement.splice(Math.min(roomIndex, replacement.length), 0, {
      ...target,
      layout: { ...placement.slot, width, height },
    });
    const candidate = spliceRoomWidgets(widgets, target.roomId, replacement);
    // AD7 pre-write invariant (reviewer fix cycle 1 M1): the room-scoped
    // placement cannot see the CP-R3 global scope, so the room subset alone
    // cannot prove the FULL result valid (e.g. a roomless widget occupying
    // the relocated cell). Validate the complete candidate list — an
    // invalid remap fails loudly and the input list stays untouched.
    const validity = validateLayout(candidate);
    if (!validity.ok) {
      return err(validity.error);
    }
    return ok(candidate);
  }
  const slot = findFreeSlot(widgets, width, height, target.roomId);
  if (slot === null) {
    return err(
      `No free spot for a ${width}x${height} widget (current position is blocked)`,
    );
  }
  return ok(
    widgets.map(w =>
      w.id === widgetId
        ? { ...w, layout: { ...resized, x: slot.x, y: slot.y } }
        : w,
    ),
  );
}

/**
 * Compact the layout vertically: gravity up, keep column x, stable within a
 * column (original y order preserved). Widgets are processed top-to-bottom
 * (stable sort by y) and each slides up to the lowest free row in its own
 * column — column position never changes.
 */
export function compactVertical(
  widgets: readonly WidgetConfig[],
): WidgetConfig[] {
  const sorted = [...widgets].sort(
    (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
  );
  const placed: WidgetConfig[] = [];
  for (const widget of sorted) {
    const { x, width, height } = widget.layout;
    if (x < 0 || x + width > WIDGET_GRID_COLUMNS) {
      // Out of bounds (shouldn't happen — validated at persist) — keep as-is.
      placed.push(widget);
      continue;
    }
    // CP-R3: only compact against widgets sharing visible scope.
    const scopePlaced = placed.filter(p => widgetsShareVisibleScope(widget, p));
    let y = 0;
    for (;;) {
      const cell: GridCell = { x, y, width, height };
      if (!scopePlaced.some(p => collides(p.layout, cell))) {
        break;
      }
      y++;
    }
    placed.push(
      y === widget.layout.y
        ? widget
        : { ...widget, layout: { ...widget.layout, x, y } },
    );
  }
  return placed;
}

/**
 * Validate a full widget list: unique ids, in-bounds cells, no overlaps.
 *
 * @returns `ok(void)` when valid; `err(message)` describing the first problem.
 */
export function validateLayout(
  widgets: readonly WidgetConfig[],
): Result<void, string> {
  const ids = new Set<string>();
  for (const widget of widgets) {
    if (ids.has(widget.id)) {
      return err(`Duplicate widget id "${widget.id}"`);
    }
    ids.add(widget.id);
    if (!inBounds(widget.layout)) {
      return err(
        `Widget "${widget.id}" is out of bounds (${widget.layout.x}, ${widget.layout.y}, ${widget.layout.width}x${widget.layout.height})`,
      );
    }
  }
  for (let i = 0; i < widgets.length; i++) {
    for (let j = i + 1; j < widgets.length; j++) {
      // CP-R3: only report overlap when widgets share visible scope.
      if (
        widgetsShareVisibleScope(widgets[i], widgets[j]) &&
        collides(widgets[i].layout, widgets[j].layout)
      ) {
        return err(`Widgets "${widgets[i].id}" and "${widgets[j].id}" overlap`);
      }
    }
  }
  return ok(undefined);
}
