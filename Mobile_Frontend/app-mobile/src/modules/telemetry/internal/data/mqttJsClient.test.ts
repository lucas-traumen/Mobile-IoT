/**
 * MqttJsClient regression tests.
 *
 * Verifies:
 * - B1: handlers + subscriptions survive disconnect(); the next connect()
 *   re-subscribes and keeps delivering to the same handlers.
 * - M1: unexpected close schedules reconnects with exponential backoff
 *   (via the injected FakeClock), capped at RECONNECT_MAX_DELAY_MS, and
 *   after the attempt budget the state becomes `failed` (terminal).
 * - publish() while not connected is rejected with a Result.err.
 */

import mqtt from 'mqtt';

import { MQTT_QOS } from '@core/constants';
import { NullLogger } from '@core/logger';
import { FakeClock } from '@core/time';

import { backoffDelay, classifyFailure, MqttJsClient } from './mqttJsClient';
import type { MqttConnectionConfig } from './mqttClientPort';

/** Minimal fake of the `mqtt` client used by tests. */
interface TestClient {
  on(event: string, cb: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  subscribe: jest.Mock;
  publish: jest.Mock;
  end: jest.Mock;
}

interface MqttModuleMock {
  connect: jest.Mock & { __clients: TestClient[] };
}

const CONFIG: MqttConnectionConfig = {
  host: 'broker.local',
  port: 9001,
  prefix: 'home',
};

jest.mock('mqtt', () => {
  const clients: TestClient[] = [];
  const connect = jest.fn(() => {
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    const client: TestClient = {
      on: (event, cb) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
      },
      emit: (event, ...args) => {
        for (const cb of handlers.get(event) ?? []) {
          cb(...args);
        }
      },
      subscribe: jest.fn(),
      publish: jest.fn(),
      end: jest.fn(),
    };
    clients.push(client);
    return client;
  });
  (connect as jest.Mock & { __clients: TestClient[] }).__clients = clients;
  return { connect, default: connect }; // no __esModule: mirrors the real pkg
});

const mqttModule = mqtt as unknown as MqttModuleMock;

function lastClient(): TestClient {
  const clients = mqttModule.connect.__clients;
  return clients[clients.length - 1];
}

describe('classifyFailure (CP5)', () => {
  it('maps broker credential rejections to auth', () => {
    expect(classifyFailure('Not authorized')).toBe('auth');
    expect(
      classifyFailure('Connection refused: Bad username or password'),
    ).toBe('auth');
  });

  it('maps connect timeouts to timeout', () => {
    expect(classifyFailure('connect timeout')).toBe('timeout');
  });

  it('defaults unreachable hosts to network', () => {
    expect(classifyFailure('ECONNREFUSED')).toBe('network');
    expect(classifyFailure('some unknown transport error')).toBe('network');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and caps at the max delay', () => {
    expect(backoffDelay(1)).toBe(1_000);
    expect(backoffDelay(2)).toBe(2_000);
    expect(backoffDelay(3)).toBe(4_000);
    expect(backoffDelay(6)).toBe(30_000); // capped at RECONNECT_MAX_DELAY_MS
    expect(backoffDelay(10)).toBe(30_000);
  });

  it('never returns a delay below the base or above the cap', () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const delay = backoffDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
  });
});

describe('MqttJsClient', () => {
  let clock: FakeClock;
  let client: MqttJsClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mqttModule.connect.__clients.length = 0;
    clock = new FakeClock();
    client = new MqttJsClient(new NullLogger(), clock);
  });

  it('re-subscribes and keeps handlers across disconnect/connect (B1)', () => {
    client.connect(CONFIG);
    client.subscribe('home/tele/sensor');
    const received: string[] = [];
    client.onMessage(message => received.push(message.payload));

    // First connection: subscription + message delivery works.
    lastClient().emit('connect');
    expect(lastClient().subscribe).toHaveBeenCalledWith(
      'home/tele/sensor',
      { qos: MQTT_QOS },
      expect.any(Function),
    );
    lastClient().emit('message', 'home/tele/sensor', Buffer.from('25.5'));
    expect(received).toEqual(['25.5']);

    // Intentional teardown → idle.
    const disconnected: string[] = [];
    client.onStateChange(state => disconnected.push(state));
    client.disconnect();
    expect(disconnected).toContain('idle');

    // Reconnect: handlers + subscriptions were NOT lost.
    client.connect(CONFIG);
    lastClient().emit('connect');
    expect(lastClient().subscribe).toHaveBeenCalledWith(
      'home/tele/sensor',
      { qos: MQTT_QOS },
      expect.any(Function),
    );
    lastClient().emit('message', 'home/tele/sensor', Buffer.from('26.0'));
    expect(received).toEqual(['25.5', '26.0']);
  });

  it('reconnects with exponential backoff on unexpected close (M1)', () => {
    client.connect(CONFIG);
    const states: string[] = [];
    client.onStateChange(state => states.push(state));

    lastClient().emit('close');
    expect(states).toContain('reconnecting');
    // No retry before the first backoff elapses.
    expect(mqttModule.connect.__clients).toHaveLength(1);
    clock.advance(1_000);
    expect(mqttModule.connect.__clients).toHaveLength(2); // retry opened a new client

    lastClient().emit('close');
    clock.advance(2_000); // second attempt, delay doubled
    expect(mqttModule.connect.__clients).toHaveLength(3);
  });

  it('gives up after the attempt budget → failed (terminal)', () => {
    client.connect(CONFIG);
    const states: string[] = [];
    client.onStateChange(state => states.push(state));

    let closes = 0;
    while (closes < 11) {
      lastClient().emit('close');
      closes += 1;
      clock.advance(backoffDelay(closes));
    }

    expect(states[states.length - 1]).toBe('failed');
    const clientsAfterFailure = mqttModule.connect.__clients.length;
    lastClient().emit('close');
    expect(mqttModule.connect.__clients.length).toBe(clientsAfterFailure); // no retry
  });

  it('rejects publish when not connected (M3)', () => {
    const result = client.publish('home/cmnd/relay/1', 'ON');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }

    client.connect(CONFIG);
    lastClient().emit('connect');
    client.disconnect();
    const afterDisconnect = client.publish('home/cmnd/relay/1', 'ON');
    expect(afterDisconnect.ok).toBe(false);
  });

  it('subscribes and publishes with QoS 1 (boards contract v2)', () => {
    client.connect(CONFIG);
    client.subscribe('smarthome/boards/+/sensors/+/state');
    lastClient().emit('connect');

    expect(lastClient().subscribe).toHaveBeenCalledWith(
      'smarthome/boards/+/sensors/+/state',
      { qos: 1 },
      expect.any(Function),
    );

    client.publish('smarthome/boards/board-1/relays/K1/set', 'ON');
    expect(lastClient().publish).toHaveBeenCalledWith(
      'smarthome/boards/board-1/relays/K1/set',
      'ON',
      // QoS 1; the relay `set` command is NOT retained (mqtt.js default).
      { qos: 1 },
    );
  });

  it('carries the classified failure code on the terminal failed transition (CP5)', () => {
    client.connect(CONFIG);
    const failedCodes: (string | undefined)[] = [];
    client.onStateChange((state, errorCode) => {
      if (state === 'failed') {
        failedCodes.push(errorCode);
      }
    });

    lastClient().emit('error', new Error('Not authorized'));
    let closes = 0;
    while (closes < 11) {
      lastClient().emit('close');
      closes += 1;
      clock.advance(backoffDelay(closes));
    }
    expect(failedCodes).toEqual(['auth']);
  });

  it('normalizes a URL-ish host before handing it to mqtt.connect', () => {
    client.connect({ ...CONFIG, host: 'ws://192.168.100.3:9001' });
    const options = mqttModule.connect.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(options.host).toBe('192.168.100.3');
    expect(options.hostname).toBe('192.168.100.3');
  });

  it('bracket-wraps a bare IPv6 host before handing it to mqtt.connect', () => {
    client.connect({ ...CONFIG, host: 'fe80::1' });
    const options = mqttModule.connect.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(options.host).toBe('[fe80::1]');
    expect(options.hostname).toBe('[fe80::1]');
  });

  it('fails typed with ZERO connect attempts when the host normalizes to empty', () => {
    const states: { state: string; errorCode?: string }[] = [];
    client.onStateChange((state, errorCode) =>
      states.push({ state, errorCode }),
    );

    client.connect({ ...CONFIG, host: 'ws://' });

    expect(mqttModule.connect).not.toHaveBeenCalled();
    expect(mqttModule.connect.__clients).toHaveLength(0);
    const last = states[states.length - 1];
    expect(last.state).toBe('failed');
    expect(last.errorCode).toBe('config');
  });

  it('defaults to a network failure code when no transport error was seen', () => {
    client.connect(CONFIG);
    const failedCodes: (string | undefined)[] = [];
    client.onStateChange((state, errorCode) => {
      if (state === 'failed') {
        failedCodes.push(errorCode);
      }
    });

    let closes = 0;
    while (closes < 11) {
      lastClient().emit('close');
      closes += 1;
      clock.advance(backoffDelay(closes));
    }
    expect(failedCodes).toEqual(['network']);
  });
});
