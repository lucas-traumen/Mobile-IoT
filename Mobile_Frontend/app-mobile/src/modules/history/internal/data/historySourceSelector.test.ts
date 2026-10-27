/**
 * SelectableHistoryDataSource tests.
 *
 * The selector is the demo-mode seam: OFF (default) every query goes to the
 * real InfluxDB adapter, ON the deterministic demo source answers instead.
 * The flag is in-memory only — a fresh instance always starts OFF (the
 * composition root is rebuilt on every app launch, so the toggle resets on
 * restart). The Settings "check connection" probe is wired to the raw
 * Influx adapter elsewhere and is therefore NOT affected by the flag.
 */

import type { Logger } from '@core/logger';

import type { HistoryQuery } from '../domain/fluxQueryBuilder';
import { DemoHistoryDataSource } from './demoHistorySource';
import { InfluxV2Adapter } from './influxV2Adapter';
import { SelectableHistoryDataSource } from './historySourceSelector';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const query: HistoryQuery = {
  measurement: 'sensors',
  range: '1h',
  fields: ['temperature'],
  roomId: 'room-living',
};

/** Influx adapter with an empty config: query() errs without any network. */
function makeInflux(
  fetchSpy?: jest.Mock<Promise<Response>, [string, RequestInit]>,
): InfluxV2Adapter {
  return new InfluxV2Adapter(
    { url: '', org: '', bucket: '', token: '' },
    logger,
    fetchSpy,
  );
}

describe('SelectableHistoryDataSource', () => {
  it('starts OFF: queries route to Influx by default', async () => {
    const influx = makeInflux();
    const demo = new DemoHistoryDataSource();
    const selector = new SelectableHistoryDataSource(influx, demo);

    expect(selector.isDemoEnabled()).toBe(false);
    const result = await selector.query(query);
    // Empty-config Influx adapter → its own "not configured" error proves
    // the request reached the Influx path (demo always returns ok).
    expect(result.ok).toBe(false);
  });

  it('routes to the demo source while enabled', async () => {
    const fetchSpy = jest.fn();
    const influx = makeInflux(fetchSpy);
    const selector = new SelectableHistoryDataSource(
      influx,
      new DemoHistoryDataSource(),
    );

    selector.setDemoEnabled(true);
    expect(selector.isDemoEnabled()).toBe(true);

    const result = await selector.query(query);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.roomId).toBe('room-living');
    }
    // Demo answers without any network activity.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes back to Influx when disabled again', async () => {
    const selector = new SelectableHistoryDataSource(
      makeInflux(),
      new DemoHistoryDataSource(),
    );

    selector.setDemoEnabled(true);
    selector.setDemoEnabled(false);
    const result = await selector.query(query);
    expect(result.ok).toBe(false); // Influx "not configured" error again.
  });

  it('delegates configure() to the Influx adapter (settings changes apply in both modes)', async () => {
    const fetchSpy = jest.fn<Promise<Response>, [string, RequestInit]>(
      async () => {
        throw new Error('no network in test');
      },
    );
    const influx = makeInflux(fetchSpy);
    const selector = new SelectableHistoryDataSource(
      influx,
      new DemoHistoryDataSource(),
    );

    selector.configure('http://influx.test', 'org', 'bucket', 'token');
    await selector.query(query);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('http://influx.test');
  });

  it('the demo flag is per-instance (in-memory only, resets on restart)', () => {
    const first = new SelectableHistoryDataSource(
      makeInflux(),
      new DemoHistoryDataSource(),
    );
    first.setDemoEnabled(true);

    // A freshly built container (app restart) starts OFF again.
    const second = new SelectableHistoryDataSource(
      makeInflux(),
      new DemoHistoryDataSource(),
    );
    expect(second.isDemoEnabled()).toBe(false);
  });
});
