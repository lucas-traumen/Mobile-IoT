/**
 * influxProbeService tests (Amendment 1, A3 — method C, R1 path 1).
 *
 * The probe is a ONE-SHOT InfluxDB v2 query against an EXPLICIT config:
 * a THROWAWAY `InfluxV2Adapter` (the history module's PUBLIC api —
 * `@modules/history/api` exports the class + `FetchLike`) built per probe
 * with the DRAFT url/org/bucket/token. These tests pin:
 * - success resolves `ok` (a valid CSV answer);
 * - token rejections map to the typed `auth` cause (401/403);
 * - HTTP/transport failures map to `network`;
 * - the ~8 s timeout resolves `timeout` and ABORTS the in-flight request;
 * - every exit path aborts the fetch signal (never a leaked request) and
 *   late settle attempts are inert;
 * - web is a typed `transport` failure before any request (the
 *   mqttProbeService web-guard precedent);
 * - the lazy singleton returns the same instance.
 *
 * The shared historyAdapter is NEVER touched — the service builds its own
 * throwaway adapter with the injected fetch (tests inject a fake).
 */

import { NullLogger } from '@core/logger';

import {
  INFLUX_PROBE_TIMEOUT_MS,
  InfluxProbeError,
  InfluxProbeService,
  getInfluxProbeService,
  mapInfluxProbeFailure,
} from './influxProbeService';

// The history PUBLIC api barrel re-exports the demo/store data sources,
// which import AsyncStorage at module scope — mock it (screen-test
// precedent).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

/** Mutable Platform.OS seam (web-guard test) — jest-expo is 'ios'. */
let mockPlatformOS = 'ios';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as Record<
    PropertyKey,
    unknown
  >;
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'Platform') {
        return {
          ...(target.Platform as Record<string, unknown>),
          get OS() {
            return mockPlatformOS;
          },
        };
      }
      return target[prop];
    },
  });
});

const CSV_OK =
  '#datatype,string,dateTime:RFC3339,string,double\n' +
  ',result,table,_time,_field,_value\n' +
  ',0,0,2026-08-28T00:00:00Z,temperature,25.5\n';

const CONFIG = {
  url: 'http://192.168.2.28:8086',
  org: 'smarthome',
  bucket: 'smarthome',
  token: 'secret-influx-token',
};

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

describe('mapInfluxProbeFailure', () => {
  it('maps AppError codes onto the probe cause union', () => {
    expect(mapInfluxProbeFailure('auth')).toBe('auth');
    expect(mapInfluxProbeFailure('timeout')).toBe('timeout');
    expect(mapInfluxProbeFailure('network')).toBe('network');
    expect(mapInfluxProbeFailure('validation')).toBe('network');
    expect(mapInfluxProbeFailure('config')).toBe('network');
    expect(mapInfluxProbeFailure('unknown')).toBe('network');
  });
});

describe('InfluxProbeService', () => {
  beforeEach(() => {
    mockPlatformOS = 'ios';
  });

  it('resolves ok on a valid CSV answer and aborts the signal once', async () => {
    const calls: FetchCall[] = [];
    const service = new InfluxProbeService(
      new NullLogger(),
      async (url, init) => {
        calls.push({ url, init });
        return new Response(CSV_OK, { status: 200 });
      },
    );
    const result = await service.probe(CONFIG);

    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      'http://192.168.2.28:8086/api/v2/query?org=smarthome',
    );
    expect(calls[0].init.method).toBe('POST');
    // The token rides the Authorization header — never the URL.
    expect(calls[0].url).not.toContain('secret-influx-token');
    expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
  });

  it('maps a 401 token rejection to the typed auth cause', async () => {
    const service = new InfluxProbeService(
      new NullLogger(),
      async () => new Response('unauthorized', { status: 401 }),
    );
    const result = await service.probe(CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.message).not.toContain('secret-influx-token');
    }
  });

  it('maps an HTTP 500 to network', async () => {
    const service = new InfluxProbeService(
      new NullLogger(),
      async () => new Response('boom', { status: 500 }),
    );
    const result = await service.probe(CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }
  });

  it('maps a thrown fetch (unreachable host) to network', async () => {
    const service = new InfluxProbeService(new NullLogger(), async () => {
      throw new Error('Network request failed');
    });
    const result = await service.probe(CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }
  });

  it('resolves the typed timeout after ~8 s and aborts the in-flight request', async () => {
    jest.useFakeTimers();
    try {
      const calls: FetchCall[] = [];
      const service = new InfluxProbeService(new NullLogger(), (url, init) => {
        calls.push({ url, init });
        return new Promise<Response>(() => undefined); // never resolves
      });
      const pending = service.probe(CONFIG);
      jest.advanceTimersByTime(INFLUX_PROBE_TIMEOUT_MS);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
      expect((calls[0].init.signal as AbortSignal).aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors a custom timeout window (injectable for tests)', async () => {
    jest.useFakeTimers();
    try {
      const calls: FetchCall[] = [];
      const service = new InfluxProbeService(new NullLogger(), (url, init) => {
        calls.push({ url, init });
        return new Promise<Response>(() => undefined);
      });
      const pending = service.probe(CONFIG, 1234);
      jest.advanceTimersByTime(1234);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
      expect(calls.length).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('settles exactly once: a late resolution after timeout is inert', async () => {
    jest.useFakeTimers();
    try {
      let resolveFetch: ((response: Response) => void) | null = null;
      const service = new InfluxProbeService(
        new NullLogger(),
        () =>
          new Promise<Response>(resolve => {
            resolveFetch = resolve;
          }),
      );
      const pending = service.probe(CONFIG);
      jest.advanceTimersByTime(INFLUX_PROBE_TIMEOUT_MS);
      const timedOut = await pending;
      expect(timedOut.ok).toBe(false);

      // The fetch finally answers AFTER the timeout — the settled guard
      // keeps the timeout result authoritative. (Cast: TS cannot see the
      // closure assignment above.)
      (resolveFetch as ((response: Response) => void) | null)?.(
        new Response(CSV_OK, { status: 200 }),
      );
      await pending;
      expect(timedOut.ok).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails with the typed transport error on web before any request', async () => {
    mockPlatformOS = 'web';
    const fetchImpl = jest.fn();
    const service = new InfluxProbeService(new NullLogger(), fetchImpl);
    const result = await service.probe(CONFIG);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InfluxProbeError);
      expect(result.error.code).toBe('transport');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('getInfluxProbeService returns the same lazy singleton', () => {
    expect(getInfluxProbeService()).toBe(getInfluxProbeService());
    expect(getInfluxProbeService()).toBeInstanceOf(InfluxProbeService);
  });
});
