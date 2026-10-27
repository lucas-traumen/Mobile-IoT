/**
 * Demo history data source — deterministic fake series for the History tab.
 *
 * Used by the Settings "Dữ liệu demo (lịch sử)" toggle (in-memory, resets to
 * OFF on restart): when enabled, the app's history data path routes here
 * instead of {@link InfluxV2Adapter} so the charts render immediately
 * without a configured InfluxDB.
 *
 * Contract (approved room-sensor rework):
 * - Implements the SAME {@link HistoryDataSourcePort} as the Influx adapter
 *   — no new port, Influx stays the default.
 * - Synthesizes one series per requested `roomId × field` (the approved
 *   `roomId + _field` identity) — it never invents rooms or fields; a room
 *   with no registered sensors still shows the existing no-sensors hint.
 * - ~48 points per series spanning the requested range window; gentle
 *   sinusoidal waves + seeded noise so each field shows a distinct line.
 * - Deterministic: a seeded PRNG (mulberry32) keyed by
 *   `measurement | range | roomId | field` — the same query always yields
 *   the same output (Jest-stable; no `Math.random`, no wall clock).
 */

import { ok, type Result } from '@core/errors';

import type { HistoryQuery, HistorySeries } from '../domain/fluxQueryBuilder';
import { DEFAULT_HISTORY_FIELDS } from '../domain/fluxQueryBuilder';
import type { HistoryDataSourcePort } from './influxV2Adapter';

/** Points per series (locked decision: ~48). */
const POINTS_PER_SERIES = 48;

/**
 * Fixed demo window anchor: 2026-09-01T12:00:00Z (epoch seconds).
 *
 * Demo x-axes intentionally show a fixed reference window instead of live
 * wall-clock time: combined with the seeded PRNG this makes the output a
 * PURE function of the query, so identical queries are byte-identical
 * (the locked determinism decision).
 */
const DEMO_ANCHOR_SECONDS = 1788264000;

/** Range window in seconds (mirrors the Flux duration literals). */
const RANGE_SECONDS: Record<HistoryQuery['range'], number> = {
  '1h': 3600,
  '24h': 86400,
  '7d': 604800,
};

/** Value-shape profile per field family. */
interface FieldProfile {
  /** Mid-line value (room offset is added on top). */
  readonly base: number;
  /** Sinusoidal amplitude around the offset baseline. */
  readonly amplitude: number;
  /** Half-span of the per-point seeded noise. */
  readonly noise: number;
  /** Span of the per-room baseline offset (0 → offsetSpan). */
  readonly offsetSpan: number;
}

/**
 * Known field families get realistic ranges; any other (custom catalog)
 * field — including unit-less ones — uses the generic profile so the
 * grouped fallback bucket always has drawable data.
 */
const FIELD_PROFILES: Record<string, FieldProfile> = {
  temperature: { base: 24, amplitude: 2.5, noise: 0.4, offsetSpan: 4 },
  humidity: { base: 58, amplitude: 6, noise: 1.5, offsetSpan: 12 },
};
const GENERIC_PROFILE: FieldProfile = {
  base: 100,
  amplitude: 8,
  noise: 2,
  offsetSpan: 40,
};

/** FNV-1a 32-bit string hash (stable across runs — seed derivation). */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — tiny seeded PRNG (deterministic 0..1 floats). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One decimal of precision keeps values realistic and float-stable. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Demo/fake history data source (see the module doc). Stateless — the
 * output depends only on the query.
 */
export class DemoHistoryDataSource implements HistoryDataSourcePort {
  async query(query: HistoryQuery): Promise<Result<HistorySeries[]>> {
    const fields =
      query.fields.length > 0 ? query.fields : DEFAULT_HISTORY_FIELDS;
    if (query.roomId === null) {
      // No room filter → nothing attributable (demo data is always
      // room-tagged; the Settings probe keeps using the Influx adapter).
      return ok([]);
    }
    const series = fields.map(field => this.synthesizeSeries(query, field));
    return ok(series);
  }

  /** One deterministic series for the query's room + one field. */
  private synthesizeSeries(query: HistoryQuery, field: string): HistorySeries {
    const rng = mulberry32(
      hashString(
        `${query.measurement}|${query.range}|${query.roomId}|${field}`,
      ),
    );
    const profile = FIELD_PROFILES[field] ?? GENERIC_PROFILE;
    const offset = rng() * profile.offsetSpan;
    const phase = rng() * Math.PI * 2;

    const span = RANGE_SECONDS[query.range];
    const step = span / (POINTS_PER_SERIES - 1);
    const last = POINTS_PER_SERIES - 1;
    const points = Array.from({ length: POINTS_PER_SERIES }, (_, i) => {
      const t = DEMO_ANCHOR_SECONDS - (last - i) * step;
      // Two gentle cycles over the window + seeded noise.
      const wave = Math.sin((i / last) * Math.PI * 4 + phase);
      const noise = (rng() - 0.5) * 2 * profile.noise;
      return {
        t,
        value: round1(profile.base + offset + wave * profile.amplitude + noise),
      };
    });
    return { roomId: query.roomId, field, points };
  }
}
