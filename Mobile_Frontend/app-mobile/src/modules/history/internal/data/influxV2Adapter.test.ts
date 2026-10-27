import { NullLogger } from '@core/logger';

import { InfluxV2Adapter, type FetchLike } from './influxV2Adapter';

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/csv' },
  });
}

const csvBody =
  '#datatype,string,dateTime:RFC3339,string,double\n' +
  ',result,table,_time,_field,_value\n' +
  ',0,0,2026-08-28T00:00:00Z,temperature,25.5\n' +
  ',0,1,2026-08-28T00:00:01Z,humidity,60.2\n';

describe('InfluxV2Adapter', () => {
  const config = {
    url: 'http://192.168.1.10:8086',
    org: 'iot',
    bucket: 'sensors',
    token: 'secret-token',
  };

  it('maps a successful response to series', async () => {
    const fetchImpl: FetchLike = jest.fn(async (url, init) => {
      expect(url).toBe('http://192.168.1.10:8086/api/v2/query?org=iot');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: 'Token secret-token',
        Accept: 'application/csv',
      });
      return jsonResponse(csvBody);
    });

    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    const result = await adapter.query({
      measurement: 'temperature',
      range: '1h',
      fields: [],
      roomId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const temperature = result.value.find(s => s.field === 'temperature');
      expect(temperature?.points).toEqual([
        { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 25.5 },
      ]);
    }
  });

  // influx-ipv6-url-normalization: defense in depth for OLD malformed
  // persisted values — an unbracketed IPv6 base still reaches fetch as a
  // valid bracketed query URL (History AND the Influx probe share this
  // adapter boundary).
  it('repairs a malformed persisted IPv6 base URL before the query request', async () => {
    let requestedUrl = '';
    const fetchImpl: FetchLike = jest.fn(async url => {
      requestedUrl = url;
      return jsonResponse(csvBody);
    });
    const adapter = new InfluxV2Adapter(
      { ...config, url: 'http://fe80::9b78:6845:8077:4ce2:9001:8086' },
      new NullLogger(),
      fetchImpl,
    );
    const result = await adapter.query({
      measurement: 'temperature',
      range: '1h',
      fields: [],
      roomId: null,
    });
    expect(result.ok).toBe(true);
    expect(requestedUrl).toBe(
      'http://[fe80::9b78:6845:8077:4ce2:9001]:8086/api/v2/query?org=iot',
    );
  });

  it('sends the roomId filter + keep/group columns (approved contract)', async () => {
    let body = '';
    const fetchImpl: FetchLike = jest.fn(async (_url, init) => {
      body = String(init.body);
      return jsonResponse(csvBody);
    });
    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    const result = await adapter.query({
      measurement: 'sensors',
      range: '1h',
      fields: ['temperature'],
      roomId: 'room-living',
    });
    expect(result.ok).toBe(true);
    expect(body).toContain('r._measurement == "sensors"');
    expect(body).toContain('r._field == "temperature"');
    expect(body).toContain('r.roomId == "room-living"');
    expect(body).toContain(
      'keep(columns: ["_time", "_field", "_value", "roomId"])',
    );
    expect(body).toContain('group(columns: ["roomId", "_field"])');
  });

  it('omits the room filter when roomId is null (connection probe)', async () => {
    let body = '';
    const fetchImpl: FetchLike = jest.fn(async (_url, init) => {
      body = String(init.body);
      return jsonResponse(csvBody);
    });
    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    await adapter.query({
      measurement: 'sensors',
      range: '1h',
      fields: [],
      roomId: null,
    });
    expect(body).not.toContain('roomId ==');
  });

  it('returns auth error on 401', async () => {
    const fetchImpl: FetchLike = jest.fn(async () =>
      jsonResponse('unauthorized', 401),
    );
    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    const result = await adapter.query({
      measurement: 'temperature',
      range: '24h',
      fields: [],
      roomId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
    }
  });

  it('returns network error on HTTP 500', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => jsonResponse('boom', 500));
    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    const result = await adapter.query({
      measurement: 'temperature',
      range: '7d',
      fields: [],
      roomId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }
  });

  it('returns network error when fetch rejects', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    const result = await adapter.query({
      measurement: 'temperature',
      range: '1h',
      fields: [],
      roomId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }
  });

  it('returns validation error on an unparsable CSV body', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => jsonResponse('not-a-csv'));
    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    const result = await adapter.query({
      measurement: 'temperature',
      range: '1h',
      fields: [],
      roomId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });

  // dashboard-history-board-touch-share (AD-2): the old "first 500 raw
  // points" head-trim is NOT the chart policy anymore — a series larger
  // than 500 points (a 24h range from a chatty sensor BEFORE aggregation
  // was introduced, or a defensive-cap-sized series) must survive intact
  // up to the defensive cap well above the largest expected window (168).
  it('does NOT head-trim a series at 500 points (the 500-point splice is gone)', async () => {
    const pointCount = 600;
    const rows = Array.from(
      { length: pointCount },
      (_, i) =>
        `,0,0,2026-08-28T00:${String(Math.floor(i / 60)).padStart(
          2,
          '0',
        )}:${String(i % 60).padStart(2, '0')}Z,temperature,${20 + i * 0.01}`,
    );
    const csv = ',result,table,_time,_field,_value\n' + rows.join('\n') + '\n';
    const fetchImpl: FetchLike = jest.fn(async () => jsonResponse(csv));
    const adapter = new InfluxV2Adapter(config, new NullLogger(), fetchImpl);
    const result = await adapter.query({
      measurement: 'sensors',
      range: '24h',
      fields: ['temperature'],
      roomId: 'room-living',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const temperature = result.value.find(s => s.field === 'temperature');
      expect(temperature?.points).toHaveLength(pointCount);
      // The LAST point survives — the old behavior dropped it.
      expect(temperature?.points[pointCount - 1]?.value).toBeCloseTo(25.99);
    }
  });
});
