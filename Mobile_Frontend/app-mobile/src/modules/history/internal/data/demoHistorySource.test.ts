/**
 * DemoHistoryDataSource tests.
 *
 * The demo source is a production data source (no network, no persistence)
 * that synthesizes deterministic series for the requested room × fields so
 * the History tab can be reviewed without a configured InfluxDB.
 * Contract under test:
 * - determinism: the same query yields byte-identical output (seeded PRNG);
 * - series identity: exactly one series per room + field combination;
 * - point count: ~48 points per series for every range, spanning the range;
 * - the fields/roomId filters are respected (empty fields → the default
 *   sensor fields; roomless queries → no attributable series).
 */

import { DEFAULT_HISTORY_FIELDS } from '../domain/fluxQueryBuilder';
import type { HistoryQuery, HistorySeries } from '../domain/fluxQueryBuilder';
import { DemoHistoryDataSource } from './demoHistorySource';

const source = new DemoHistoryDataSource();

const query = (over: Partial<HistoryQuery> = {}): HistoryQuery => ({
  measurement: 'sensors',
  range: '24h',
  fields: ['temperature', 'humidity'],
  roomId: 'room-living',
  ...over,
});

describe('DemoHistoryDataSource', () => {
  it('is deterministic: the same query yields identical output twice', async () => {
    const q = query();
    const first = await source.query(q);
    const second = await source.query(q);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value).toEqual(first.value);
    }
  });

  it('produces one series per room + field combination (approved identity)', async () => {
    const result = await source.query(query());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const identities = result.value.map(
      series => `${series.roomId}|${series.field}`,
    );
    expect(identities).toEqual([
      'room-living|temperature',
      'room-living|humidity',
    ]);
  });

  it('emits 48 points per series for every range, spanning the range window', async () => {
    const spans: Record<HistoryQuery['range'], number> = {
      '1h': 3600,
      '24h': 86400,
      '7d': 604800,
    };
    for (const range of ['1h', '24h', '7d'] as const) {
      const result = await source.query(query({ range }));
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      for (const series of result.value) {
        expect(series.points).toHaveLength(48);
        const span =
          series.points[series.points.length - 1]!.t - series.points[0]!.t;
        expect(span).toBe(spans[range]);
        // Ascending finite timestamps (the chart maps t → ms via ×1000).
        for (let i = 1; i < series.points.length; i += 1) {
          expect(series.points[i]!.t).toBeGreaterThan(series.points[i - 1]!.t);
          expect(Number.isFinite(series.points[i]!.t)).toBe(true);
        }
      }
    }
  });

  it('gives different fields different baselines (multi-line stays distinct)', async () => {
    const result = await source.query(query());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const [first, second] = result.value;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const mean = (series: HistorySeries): number =>
      series.points.reduce((sum, point) => sum + point.value, 0) /
      series.points.length;
    expect(mean(second!)).not.toBeCloseTo(mean(first!), 6);
  });

  it('respects the fields filter and falls back to the default fields', async () => {
    const explicit = await source.query(query({ fields: ['humidity'] }));
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      // One series per room × requested field.
      expect(explicit.value.map(series => series.field)).toEqual(['humidity']);
    }

    // Empty fields → the default sensor fields (same contract as Flux).
    const fallback = await source.query(query({ fields: [] }));
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.value.map(series => series.field)).toEqual([
        ...DEFAULT_HISTORY_FIELDS,
      ]);
    }
  });

  it('returns no series for a roomless query (nothing to attribute)', async () => {
    // roomId null = the Settings probe shape; demo data is per-room, so
    // there is nothing attributable to render.
    const result = await source.query(query({ roomId: null }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('synthesizes a unit-less capability series (grouped fallback bucket)', async () => {
    const result = await source.query(
      query({ fields: ['co2'], roomId: 'room-kitchen' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.roomId).toBe('room-kitchen');
    expect(result.value[0]!.field).toBe('co2');
    for (const point of result.value[0]!.points) {
      expect(Number.isFinite(point.value)).toBe(true);
    }
  });
});
