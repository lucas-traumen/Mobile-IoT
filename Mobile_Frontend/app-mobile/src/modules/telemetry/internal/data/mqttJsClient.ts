/**
 * MQTT adapter over the `mqtt` npm package (pure-JS, WebSocket transport).
 *
 * Uses React Native's built-in WebSocket (mqtt v5 resolves its
 * `react-native` export condition to a WebSocket-based implementation), so no
 * native module or dev-client is required.
 *
 * Reconnect policy (M1): the library's built-in reconnect is disabled
 * (`reconnectPeriod: 0`); this adapter schedules its own reconnects with
 * exponential backoff (base 1s, factor 2, cap 30s, max 10 attempts) through
 * the injected {@link Clock}. After the final attempt the state becomes
 * `failed`, which is **terminal**: no further attempts happen until an
 * explicit {@link connect} (foreground return or settings save).
 *
 * Handler/subscription survival (B1): {@link disconnect} tears down only the
 * transport — registered handlers and subscriptions are kept, so the next
 * {@link connect} re-subscribes and keeps delivering to the same handlers.
 */

import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

import {
  DEFAULT_MQTT_CONNECT_TIMEOUT_MS,
  DEFAULT_MQTT_KEEPALIVE_SECONDS,
  MQTT_QOS,
  RECONNECT_BACKOFF_FACTOR,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
} from '@core/constants';
import { err, Errors, ok, type AppErrorCode, type Result } from '@core/errors';
import type { Logger } from '@core/logger';
import { normalizeBrokerHost } from '@core/net';
import { SystemClock, type Clock } from '@core/time';

import type {
  MqttClientPort,
  MqttConnectionConfig,
  MqttConnectionState,
  MqttMessage,
} from './mqttClientPort';

/** Compute the next backoff delay given the attempt number (1-based). */
export function backoffDelay(attempt: number): number {
  const exponential =
    RECONNECT_BASE_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, attempt - 1);
  return Math.min(exponential, RECONNECT_MAX_DELAY_MS);
}

/**
 * `mqtt` npm package adapter implementing {@link MqttClientPort}.
 *
 * State machine: `connect()` transitions to `connecting`; the broker link
 * then drives `connected`, and any unexpected close drives `reconnecting`
 * (manual exponential backoff). When the attempt budget is exhausted the
 * adapter transitions to `failed` and stops retrying until the next explicit
 * `connect()`. `disconnect()` is an intentional teardown back to `idle`.
 */
export class MqttJsClient implements MqttClientPort {
  private client: MqttClient | null = null;
  private config: MqttConnectionConfig | null = null;
  private state: MqttConnectionState = 'idle';
  private readonly subscriptions = new Set<string>();
  private readonly messageHandlers = new Set<(message: MqttMessage) => void>();
  private readonly stateHandlers = new Set<
    (state: MqttConnectionState, errorCode?: AppErrorCode) => void
  >();
  /**
   * Failure cause observed on the transport (error/close events) so the
   * terminal `failed` transition can carry a friendly code (CP5).
   */
  private pendingFailureCode: AppErrorCode | null = null;
  private reconnectAttempts = 0;
  private cancelPendingReconnect: (() => void) | null = null;
  private readonly logger: Logger;
  private readonly clock: Clock;

  constructor(logger: Logger, clock?: Clock) {
    this.logger = logger;
    this.clock = clock ?? new SystemClock();
  }

  connect(config: MqttConnectionConfig): Promise<void> {
    if (this.client) {
      this.logger.warn(
        'Mqtt: connect called while already connected; ignoring',
      );
      return Promise.resolve();
    }
    this.config = config;
    this.cancelScheduledReconnect();
    this.reconnectAttempts = 0;
    this.openClient(config);
    return Promise.resolve();
  }

  subscribe(topic: string): void {
    this.subscriptions.add(topic);
    if (this.state === 'connected' && this.client) {
      this.safeSubscribe(topic);
    }
  }

  publish(topic: string, payload: string): Result<void> {
    if (!this.client || this.state !== 'connected') {
      this.logger.warn(`Mqtt: publish to ${topic} rejected (not connected)`);
      return err(Errors.network('MQTT client is not connected'));
    }
    this.client.publish(topic, payload, { qos: MQTT_QOS });
    return ok(undefined);
  }

  disconnect(): void {
    this.cancelScheduledReconnect();
    const wasActive = this.state !== 'idle';
    // Mark idle *before* tearing the transport down so the library's
    // close/end events for this client are ignored by the state machine.
    if (wasActive) {
      this.transition('idle');
    }
    this.destroyClient();
    this.reconnectAttempts = 0;
    // Deliberate: subscriptions + handlers are kept. The next connect()
    // re-subscribes and keeps delivering to the same handlers (B1).
  }

  onMessage(handler: (message: MqttMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  onStateChange(
    handler: (state: MqttConnectionState, errorCode?: AppErrorCode) => void,
  ): void {
    this.stateHandlers.add(handler);
  }

  private openClient(config: MqttConnectionConfig): void {
    this.transition('connecting');

    // Normalize the persisted host at the connection boundary (see
    // `normalizeBrokerHost`): a scheme-bearing/URL-ish or bare-IPv6 value
    // would otherwise build a malformed `ws://` URL and crash the RN
    // WebSocket with `TypeError: Invalid URL`.
    const host = normalizeBrokerHost(config.host);
    if (host === '') {
      // Nothing usable: fail typed WITHOUT any `mqtt.connect` attempt —
      // connect() still resolves; state flows through onStateChange.
      this.logger.warn(
        `Mqtt: invalid broker host "${config.host}" — not connecting`,
      );
      this.transition('failed', 'config');
      return;
    }

    const options: IClientOptions = {
      protocol: 'ws',
      host,
      // Belt-and-braces: mqtt.js's react-native/browser build copies
      // `host` into `hostname`; passing BOTH keeps every build honest.
      hostname: host,
      port: config.port,
      keepalive: DEFAULT_MQTT_KEEPALIVE_SECONDS,
      connectTimeout: DEFAULT_MQTT_CONNECT_TIMEOUT_MS,
      // Library reconnect disabled — this adapter schedules its own attempts
      // with exponential backoff (see handleClose / retryNow).
      reconnectPeriod: 0,
      clean: true,
      clientId: `iot-dashboard-${Math.random().toString(16).slice(2, 10)}`,
      ...(config.username ? { username: config.username } : {}),
      ...(config.password ? { password: config.password } : {}),
    };

    this.logger.info(`Mqtt: connecting to ws://${host}:${config.port}`);
    const client = mqtt.connect(options);
    this.client = client;

    // Every callback below is guarded by client identity: events from stale
    // (already replaced) clients are ignored.
    client.on('connect', () => {
      if (this.client !== client) {
        return;
      }
      this.reconnectAttempts = 0;
      this.pendingFailureCode = null;
      this.transition('connected');
      for (const topic of this.subscriptions) {
        this.safeSubscribe(topic);
      }
    });

    client.on('message', (topic: string, payload: Buffer) => {
      if (this.client !== client) {
        return;
      }
      const message: MqttMessage = { topic, payload: payload.toString('utf8') };
      for (const handler of this.messageHandlers) {
        handler(message);
      }
    });

    client.on('error', (error: Error) => {
      if (this.client !== client) {
        return;
      }
      this.logger.warn(`Mqtt: error ${error.message}`);
      this.pendingFailureCode = classifyFailure(error.message);
    });

    client.on('close', () => {
      if (this.client !== client) {
        return;
      }
      this.handleClose();
    });

    client.on('end', () => {
      if (this.client !== client) {
        return;
      }
      if (this.state !== 'idle' && this.state !== 'failed') {
        this.transition('idle');
      }
    });
  }

  /** Unexpected close: schedule the next reconnect attempt with backoff. */
  private handleClose(): void {
    if (this.state === 'idle' || this.state === 'failed') {
      return;
    }
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      // Terminal `failed` state: no further attempts until an explicit
      // connect() (foreground return or settings save).
      const failureCode = this.pendingFailureCode ?? 'network';
      this.pendingFailureCode = null;
      this.destroyClient();
      this.transition('failed', failureCode);
      this.logger.warn(
        `Mqtt: giving up after ${RECONNECT_MAX_ATTEMPTS} reconnect attempts (${failureCode})`,
      );
      return;
    }
    this.reconnectAttempts += 1;
    this.transition('reconnecting');
    const delay = backoffDelay(this.reconnectAttempts);
    this.logger.debug(
      `Mqtt: reconnect attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS} in ${delay}ms`,
    );
    this.cancelPendingReconnect = this.clock.setTimeout(() => {
      this.cancelPendingReconnect = null;
      this.retryNow();
    }, delay);
  }

  private retryNow(): void {
    if (this.state !== 'reconnecting' || !this.config) {
      return; // disconnected or reconnected in the meantime
    }
    this.destroyClient();
    this.openClient(this.config);
  }

  private destroyClient(): void {
    const client = this.client;
    this.client = null;
    if (client) {
      client.end(true, {}, () => undefined);
    }
  }

  private cancelScheduledReconnect(): void {
    if (this.cancelPendingReconnect) {
      this.cancelPendingReconnect();
      this.cancelPendingReconnect = null;
    }
  }

  private safeSubscribe(topic: string): void {
    if (this.client) {
      this.client.subscribe(topic, { qos: MQTT_QOS }, error => {
        if (error) {
          this.logger.warn(
            `Mqtt: subscribe failed for ${topic}: ${error.message}`,
          );
        }
      });
    }
  }

  private transition(
    state: MqttConnectionState,
    errorCode?: AppErrorCode,
  ): void {
    this.state = state;
    for (const handler of this.stateHandlers) {
      handler(state, errorCode);
    }
  }
}

/**
 * Map a transport error message to a friendly {@link AppErrorCode} (CP5).
 *
 * mqtt.js surfaces auth rejections as "Not authorized"-style errors and
 * connect timeouts as "connect timeout" / ECONNREFUSED-style network errors.
 * Unknown messages default to `network` (the overwhelmingly common case).
 */
export function classifyFailure(message: string): AppErrorCode {
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
