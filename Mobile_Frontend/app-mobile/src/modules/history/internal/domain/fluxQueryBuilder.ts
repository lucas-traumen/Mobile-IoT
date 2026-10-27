/**
 * History domain: Flux query builder + response mapping (pure functions).
 *
 * Approved room-sensor contract (room-sensor-derived-history-layout-rework):
 * the collector stores `sensors` rows tagged with the app room id (`roomId`
 * tag) and the sensor field as the Influx field key. Queries carry a
 * {@link HistoryQuery} value object; results are separate series per
 * `roomId + field` so two rooms never mix and each field stays its own card.
 */

import { z } from 'zod';

import { Errors, err, ok, type Result } from '@core/errors';

/** Supported history ranges (displayed in the UI). */
export type HistoryRange = '1h' | '24h' | '7d';

/**
 * Default sensor fields queried when no explicit field list is given
 * (back-compat with the pre-catalog two-sensor layout / the raw probe).
 */
export const DEFAULT_HISTORY_FIELDS: readonly string[] = [
  'temperature',
  'humidity',
];

/** Range → Flux duration literal. */
export const RANGE_TO_DURATION: Record<HistoryRange, string> = {
  '1h': '1h',
  '24h': '24h',
  '7d': '7d',
};

/**
 * Range → `aggregateWindow` bucket size (dashboard-history-board-touch-
 * share, AD-2): the phone never receives raw per-second points — the
 * server aggregates each range into fixed-size mean buckets so a 1h chart
 * is ~60 points, 24h ~96 and 7d ~168, regardless of the sensor's publish
 * rate. Second-level spikes are intentionally invisible at these ranges.
 */
export const RANGE_TO_AGGREGATION: Record<HistoryRange, string> = {
  '1h': '1m',
  '24h': '15m',
  '7d': '1h',
};

/**
 * CP-R5 query value object — everything one history request needs, carried
 * as a single argument instead of parallel optional parameters.
 */
export interface HistoryQuery {
  /** InfluxDB measurement (e.g. `sensors`). */
  readonly measurement: string;
  /** History range. */
  readonly range: HistoryRange;
  /**
   * Sensor fields (Influx `_field` keys) to fetch; empty list falls back
   * to {@link DEFAULT_HISTORY_FIELDS}.
   */
  readonly fields: readonly string[];
  /**
   * `roomId` tag filter (approved identity: the query matches the room's
   * rows). `null` = no room filter (the Settings raw probe / all rooms).
   */
  readonly roomId: string | null;
  /**
   * `boardId` tag filter (boards-topic-contract-v2, decision 1): the
   * backend's direct-Influx contract tags real-board rows with the board
   * id. When set, the query filters `boardId` INSTEAD of `roomId` and keeps
   * BOTH tag columns (boardId stays a plain column; the group key remains
   * `roomId + _field`). Unset/`null` → the exact historical roomId behavior.
   */
  readonly boardId?: string | null;
}

/** Escaping for Flux string literals (backslash + double-quote). */
export function escapeFluxString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build a Flux query returning `_time`, `_field`, `_value` (+ the identity
 * tags) for the query object's measurement/range/fields/room.
 *
 * Identity (boards-topic-contract-v2): when `query.boardId` is set the
 * query filters the `boardId` tag INSTEAD of `roomId` (the backend's direct
 * Influx contract for real-board rows) and keeps BOTH tag columns —
 * `boardId` stays a plain column while the group key remains
 * `roomId + _field`, so series pairing stays mechanical. Without `boardId`
 * the exact historical roomId behavior applies.
 *
 * @param bucket - InfluxDB bucket (escaped into the query).
 * @param query - the query value object (measurement, range, fields, tags).
 * @returns the Flux query string.
 */
export function buildFluxQuery(bucket: string, query: HistoryQuery): string {
  const b = escapeFluxString(bucket);
  const m = escapeFluxString(query.measurement);
  const duration = RANGE_TO_DURATION[query.range];
  const wanted =
    query.fields.length > 0 ? query.fields : DEFAULT_HISTORY_FIELDS;
  const fieldFilter = wanted
    .map(field => `r._field == "${escapeFluxString(field)}"`)
    .join(' or ');
  const lines = [
    `from(bucket: "${b}")`,
    `  |> range(start: -${duration})`,
    `  |> filter(fn: (r) => r._measurement == "${m}")`,
    `  |> filter(fn: (r) => ${fieldFilter})`,
  ];
  const boardId = query.boardId ?? null;
  if (boardId !== null) {
    lines.push(
      `  |> filter(fn: (r) => r.boardId == "${escapeFluxString(boardId)}")`,
    );
  } else if (query.roomId !== null) {
    lines.push(
      `  |> filter(fn: (r) => r.roomId == "${escapeFluxString(query.roomId)}")`,
    );
  }
  lines.push(
    boardId !== null
      ? `  |> keep(columns: ["_time", "_field", "_value", "roomId", "boardId"])`
      : `  |> keep(columns: ["_time", "_field", "_value", "roomId"])`,
    `  |> group(columns: ["roomId", "_field"])`,
    // AD-2 (dashboard-history-board-touch-share): aggregate per series
    // (the group above defines the series identity) into fixed-size mean
    // buckets. `createEmpty: false` keeps empty buckets from becoming
    // fake zero points. The aggregation DROPS non-group-key columns
    // (e.g. the plain `boardId` column) — `parseFluxCsv` already pairs
    // board-bound rows by the group-key `roomId` tag (documented 1:1
    // contract), so the mapped series identity is unchanged.
    `  |> aggregateWindow(every: ${
      RANGE_TO_AGGREGATION[query.range]
    }, fn: mean, createEmpty: false)`,
  );
  return lines.join('\n');
}

/** One chart point after mapping. */
export interface HistoryPoint {
  /** Unix epoch seconds. */
  readonly t: number;
  readonly value: number;
}

/**
 * The mapped result of one history query — one series per identity tag +
 * field. Series identity is `(boardId ?? roomId) + field`
 * (boards-topic-contract-v2): board-bound rows carry the `boardId` tag and
 * pair by it; legacy rows pair by `roomId`. `roomId` is `null` for rows
 * without the tag and `boardId` is `null`/absent for legacy rows (they
 * cannot be attributed to a board; collector migration is required —
 * documented in the README).
 */
export interface HistorySeries {
  /** Room the series belongs to (`null` = untagged legacy row). */
  readonly roomId: string | null;
  /**
   * Board the series belongs to (`null`/absent = legacy row without the
   * `boardId` tag). Present on real-backend rows (1:1 with `roomId` there).
   */
  readonly boardId?: string | null;
  /** Sensor field name (e.g. 'temperature', or a custom catalog type). */
  readonly field: string;
  readonly points: HistoryPoint[];
}

/** CSV row shape from the InfluxDB v2 CSV response. */
const CsvRowSchema = z.object({
  _time: z.string(),
  _field: z.string(),
  _value: z.union([z.string(), z.number()]),
});

/**
 * Parse the InfluxDB v2 annotated CSV response into
 * `{roomId, field}`-identified series.
 *
 * The `roomId` column is optional: legacy CSVs (or untagged rows) parse
 * with `roomId: null` instead of being guessed into a room.
 */
export function parseFluxCsv(
  csv: string,
  fields: readonly string[] = DEFAULT_HISTORY_FIELDS,
): Result<HistorySeries[]> {
  // InfluxDB v2 annotates the CSV with `#datatype`, `#group`, `#default`
  // lines before the header row — skip those.
  const lines = csv
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) {
    return ok([]);
  }

  const header = lines[0];
  if (!header.includes('_field')) {
    return err(
      Errors.validation('InfluxDB CSV response is missing the _field column'),
    );
  }
  const columns = header.split(',');
  const fieldIdx = columns.indexOf('_field');
  const timeIdx = columns.indexOf('_time');
  const valueIdx = columns.indexOf('_value');
  const roomIdx = columns.indexOf('roomId');
  const boardIdx = columns.indexOf('boardId');
  if (fieldIdx < 0 || timeIdx < 0 || valueIdx < 0) {
    return err(
      Errors.validation('InfluxDB CSV response is missing required columns'),
    );
  }

  // Series identity is `(boardId ?? roomId) + field`
  // (boards-topic-contract-v2): board-bound rows pair by the board tag,
  // legacy rows keep the historical roomId pairing.
  const series = new Map<
    string,
    {
      roomId: string | null;
      boardId: string | null;
      field: string;
      points: HistoryPoint[];
    }
  >();

  for (const line of lines.slice(1)) {
    if (line === '') {
      continue;
    }
    // Values may contain commas when quoted — take the naive split; the
    // Influx CSV for numeric _value does not quote numbers.
    const cells = splitCsvLine(line);
    if (cells.length <= Math.max(fieldIdx, timeIdx, valueIdx)) {
      continue;
    }
    const field = cells[fieldIdx];
    const rawTime = cells[timeIdx];
    const rawValue = cells[valueIdx];
    // Group-key columns repeat per table block; a repeated header row parses
    // to an invalid _time below and is skipped naturally.
    const roomId =
      roomIdx >= 0 && cells.length > roomIdx && cells[roomIdx] !== ''
        ? cells[roomIdx]
        : null;
    const boardId =
      boardIdx >= 0 && cells.length > boardIdx && cells[boardIdx] !== ''
        ? cells[boardIdx]
        : null;

    const parsed = CsvRowSchema.safeParse({
      _time: rawTime,
      _field: field,
      _value: rawValue,
    });
    if (!parsed.success) {
      continue;
    }
    const t = Date.parse(parsed.data._time) / 1000;
    if (Number.isNaN(t)) {
      continue;
    }
    const value = Number(parsed.data._value);
    if (!Number.isFinite(value)) {
      continue;
    }
    const identityTag = boardId ?? roomId;
    const identity = `${identityTag ?? ''}|${field}`;
    let entry = series.get(identity);
    if (!entry) {
      entry = { roomId, boardId, field, points: [] };
      series.set(identity, entry);
    }
    entry.points.push({ t, value });
  }

  const allowed = new Set(fields.length > 0 ? fields : DEFAULT_HISTORY_FIELDS);
  const result: HistorySeries[] = [];
  for (const entry of series.values()) {
    if (!allowed.has(entry.field)) {
      // B2: do not silently collapse unknown fields into temperature.
      continue;
    }
    result.push({
      roomId: entry.roomId,
      boardId: entry.boardId,
      field: entry.field,
      points: entry.points,
    });
  }
  return ok(result);
}
/** Split one CSV line respecting double-quoted cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
