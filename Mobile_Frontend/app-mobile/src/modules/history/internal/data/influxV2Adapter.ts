/**
 * InfluxDB v2 data source: HTTP query API adapter (read-only, Bearer token).
 */

import {
  INFLUX_QUERY_PATH,
  INFLUX_TOKEN_HEADER,
  INFLUX_TOKEN_PREFIX,
} from '@core/constants';
import { normalizeInfluxBaseUrl } from '@core/net';
import { Errors, err, ok, type Result } from '@core/errors';
import type { Logger } from '@core/logger';

import type { HistoryQuery } from '../domain/fluxQueryBuilder';
import {
  buildFluxQuery,
  parseFluxCsv,
  type HistorySeries,
} from '../domain/fluxQueryBuilder';

/**
 * Defensive point cap (dashboard-history-board-touch-share, AD-2): the
 * chart policy is SERVER-SIDE aggregation (`aggregateWindow` — ~60/96/168
 * points for the 1h/24h/7d ranges), so the old "first 500 raw points"
 * head-trim is gone — it clipped every chatty series to its first minutes
 * and skewed the stats. This cap remains only as a safety net ABOVE the
 * largest expected window (168); it must never be what makes a 1h chart
 * show only its first minutes.
 */
const HISTORY_DEFENSIVE_MAX_POINTS = 2000;

/** InfluxDB connection settings (read-only). */
export interface InfluxConfig {
  readonly url: string;
  readonly org: string;
  readonly bucket: string;
  readonly token: string;
}

/** Port: history data source. */
export interface HistoryDataSourcePort {
  /**
   * Query sensor series for a query value object (CP-R5).
   * @param query - measurement + range + fields + `deviceId` tag filter.
   * @returns `ok(series)` (one per deviceId+field) or `err`
   *   (`network`/`auth`/`validation`).
   */
  query(query: HistoryQuery): Promise<Result<HistorySeries[]>>;
}

/** Fetch function shape (injectable for tests). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * InfluxDB v2 adapter over the HTTP query API.
 *
 * - Requests `POST {url}/api/v2/query?org={org}` with `Accept:
 *   application/csv`, `Authorization: Token {token}`.
 * - Maps the CSV response to {@link HistorySeries} (deviceId+field identity).
 */
export class InfluxV2Adapter implements HistoryDataSourcePort {
  private config: InfluxConfig;
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;

  constructor(config: InfluxConfig, logger: Logger, fetchImpl?: FetchLike) {
    this.config = config;
    this.logger = logger;
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** Update the connection config (called on `settings:changed`). */
  configure(url: string, org: string, bucket: string, token: string): void {
    this.config = { url, org, bucket, token };
  }

  async query(query: HistoryQuery): Promise<Result<HistorySeries[]>> {
    if (!this.config.url || !this.config.bucket) {
      return err(
        Errors.config(
          'InfluxDB is not configured — set URL/bucket/token in Settings first',
        ),
      );
    }
    const flux = buildFluxQuery(this.config.bucket, query);
    // influx-ipv6-url-normalization (defense in depth): OLD persisted
    // values may carry the broken unbracketed IPv6 base; repair it here
    // so BOTH History and the Influx probe send a valid URL. The
    // persisted settings themselves are never mutated or logged.
    const baseUrl = normalizeInfluxBaseUrl(this.config.url);
    const url = `${baseUrl.replace(
      /\/+$/,
      '',
    )}${INFLUX_QUERY_PATH}?org=${encodeURIComponent(this.config.org)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.flux',
          Accept: 'application/csv',
          [INFLUX_TOKEN_HEADER]: `${INFLUX_TOKEN_PREFIX}${this.config.token}`,
        },
        body: flux,
      });
    } catch (e) {
      return err(Errors.network(`InfluxDB request failed: ${String(e)}`, e));
    }

    if (response.status === 401 || response.status === 403) {
      return err(Errors.auth('InfluxDB rejected the token (401/403)'));
    }
    if (!response.ok) {
      return err(
        Errors.network(`InfluxDB query failed with HTTP ${response.status}`),
      );
    }

    let body: string;
    try {
      body = await response.text();
    } catch (e) {
      return err(Errors.network('InfluxDB response could not be read', e));
    }

    const parsed = parseFluxCsv(body, query.fields);
    if (!parsed.ok) {
      return parsed;
    }
    // Defensive cap only (see the constant doc): aggregated series are
    // far below it, so this can never head-trim a real windowed chart.
    for (const series of parsed.value) {
      series.points.splice(HISTORY_DEFENSIVE_MAX_POINTS);
    }
    this.logger.debug(
      `InfluxDB: ${parsed.value.length} series for ${query.measurement}/${query.range}`,
    );
    return ok(parsed.value);
  }
}
