/**
 * Relay store tests — room-scoped optimistic state (boards contract v2).
 *
 * Verifies: state/pending are keyed by `relaySlotKey(roomId, index)`; the
 * SAME slot number in two different rooms never aliases; untouched slots
 * read OFF / not-pending through the `relayStateOf`/`relayPendingOf` reads;
 * `apply` writes the state WITHOUT touching pending (ack split —
 * boards-topic-contract-v2), `confirm` writes the state AND clears pending,
 * and `rollback` restores the pre-command state (or DELETES the slot key
 * when the previous state was unknown, so the slot honestly reads as
 * never-touched again).
 */

import type { RelayAddress } from '../../api';
import {
  createRelayStore,
  relayPendingOf,
  relayStateOf,
  relaySlotKey,
} from './relayStore';

const LIVING: RelayAddress = { roomId: 'room-living', index: 2 };
const BEDROOM: RelayAddress = { roomId: 'room-bedroom', index: 2 };

describe('relayStore (room-scoped)', () => {
  it('keys optimistic state by room + slot', () => {
    const store = createRelayStore();
    store.getState().setOptimistic(LIVING, 'ON');

    expect(store.getState().states[relaySlotKey('room-living', 2)]).toBe('ON');
    expect(store.getState().pending[relaySlotKey('room-living', 2)]).toBe(true);
  });

  it('keeps equal slots in different rooms independent (no aliasing)', () => {
    const store = createRelayStore();
    store.getState().setOptimistic(LIVING, 'ON');

    // Bedroom slot 2 is untouched: OFF and not pending.
    expect(relayStateOf(store.getState().states, BEDROOM)).toBe('OFF');
    expect(relayPendingOf(store.getState().pending, BEDROOM)).toBe(false);

    store.getState().confirm(BEDROOM, 'ON');
    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayStateOf(store.getState().states, BEDROOM)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(true);
    expect(relayPendingOf(store.getState().pending, BEDROOM)).toBe(false);
  });

  it('confirm clears the pending flag for exactly the addressed slot', () => {
    const store = createRelayStore();
    store.getState().setOptimistic(LIVING, 'ON');
    store.getState().setOptimistic(BEDROOM, 'ON');

    store.getState().confirm(LIVING, 'OFF');

    expect(relayStateOf(store.getState().states, LIVING)).toBe('OFF');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
    expect(relayStateOf(store.getState().states, BEDROOM)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, BEDROOM)).toBe(true);
  });

  it('apply writes the state WITHOUT touching pending (ack split)', () => {
    const store = createRelayStore();
    store.getState().setOptimistic(LIVING, 'ON');

    // A non-matching state (likely the stale retained old state) is
    // applied but the command stays pending.
    store.getState().apply(LIVING, 'OFF');

    expect(relayStateOf(store.getState().states, LIVING)).toBe('OFF');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(true);

    // With no pending entry, apply also leaves pending untouched (false).
    store.getState().apply(BEDROOM, 'ON');
    expect(relayStateOf(store.getState().states, BEDROOM)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, BEDROOM)).toBe(false);
  });

  it('rollback restores the pre-command state (known previous)', () => {
    const store = createRelayStore();
    store.getState().confirm(LIVING, 'ON'); // known previous
    store.getState().setOptimistic(LIVING, 'OFF'); // optimistic flip

    store.getState().rollback(LIVING, 'ON');

    expect(relayStateOf(store.getState().states, LIVING)).toBe('ON');
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
  });

  it('rollback with an UNKNOWN previous deletes the slot key (honest unknown)', () => {
    const store = createRelayStore();
    store.getState().setOptimistic(LIVING, 'ON'); // command from unknown

    store.getState().rollback(LIVING, null);

    // The key is GONE — the slot reads as never-touched (unknown), not OFF.
    expect(
      store.getState().states[relaySlotKey('room-living', 2)],
    ).toBeUndefined();
    expect(relayPendingOf(store.getState().pending, LIVING)).toBe(false);
  });

  it('rollback is room-scoped (other rooms untouched)', () => {
    const store = createRelayStore();
    store.getState().setOptimistic(LIVING, 'ON');
    store.getState().setOptimistic(BEDROOM, 'ON');

    store.getState().rollback(LIVING, null);

    expect(
      store.getState().states[relaySlotKey('room-living', 2)],
    ).toBeUndefined();
    expect(relayStateOf(store.getState().states, BEDROOM)).toBe('ON');
  });

  it('supports slots 1..10 per room', () => {
    const store = createRelayStore();
    for (let slot = 1; slot <= 10; slot++) {
      store
        .getState()
        .setOptimistic({ roomId: 'room-a', index: slot as 1 }, 'ON');
      store
        .getState()
        .setOptimistic({ roomId: 'room-b', index: slot as 1 }, 'OFF');
    }
    for (let slot = 1; slot <= 10; slot++) {
      expect(
        relayStateOf(store.getState().states, {
          roomId: 'room-a',
          index: slot as 1,
        }),
      ).toBe('ON');
      expect(
        relayStateOf(store.getState().states, {
          roomId: 'room-b',
          index: slot as 1,
        }),
      ).toBe('OFF');
    }
  });
});
