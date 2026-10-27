/**
 * seriesSampling tests (history-chart-reveal-downsample): the pure
 * client-side downsample contract that caps the History chart render
 * budget (AD-4) — even-stride sampling that ALWAYS keeps the first and
 * last points (the line must keep spanning the full time window), with a
 * same-reference passthrough for series already within the cap.
 */

import { downsampleSeries } from './seriesSampling';

/** `t` values of a sampled result, for the ordering/endpoint assertions. */
const tsOf = (points: readonly { t: number; value: number }[]): number[] =>
  points.map(point => point.t);

describe('downsampleSeries', () => {
  it('passes through a series already within the cap (same reference)', () => {
    const points = [
      { t: 1, value: 20 },
      { t: 2, value: 22 },
      { t: 3, value: 21 },
    ];
    expect(downsampleSeries(points, 50)).toEqual(points);
    expect(downsampleSeries(points, 50)).toBe(points);
    // Boundary: exactly max points is also a passthrough.
    expect(downsampleSeries(points, 3)).toBe(points);
    const empty: { t: number; value: number }[] = [];
    expect(downsampleSeries(empty, 50)).toBe(empty);
  });

  it('downsamples 120 → exactly 50 points, strictly increasing, first/last kept', () => {
    const points = Array.from({ length: 120 }, (_, i) => ({
      t: 1000 + i,
      value: 20,
    }));
    const sampled = downsampleSeries(points, 50);
    expect(sampled).toHaveLength(50);
    const ts = tsOf(sampled);
    expect(ts[0]).toBe(1000); // first point kept
    expect(ts[ts.length - 1]).toBe(1119); // last point kept
    for (let i = 1; i < ts.length; i += 1) {
      expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    }
    // Every sampled point IS an original point (no interpolation — shape
    // preservation is the cap's contract).
    for (const point of sampled) {
      expect(point).toEqual(points[point.t - 1000]);
    }
  });

  it('downsamples 48 → 10 points (coarse demo case), first/last kept', () => {
    const points = Array.from({ length: 48 }, (_, i) => ({
      t: 100 + i,
      value: i,
    }));
    const sampled = downsampleSeries(points, 10);
    expect(sampled).toHaveLength(10);
    const ts = tsOf(sampled);
    expect(ts[0]).toBe(100); // first point kept
    expect(ts[ts.length - 1]).toBe(147); // last point kept
    for (let i = 1; i < ts.length; i += 1) {
      expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    }
  });

  it('downsamples 51 → 50 points (smallest-stride boundary), first/last kept', () => {
    const points = Array.from({ length: 51 }, (_, i) => ({
      t: 2000 + i,
      value: i,
    }));
    const sampled = downsampleSeries(points, 50);
    expect(sampled).toHaveLength(50);
    const ts = tsOf(sampled);
    expect(ts[0]).toBe(2000); // first point kept
    expect(ts[ts.length - 1]).toBe(2050); // last point kept
    for (let i = 1; i < ts.length; i += 1) {
      expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    }
  });
});
