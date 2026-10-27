/**
 * MQTT connection probe (advanced-config-stepper-redesign, D4) — the
 * `Kiểm tra kết nối` engine of the guided flow's step 2 (Xác thực).
 *
 * One-shot contract: {@link MqttProbeService.probe} creates a THROWAWAY
 * `mqtt` client (WebSocket transport — the same pure-JS recipe as the
 * telemetry adapter, no native module), connects to the DRAFT host/port
 * with the DRAFT credentials, and resolves exactly once:
 * - `ok` — the broker answered CONNACK (`connect` event);
 * - `err(MqttProbeError)` — a typed failure cause (`auth` / `timeout` /
 *   `network` / `transport`) carrying the lib's message when available.
 *
 * Cleanup runs on EVERY exit path (success, lib error, dropped transport,
 * timeout): the one-shot timer is cleared and the client is force-ended,
 * so the probe can never leak a parallel MQTT connection next to the real
 * telemetry client — this service NEVER touches the shared client.
 *
 * Web safety (the `mdnsDiscoveryService` precedent): on web the probe
 * resolves a typed `transport` failure BEFORE any client construction —
 * the `mqtt` package is never even instantiated on the web path. (The
 * guided setup flow is additionally hidden on web — user decision 2a — so
 * the guard is defense in depth.)
 *
 * Injectable seam (the `MdnsDiscoveryServiceLike` precedent): tests and
 * the screen consume {@link MqttProbeServiceLike}; the real singleton is
 * resolved lazily via {@link getMqttProbeService}.
 */

import { Platform } from 'react-native';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

import { DEFAULT_MQTT_KEEPALIVE_SECONDS } from '@core/constants';
import { err, ok, type Result } from '@core/errors';
import { createLogger, type Logger } from '@core/logger';
import { normalizeBrokerHost } from '@core/net';

/** The one-shot probe window (~8 s per the approved plan). */
export const MQTT_PROBE_TIMEOUT_MS = 8000;

/**
 * Why a probe failed — `auth`/`timeout`/`network` mirror the friendly
 * cause taxonomy the telemetry client surfaces for the real connection;
 * `transport` is the web guard (the probe never runs there).
 */
export type MqttProbeErrorCode = 'auth' | 'timeout' | 'network' | 'transport';

/** Typed probe failure (`message` = the lib's cause when available). */
export class MqttProbeError extends Error {
  constructor(readonly code: MqttProbeErrorCode, message: string) {
    super(message);
    this.name = 'MqttProbeError';
  }
}

/** Probe target: the DRAFT broker config (never the persisted one). */
export interface MqttProbeConfig {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
}

/** Probe outcome: `ok` (broker answered) or `err(typed)`. */
export type MqttProbeResult = Result<void, MqttProbeError>;

/**
 * The screen-facing seam: exactly the surface
 * AdvancedSettingsScreen consumes for `Kiểm tra kết nối`.
 */
export interface MqttProbeServiceLike {
  /**
   * Run one one-shot probe.
   *
   * @param config - draft host/port (+ credentials unless "no auth").
   * @param timeoutMs - probe window (default ~8 s; injectable for tests).
   * @returns resolves exactly once; the throwaway client is always ended.
   */
  probe(config: MqttProbeConfig, timeoutMs?: number): Promise<MqttProbeResult>;
}

/**
 * Map a transport error message to a typed probe cause.
 *
 * Deliberate local wordlist: the telemetry module's `classifyFailure`
 * lives behind that module's internal — cross-module internal imports are
 * forbidden by the boundary rules, and the probe's union adds `transport`.
 * Keep the two wordlists in sync (same backlog pattern as the zod
 * cross-pin note in KNOWN_ISSUES).
 */
export function classifyProbeFailure(message: string): MqttProbeErrorCode {
  const lower = message.toLowerCase();
  if (
    lower.includes('not authorized') ||
    lower.includes('unauthorized') ||
    lower.includes('bad user name or password') ||
    lower.includes('refused: bad username or password')
  ) {
    return 'auth';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }
  return 'network';
}

/**
 * The real probe service. Stateless per call — every probe builds its own
 * throwaway client, so one lazily-shared instance is enough.
 */
export class MqttProbeService implements MqttProbeServiceLike {
  private readonly logger: Logger;

  constructor(logger: Logger = createLogger('MqttProbe')) {
    this.logger = logger;
  }

  probe(
    config: MqttProbeConfig,
    timeoutMs: number = MQTT_PROBE_TIMEOUT_MS,
  ): Promise<MqttProbeResult> {
    // Web guard (AD-4 pattern): resolve the typed transport failure before
    // any `mqtt` construction — the lib is never instantiated on web.
    if (Platform.OS === 'web') {
      return Promise.resolve(
        err(
          new MqttProbeError('transport', 'MQTT probe is not available on web'),
        ),
      );
    }

    // Normalize the DRAFT host at the connection boundary (see
    // `normalizeBrokerHost`) BEFORE building options — a scheme-bearing
    // or bare-IPv6 value would otherwise build a malformed `ws://` URL.
    const host = normalizeBrokerHost(config.host);
    if (host === '') {
      // Nothing usable: typed failure WITHOUT constructing any client
      // (the web-guard early-return pattern).
      return Promise.resolve(
        err(new MqttProbeError('network', 'Invalid broker host')),
      );
    }

    return new Promise<MqttProbeResult>(resolve => {
      let client: MqttClient;
      try {
        const options: IClientOptions = {
          protocol: 'ws',
          host,
          port: config.port,
          keepalive: DEFAULT_MQTT_KEEPALIVE_SECONDS,
          connectTimeout: timeoutMs,
          // Throwaway client: the library's auto-reconnect is disabled —
          // a probe that fails is a RESULT, never a retry loop.
          reconnectPeriod: 0,
          clean: true,
          clientId: `iot-probe-${Math.random().toString(16).slice(2, 10)}`,
          ...(config.username ? { username: config.username } : {}),
          ...(config.password ? { password: config.password } : {}),
        };
        client = mqtt.connect(options);
      } catch (startError: unknown) {
        this.logger.warn('MQTT probe failed to start', startError);
        resolve(
          err(new MqttProbeError('network', 'MQTT probe could not start')),
        );
        return;
      }

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      // Settle exactly once: clear the timer, force-end the throwaway
      // client, THEN resolve. Runs on every exit path (success / lib error
      // / dropped transport / timeout) so no parallel connection can leak.
      const finish = (result: MqttProbeResult) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          client.end(true, {}, () => undefined);
        } catch (endError: unknown) {
          // Ending an already-dead client is a harmless no-op — never mask
          // the probe result with a cleanup failure.
          this.logger.warn('MQTT probe cleanup failed', endError);
        }
        resolve(result);
      };

      timer = setTimeout(() => {
        finish(
          err(
            new MqttProbeError(
              'timeout',
              `MQTT probe timed out after ${timeoutMs} ms`,
            ),
          ),
        );
      }, timeoutMs);

      client.on('connect', () => {
        finish(ok(undefined));
      });

      client.on('error', (error: Error) => {
        finish(
          err(
            new MqttProbeError(
              classifyProbeFailure(error.message),
              error.message || 'MQTT probe failed',
            ),
          ),
        );
      });

      client.on('close', () => {
        // A close before any terminal event = the transport dropped before
        // the broker answered (refused TCP, dead WS). After a settle the
        // guard makes this inert (our own force-end also emits close).
        finish(
          err(
            new MqttProbeError(
              'network',
              'Connection closed before the broker answered',
            ),
          ),
        );
      });
    });
  }
}

/** Lazily-created default instance (constructed on first use). */
let defaultService: MqttProbeService | null = null;

/**
 * The default real service (singleton). The screen resolves this when no
 * service was injected — tests always inject a fake, so the `mqtt` lib is
 * never driven under Jest (the BoardsScreen BLE / mDNS precedent).
 */
export function getMqttProbeService(): MqttProbeService {
  if (defaultService === null) {
    defaultService = new MqttProbeService();
  }
  return defaultService;
}
