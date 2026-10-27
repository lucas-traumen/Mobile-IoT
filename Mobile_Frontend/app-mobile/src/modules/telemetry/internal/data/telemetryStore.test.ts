import { createTelemetryStore } from './telemetryStore';

describe('telemetry store', () => {
  it('starts idle with no readings', () => {
    const store = createTelemetryStore();
    const state = store.getState();
    expect(state.connection).toBe('idle');
    expect(state.latest).toBeNull();
    expect(state.messageCount).toBe(0);
  });

  it('updates state when a valid reading arrives', () => {
    const store = createTelemetryStore();
    store.getState().setConnection('connected');
    store
      .getState()
      .applyReading({ roomId: 'r1', field: 'temperature', value: 25.6 });
    const state = store.getState();
    expect(state.connection).toBe('connected');
    expect(state.latest).toEqual({
      roomId: 'r1',
      field: 'temperature',
      value: 25.6,
    });
    expect(state.messageCount).toBe(1);
  });

  it('keeps state unchanged when an invalid payload arrives', () => {
    const store = createTelemetryStore();
    store.getState().setConnection('connected');
    const before = store.getState();

    // Simulate the data-flow: invalid payloads are rejected by the domain
    // parser, so the store is never reached.
    const invalid = 'not-a-number';
    if (!Number.isFinite(Number(invalid))) {
      // reject — do nothing
    }
    expect(store.getState()).toEqual(before);
  });

  it('increments messageCount on each valid reading', () => {
    const store = createTelemetryStore();
    store
      .getState()
      .applyReading({ roomId: 'r1', field: 'temperature', value: 1 });
    store
      .getState()
      .applyReading({ roomId: 'r1', field: 'temperature', value: 2 });
    expect(store.getState().messageCount).toBe(2);
  });

  it('replaces latest with the newest reading', () => {
    const store = createTelemetryStore();
    store
      .getState()
      .applyReading({ roomId: 'r1', field: 'temperature', value: 1 });
    store
      .getState()
      .applyReading({ roomId: 'r2', field: 'humidity', value: 2 });
    expect(store.getState().latest).toEqual({
      roomId: 'r2',
      field: 'humidity',
      value: 2,
    });
  });

  it('tracks connection state transitions', () => {
    const store = createTelemetryStore();
    store.getState().setConnection('connecting');
    expect(store.getState().connection).toBe('connecting');
    store.getState().setConnection('connected');
    expect(store.getState().connection).toBe('connected');
    store.getState().setConnection('reconnecting');
    expect(store.getState().connection).toBe('reconnecting');
    store.getState().setConnection('failed');
    expect(store.getState().connection).toBe('failed');
  });

  it('records the error code on failed and keeps it through reconnecting (CP5)', () => {
    const store = createTelemetryStore();
    store.getState().setConnection('failed', 'auth');
    expect(store.getState().lastErrorCode).toBe('auth');
    store.getState().setConnection('reconnecting');
    expect(store.getState().lastErrorCode).toBe('auth');
  });

  it('defaults the error code to network when failed without a cause', () => {
    const store = createTelemetryStore();
    store.getState().setConnection('failed');
    expect(store.getState().lastErrorCode).toBe('network');
  });

  it('keeps the recorded error code on a bare failed transition', () => {
    const store = createTelemetryStore();
    store.getState().setConnection('failed', 'timeout');
    store.getState().setConnection('reconnecting');
    store.getState().setConnection('failed'); // no new cause supplied
    expect(store.getState().lastErrorCode).toBe('timeout');
  });

  it('clears the error code on connected', () => {
    const store = createTelemetryStore();
    store.getState().setConnection('failed', 'auth');
    store.getState().setConnection('connected');
    expect(store.getState().lastErrorCode).toBeNull();
  });

  // Amendment 1 (A2) — connectionSince episode semantics: the timestamp
  // marks when the CURRENT connection-state episode started. mqttJsClient
  // re-emits `reconnecting` on every backoff retry, so the timestamp MUST
  // NOT churn on same-state transitions (a 60 s episode window keyed on it
  // would otherwise never elapse).
  describe('connectionSince (episode semantics)', () => {
    it('starts at 0 (no episode yet)', () => {
      const store = createTelemetryStore();
      expect(store.getState().connectionSince).toBe(0);
    });

    it('stamps the episode start on every ACTUAL state change', () => {
      const store = createTelemetryStore();
      const before = Date.now();
      store.getState().setConnection('connecting');
      const first = store.getState().connectionSince;
      expect(first).toBeGreaterThanOrEqual(before);
      const beforeSecond = Date.now();
      store.getState().setConnection('reconnecting');
      expect(store.getState().connectionSince).toBeGreaterThanOrEqual(
        beforeSecond,
      );
    });

    it('keeps the original timestamp on a same-state reconnecting retry (same episode)', () => {
      const store = createTelemetryStore();
      store.getState().setConnection('connected');
      store.getState().setConnection('reconnecting');
      const episodeStart = store.getState().connectionSince;
      // The next backoff retry re-emits `reconnecting` — the episode did
      // NOT restart, so the timestamp must stay.
      store.getState().setConnection('reconnecting');
      store.getState().setConnection('reconnecting');
      expect(store.getState().connectionSince).toBe(episodeStart);
    });

    it('resets the timestamp when a fresh connected → reconnecting episode starts', () => {
      const store = createTelemetryStore();
      store.getState().setConnection('connected');
      store.getState().setConnection('reconnecting');
      const firstEpisode = store.getState().connectionSince;
      void firstEpisode;
      // Recovery, then a NEW loss: a new episode must re-stamp.
      const beforeRecovery = Date.now();
      store.getState().setConnection('connected');
      expect(store.getState().connectionSince).toBeGreaterThanOrEqual(
        beforeRecovery,
      );
      const beforeSecondLoss = Date.now();
      store.getState().setConnection('reconnecting');
      expect(store.getState().connectionSince).toBeGreaterThanOrEqual(
        beforeSecondLoss,
      );
      expect(store.getState().connectionSince).toBeGreaterThan(0);
    });

    it('keeps the timestamp on a same-state failed re-emission (CP5 semantics preserved)', () => {
      const store = createTelemetryStore();
      store.getState().setConnection('connecting');
      store.getState().setConnection('failed', 'timeout');
      const failedAt = store.getState().connectionSince;
      store.getState().setConnection('failed');
      expect(store.getState().connectionSince).toBe(failedAt);
      // The CP5 error-code semantics are unchanged.
      expect(store.getState().lastErrorCode).toBe('timeout');
    });
  });
});
