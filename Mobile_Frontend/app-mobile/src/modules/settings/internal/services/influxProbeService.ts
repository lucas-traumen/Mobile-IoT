/**
 * InfluxDB draft probe (Amendment 1, A3 — method C) — the InfluxDB half
 * of step 2's `Kiểm tra kết nối` dual probe.
 *
 * One-shot contract: {@link InfluxProbeService.probe} issues a SINGLE
 * InfluxDB v2 query against an EXPLICIT config (the DRAFT
 * url/org/bucket/token) and resolves exactly once:
 * - `ok` — the endpoint answered with a parseable CSV response;
 * - `err(InfluxProbeError)` — a typed failure cause (`auth` / `timeout` /
 *   `network` / `transport`), message short and friendly (the history
 *   adapter's own messages — never the raw response body, never the
 *   token, which only ever rides the Authorization header).
 *
 * R1 outcome (public-api seam): `@modules/history/api` exports the
 * `InfluxV2Adapter` class parameterized by an explicit `InfluxConfig` —
 * so the probe builds a THROWAWAY adapter PER PROBE (one HTTP request,
 * no persistent client) instead of duplicating the query/CSV logic with
 * a raw `fetch` inside settings. The adapter never touches the shared
 * `historyAdapter` instance, which keeps probing the PERSISTED config
 * for the status card (`onCheckInflux`) — the two surfaces stay disjoint.
 *
 * Cleanup on EVERY exit path (success / adapter error / timeout): the
 * one-shot timer is cleared and the in-flight request is ABORTED via the
 * signal the probe injects into the adapter's fetch (the adapter's
 * `FetchLike` seam is public api) — the probe can never leak a pending
 * HTTP request.
 *
 * Web safety (the `mqttProbeService` precedent): on web the probe
 * resolves a typed `transport` failure before any request. Injectable
 * seam + lazy singleton, same as `mqttProbeService`.
 */

import { Platform } from 'react-native';

import { err, ok, type AppErrorCode, type Result } from '@core/errors';
import { createLogger, type Logger } from '@core/logger';
import { InfluxV2Adapter, type FetchLike } from '@modules/history/api';

/** The one-shot probe window (~8 s, symmetric with the MQTT probe). */
export const INFLUX_PROBE_TIMEOUT_MS = 8000;

/**
 * Why a probe failed — mirrors the friendly cause taxonomy; `transport`
 * is the web guard. `auth` = the endpoint rejected the token (401/403).
 */
export type InfluxProbeErrorCode = 'auth' | 'timeout' | 'network' | 'transport';

/** Typed probe failure (`message` = a short friendly cause, non-secret). */
export class InfluxProbeError extends Error {
  constructor(readonly code: InfluxProbeErrorCode, message: string) {
    super(message);
    this.name = 'InfluxProbeError';
  }
}

/** Probe target: the EXPLICIT draft config (never the shared adapter's). */
export interface InfluxProbeConfig {
  readonly url: string;
  readonly org: string;
  readonly bucket: string;
  readonly token: string;
}

/** Probe outcome: `ok` (endpoint answered) or `err(typed)`. */
export type InfluxProbeResult = Result<void, InfluxProbeError>;

/** Map the history adapter's `AppErrorCode` onto the probe cause union. */
export function mapInfluxProbeFailure(
  code: AppErrorCode,
): InfluxProbeErrorCode {
  switch (code) {
    case 'auth':
      return 'auth';
    case 'timeout':
      return 'timeout';
    default:
      // network / validation / config / not-found / unknown — all
      // present as "the endpoint did not answer usefully".
      return 'network';
  }
}

/**
 * The screen-facing seam: exactly the surface AdvancedSettingsScreen
 * consumes for the dual probe's InfluxDB half.
 */
export interface InfluxProbeServiceLike {
  /**
   * Run one one-shot probe.
   *
   * @param config - explicit draft url/org/bucket/token.
   * @param timeoutMs - probe window (default ~8 s; injectable for tests).
   * @returns resolves exactly once; the request is always aborted.
   */
  probe(
    config: InfluxProbeConfig,
    timeoutMs?: number,
  ): Promise<InfluxProbeResult>;
}

/**
 * The real probe service. Stateless per call — every probe builds its
 * own throwaway adapter, so one lazily-shared instance is enough.
 */
export class InfluxProbeService implements InfluxProbeServiceLike {
  private readonly logger: Logger;
  private readonly fetchImpl: FetchLike;

  constructor(
    logger: Logger = createLogger('InfluxProbe'),
    fetchImpl?: FetchLike,
  ) {
    this.logger = logger;
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  probe(
    config: InfluxProbeConfig,
    timeoutMs: number = INFLUX_PROBE_TIMEOUT_MS,
  ): Promise<InfluxProbeResult> {
    // Web guard: resolve the typed transport failure before any request —
    // the flow is hidden on web anyway (user decision 2a).
    if (Platform.OS === 'web') {
      return Promise.resolve(
        err(
          new InfluxProbeError(
            'transport',
            'InfluxDB probe is not available on web',
          ),
        ),
      );
    }

    return new Promise<InfluxProbeResult>(resolve => {
      const controller = new AbortController();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      // Settle exactly once: clear the timer, abort the in-flight
      // request, THEN resolve. Runs on every exit path.
      const finish = (result: InfluxProbeResult) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          // Idempotent: aborting an already-settled request is a no-op.
          controller.abort();
        } catch (abortError: unknown) {
          this.logger.warn('InfluxDB probe abort failed', abortError);
        }
        resolve(result);
      };

      // THROWAWAY adapter per probe (history PUBLIC api): parameterized
      // by the EXPLICIT draft config; the fetch wrapper injects the
      // abort signal so the timeout can actually cancel the request.
      const adapter = new InfluxV2Adapter(
        {
          url: config.url,
          org: config.org,
          bucket: config.bucket,
          token: config.token,
        },
        this.logger,
        (url, init) =>
          this.fetchImpl(url, { ...init, signal: controller.signal }),
      );

      timer = setTimeout(() => {
        finish(
          err(
            new InfluxProbeError(
              'timeout',
              `InfluxDB probe timed out after ${timeoutMs} ms`,
            ),
          ),
        );
      }, timeoutMs);

      // The minimal probe query — the same shape the composition root's
      // explicit `onCheckInflux` uses against the PERSISTED config (here:
      // the DRAFT config). Empty fields = reachability + auth only.
      adapter
        .query({
          measurement: 'sensors',
          range: '1h',
          fields: [],
          roomId: null,
        })
        .then(result => {
          if (result.ok) {
            finish(ok(undefined));
          } else {
            finish(
              err(
                new InfluxProbeError(
                  mapInfluxProbeFailure(result.error.code),
                  result.error.message || 'InfluxDB probe failed',
                ),
              ),
            );
          }
        })
        .catch((error: unknown) => {
          finish(
            err(
              new InfluxProbeError(
                'network',
                `InfluxDB probe failed: ${String(error)}`,
              ),
            ),
          );
        });
    });
  }
}

/** Lazily-created default instance (constructed on first use). */
let defaultService: InfluxProbeService | null = null;

/**
 * The default real service (singleton). The screen resolves this when no
 * service was injected — tests always inject a fake or a scripted fetch,
 * so no real network call happens under Jest.
 */
export function getInfluxProbeService(): InfluxProbeService {
  if (defaultService === null) {
    defaultService = new InfluxProbeService();
  }
  return defaultService;
}
