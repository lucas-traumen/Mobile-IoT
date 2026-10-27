/**
 * TelemetryServiceImpl tests — boards sensor-state contract
 * (boards-topic-contract-v2).
 *
 * Verifies:
 * - start subscribes the sensor-state wildcard
 *   `<prefix>/boards/+/sensors/+/state`.
 * - a numeric message on a valid sensor-state topic resolves the descriptor
 *   channel to the semantic field (injected resolver) and emits the
 *   UNCHANGED `{roomId: boardId, field, value}` event + store reading.
 * - messages that are NOT sensor-state topics (descriptor, status, relay,
 *   legacy room shapes, garbage) are ignored SILENTLY (no warn — the
 *   fan-out must not produce "Malformed sensor topic" noise).
 * - sensor-SHAPED topics with an invalid channel (S0/S01) and non-numeric
 *   payloads are warned + dropped.
 * - readings that cannot be resolved yet (no descriptor) are BUFFERED
 *   (latest per `{boardId, channel}`, capped at 128, FIFO-evicted) and
 *   replayed through the resolver when `board:changed` fires for that board.
 * - stop → start → handlers still active (B1 regression guard).
 */

import type { SensorTelemetry } from '@modules/telemetry/api';
import { InMemoryEventBus } from '@core/eventbus';
import { ok, type Result } from '@core/errors';
import type { Logger } from '@core/logger';

import type {
  MqttClientPort,
  MqttConnectionConfig,
  MqttConnectionState,
  MqttMessage,
} from '../data/mqttClientPort';
import { createTelemetryStore } from '../data/telemetryStore';
import { TelemetryServiceImpl } from './telemetryService';

class FakeMqttClient implements MqttClientPort {
  private messageHandlers: ((m: MqttMessage) => void)[] = [];
  private stateHandlers: ((s: MqttConnectionState) => void)[] = [];
  public subscribedTopics: string[] = [];
  public connected = false;
  public connectCalls = 0;
  public disconnectCalls = 0;

  async connect(_config: MqttConnectionConfig): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
    for (const h of this.stateHandlers) {
      h('connected');
    }
  }

  subscribe(topic: string): void {
    this.subscribedTopics.push(topic);
  }

  publish(_topic: string, _payload: string): Result<void> {
    return ok(undefined);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connected = false;
    for (const h of this.stateHandlers) {
      h('idle');
    }
  }

  onMessage(handler: (message: MqttMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onStateChange(handler: (state: MqttConnectionState) => void): void {
    this.stateHandlers.push(handler);
  }

  /** Test helper: simulate an incoming MQTT message. */
  emitMessage(message: MqttMessage): void {
    for (const h of this.messageHandlers) {
      h(message);
    }
  }
}

const CONFIG: MqttConnectionConfig = {
  host: 'broker.local',
  port: 9001,
  prefix: 'home',
};

/** Swappable resolver: the test decides what the "descriptor" knows. */
type Resolver = (boardId: string, channel: string) => string | null;

function makeService(options?: {
  config?: MqttConnectionConfig;
  resolveSensorField?: Resolver;
}) {
  const client = new FakeMqttClient();
  const bus = new InMemoryEventBus(new NullLoggerTest());
  const store = createTelemetryStore();
  const warn = jest.fn();
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: message => warn(message),
    error: () => undefined,
  };
  const service = new TelemetryServiceImpl({
    client,
    bus,
    logger,
    store,
    config: options?.config ?? CONFIG,
    resolveSensorField: options?.resolveSensorField ?? (() => null),
  });
  return { client, bus, store, service, warn };
}

/** Silent logger stand-in (keeps test output clean). */
class NullLoggerTest {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

describe('TelemetryServiceImpl — subscription + channel mapping', () => {
  it('subscribes the boards sensor-state wildcard on start', async () => {
    const { client, service } = makeService();
    service.start();
    // The subscription is attached after the connect promise resolves.
    await Promise.resolve();
    expect(client.subscribedTopics).toEqual(['home/boards/+/sensors/+/state']);
  });

  it('maps a descriptor channel to the semantic field and emits the UNCHANGED event shape', () => {
    const resolver: Resolver = jest.fn(
      (_boardId, channel) =>
        ({ S1: 'temperature', S2: 'humidity' }[channel] ?? null),
    );
    const { bus, store, client, service } = makeService({
      resolveSensorField: resolver,
    });
    service.start();
    const received: SensorTelemetry[] = [];
    bus.subscribe('telemetry:received', p => received.push(p));

    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S1/state',
      payload: '25.6',
    });

    expect(received).toEqual([
      { roomId: 'board-1', field: 'temperature', value: 25.6 },
    ]);
    expect(store.getState().latest).toEqual({
      roomId: 'board-1',
      field: 'temperature',
      value: 25.6,
    });
    expect(store.getState().messageCount).toBe(1);
    // The resolver receives the exact wire identity.
    expect(resolver).toHaveBeenCalledWith('board-1', 'S1');
  });

  it('keeps handlers active across stop/start cycles (B1)', () => {
    const { bus, store, client, service } = makeService({
      resolveSensorField: (_b, channel) =>
        ({ S1: 'temperature', S2: 'humidity' }[channel] ?? null),
    });
    service.start();
    const received: SensorTelemetry[] = [];
    bus.subscribe('telemetry:received', p => received.push(p));

    service.stop();
    service.start();

    // After stop+start the fake client has been re-connected; handlers
    // registered once in the constructor must still fire.
    client.emitMessage({
      topic: 'home/boards/board-2/sensors/S2/state',
      payload: '2',
    });
    expect(received).toEqual([
      { roomId: 'board-2', field: 'humidity', value: 2 },
    ]);
    expect(store.getState().latest).toEqual({
      roomId: 'board-2',
      field: 'humidity',
      value: 2,
    });
  });

  it('re-subscribes with the new prefix on applyConfig (running)', async () => {
    const { client, service } = makeService();
    service.start();
    await Promise.resolve();
    service.applyConfig({ ...CONFIG, prefix: 'smarthome' });
    await Promise.resolve();

    expect(client.subscribedTopics).toContain(
      'smarthome/boards/+/sensors/+/state',
    );
  });
});

describe('TelemetryServiceImpl — silent ignore of non-sensor topics', () => {
  it('ignores descriptor/status/relay/legacy topics SILENTLY (no warn)', () => {
    const { store, client, service, warn } = makeService();
    service.start();

    const nonSensorTopics = [
      'home/boards/board-1/descriptor',
      'home/boards/board-1/status',
      'home/boards/board-1/relays/K1/state',
      'home/boards/board-1/relays/K1/set',
      'home/room/board-1/sensor/temperature', // legacy room shape
      'home/tele/sensor', // retired global topic
      'other/boards/board-1/sensors/S1/state', // wrong prefix
      'home/boards/board-1/sensors/S1', // malformed
      'home/boards/board-1/sensors/S1/state/extra',
      'totally/unrelated/topic',
    ];
    for (const topic of nonSensorTopics) {
      client.emitMessage({ topic, payload: '25' });
    }

    expect(warn).not.toHaveBeenCalled();
    expect(store.getState().messageCount).toBe(0);
  });

  it('WARNS for a sensor-shaped topic with an invalid channel', () => {
    const { store, client, service, warn } = makeService();
    service.start();

    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S0/state',
      payload: '25',
    });
    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S01/state',
      payload: '25',
    });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(store.getState().messageCount).toBe(0);
  });

  it('WARNS for a non-numeric payload on a valid sensor topic', () => {
    const { store, client, service, warn } = makeService();
    service.start();

    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S1/state',
      payload: 'garbage',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(store.getState().messageCount).toBe(0);
  });
});

describe('TelemetryServiceImpl — unresolved readings (buffer + replay)', () => {
  it('buffers a reading when the resolver returns null (no descriptor yet)', () => {
    const { bus, store, client, service } = makeService();
    service.start();
    const received: SensorTelemetry[] = [];
    bus.subscribe('telemetry:received', p => received.push(p));

    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S1/state',
      payload: '25.6',
    });

    expect(received).toEqual([]);
    expect(store.getState().messageCount).toBe(0);
  });

  it('replays the buffered reading through the resolver on board:changed (state-first order)', () => {
    // The resolver starts descriptor-less (null), then the "descriptor"
    // arrives before the board:changed event fires.
    let descriptorKnown = false;
    const resolver: Resolver = (_boardId, channel) =>
      descriptorKnown
        ? { S1: 'temperature', S2: 'humidity' }[channel] ?? null
        : null;
    const { bus, store, client, service } = makeService({
      resolveSensorField: resolver,
    });
    service.start();

    const received: SensorTelemetry[] = [];
    bus.subscribe('telemetry:received', p => received.push(p));

    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S1/state',
      payload: '25.6',
    });
    expect(received).toEqual([]);

    // The inventory upserts the descriptor and emits board:changed — the
    // resolver is already updated when the event fires.
    descriptorKnown = true;
    bus.emit('board:changed', { code: 'board-1' });

    expect(received).toEqual([
      { roomId: 'board-1', field: 'temperature', value: 25.6 },
    ]);
    expect(store.getState().messageCount).toBe(1);
  });

  it('buffers only the LATEST value per {boardId, channel}', () => {
    let descriptorKnown = false;
    const resolver: Resolver = (_boardId, channel) =>
      descriptorKnown ? `field-${channel}` : null;
    const { bus, store, client, service } = makeService({
      resolveSensorField: resolver,
    });
    service.start();
    const received: SensorTelemetry[] = [];
    bus.subscribe('telemetry:received', p => received.push(p));

    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S1/state',
      payload: '25.6',
    });
    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S1/state',
      payload: '26.1',
    });

    descriptorKnown = true;
    bus.emit('board:changed', { code: 'board-1' });

    // Exactly ONE replay per buffered key — the latest value wins.
    expect(received).toEqual([
      { roomId: 'board-1', field: 'field-S1', value: 26.1 },
    ]);
    expect(store.getState().messageCount).toBe(1);
  });

  it('replays only entries whose boardId matches the changed board', () => {
    let descriptorKnown = false;
    const resolver: Resolver = (_boardId, channel) =>
      descriptorKnown ? `field-${channel}` : null;
    const { bus, client, service } = makeService({
      resolveSensorField: resolver,
    });
    service.start();
    const received: SensorTelemetry[] = [];
    bus.subscribe('telemetry:received', p => received.push(p));

    client.emitMessage({
      topic: 'home/boards/board-1/sensors/S1/state',
      payload: '1',
    });
    client.emitMessage({
      topic: 'home/boards/board-2/sensors/S1/state',
      payload: '2',
    });

    descriptorKnown = true;
    bus.emit('board:changed', { code: 'board-1' });

    expect(received).toEqual([
      { roomId: 'board-1', field: 'field-S1', value: 1 },
    ]);
  });

  it('caps the buffer at 128 entries with FIFO eviction of the oldest', () => {
    let descriptorKnown = false;
    const resolver: Resolver = (_boardId, channel) =>
      descriptorKnown ? `field-${channel}` : null;
    const { bus, client, service } = makeService({
      resolveSensorField: resolver,
    });
    service.start();
    const received: SensorTelemetry[] = [];
    bus.subscribe('telemetry:received', p => received.push(p));

    // Fill the buffer with exactly 128 distinct keys (two boards × S1..S64),
    // then overflow with ONE more — the OLDEST key (board-a/S1) is evicted.
    for (let channelIndex = 1; channelIndex <= 64; channelIndex++) {
      client.emitMessage({
        topic: `home/boards/board-a/sensors/S${channelIndex}/state`,
        payload: '1',
      });
      client.emitMessage({
        topic: `home/boards/board-b/sensors/S${channelIndex}/state`,
        payload: '1',
      });
    }
    client.emitMessage({
      topic: 'home/boards/board-c/sensors/S1/state',
      payload: '1',
    });

    descriptorKnown = true;
    bus.emit('board:changed', { code: 'board-a' });

    // board-a retains S2..S64 (63 entries); S1 was FIFO-evicted.
    const boardA = received.filter(r => r.roomId === 'board-a');
    expect(boardA).toHaveLength(63);
    expect(boardA.map(r => r.field)).not.toContain('field-S1');
    expect(boardA.map(r => r.field)).toContain('field-S2');
    expect(boardA.map(r => r.field)).toContain('field-S64');
  });
});
