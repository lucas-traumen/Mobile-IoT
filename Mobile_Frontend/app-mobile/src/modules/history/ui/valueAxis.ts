/**
 * Per-card value-axis (y-domain) policy for the History chart cards
 * (history-adaptive-y-axis): each card computes its OWN adaptive
 * y-domain from the points it renders — temperature and humidity (or CO2)
 * never share a scale (user-approved 2026-09-17: always adaptive, NO
 * zero-based toggle).
 *
 * WHY an explicit domain: without a `domain.y` prop on `VictoryChart`,
 * victory's `VictoryArea` applies `getDomainWithZero` — it forces the
 * y-domain to include 0 — so a near-constant series (e.g. 25–26.4 °C)
 * renders as a flat line squashed against the top edge with 0-based
 * ticks (0/5/10/…/25); a 1.4 °C variation takes ~5% of the chart height.
 * Passing an explicit `domain.y` makes `getDomainFromProps` win (verified
 * in victory's source; the same override mechanism as the shared
 * x-domain), so the series fills the chart height.
 *
 * Rules (approved spec):
 * - empty series → `null` (the card renders the no-data branch — no
 *   chart is mounted, so there is no axis to scale);
 * - flat series (min === max, INCLUDING a single point) → `[v − 1,
 *   v + 1]` (a zero-height range would collapse the axis onto one line;
 *   ±1 keeps the line centered with visible headroom);
 * - otherwise `[min − 10% × range, max + 10% × range]` — enough padding
 *   that the line never touches the top/bottom edge, small enough not to
 *   amplify noise.
 */

/** One card's adaptive y-domain (`domain.y` for `VictoryChart`). */
export interface ValueDomain {
  /** Lower bound: data min minus padding (or `v − 1` when flat). */
  readonly min: number;
  /** Upper bound: data max plus padding (or `v + 1` when flat). */
  readonly max: number;
}

/**
 * The adaptive y-domain for one card's series (see the module doc for the
 * rules). `null` for an empty series — the caller renders the no-data
 * branch instead of a chart.
 *
 * @param points - the series points the card renders (its `value` field
 * is the y data; `t` is accepted for call-site symmetry with the x axis).
 */
export function computeValueDomain(
  points: readonly { t: number; value: number }[],
): ValueDomain | null {
  if (points.length === 0) {
    return null;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.value < min) {
      min = point.value;
    }
    if (point.value > max) {
      max = point.value;
    }
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  const pad = 0.1 * (max - min);
  return { min: min - pad, max: max + pad };
}
