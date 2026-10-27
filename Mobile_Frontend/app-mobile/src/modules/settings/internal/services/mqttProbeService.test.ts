/**
 * mqttProbeService tests (advanced-config-stepper-redesign, D4).
 *
 * The probe is a THROWAWAY one-shot MQTT client: connect with the DRAFT
 * host/port/credentials → success/fail → ALWAYS clean up. These tests pin:
 * - success resolves `ok` and ends the client;
 * - broker auth rejections map to the typed `auth` cause (friendly UI copy);
 * - the ~8 s timeout resolves `timeout` and still ends the client;
 * - every exit path ends the client EXACTLY ONCE (never a leaked parallel
 *   connection) and late events after settle are inert;
 * - web is a typed `transport` failure before any client construction
 *   (the mdnsDiscoveryService web-guard precedent);
 * - the lazy singleton returns the same instance.
 *
 * The `mqtt` package is mocked with the same fake-client recipe as the
 * telemetry adapter tests (`mqttJsClient.test.ts`).
 */

import mqtt from 'mqtt';

import { NullLogger } from '@core/logger';

import {
  MQTT_PROBE_TIMEOUT_MS,
  MqttProbeError,
  MqttProbeService,
  classifyProbeFailure,
  getMqttProbeService,
} from './mqttProbeService';

/** Minimal fake of the `mqtt` client used by tests. */
interface TestClient {
  on(event: string, cb: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  end: jest.Mock;
}

interface MqttModuleMock {
  connect: jest.Mock & { __clients: TestClient[] };
}

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
      end: jest.fn(),
    };
    clients.push(client);
    return client;
  });
  (connect as jest.Mock & { __clients: TestClient[] }).__clients = clients;
  return { connect, default: connect }; // no __esModule: mirrors the real pkg
});

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

const mqttModule = mqtt as unknown as MqttModuleMock;

function lastClient(): TestClient {
  const clients = mqttModule.connect.__clients;
  return clients[clients.length - 1];
}

describe('classifyProbeFailure', () => {
  it('maps broker credential rejections to auth', () => {
    expect(classifyProbeFailure('Not authorized')).toBe('auth');
    expect(
      classifyProbeFailure('Connection refused: Bad user name or password'),
    ).toBe('auth');
  });

  it('maps connect timeouts to timeout', () => {
    expect(classifyProbeFailure('connect timeout')).toBe('timeout');
  });

  it('defaults unreachable hosts to network', () => {
    expect(classifyProbeFailure('ECONNREFUSED')).toBe('network');
    expect(classifyProbeFailure('WebSocket error')).toBe('network');
  });
});

describe('MqttProbeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mqttModule.connect.__clients.length = 0;
    mockPlatformOS = 'ios';
  });

  it('resolves ok on a successful connect and ends the throwaway client', async () => {
    const service = new MqttProbeService(new NullLogger());
    const pending = service.probe({
      host: '192.168.2.28',
      port: 9001,
      username: 'alice',
      password: 'secret',
    });

    expect(mqttModule.connect).toHaveBeenCalledTimes(1);
    const options = mqttModule.connect.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(options.protocol).toBe('ws');
    expect(options.host).toBe('192.168.2.28');
    expect(options.port).toBe(9001);
    expect(options.username).toBe('alice');
    expect(options.password).toBe('secret');
    // No auto-reconnect on a throwaway client.
    expect(options.reconnectPeriod).toBe(0);

    lastClient().emit('connect');
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(lastClient().end).toHaveBeenCalledTimes(1);
  });

  it('omits credentials when none are provided (no-auth brokers)', async () => {
    const service = new MqttProbeService(new NullLogger());
    const pending = service.probe({ host: 'broker.local', port: 9001 });
    lastClient().emit('connect');
    const result = await pending;

    expect(result.ok).toBe(true);
    const options = mqttModule.connect.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(options.username).toBeUndefined();
    expect(options.password).toBeUndefined();
  });

  it('maps a broker auth rejection to the typed auth cause', async () => {
    const service = new MqttProbeService(new NullLogger());
    const pending = service.probe({ host: 'broker.local', port: 9001 });
    lastClient().emit('error', new Error('Connection refused: Not authorized'));
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('auth');
      expect(result.error.message).toContain('Not authorized');
    }
    // The client is still cleaned up on the failure path.
    expect(lastClient().end).toHaveBeenCalledTimes(1);
  });

  it('maps a dropped transport (close before CONNACK) to network', async () => {
    const service = new MqttProbeService(new NullLogger());
    const pending = service.probe({ host: 'broker.local', port: 9001 });
    lastClient().emit('close');
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }
    expect(lastClient().end).toHaveBeenCalledTimes(1);
  });

  it('resolves the typed timeout after ~8 s and still ends the client', async () => {
    jest.useFakeTimers();
    try {
      const service = new MqttProbeService(new NullLogger());
      const pending = service.probe({ host: 'broker.local', port: 9001 });
      jest.advanceTimersByTime(MQTT_PROBE_TIMEOUT_MS);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
      expect(lastClient().end).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors a custom timeout window (injectable for tests)', async () => {
    jest.useFakeTimers();
    try {
      const service = new MqttProbeService(new NullLogger());
      const pending = service.probe({ host: 'broker.local', port: 9001 }, 1234);
      jest.advanceTimersByTime(1234);
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('settles exactly once: late events after success are inert', async () => {
    const service = new MqttProbeService(new NullLogger());
    const pending = service.probe({ host: 'broker.local', port: 9001 });
    lastClient().emit('connect');
    await pending;
    // Late error + close after the successful probe (and the forced end).
    lastClient().emit('error', new Error('late failure'));
    lastClient().emit('close');
    expect(lastClient().end).toHaveBeenCalledTimes(1);
  });

  it('the timeout timer is cleared when the probe settles early', async () => {
    jest.useFakeTimers();
    try {
      const service = new MqttProbeService(new NullLogger());
      const pending = service.probe({ host: 'broker.local', port: 9001 });
      lastClient().emit('connect');
      await pending;
      // Advancing past the original window must not change the settled result.
      jest.advanceTimersByTime(MQTT_PROBE_TIMEOUT_MS + 1000);
      expect(lastClient().end).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails with the typed transport error on web before any client exists', async () => {
    mockPlatformOS = 'web';
    const service = new MqttProbeService(new NullLogger());
    const result = await service.probe({ host: 'broker.local', port: 9001 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(MqttProbeError);
      expect(result.error.code).toBe('transport');
    }
    expect(mqttModule.connect).not.toHaveBeenCalled();
  });

  it('passes the normalized host to mqtt.connect', async () => {
    const service = new MqttProbeService(new NullLogger());
    const pending = service.probe({
      host: 'ws://192.168.100.3:9001',
      port: 9001,
    });
    lastClient().emit('connect');
    await pending;

    const options = mqttModule.connect.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(options.host).toBe('192.168.100.3');
  });

  it('resolves a typed network failure without any client when the host normalizes to empty', async () => {
    const service = new MqttProbeService(new NullLogger());
    const result = await service.probe({ host: 'ws://', port: 9001 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(MqttProbeError);
      expect(result.error.code).toBe('network');
    }
    expect(mqttModule.connect).not.toHaveBeenCalled();
  });

  it('getMqttProbeService returns the same lazy singleton', () => {
    expect(getMqttProbeService()).toBe(getMqttProbeService());
    expect(getMqttProbeService()).toBeInstanceOf(MqttProbeService);
  });
});
