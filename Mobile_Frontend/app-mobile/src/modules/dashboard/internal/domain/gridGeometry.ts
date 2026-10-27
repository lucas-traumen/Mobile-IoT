/**
 * Grid geometry primitives — the minimal pure math every layout/placement
 * module shares: the 2-column grid cell tuple, overlap detection and the
 * in-bounds rule. Extracted from `layout.ts` so the section-placement
 * helper can reuse them without an import cycle (gridGeometry ←
 * sectionPlacement ← layout); `layout.ts` re-exports everything here, so
 * every existing import path keeps working unchanged.
 *
 * Pure + platform-independent.
 */

import { WIDGET_GRID_COLUMNS } from '@core/constants';

/** A widget's grid position+size tuple (x, y, width, height). */
export interface GridCell {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** True when two cells overlap (sharing any grid cell). */
export function collides(a: GridCell, b: GridCell): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** True when the cell is fully inside the 2-column grid with non-negative y. */
export function inBounds(cell: GridCell): boolean {
  return (
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.width > 0 &&
    cell.height > 0 &&
    cell.x + cell.width <= WIDGET_GRID_COLUMNS
  );
}
