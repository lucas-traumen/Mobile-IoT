/**
 * Telemetry store — thin ViewModel + connection state machine.
 *
 * The store holds the MQTT connection state (`idle → connecting → connected →
 * reconnecting → failed`) and the latest validated readings. Parsing and
 * validation happen in the domain layer before the store is touched.
 */

import { create } from 'zustand';

import type { AppErrorCode } from '@core/errors';

import type { SensorTelemetry } from '@modules/telemetry/api';

/** Connection lifecycle state. */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

interface TelemetryState {
  /** MQTT connection state. */
  connection: ConnectionState;
  /**
   * Epoch-ms timestamp of the CURRENT connection-state episode's start
   * (Amendment 1, A2): re-stamped ONLY when the state actually CHANGES —
   * same-state re-emissions (e.g. the per-retry `reconnecting` events)
   * keep the original timestamp, so a "sustained reconnecting" window
   * keyed on this value measures the EPISODE, not the last retry.
   * `0` = no episode recorded yet.
   */
  connectionSince: number;
  /**
   * Machine-readable cause of the last failed connection (CP5), or null
   * while healthy. Set on `failed`/`timeout` transitions; cleared on
   * `connected` so the UI only shows a friendly label when offline.
   */
  lastErrorCode: AppErrorCode | null;
  /** Latest validated room-scoped reading, or null before the first message. */
  latest: SensorTelemetry | null;
  /** Number of readings received since connect. */
  messageCount: number;
  /**
   * Transition the connection state. `failed` records a cause (default
   * `network`); `connected` clears the recorded cause.
   */
  setConnection(state: ConnectionState, errorCode?: AppErrorCode): void;
  /** Apply a *validated* room-scoped reading. */
  applyReading(reading: SensorTelemetry): void;
}

/** The zustand store instance shape returned by {@link createTelemetryStore}. */
export type TelemetryStore = ReturnType<typeof createTelemetryStore>;

/** Create the telemetry zustand store. */
export function createTelemetryStore() {
  return create<TelemetryState>(set => ({
    connection: 'idle',
    // 0 = no episode recorded yet (stamped on the first actual change).
    connectionSince: 0,
    lastErrorCode: null,
    latest: null,
    messageCount: 0,

    setConnection: (state, errorCode) =>
      set(previous => {
        if (previous.connection === state) {
          // Same-state re-emission (episode semantics): the connectionSince
          // timestamp MUST NOT churn. `failed` keeps its CP5 error-code
          // update; every other same-state call is a no-op (zustand skips).
          if (state === 'failed') {
            return {
              ...previous,
              lastErrorCode: errorCode ?? previous.lastErrorCode ?? 'network',
            };
          }
          return previous;
        }
        // An ACTUAL state change starts a new episode.
        const connectionSince = Date.now();
        if (state === 'failed') {
          return {
            connection: state,
            lastErrorCode: errorCode ?? previous.lastErrorCode ?? 'network',
            connectionSince,
          };
        }
        if (state === 'connected') {
          return { connection: state, lastErrorCode: null, connectionSince };
        }
        return { connection: state, connectionSince };
      }),

    applyReading: reading =>
      set(state => ({
        latest: reading,
        messageCount: state.messageCount + 1,
      })),
  }));
}
