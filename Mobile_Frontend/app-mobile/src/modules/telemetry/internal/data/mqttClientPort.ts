/**
 * MQTT client port (hexagonal: the telemetry/relay modules depend on this
 * interface, not on any concrete MQTT library).
 */

import type { AppErrorCode, Result } from '@core/errors';

/** A received MQTT message. */
export interface MqttMessage {
  readonly topic: string;
  /** UTF-8 decoded payload. */
  readonly payload: string;
}

/** Connection configuration for the MQTT client. */
export interface MqttConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  /** Topic prefix used to build subscription/command topics. */
  readonly prefix: string;
}

/**
 * Low-level MQTT client abstraction over WebSocket transport.
 * Lifecycle: {@link connect} → connected (or reconnecting) → {@link disconnect}.
 */
export interface MqttClientPort {
  /**
   * Connect to the broker. Resolves when the WebSocket is established;
   * connection state transitions are reported through `onStateChange`.
   */
  connect(config: MqttConnectionConfig): Promise<void>;

  /**
   * Subscribe to a topic. Called after connect; the adapter re-subscribes
   * automatically after a reconnect.
   */
  subscribe(topic: string): void;

  /**
   * Publish a message to a topic.
   * @param topic - destination topic.
   * @param payload - UTF-8 payload.
   * @returns `ok` when the payload was handed to the transport; `err` with
   *   code `network` when the client is not connected (nothing is published).
   */
  publish(topic: string, payload: string): Result<void>;

  /**
   * Disconnect cleanly. Safe to call multiple times.
   *
   * The transport is torn down, but registered handlers and subscriptions
   * survive: a later {@link connect} re-subscribes and keeps delivering to
   * the same handlers.
   */
  disconnect(): void;

  /**
   * Register a message handler. Multiple handlers are supported; they all
   * receive every message. Registrations survive {@link disconnect} and
   * reconnect cycles.
   */
  onMessage(handler: (message: MqttMessage) => void): void;

  /**
   * Register a connection-state handler. Multiple handlers are supported.
   * Registrations survive {@link disconnect} and reconnect cycles.
   *
   * The optional second argument carries the failure cause when the state is
   * `failed` (CP5: `network` for unreachable brokers, `auth` for rejected
   * credentials, `timeout` for connect timeouts) so the store can surface a
   * friendly label.
   */
  onStateChange(
    handler: (state: MqttConnectionState, errorCode?: AppErrorCode) => void,
  ): void;
}

/** Connection state as seen by the client port. */
export type MqttConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';
