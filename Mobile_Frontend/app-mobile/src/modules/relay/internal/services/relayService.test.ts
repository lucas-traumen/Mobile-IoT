/**
 * RelayServiceImpl tests — boards contract v2 with the command
 * acknowledgement timeout (M13-4, deterministic FakeClock).
 *
 * Verifies:
 * - commands publish exactly `<prefix>/boards/<boardId>/relays/K<n>/set`
 *   with an optimistic store update + `relay:command` event;
 * - publish failure rejects without optimistic state (M3);
 * - a MATCHING state message confirms the pending command (state + pending
 *   cleared, timer cancelled);
 * - a NON-matching state message while pending applies the state WITHOUT
 *   clearing pending (stale retained old state cannot ack a toggle);
 * - timeout (FakeClock): rollback to the pre-command state (known previous)
 *   or slot deletion (unknown previous), pending cleared, typed
 *   `relay:commandFailed` emitted;
 * - a stale timer callback (generation guard) after confirm does nothing;
 * - a second command for the SAME address while pending is rejected;
 *   different addresses stay independent;
 * - equal slots in two rooms stay isolated end-to-end.
 */

import { InMemoryEventBus } from '@core/eventbus';
import { RELAY_COMMAND_TIMEOUT_MS } from '@core/constants';
import { err, Errors, ok, type Result } from '@core/errors';
import { createLogger } from '@core/logger';
import { FakeClock } from '@core/time';

import type {
  MqttClientPort,
  MqttConnectionConfig,
  MqttConnectionState,
  MqttMessage,
} from '@modules/telemetry/api';
import {
  createRelayStore,
  relayPendingOf,
  relaySlotKey,
  relayStateOf,
} from '../data/relayStore';
import type { RelayAddress } from '../domain/commands';
import { RelayServiceImpl } from './relayService';

const LIVING: RelayAddress = { roomId: 'board-1', index: 1 };
const BEDROOM: RelayAddress = { roomId: 'board-2', index: 1 };

class FakeMqttClient implements MqttClientPort {
  public subscribedTopics: string[] = [];
  public published: { topic: string; payload: string }[] = [];
  public publishResult = ok(undefined) as Result<void>;

  async connect(_config: MqttConnectionConfig): Promise<void> {}
  subscribe(topic: string): void {
    this.subscribedTopics.push(topic);
  }
  publish(topic: string, payload: string): Result<void> {
    this.published.push({ topic, payload });
    return this.publishResult;
  }
  disconnect(): void {}
  onMessage(_handler: (message: MqttMessage) => void): void {}
  onStateChange(_handler: (state: MqttConnectionState) => void): void {}
}

function makeService(options?: { prefix?: string; client?: FakeMqttClient }): {
  bus: InMemoryEventBus;
  client: FakeMqttClient;
  store: ReturnType<typeof createRelayStore>;
  clock: FakeClock;
  service: RelayServiceImpl;
} {
  const bus = new InMemoryEventBus(createLogger('test'));
  const client = options?.client ?? new FakeMqttClient();
  const store = createRelayStore();
  const clock = new FakeClock();
  const service = new RelayServiceImpl({
    client,
    bus,
    logger: createLogger('test'),
    store,
    prefix: options?.prefix ?? 'home',
    clock,
  });
  return { bus, client, store, clock, service };
}

describe('RelayServiceImpl.setRelay (boards topics)', () => {
  it('publishes to `<prefix>/boards/<boardId>/relays/K<n>/set` and applies optimistic state', () => {
    const { bus, client, store, service } = makeService();
    const commands: unknown[] = [];
    bus.subscribe('relay:command', c => commands.push(c));

    const result = service.setRelay(LIVING, 'ON');

    expect(result.ok).toBe(true);
    expect(client.published).toEqual([
      { topic: 'home/boards/board-1/relays/K1/set', payload: 'ON' },
    ]);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(true);
    expect(commands).toEqual([{ roomId: 'board-1', index: 1, state: 'ON' }]);
  });

  it('accepts slots up to 10 (K10)', () => {
    const { client, service } = makeService();
    expect(service.setRelay({ roomId: 'board-a', index: 10 }, 'ON').ok).toBe(
      true,
    );
    expect(client.published[0]?.topic).toBe(
      'home/boards/board-a/relays/K10/set',
    );
  });

  it('rejects slots 0/11, malformed ids and unknown states without publishing', () => {
    const { client, service } = makeService();
    expect(service.setRelay({ roomId: 'b', index: 0 as 1 }, 'ON').ok).toBe(
      false,
    );
    expect(service.setRelay({ roomId: 'b', index: 11 as 1 }, 'ON').ok).toBe(
      false,
    );
    expect(service.setRelay({ roomId: '', index: 1 }, 'ON').ok).toBe(false);
    expect(service.setRelay({ roomId: 'a/b', index: 1 }, 'ON').ok).toBe(false);
    expect(service.setRelay(LIVING, 'TOGGLE').ok).toBe(false);
    expect(client.published).toEqual([]);
  });

  it('isolates equal slots in different rooms (no aliasing)', () => {
    const { store, service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    expect(service.setRelay(BEDROOM, 'OFF').ok).toBe(true);

    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayStateOf(store.getState().states, BEDROOM)).toBe('OFF');
  });

  it('rejects the command without changing state or pending when publish fails (M3)', () => {
    const failedClient = new FakeMqttClient();
    failedClient.publishResult = err(
      Errors.network('MQTT client is not connected'),
    );
    const { store, service } = makeService({ client: failedClient });

    const result = service.setRelay(LIVING, 'ON');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }
    expect(relayStateOf(store.getState().states, LIVING)).toBe('OFF');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
  });

  it('REJECTS a second command for the SAME address while one is pending', () => {
    const { client, service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);

    const second = service.setRelay(LIVING, 'OFF');

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('validation');
      expect(second.error.message).toMatch(/already in flight/i);
    }
    // Nothing new was published; the first command stays the live one.
    expect(client.published).toEqual([
      { topic: 'home/boards/board-1/relays/K1/set', payload: 'ON' },
    ]);
  });

  it('DIFFERENT addresses are independent (no cross-address pending lock)', () => {
    const { service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    expect(service.setRelay(BEDROOM, 'OFF').ok).toBe(true);
  });
});

describe('RelayServiceImpl.handleFeedbackMessage (state topic ack)', () => {
  it('confirms a pending command when the state MATCHES the request', () => {
    const { bus, store, clock, service } = makeService();
    const feedbacks: unknown[] = [];
    bus.subscribe('relay:feedback', f => feedbacks.push(f));

    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    const matched = service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'ON',
    });

    expect(matched).toBe(true);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
    expect(feedbacks).toEqual([{ roomId: 'board-1', index: 1, state: 'ON' }]);

    // The ack cancels the pending timeout: advancing the clock is a no-op.
    clock.advance(RELAY_COMMAND_TIMEOUT_MS + 1);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
  });

  it('applies a NON-matching state without clearing pending (stale retained state)', () => {
    const { bus, store, clock, service } = makeService();
    const feedbacks: unknown[] = [];
    bus.subscribe('relay:feedback', f => feedbacks.push(f));

    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    const matched = service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'OFF',
    });

    expect(matched).toBe(true);
    // The state is applied (device-reported reality) but the command stays
    // pending — OFF is likely the stale retained pre-command state.
    expect(relayStateOf(store.getState().states, LIVING)).toBe('OFF');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(true);
    expect(feedbacks).toEqual([{ roomId: 'board-1', index: 1, state: 'OFF' }]);

    // The real ack can still arrive later and confirm.
    service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'ON',
    });
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);

    // And the timeout never fires for the confirmed command.
    clock.advance(RELAY_COMMAND_TIMEOUT_MS + 1);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
  });

  it('applies state with NO pending command (store stays fresh)', () => {
    const { store, service } = makeService();
    const matched = service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'ON',
    });

    expect(matched).toBe(true);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
  });

  it('matches the configured (non-default) prefix (M2)', () => {
    const { service } = makeService({ prefix: 'factory/house-a' });
    expect(
      service.handleFeedbackMessage({
        topic: 'home/boards/b1/relays/K1/state',
        payload: 'ON',
      }),
    ).toBe(false);
    expect(
      service.handleFeedbackMessage({
        topic: 'factory/house-a/boards/b1/relays/K1/state',
        payload: 'ON',
      }),
    ).toBe(true);
  });

  it('escapes regex metacharacters in the configured prefix', () => {
    const { service } = makeService({ prefix: 'a.b' });
    expect(
      service.handleFeedbackMessage({
        topic: 'aXb/boards/b1/relays/K1/state',
        payload: 'ON',
      }),
    ).toBe(false);
    expect(
      service.handleFeedbackMessage({
        topic: 'a.b/boards/b1/relays/K1/state',
        payload: 'ON',
      }),
    ).toBe(true);
  });

  it('ignores wrong prefixes, set topics and foreign structures', () => {
    const { service } = makeService();
    expect(
      service.handleFeedbackMessage({
        topic: 'office/boards/b1/relays/K1/state',
        payload: 'ON',
      }),
    ).toBe(false);
    // The legacy room-shape stat topic no longer matches (clean cut).
    expect(
      service.handleFeedbackMessage({
        topic: 'home/room/r1/stat/relay/1',
        payload: 'ON',
      }),
    ).toBe(false);
    expect(
      service.handleFeedbackMessage({
        topic: 'home/boards/b1/relays/K1/set',
        payload: 'ON',
      }),
    ).toBe(false);
    expect(
      service.handleFeedbackMessage({
        topic: 'home/boards/b1/relays/K1/state/extra',
        payload: 'ON',
      }),
    ).toBe(false);
  });

  it('ignores channels outside K1..K10', () => {
    const { service } = makeService();
    expect(
      service.handleFeedbackMessage({
        topic: 'home/boards/b1/relays/K0/state',
        payload: 'ON',
      }),
    ).toBe(false);
    expect(
      service.handleFeedbackMessage({
        topic: 'home/boards/b1/relays/K11/state',
        payload: 'ON',
      }),
    ).toBe(false);
    expect(
      service.handleFeedbackMessage({
        topic: 'home/boards/b1/relays/K01/state',
        payload: 'ON',
      }),
    ).toBe(false);
  });

  it('ignores invalid state payloads on a matching topic', () => {
    const { bus, service } = makeService();
    const feedbacks: unknown[] = [];
    bus.subscribe('relay:feedback', f => feedbacks.push(f));

    expect(
      service.handleFeedbackMessage({
        topic: 'home/boards/b1/relays/K1/state',
        payload: 'MAYBE',
      }),
    ).toBe(true);
    expect(feedbacks).toHaveLength(0);
  });

  it('confirms exactly the addressed room+slot (room isolation end-to-end)', () => {
    const { store, service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    expect(service.setRelay(BEDROOM, 'ON').ok).toBe(true);

    // Only the board-1 slot gets a matching state.
    service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'OFF',
    });

    // board-1: OFF applied but still pending; board-2 untouched (pending).
    expect(relayStateOf(store.getState().states, LIVING)).toBe('OFF');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(true);
    expect(relayStateOf(store.getState().states, BEDROOM)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, BEDROOM)).toBe(true);
  });
});

describe('RelayServiceImpl timeout (M13-4, deterministic FakeClock)', () => {
  it('rolls back to the KNOWN pre-command state and emits relay:commandFailed', () => {
    const { bus, store, clock, service } = makeService();
    // Establish a known pre-command state: ON confirmed.
    service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'ON',
    });

    const failures: unknown[] = [];
    bus.subscribe('relay:commandFailed', f => failures.push(f));

    expect(service.setRelay(LIVING, 'OFF').ok).toBe(true);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('OFF');

    clock.advance(RELAY_COMMAND_TIMEOUT_MS);

    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
    expect(failures).toEqual([
      {
        roomId: 'board-1',
        index: 1,
        attempted: 'OFF',
        previous: 'ON',
        error: expect.objectContaining({ code: 'timeout' }),
      },
    ]);
  });

  it('rolls back to an UNKNOWN pre-command state by deleting the slot key', () => {
    const { bus, store, clock, service } = makeService();
    const failures: unknown[] = [];
    bus.subscribe('relay:commandFailed', f => failures.push(f));

    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');

    clock.advance(RELAY_COMMAND_TIMEOUT_MS);

    // The slot key is GONE — honest unknown, not an invented OFF.
    expect(store.getState().states[relaySlotKey('board-1', 1)]).toBeUndefined();
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
    expect(failures).toEqual([
      expect.objectContaining({
        roomId: 'board-1',
        index: 1,
        attempted: 'ON',
        previous: null,
      }),
    ]);
  });

  it('a LATE matching state after the timeout cannot re-confirm (generation guard)', () => {
    const { store, clock, service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);

    clock.advance(RELAY_COMMAND_TIMEOUT_MS); // timeout: rollback + pending cleared
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);

    // A stale retained state arrives after the timeout.
    service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'ON',
    });
    // Applied as a plain state refresh (no pending), nothing else.
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
  });

  it('a stale timer callback AFTER a confirm does not roll the state back (generation guard)', () => {
    const { store, clock, service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'ON',
    });
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);

    // The cancelled timer would be due now — but confirm cancelled it, and
    // even a fired callback must observe the pending entry is gone.
    clock.advance(RELAY_COMMAND_TIMEOUT_MS + 5_000);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
  });

  it('a NEW command gets a fresh generation: its own timeout works after an earlier ack', () => {
    const { store, clock, service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    service.handleFeedbackMessage({
      topic: 'home/boards/board-1/relays/K1/state',
      payload: 'ON',
    });

    // Time moves before the next command, so the windows are distinct.
    clock.advance(1_000);
    expect(service.setRelay(LIVING, 'OFF').ok).toBe(true);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('OFF');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(true);

    // The SECOND command's window: timeout fires for the live generation
    // and rolls back to the confirmed pre-command state (ON).
    clock.advance(RELAY_COMMAND_TIMEOUT_MS);
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
  });

  it('timeouts are room-scoped (the other room pending command is untouched)', () => {
    const { store, clock, service } = makeService();
    expect(service.setRelay(LIVING, 'ON').ok).toBe(true);
    expect(service.setRelay(BEDROOM, 'ON').ok).toBe(true);

    clock.advance(RELAY_COMMAND_TIMEOUT_MS);

    // Both time out independently (same window, different addresses).
    expect(store.getState().states[relaySlotKey('board-1', 1)]).toBeUndefined();
    expect(store.getState().states[relaySlotKey('board-2', 1)]).toBeUndefined();
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
    expect(relayPendingOf(store.getState().pending, BEDROOM)).toBe(false);
  });
});

describe('RelayServiceImpl state subscription', () => {
  it('subscribes the single board+channel state wildcard for the configured prefix', () => {
    const { client, service } = makeService({ prefix: 'factory/house-a' });

    service.startFeedbackListener();

    expect(client.subscribedTopics).toEqual([
      'factory/house-a/boards/+/relays/+/state',
    ]);
  });

  it('re-subscribes the wildcard with the new prefix on applyPrefix', () => {
    const { client, service } = makeService({ prefix: 'home' });
    service.applyPrefix('office');

    expect(client.subscribedTopics).toEqual(['office/boards/+/relays/+/state']);
  });
});
