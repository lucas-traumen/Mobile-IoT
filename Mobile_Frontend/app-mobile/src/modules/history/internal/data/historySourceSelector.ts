/**
 * Selectable history data source — the demo-mode seam.
 *
 * Wraps the real {@link InfluxV2Adapter} and the deterministic
 * {@link DemoHistoryDataSource} behind the SAME
 * {@link HistoryDataSourcePort}. OFF (default) every query goes to Influx
 * exactly as before; ON (Settings "Dữ liệu demo (lịch sử)" toggle) the demo
 * source answers instead. `configure` always reaches the Influx adapter so
 * `settings:changed` keeps working in both modes — and the Settings
 * "check connection" probe can keep using the raw Influx adapter, so demo
 * mode can never fake a successful connectivity check.
 *
 * The flag is IN-MEMORY ONLY: it lives on this instance (built by the
 * composition root once per app launch) and resets to OFF on restart —
 * fake data must never silently replace real data across restarts.
 */

import type { Result } from '@core/errors';

import type { HistoryQuery, HistorySeries } from '../domain/fluxQueryBuilder';
import type { DemoHistoryDataSource } from './demoHistorySource';
import type { InfluxV2Adapter } from './influxV2Adapter';

/** Port + the demo-mode selection surface (in-memory). */
export interface SelectableHistoryDataSourcePort {
  query(query: HistoryQuery): Promise<Result<HistorySeries[]>>;
  /** Turn demo data on/off (in-memory, resets to OFF on app restart). */
  setDemoEnabled(enabled: boolean): void;
  /** Current demo state (initializes the Settings toggle). */
  isDemoEnabled(): boolean;
}

/**
 * Front door for every UI history query: routes to demo or Influx per the
 * in-memory flag while `configure` stays delegated to Influx.
 */
export class SelectableHistoryDataSource
  implements SelectableHistoryDataSourcePort
{
  private demoEnabled = false;

  constructor(
    private readonly influx: InfluxV2Adapter,
    private readonly demo: DemoHistoryDataSource,
  ) {}

  /** Turn demo data on/off (in-memory, resets to OFF on app restart). */
  setDemoEnabled(enabled: boolean): void {
    this.demoEnabled = enabled;
  }

  /** Current demo state (initializes the Settings toggle). */
  isDemoEnabled(): boolean {
    return this.demoEnabled;
  }

  /** Update the Influx connection config (called on `settings:changed`). */
  configure(url: string, org: string, bucket: string, token: string): void {
    this.influx.configure(url, org, bucket, token);
  }

  async query(query: HistoryQuery): Promise<Result<HistorySeries[]>> {
    return this.demoEnabled ? this.demo.query(query) : this.influx.query(query);
  }
}
