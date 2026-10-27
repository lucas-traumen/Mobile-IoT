/**
 * History chart layout tests — pure sizing policy for the dashboard
 * `history-chart` widget.
 *
 * The chart must never force a width larger than its measured parent content
 * (the old `Math.max(160, windowWidth - chrome)` minimum overflowed narrow
 * cards), must stay bounded on very wide cards, and must fall back to a safe
 * finite size before the first `onLayout` / for invalid measurements.
 */

import {
  CHART_HEIGHT,
  FALLBACK_CHART_CONTENT_WIDTH,
  MAX_CHART_WIDTH,
  historyChartDimensions,
} from './chartLayout';

describe('historyChartDimensions', () => {
  it('uses the measured content width when it is valid', () => {
    expect(historyChartDimensions(184)).toEqual({
      width: 184,
      height: CHART_HEIGHT,
    });
    expect(historyChartDimensions(316).width).toBe(316);
  });

  it('never exceeds the parent content width (no minimum overflow)', () => {
    for (const contentWidth of [10, 60, 120, 184, 240]) {
      const { width } = historyChartDimensions(contentWidth);
      expect(width).toBeLessThanOrEqual(contentWidth);
      expect(width).toBeGreaterThan(0);
    }
  });

  it('caps the chart width on very wide (tablet) cards', () => {
    expect(historyChartDimensions(900).width).toBe(MAX_CHART_WIDTH);
    expect(MAX_CHART_WIDTH).toBeLessThanOrEqual(480);
  });

  it('falls back safely for unmeasured/invalid widths', () => {
    for (const invalid of [0, -20, NaN, Infinity]) {
      const dims = historyChartDimensions(invalid);
      expect(Number.isFinite(dims.width)).toBe(true);
      expect(dims.width).toBe(FALLBACK_CHART_CONTENT_WIDTH);
      expect(dims.height).toBe(CHART_HEIGHT);
    }
  });
});
