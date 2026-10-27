/**
 * valueAxis tests (history-adaptive-y-axis): the per-card adaptive
 * y-domain contract that keeps each History chart scaled to ITS OWN
 * series (never zero-based).
 */

import { computeValueDomain } from './valueAxis';

describe('computeValueDomain', () => {
  it('returns null for an empty series (no chart is rendered)', () => {
    expect(computeValueDomain([])).toBeNull();
  });

  it('falls back to ±1 for a single point (flat series)', () => {
    expect(computeValueDomain([{ t: 1, value: 400 }])).toEqual({
      min: 399,
      max: 401,
    });
  });

  it('falls back to ±1 for a flat multi-point series', () => {
    expect(
      computeValueDomain([
        { t: 1, value: 26 },
        { t: 2, value: 26 },
        { t: 3, value: 26 },
      ]),
    ).toEqual({ min: 25, max: 27 });
  });

  it('pads a varying series by 10% of its range on each side', () => {
    const domain = computeValueDomain([
      { t: 1, value: 25 },
      { t: 2, value: 26.2 },
      { t: 3, value: 26.4 },
    ]);
    expect(domain).not.toBeNull();
    if (domain) {
      expect(domain.min).toBeCloseTo(24.86);
      expect(domain.max).toBeCloseTo(26.54);
      // The 25–26.4 °C regression: the domain must NOT include 0.
      expect(domain.min).toBeGreaterThan(0);
    }
  });

  it('applies the same formula to series with negative values', () => {
    const domain = computeValueDomain([
      { t: 1, value: -2 },
      { t: 2, value: 1 },
      { t: 3, value: 3 },
    ]);
    expect(domain).not.toBeNull();
    if (domain) {
      // range 5 → pad 0.5 on each side.
      expect(domain.min).toBeCloseTo(-2.5);
      expect(domain.max).toBeCloseTo(3.5);
    }
  });
});
