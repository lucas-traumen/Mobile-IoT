/**
 * computeSeriesStats tests.
 *
 * Verifies: empty series → null; known values → min/max/avg; single point
 * series; negative values.
 */

import { computeSeriesStats } from './seriesStats';

describe('computeSeriesStats', () => {
  it('returns null for an empty series', () => {
    expect(computeSeriesStats([])).toBeNull();
  });

  it('computes min/max/avg for known values', () => {
    const result = computeSeriesStats([
      { t: 1, value: 10 },
      { t: 2, value: 20 },
      { t: 3, value: 30 },
    ]);
    expect(result).toEqual({ min: 10, max: 30, avg: 20 });
  });

  it('handles a single point', () => {
    expect(computeSeriesStats([{ t: 5, value: 42.5 }])).toEqual({
      min: 42.5,
      max: 42.5,
      avg: 42.5,
    });
  });

  it('handles negative and non-integer values', () => {
    const result = computeSeriesStats([
      { t: 1, value: -3.5 },
      { t: 2, value: 1.5 },
      { t: 3, value: -1.5 },
    ]);
    expect(result).toEqual({ min: -3.5, max: 1.5, avg: -1.1666666666666667 });
  });
});
