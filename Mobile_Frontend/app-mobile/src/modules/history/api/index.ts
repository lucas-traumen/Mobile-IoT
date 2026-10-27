/**
 * History module — public facade.
 *
 * The only entry point other modules may use. Everything else lives in
 * `internal/` and must not be imported across modules (enforced by
 * `eslint-plugin-boundaries`).
 */

export type {
  HistoryQuery,
  HistoryRange,
  HistoryPoint,
  HistorySeries,
} from '../internal/domain/fluxQueryBuilder';
export {
  buildFluxQuery,
  DEFAULT_HISTORY_FIELDS,
  escapeFluxString,
  parseFluxCsv,
  RANGE_TO_DURATION,
} from '../internal/domain/fluxQueryBuilder';
/** Min/Max/Trung bình statistics for a series (pure). */
export { computeSeriesStats } from '../internal/domain/seriesStats';
export type { SeriesStats } from '../internal/domain/seriesStats';
/** Room + optional saved sensor-widget scope → fields/query (pure). */
export {
  historyQueryForRoom,
  sensorFieldsForRoom,
} from '../internal/domain/roomSensorFields';
export type {
  InfluxConfig,
  HistoryDataSourcePort,
  FetchLike,
} from '../internal/data/influxV2Adapter';
export { InfluxV2Adapter } from '../internal/data/influxV2Adapter';
/**
 * Demo/fake history source (Settings "Dữ liệu demo (lịch sử)" toggle):
 * deterministic per-device series, no network, no persistence.
 */
export { DemoHistoryDataSource } from '../internal/data/demoHistorySource';
/**
 * Demo↔Influx selector behind the same port (the demo seam). Influx is the
 * default; the demo flag is in-memory only and resets to OFF on restart.
 */
export { SelectableHistoryDataSource } from '../internal/data/historySourceSelector';
export type { SelectableHistoryDataSourcePort } from '../internal/data/historySourceSelector';
export { createHistoryStore } from '../internal/data/historyStore';
export type { HistoryStore } from '../internal/data/historyStore';
