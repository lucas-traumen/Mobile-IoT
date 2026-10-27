/**
 * Pure series downsampling for the History chart cards (AD-4). Since the
 * Flux query aggregates server-side (dashboard-history-board-touch-share,
 * AD-2), the delivered series are already small; this stays only for the
 * COARSE 10-point reveal phase — the settle phase passes the full
 * aggregated series through (`MAX_RENDER_POINTS` is above every expected
 * window). Presentation only; the data layer and the stats/y-domain stay
 * on the FULL points.
 *
 * Contract (AD-4):
 * - `points.length <= max` → the SAME array reference comes back
 *   (passthrough — aggregated series and demo sources render untouched);
 * - otherwise `max` points at an even stride `(n − 1) / (max − 1)`, ALWAYS
 *   keeping the first and the last point so the line keeps spanning the
 *   whole time window (the shared x-domain never shows an empty edge);
 * - sampled points are ORIGINAL points (no interpolation — shape
 *   preservation); because the stride is > 1 whenever downsampling
 *   happens, the rounded indices are strictly increasing (no duplicate
 *   timestamps on the x axis).
 *
 * Precondition: `max >= 2` (the only remaining call site passes the
 * pinned constant `REVEAL_COARSE_POINTS = 10`; the settle cap
 * `MAX_RENDER_POINTS = 200` passthroughs every aggregated series). Placed
 * in `ui/` alongside `valueAxis.ts` / `timeAxis.ts`; NOT exported through
 * the module's public `api/` facade (view-only concern).
 */

/**
 * The even-stride, endpoint-keeping sample of `points` capped at `max`
 * points. Passthrough (same reference) when the series is already within
 * the cap.
 *
 * @param points - the FULL series (ascending `t`); never mutated.
 * @param max - the render cap (precondition: `max >= 2`).
 */
export function downsampleSeries(
  points: readonly { t: number; value: number }[],
  max: number,
): readonly { t: number; value: number }[] {
  if (points.length <= max) {
    return points;
  }
  const stride = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => {
    const point = points[Math.round(i * stride)];
    return { t: point.t, value: point.value };
  });
}
