/**
 * History chart sizing policy — pure pixel math for dashboard chart cards
 * (the retired `history-chart` widget used this policy; kept for reference
 * and potential future reuse).
 *
 * The chart is sized from the MEASURED card content width (`onLayout` on the
 * card), never from the window and never from a minimum that can exceed the
 * parent (the old `Math.max(160, windowWidth - chrome)` overflowed narrow
 * cards horizontally). Policy:
 *
 * - valid measured width → the chart fills exactly the card content width;
 * - very wide (tablet) cards cap the plot so it stays readable;
 * - unmeasured / invalid input falls back to a safe finite width until the
 *   first `onLayout` fires.
 *
 * Pure + platform-independent so Jest can verify the bounds without an
 * emulator.
 */

/** Card content width used before the first `onLayout` / for invalid input. */
export const FALLBACK_CHART_CONTENT_WIDTH = 280;

/** Upper bound for the plot on very wide (tablet) cards (points). */
export const MAX_CHART_WIDTH = 480;

/** Plot height (points) — bounded; fits the 2x2 card at every row height. */
export const CHART_HEIGHT = 140;

/** Chart dimensions for a measured card content width. */
export interface HistoryChartDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve the victory chart size from the measured card content width.
 *
 * @param contentWidth - the measured card content width (points); may be
 *   invalid (`NaN`/`<= 0`) before the first layout event.
 * @returns finite chart dimensions; `width <= contentWidth` whenever the
 *   measurement is valid — the chart can never overflow its parent.
 */
export function historyChartDimensions(
  contentWidth: number,
): HistoryChartDimensions {
  const width =
    Number.isFinite(contentWidth) && contentWidth > 0
      ? Math.min(Math.floor(contentWidth), MAX_CHART_WIDTH)
      : FALLBACK_CHART_CONTENT_WIDTH;
  return { width, height: CHART_HEIGHT };
}
