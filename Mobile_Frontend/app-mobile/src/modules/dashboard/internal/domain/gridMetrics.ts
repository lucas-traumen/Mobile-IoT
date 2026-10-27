/**
 * Dashboard grid metrics — pure pixel math for the 2-column grid.
 *
 * The dashboard grid renders with absolute positioning: a widget at grid
 * `(x, y)` with size width x height cells is placed at
 *
 * - `left = PADDING + x * (cellW + GAP)`
 * - `top = PADDING + y * (rowH + GAP)`
 * - `width = cellW * w + GAP * (w - 1)`
 * - `height = rowH * h + GAP * (h - 1)`
 *
 * Responsive contract (measured canvas):
 *
 * - Callers measure the actual grid container width with `onLayout` and pass
 *   it through `resolveCanvasWidth` — the parent width is authoritative;
 *   `useWindowDimensions` is only the documented fallback until the first
 *   layout event (they coincide for the full-width grid).
 * - `computeGridMetrics` is total: invalid/unmeasured widths (`NaN`,
 *   `<= 0`, `Infinity`) fall back to `FALLBACK_GRID_CANVAS_WIDTH`; canvases
 *   below `MIN_GRID_CANVAS_WIDTH` (geometrically impossible for two positive
 *   columns) are clamped up to that documented degenerate floor. Cell widths
 *   and row heights are therefore always finite and positive, and every
 *   `pixelRect` stays within the canvas horizontally for supported widths.
 * - Row height policy: one row tracks the cell width 1:1, clamped to
 *   `[GRID_ROW_HEIGHT, GRID_ROW_HEIGHT_MAX]` — enough vertical space for
 *   the supported widgets (`sensor-value` 2x1, `switch` cards) at narrow
 *   and normal phone widths without making tablet cards unreasonably
 *   tall.
 *
 * Pure + platform-independent so Jest can test the formulas without mocking
 * `useWindowDimensions`.
 */

/** Outer padding around the grid (points). */
export const GRID_PADDING = 16;

/** Gap between cells (points). */
export const GRID_GAP = 12;

/** Minimum height of one grid row (points) — the responsive policy floor. */
export const GRID_ROW_HEIGHT = 160;

/** Maximum height of one grid row (points) — the responsive policy cap. */
export const GRID_ROW_HEIGHT_MAX = 176;

/**
 * Canvas width used until the first `onLayout` event / for invalid input
 * (points). Matches the narrowest supported phone class.
 */
export const FALLBACK_GRID_CANVAS_WIDTH = 320;

/**
 * Degenerate floor for the canvas (points): `2 * PADDING + GAP + 2` — the
 * smallest width that still yields positive cell widths. Real containers are
 * always far above this; clamping here only keeps the math total.
 */
export const MIN_GRID_CANVAS_WIDTH = 2 * GRID_PADDING + GRID_GAP + 2;

/**
 * Resolve the canvas width for the grid metrics from the measured parent
 * width.
 *
 * @param measuredWidth - the `onLayout` width of the grid container, or
 *   `null` before the first layout event.
 * @param fallbackWidth - the window width (documented fallback; the grid
 *   normally spans the full window width).
 * @returns the canvas width to feed {@link computeGridMetrics}.
 */
export function resolveCanvasWidth(
  measuredWidth: number | null,
  fallbackWidth: number,
): number {
  if (
    measuredWidth !== null &&
    Number.isFinite(measuredWidth) &&
    measuredWidth > 0
  ) {
    return measuredWidth;
  }
  return Number.isFinite(fallbackWidth) && fallbackWidth > 0
    ? fallbackWidth
    : FALLBACK_GRID_CANVAS_WIDTH;
}

/** Sanitize a canvas width: finite, positive, never below the degenerate floor. */
function sanitizeCanvasWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return FALLBACK_GRID_CANVAS_WIDTH;
  }
  return Math.max(width, MIN_GRID_CANVAS_WIDTH);
}

/**
 * Grid pixel metrics for a given canvas width.
 *
 * @param canvasWidth - the available container width (points); invalid or
 *   unmeasured values fall back per the responsive contract above.
 * @returns cell width, padding, gap, row height (all finite positive points).
 */
export function computeGridMetrics(canvasWidth: number): {
  readonly padding: number;
  readonly gap: number;
  readonly rowHeight: number;
  readonly cellWidth: number;
} {
  const canvas = sanitizeCanvasWidth(canvasWidth);
  const cellWidth = (canvas - 2 * GRID_PADDING - GRID_GAP) / 2;
  const rowHeight = Math.min(
    Math.max(Math.round(cellWidth), GRID_ROW_HEIGHT),
    GRID_ROW_HEIGHT_MAX,
  );
  return {
    padding: GRID_PADDING,
    gap: GRID_GAP,
    rowHeight,
    cellWidth,
  };
}

/** Position + size of a cell in pixels (absolute rendering). */
export interface GridPixelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pixel rect for one widget cell.
 *
 * @param x - grid column.
 * @param y - grid row.
 * @param width - cell width (1|2).
 * @param height - cell height (1|2).
 * @param metrics - grid metrics from {@link computeGridMetrics}.
 */
export function pixelRect(
  x: number,
  y: number,
  width: number,
  height: number,
  metrics: {
    readonly padding: number;
    readonly gap: number;
    readonly rowHeight: number;
    readonly cellWidth: number;
  },
): GridPixelRect {
  return {
    left: metrics.padding + x * (metrics.cellWidth + metrics.gap),
    top: metrics.padding + y * (metrics.rowHeight + metrics.gap),
    width: metrics.cellWidth * width + metrics.gap * (width - 1),
    height: metrics.rowHeight * height + metrics.gap * (height - 1),
  };
}

/**
 * Snap a dragged pixel delta to the nearest grid cell step.
 *
 * @param deltaPx - pixel offset accumulated during the gesture.
 * @param stepPx - one grid step in pixels (cellW + GAP for columns;
 *   rowH + GAP for rows).
 * @returns the nearest integer cell offset (positive or negative).
 */
export function snapToGrid(deltaPx: number, stepPx: number): number {
  if (stepPx <= 0) {
    return 0;
  }
  return Math.round(deltaPx / stepPx);
}

/**
 * Canvas width (points) that separates the view band widths: below it the
 * Dashboard/room views use the narrow smart inset (16), at/above it the
 * wide inset (24). The Settings editor ALWAYS uses the absolute two-column
 * grid regardless of width, and History uses the same threshold for its
 * own band padding (`windowWidth >= STACKED_BREAKPOINT` → wide). Since
 * dashboard-view-wysiwyg-two-column the VIEW renders the two-column flow
 * at EVERY width — this threshold no longer switches presentations, only
 * the inset band.
 */
export const STACKED_BREAKPOINT = 560;

/**
 * The narrow/wide band decision for the VIEW surfaces (single threshold
 * authority — the same boolean feeds the screens' own padding styles and
 * the smart-view metrics inset).
 *
 * Invalid/unmeasured widths (`NaN`, `<= 0`) resolve to the WIDE band —
 * the safe default that keeps the wide-inset geometry (and the previous
 * `resolvePresentationMode` fallback semantics) intact until a real
 * measurement arrives.
 *
 * @param canvasWidth - the resolved canvas width (see `resolveCanvasWidth`).
 */
export function isNarrowCanvas(canvasWidth: number): boolean {
  return (
    Number.isFinite(canvasWidth) &&
    canvasWidth > 0 &&
    canvasWidth < STACKED_BREAKPOINT
  );
}

/**
 * Height of the grid content (points) for a set of widgets.
 *
 * The grid renders absolutely-positioned cards inside a scroll view, so the
 * container must reserve the exact height or cards on lower rows would be
 * clipped (absolute children do not grow the scroll content).
 *
 * @param widgets - the widgets laid out on the grid (row positions only).
 * @param metrics - grid metrics from {@link computeGridMetrics}.
 * @returns content height in points (>= one row + padding).
 */
export function gridContentHeight(
  widgets: readonly {
    readonly layout: { readonly y: number; readonly height: number };
  }[],
  metrics: {
    readonly padding: number;
    readonly gap: number;
    readonly rowHeight: number;
  },
): number {
  if (widgets.length === 0) {
    return metrics.rowHeight + 2 * metrics.padding;
  }
  const rows = Math.max(
    ...widgets.map(widget => widget.layout.y + widget.layout.height),
  );
  return (
    rows * metrics.rowHeight + (rows - 1) * metrics.gap + 2 * metrics.padding
  );
}

/**
 * View-mode device (switch) row height (points) — the D4 compact device
 * card policy (~92). VIEW-screens only: the editor keeps the uniform
 * 160–176 row policy and the persisted grid math is untouched.
 */
export const VIEW_DEVICE_ROW_HEIGHT = 92;

/**
 * View-mode sensor row height FLOOR (points) — the amendment-2 compact
 * sensor card policy (~136, card padding 14–16). Smart-view floors ONLY:
 * the editor keeps the uniform 160–176 persisted row policy
 * ({@link GRID_ROW_HEIGHT}/{@link GRID_ROW_HEIGHT_MAX}) and the persisted
 * grid math is untouched.
 */
export const SMART_VIEW_SENSOR_ROW_HEIGHT = 136;

/**
 * Smart-view content width CAP (points) on large screens (scope amendment
 * 2): the smart content (card columns) never stretches past ~880 — wider
 * canvases CENTER the capped content and the ambient wash fills the rest.
 * Presentation-only: bounds the smart-view metric canvas (and the screens'
 * canvas wrappers); the editor's persisted slot math is untouched.
 */
export const SMART_VIEW_MAX_CONTENT_WIDTH = 880;

/**
 * Pure view-mode ROW height for one widget TYPE (D4 + scope amendment 2,
 * presentation-only): device (`switch`) rows render compact
 * ({@link VIEW_DEVICE_ROW_HEIGHT}); sensor rows render at the compact
 * smart floor ({@link SMART_VIEW_SENSOR_ROW_HEIGHT}, was the 160–176
 * policy). Unknown types fall back to the sensor floor.
 *
 * Pure + presentation-only: reads no persisted coordinates, feeds no store.
 *
 * @param widgetType - the widget type key (e.g. `'switch'`, `'sensor-value'`).
 */
export function viewRowHeight(widgetType: string): number {
  return widgetType === 'switch'
    ? VIEW_DEVICE_ROW_HEIGHT
    : SMART_VIEW_SENSOR_ROW_HEIGHT;
}

/**
 * Pure view-mode CARD height for a widget spanning `span` rows (D4):
 * `span * viewRowHeight(type) + (span - 1) * gap`. This is the card's
 * MINIMUM height (a presentation floor): the smart view renders it as a
 * `minHeight`, so content that needs more room (a long inline command
 * error, font-scaled text) grows the card instead of being clipped.
 * Total for degenerate spans (`NaN`/`< 1` → one row).
 *
 * @param widgetType - the widget type key.
 * @param span - the widget's persisted row span (`layout.height`).
 * @param metrics - grid metrics (the gap comes from the smart-view metrics).
 */
export function viewCardHeight(
  widgetType: string,
  span: number,
  metrics: { readonly rowHeight: number; readonly gap: number },
): number {
  const rows = Number.isFinite(span) && span >= 1 ? Math.floor(span) : 1;
  const rowHeight = viewRowHeight(widgetType);
  return rows * rowHeight + (rows - 1) * metrics.gap;
}

/**
 * Smart-view metric constants (dashboard-smart-home-redesign) — the
 * presentation-only Smart Home spacing the view layer maps the persisted
 * grid cells into. They mirror the `smart` spacing tokens
 * (`cardGap` / `screenH` / `screenHWide`); a drift-guard test pins them
 * together.
 */

/** Smart-view inter-card gap (points) — `smart.spacing.cardGap`. */
export const SMART_VIEW_GAP = 16;

/** Smart-view screen inset — narrow canvas (`smart.spacing.screenH`). */
export const SMART_VIEW_INSET_NARROW = 16;

/** Smart-view screen inset — wide/absolute canvas (`smart.spacing.screenHWide`). */
export const SMART_VIEW_INSET_WIDE = 24;

/**
 * Presentation-only smart-view METRIC/COORDINATE layer (blocker fix, fix
 * cycle 1): maps the persisted grid cells to the Smart Home view geometry —
 * symmetric screen padding (16 narrow / 24 wide) and a 16pt card gap —
 * while the persisted math ({@link computeGridMetrics} + `pixelRect` with
 * `GRID_GAP`/`GRID_PADDING`) stays byte-identical for the editor and the
 * `'default'` surfaces.
 *
 * The caller measures its CONTENT width (`onLayout`) and passes it here;
 * the returned metrics drive the VIEW rendering only. Persisted cell
 * coordinates are read (never rewritten). Row/card heights are the
 * per-TYPE view floors (D4 + scope amendment 2: sensor ~136, switch ~92).
 * The canvas is additionally CAPPED at {@link SMART_VIEW_MAX_CONTENT_WIDTH}
 * (scope amendment 2): wider screens center the capped content and the
 * ambient wash fills the rest.
 *
 * Pure + platform-independent; total for every input: invalid/unmeasured
 * widths fall back like {@link computeGridMetrics}, the degenerate floor
 * is per-presentation (`2 * padding + gap + 2`) so `cellWidth` stays
 * finite and positive, and oversized canvases clamp to the content cap.
 *
 * @param contentWidth - the MEASURED content width of the view canvas
 *   (points); invalid values fall back per the responsive contract.
 * @param narrowCanvas - the band decision (`isNarrowCanvas`): `true` → the
 *   narrow phone inset (16), `false` → the wide inset (24). The flow
 *   itself is the SAME two-column mapping at every width.
 */
export function computeSmartViewMetrics(
  contentWidth: number,
  narrowCanvas: boolean,
): {
  readonly padding: number;
  readonly gap: number;
  readonly rowHeight: number;
  readonly cellWidth: number;
} {
  const padding = narrowCanvas
    ? SMART_VIEW_INSET_NARROW
    : SMART_VIEW_INSET_WIDE;
  const floor = 2 * padding + SMART_VIEW_GAP + 2;
  const canvas = Math.min(
    Math.max(sanitizeCanvasWidth(contentWidth), floor),
    SMART_VIEW_MAX_CONTENT_WIDTH,
  );
  const cellWidth = (canvas - 2 * padding - SMART_VIEW_GAP) / 2;
  const rowHeight = Math.min(
    Math.max(Math.round(cellWidth), GRID_ROW_HEIGHT),
    GRID_ROW_HEIGHT_MAX,
  );
  return {
    padding,
    gap: SMART_VIEW_GAP,
    rowHeight,
    cellWidth,
  };
}

/** One flow ROW of the smart two-column view (presentation-only mapping). */
export interface SmartFlowRow {
  /** 1-wide card in the LEFT column (persisted x=0) — widget id or null. */
  readonly left: string | null;
  /** 1-wide card in the RIGHT column (persisted x=1) — widget id or null. */
  readonly right: string | null;
  /** Full-width card (persisted width ≥ 2) spanning the whole row — id or null. */
  readonly full: string | null;
}

/**
 * The pure smart two-column FLOW layout (growth-safety fix, fix cycle 2).
 *
 * The smart view NEVER renders absolutely positioned per-slot cards: grown
 * content (a long inline command error, font-scaled text) would overlap the
 * next row's slot and could escape the reserved scroll extent. Instead the
 * cards render in NORMAL flow — rows of up to two columns — and this pure
 * helper derives the row/column structure from the PERSISTED coordinates as
 * a presentation-only mapping (WYSIWYG: the editor and the view agree at
 * every canvas width):
 *
 * 1. Cards are ordered deterministically by (persisted row, persisted
 *    column, given order) and grouped into rows by their persisted `y`.
 * 2. A card with persisted `width >= 2` spans its whole row; a 1-wide card
 *    takes its persisted column (`x === 1` → right, everything else —
 *    including degenerate values — → left). When the preferred column is
 *    already taken the other column is used; when both are taken (corrupt
 *    data — the persisted grid forbids overlap) the card starts a NEW row,
 *    so the mapping stays total and can never place two cards in one slot.
 * 3. Each row's height floor is the MAX of its cards' per-type floors
 *    ({@link viewCardHeight}) — Yoga stretches the row's siblings to the
 *    row height and grown content makes the row (and everything below it)
 *    taller. Nothing can overlap and nothing escapes the scroll extent.
 *
 * Pure + platform-independent + total: degenerate coordinates (`NaN`,
 * negatives) sanitize to the top-left row/column instead of producing
 * invalid structure.
 *
 * @param widgets - the section's widgets (any order; persisted coords are
 *   READ, never rewritten).
 * @param metrics - grid metrics from `computeSmartViewMetrics` (always
 *   finite positive, so the flow math is finite too).
 * @returns the rows (empty sections → no rows) and the FLOOR-based minimum
 *   flow height `2 * padding + Σ rowFloor + gap * (rows - 1)` — the real
 *   flow height is content-driven (Yoga) and can only be taller.
 */
export function smartFlowLayout(
  widgets: readonly {
    readonly id: string;
    readonly type: string;
    readonly layout: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }[],
  metrics: {
    readonly padding: number;
    readonly gap: number;
    readonly rowHeight: number;
    readonly cellWidth: number;
  },
): { readonly rows: readonly SmartFlowRow[]; readonly minHeight: number } {
  const safeRow = (y: number): number =>
    Number.isFinite(y) && y >= 0 ? Math.floor(y) : 0;
  const safeColumn = (x: number): 0 | 1 => (x === 1 ? 1 : 0);

  interface MutableRow {
    left: string | null;
    right: string | null;
    full: string | null;
  }
  const rows: MutableRow[] = [];
  const floors: number[] = [];
  const newRow = (): MutableRow => {
    const row: MutableRow = { left: null, right: null, full: null };
    rows.push(row);
    floors.push(0);
    return row;
  };

  // 1. Deterministic order: persisted row, then column, then array order.
  const ordered = widgets
    .map((widget, index) => ({ widget, index }))
    .sort((a, b) => {
      const rowDelta = safeRow(a.widget.layout.y) - safeRow(b.widget.layout.y);
      if (rowDelta !== 0) {
        return rowDelta;
      }
      const colDelta =
        safeColumn(a.widget.layout.x) - safeColumn(b.widget.layout.x);
      return colDelta !== 0 ? colDelta : a.index - b.index;
    });

  // 2. Place the ordered cards. A persisted-row bucket NEVER shares a flow
  //    row with another bucket (the bucket boundary is a row boundary),
  //    even when the previous row still has a free slot.
  let bucketRow = -1;
  for (const { widget } of ordered) {
    const y = safeRow(widget.layout.y);
    const floor = viewCardHeight(widget.type, widget.layout.height, metrics);
    const full =
      Number.isFinite(widget.layout.width) && widget.layout.width >= 2;
    const column = safeColumn(widget.layout.x);

    let row =
      rows.length === 0 || y !== bucketRow ? newRow() : rows[rows.length - 1]!;
    bucketRow = y;
    if (full) {
      // A full-width card needs the WHOLE row (any occupant → next row).
      if (row.left !== null || row.right !== null || row.full !== null) {
        row = newRow();
      }
      row.full = widget.id;
    } else {
      const slot: 'left' | 'right' = column === 0 ? 'left' : 'right';
      const other: 'left' | 'right' = column === 0 ? 'right' : 'left';
      if (row[slot] !== null) {
        // Preferred column taken → the other column; both taken (corrupt
        // data — the persisted grid forbids overlap) → a fresh row, so two
        // cards can never share one slot.
        if (row[other] !== null || row.full !== null) {
          row = newRow();
          row[slot] = widget.id;
        } else {
          row[other] = widget.id;
        }
      } else {
        row[slot] = widget.id;
      }
    }
    // 3. The row's height floor is the MAX of its cards' per-type floors.
    floors[rows.length - 1] = Math.max(floors[rows.length - 1]!, floor);
  }

  const minHeight =
    rows.length === 0
      ? 2 * metrics.padding
      : 2 * metrics.padding +
        floors.reduce((sum, floor) => sum + floor, 0) +
        metrics.gap * (rows.length - 1);
  return { rows, minHeight };
}
