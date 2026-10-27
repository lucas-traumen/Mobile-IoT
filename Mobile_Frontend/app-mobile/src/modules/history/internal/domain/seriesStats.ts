/**
 * History domain: series statistics (pure).
 *
 * Given the points of one series, compute the min/max/average of the values.
 * Returns `null` for an empty series so callers can render an em-dash
 * without special-casing zero-value series.
 */

/** Aggregate statistics for one series. */
export interface SeriesStats {
  /** Minimum value. */
  readonly min: number;
  /** Maximum value. */
  readonly max: number;
  /** Arithmetic mean of the values. */
  readonly avg: number;
}

/**
 * Compute min/max/avg for a series.
 *
 * @param points - series points (values only; timestamps are ignored).
 * @returns `{ min, max, avg }` or `null` when the series is empty (pure).
 */
export function computeSeriesStats(
  points: readonly { t: number; value: number }[],
): SeriesStats | null {
  if (points.length === 0) {
    return null;
  }
  let min = points[0].value;
  let max = points[0].value;
  let sum = 0;
  for (const point of points) {
    if (point.value < min) {
      min = point.value;
    }
    if (point.value > max) {
      max = point.value;
    }
    sum += point.value;
  }
  return { min, max, avg: sum / points.length };
}
