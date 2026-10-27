/**
 * Load-migration layout repair (fix cycle 2 of the approved room-sensor
 * rework) — the MIGRATION-SPECIFIC alternative to the shared
 * `compactVertical` gravity, whose global slide-up rewrote the
 * coordinates of unrelated custom widgets.
 *
 * Contract (acceptance criterion 10): after removing later exact duplicates
 * and retired widgets, each affected layout receives only the MINIMUM
 * repair necessarily caused by the removed items:
 *
 * - Survivors whose type is NOT movable (`isMovable` === registered)
 *   keep their EXACT grid cell, title, binding and config — unknown/custom
 *   widgets are pinned obstacles that never move.
 * - Movable survivors also keep their exact cell, unless they sit strictly
 *   below a removed cell (in a column it covered and a scope where it was
 *   visible): they may slide up ONLY into the rows that cell vacated —
 *   never above the removed cell's top — and only while the slide stays
 *   collision-free against the current layout.
 * - Widget order and every untouched field are preserved.
 *
 * Pure and deterministic: the holes are processed top-to-bottom, the
 * candidates per hole bottom-up, and every placement is verified against
 * the live (already-repaired) list — so the result never overlaps.
 */

import type { WidgetConfig } from '@modules/widgets/api';

import { collides, widgetsShareVisibleScope } from './layout';

/** Predicate deciding which surviving widget types may slide (registered). */
export type WidgetMovable = (widget: WidgetConfig) => boolean;

/**
 * Smallest `y' >= minY` where the widget's cell collides with no OTHER
 * widget of the live list (scope-aware). The widget's current `y` is always
 * a fallback answer, so the scan always succeeds.
 */
function firstFreeY(
  working: readonly WidgetConfig[],
  widget: WidgetConfig,
  minY: number,
): number {
  for (let y = minY; y <= widget.layout.y; y++) {
    const cell = {
      x: widget.layout.x,
      y,
      width: widget.layout.width,
      height: widget.layout.height,
    };
    const blocked = working.some(
      w =>
        w !== widget &&
        widgetsShareVisibleScope(widget, w) &&
        collides(w.layout, cell),
    );
    if (!blocked) {
      return y;
    }
  }
  return widget.layout.y;
}

/**
 * Repair a widget list after a migration removed `removed` items from it.
 *
 * @param kept - survivors in their original order, with their original
 *   coordinates (the dedupe/retire output).
 * @param removed - the widgets the migration dropped (duplicates + retired
 *   types); their cells define the only space a repair may reclaim.
 * @param isMovable - which survivor types may slide (the service passes
 *   "type is registered"; unknown/custom types are pinned).
 * @returns the repaired list — a NEW array (the caller's change detection
 *   is based on the removal itself, not on this function's identity).
 */
export function repairLayoutAfterRemoval(
  kept: readonly WidgetConfig[],
  removed: readonly WidgetConfig[],
  isMovable: WidgetMovable,
): WidgetConfig[] {
  if (removed.length === 0) {
    return [...kept];
  }
  const working: WidgetConfig[] = [...kept];
  // Deterministic hole order: top-to-bottom, left-to-right.
  const holes = [...removed].sort(
    (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
  );
  for (const hole of holes) {
    // Eligible movers: registered widgets, strictly below the hole, in a
    // column the hole covered, in a scope where the hole was visible.
    const candidates = working
      .filter(
        widget =>
          isMovable(widget) &&
          widgetsShareVisibleScope(hole, widget) &&
          widget.layout.x < hole.layout.x + hole.layout.width &&
          hole.layout.x < widget.layout.x + widget.layout.width &&
          widget.layout.y >= hole.layout.y + hole.layout.height,
      )
      .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
    for (const candidate of candidates) {
      // Identity lookup (ids are not guaranteed unique in a legacy file).
      const index = working.indexOf(candidate);
      if (index === -1) {
        continue;
      }
      const targetY = firstFreeY(working, candidate, hole.layout.y);
      if (targetY < candidate.layout.y) {
        working[index] = {
          ...candidate,
          layout: { ...candidate.layout, y: targetY },
        };
      }
    }
  }
  return working;
}
