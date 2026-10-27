/**
 * historyStore transitions test.
 *
 * Verifies:
 * - initial state is idle (no loading, no error, empty series).
 * - setRange clears stale errors.
 * - beginRequest bumps the request id and switches to loading.
 * - CP-R5 stale-request guard: setSeriesIfCurrent / setErrorIfCurrent apply
 *   only when the request is still current; an older result is rejected.
 */

import { createHistoryStore } from './historyStore';

const SERIES = [
  {
    roomId: 'room-living' as const,
    field: 'temperature' as const,
    points: [{ t: 1, value: 25 }],
  },
];

describe('historyStore', () => {
  it('starts in the idle state', () => {
    const store = createHistoryStore();
    const state = store.getState();
    expect(state.range).toBe('1h');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.series).toEqual([]);
    expect(state.requestId).toBe(0);
  });

  it('transitions to loading when requested', () => {
    const store = createHistoryStore();
    store.getState().setLoading(true);
    expect(store.getState().loading).toBe(true);
  });

  it('applies a current successful result and clears loading/error', () => {
    const store = createHistoryStore();
    const id = store.getState().beginRequest();
    expect(store.getState().loading).toBe(true);

    expect(store.getState().setSeriesIfCurrent(id, SERIES)).toBe(true);
    const state = store.getState();
    expect(state.series).toEqual(SERIES);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('applies a current failure and records the message', () => {
    const store = createHistoryStore();
    const id = store.getState().beginRequest();
    expect(store.getState().setErrorIfCurrent(id, 'network down')).toBe(true);
    const state = store.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('network down');
  });

  it('rejects a stale success after a newer request started (CP-R5)', () => {
    const store = createHistoryStore();
    const firstId = store.getState().beginRequest();
    const secondId = store.getState().beginRequest();
    expect(secondId).toBe(firstId + 1);

    // The older request resolves last — it must not land.
    expect(store.getState().setSeriesIfCurrent(firstId, SERIES)).toBe(false);
    expect(store.getState().series).toEqual([]);
    expect(store.getState().loading).toBe(true);

    expect(store.getState().setSeriesIfCurrent(secondId, SERIES)).toBe(true);
    expect(store.getState().series).toEqual(SERIES);
  });

  it('rejects a stale error after a newer request started (CP-R5)', () => {
    const store = createHistoryStore();
    const firstId = store.getState().beginRequest();
    store.getState().beginRequest();
    expect(store.getState().setErrorIfCurrent(firstId, 'old failure')).toBe(
      false,
    );
    expect(store.getState().error).toBeNull();
  });

  it('a failed short-circuit (empty room) still invalidates in-flight requests', () => {
    // beginRequest() is the invalidation primitive: the App calls it even
    // when it short-circuits to an empty series set.
    const store = createHistoryStore();
    const inFlight = store.getState().beginRequest();
    const invalidated = store.getState().beginRequest();
    expect(store.getState().setSeriesIfCurrent(invalidated, [])).toBe(true);
    expect(store.getState().setSeriesIfCurrent(inFlight, SERIES)).toBe(false);
    expect(store.getState().series).toEqual([]);
  });

  it('transitions the range and clears stale errors', () => {
    const store = createHistoryStore();
    const id = store.getState().beginRequest();
    store.getState().setErrorIfCurrent(id, 'stale error');
    expect(store.getState().error).toBe('stale error');
    store.getState().setRange('24h');
    const state = store.getState();
    expect(state.range).toBe('24h');
    expect(state.error).toBeNull();

    store.getState().setRange('7d');
    expect(store.getState().range).toBe('7d');
  });

  it('keeps previous series while a new range is being loaded', () => {
    const store = createHistoryStore();
    const id = store.getState().beginRequest();
    store.getState().setSeriesIfCurrent(id, SERIES);

    store.getState().setRange('7d');
    store.getState().setLoading(true);

    const state = store.getState();
    expect(state.range).toBe('7d');
    expect(state.loading).toBe(true);
    expect(state.series).toHaveLength(1); // old data still displayed
  });
});
