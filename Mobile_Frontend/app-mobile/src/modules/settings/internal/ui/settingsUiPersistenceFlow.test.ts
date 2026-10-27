/**
 * Settings UI-persistence flow integration regression (user-authorized
 * exceptional fix for the App-integrated draft-loss defect).
 *
 * Models the ACTUAL production transition end-to-end — real
 * {@link SettingsServiceImpl} + real settings store + real
 * `InMemoryEventBus` + an App-equivalent `settings:changed` subscriber
 * (the same snapshot→settings conversion and `changeScope` branch as
 * `App.tsx`):
 *
 * 1. Bootstrap full adoption (`setCurrent`) syncs current + draft.
 * 2. Unsaved technical edits live in the draft only (B).
 * 3. A theme change (`updateUi`) persists A+theme and emits a
 *    `changeScope: 'ui-only'` event; the subscriber adopts it via
 *    `applyPersistedUi` — technical current stays A, the technical draft
 *    stays B (dirty), and B never leaks into the event.
 * 4. The later explicit full save persists B+theme, emits a `changeScope:
 *    'full'` event, and the subscriber's `setCurrent` re-syncs the store.
 *
 * Before the fix, step 3's subscriber ran `setCurrent` and erased B, so no
 * later save could recover it.
 */

import { InMemoryEventBus } from '@core/eventbus';
import { ok, type Result } from '@core/errors';
import type { SettingsSnapshot } from '@core/events';
import { createLogger } from '@core/logger';

import type { AppSettings } from '../domain/settingsSchema';
import type { SettingsRepository } from '../data/settingsRepository';
import { SettingsServiceImpl } from '../services/settingsService';
import { createSettingsStore } from './settingsStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const persistedA: AppSettings = {
  mqtt: {
    host: 'broker.local',
    port: 9001,
    username: undefined,
    password: undefined,
    prefix: 'home',
  },
  influx: {
    url: 'http://influx.local:8086',
    org: 'iot',
    bucket: 'sensors',
    token: 'tok',
  },
  ui: { theme: 'light' },
};

/** In-memory repository (persisted truth of the flow). */
class InMemorySettingsRepository implements SettingsRepository {
  public saved: AppSettings | null = null;
  async load(): Promise<Result<AppSettings>> {
    return ok(this.saved ?? persistedA);
  }
  async save(settings: AppSettings): Promise<Result<void>> {
    this.saved = settings;
    return ok(undefined);
  }
}

/** Exact snapshot→settings conversion used by the App.tsx event handler. */
function toSettings(snapshot: SettingsSnapshot): AppSettings {
  return {
    mqtt: {
      host: snapshot.mqtt.host,
      port: snapshot.mqtt.port,
      username: snapshot.mqtt.username,
      password: snapshot.mqtt.password,
      prefix: snapshot.mqtt.prefix,
    },
    influx: {
      url: snapshot.influx.url,
      org: snapshot.influx.org,
      bucket: snapshot.influx.bucket,
      token: snapshot.influx.token,
    },
    ui: { theme: snapshot.ui.theme },
  };
}

/** Drain pending microtasks of fire-and-forget persistence. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

describe('settings UI-persistence flow (production transition)', () => {
  it('preserves the unsaved technical draft across the theme round-trip and persists it on the later explicit save', async () => {
    const repository = new InMemorySettingsRepository();
    const bus = new InMemoryEventBus(createLogger('test'));
    const service = new SettingsServiceImpl(
      repository,
      bus,
      createLogger('test'),
    );
    const store = createSettingsStore(service);

    // App-equivalent subscriber: the same conversion + changeScope branch
    // as the App.tsx `settings:changed` handler.
    const events: SettingsSnapshot[] = [];
    const unsubscribe = bus.subscribe('settings:changed', snapshot => {
      events.push(snapshot);
      const settings = toSettings(snapshot);
      if (snapshot.changeScope === 'ui-only') {
        store.getState().applyPersistedUi(settings);
        return;
      }
      store.getState().setCurrent(settings);
    });

    // 1. Bootstrap full adoption: current + draft sync to the persisted A.
    store.getState().setCurrent(persistedA);
    expect(store.getState().draft).toEqual(persistedA);

    // 2. Unsaved technical edits live in the draft only (B).
    store.getState().updateMqtt({ host: 'edited.local' });
    store.getState().updateInflux({ token: 'tok-2' });

    // 3. Theme change: persisted A+theme, event stamped ui-only, subscriber
    //    adopts via applyPersistedUi.
    store.getState().updateUi({ theme: 'dark' });
    await flushAsync();

    expect(events).toHaveLength(1);
    expect(events[0]?.changeScope).toBe('ui-only');
    // The ui-only event carries the PERSISTED technical values — no leak
    // of the unsaved draft B.
    expect(events[0]?.mqtt).toEqual(persistedA.mqtt);
    expect(events[0]?.influx.token).toBe('tok');
    expect(events[0]?.ui.theme).toBe('dark');
    expect(repository.saved?.mqtt).toEqual(persistedA.mqtt);
    expect(repository.saved?.ui.theme).toBe('dark');

    // Store state after the production adoption: technical current A,
    // technical draft B (still unsaved/dirty), BOTH ui themes dark.
    expect(store.getState().current.mqtt).toEqual(persistedA.mqtt);
    expect(store.getState().current.influx).toEqual(persistedA.influx);
    expect(store.getState().current.ui.theme).toBe('dark');
    expect(store.getState().draft.mqtt.host).toBe('edited.local');
    expect(store.getState().draft.influx.token).toBe('tok-2');
    expect(store.getState().draft.ui.theme).toBe('dark');

    // 4. Later explicit full Advanced save: persists B + selected theme,
    //    emits a full event, and the subscriber re-syncs the store.
    await store.getState().save();
    await flushAsync();

    expect(events).toHaveLength(2);
    expect(events[1]?.changeScope).toBe('full');
    expect(repository.saved?.mqtt.host).toBe('edited.local');
    expect(repository.saved?.influx.token).toBe('tok-2');
    expect(repository.saved?.ui.theme).toBe('dark');
    // Full adoption: current and draft are synced to the persisted snapshot.
    expect(store.getState().current.mqtt.host).toBe('edited.local');
    expect(store.getState().current.influx.token).toBe('tok-2');
    expect(store.getState().current.ui.theme).toBe('dark');
    expect(store.getState().draft).toEqual(store.getState().current);

    unsubscribe();
  });

  it('a FAILED theme persistence emits no event and keeps the applied theme plus the technical draft', async () => {
    const bus = new InMemoryEventBus(createLogger('test'));
    const service = new SettingsServiceImpl(
      new (class implements SettingsRepository {
        async load(): Promise<Result<AppSettings>> {
          return ok(persistedA);
        }
        async save(): Promise<Result<void>> {
          throw new Error('disk full');
        }
      })(),
      bus,
      createLogger('test'),
    );
    const store = createSettingsStore(service);

    const events: SettingsSnapshot[] = [];
    const unsubscribe = bus.subscribe('settings:changed', snapshot => {
      events.push(snapshot);
      const settings = toSettings(snapshot);
      if (snapshot.changeScope === 'ui-only') {
        store.getState().applyPersistedUi(settings);
        return;
      }
      store.getState().setCurrent(settings);
    });

    store.getState().setCurrent(persistedA);
    store.getState().updateMqtt({ host: 'edited.local' });

    store.getState().updateUi({ theme: 'dark' });
    await flushAsync();

    // Failure: nothing persisted, nothing emitted, no adoption ran — the
    // theme stays applied in memory (apply-immediately contract) and the
    // technical draft survives untouched.
    expect(events).toHaveLength(0);
    expect(store.getState().current.ui.theme).toBe('dark');
    expect(store.getState().draft.mqtt.host).toBe('edited.local');

    unsubscribe();
  });
});
