/**
 * Settings store (zustand ViewModel) tests.
 *
 * Verifies:
 * - updateMqtt / updateInflux recompute field-level errors on the draft.
 * - save() with an invalid draft does NOT reach the service (errors surface).
 * - save() with a valid draft calls the service and records the outcome.
 * - updateUi applies the theme IMMEDIATELY (current + draft) and persists
 *   fire-and-forget (theme is an apply-immediately setting — App reads
 *   `current.ui.theme` while the form reads the draft). The persistence
 *   merge bases on the LAST PERSISTED settings: unsaved MQTT/Influx draft
 *   edits are never saved, never emitted, and survive until an explicit
 *   save() (fix cycle 2).
 */

import { InMemoryEventBus } from '@core/eventbus';
import { ok, type Result } from '@core/errors';
import type { SettingsSnapshot } from '@core/events';
import { createLogger } from '@core/logger';

import type { AppSettings } from '@modules/settings/api';

import type { SettingsRepository } from '../data/settingsRepository';
import { SettingsServiceImpl } from '../services/settingsService';
import { createSettingsStore } from './settingsStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const validSettings: AppSettings = {
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

class FakeSettingsRepository implements SettingsRepository {
  public saved: AppSettings | null = null;
  async load(): Promise<Result<AppSettings>> {
    return ok(validSettings);
  }
  async save(settings: AppSettings): Promise<Result<void>> {
    this.saved = settings;
    return ok(undefined);
  }
}

function makeStore() {
  const repository = new FakeSettingsRepository();
  const bus = new InMemoryEventBus(createLogger('test'));
  const service = new SettingsServiceImpl(
    repository,
    bus,
    createLogger('test'),
  );
  const store = createSettingsStore(service);
  return { repository, bus, store };
}

describe('createSettingsStore', () => {
  it('recomputes field-level errors when the draft changes', () => {
    const { store } = makeStore();
    store.getState().setCurrent(validSettings);

    store.getState().updateMqtt({ host: '' });
    expect(store.getState().errors['mqtt.host']).toBeTruthy();

    store.getState().updateMqtt({ host: 'broker.local' });
    expect(store.getState().errors).toEqual({});

    store.getState().updateInflux({ url: 'not-a-url' });
    expect(store.getState().errors['influx.url']).toBeTruthy();
  });

  it('does not call the service when the draft is invalid', async () => {
    const { repository, store } = makeStore();
    store.getState().updateInflux({ token: '' });
    await store.getState().save();
    expect(repository.saved).toBeNull();
    expect(store.getState().saveMessage).toContain('Fix the highlighted');
  });

  it('calls the service and records success on save', async () => {
    const { repository, store } = makeStore();
    store.getState().setCurrent(validSettings);
    await store.getState().save();
    expect(repository.saved).toEqual(validSettings);
    expect(store.getState().saveMessage).toBe('Settings saved and applied.');
  });

  it('updateUi applies the theme immediately to current + draft and persists', async () => {
    const { repository, store } = makeStore();
    store.getState().setCurrent(validSettings);

    store.getState().updateUi({ theme: 'dark' });

    // Theme is apply-immediately: App reads `current.ui.theme` — it must be
    // updated SYNCHRONOUSLY, not only after save().
    const state = store.getState();
    expect(state.current.ui.theme).toBe('dark');
    expect(state.draft.ui.theme).toBe('dark');

    // ...and the patch is persisted fire-and-forget (theme buttons never
    // call save()).
    await flushAsync();
    expect(repository.saved?.ui.theme).toBe('dark');
    expect(store.getState().current.ui.theme).toBe('dark');
  });

  it('updateUi persists only UI preferences over the last persisted settings (never the technical draft)', async () => {
    const { repository, bus, store } = makeStore();
    const snapshots: SettingsSnapshot[] = [];
    bus.subscribe('settings:changed', snapshot => snapshots.push(snapshot));
    store.getState().setCurrent(validSettings);
    // Unsaved technical edits live in the draft only.
    store.getState().updateMqtt({ host: 'edited.local' });
    store.getState().updateInflux({ token: 'tok-2' });

    store.getState().updateUi({ theme: 'dark' });
    await flushAsync();

    const state = store.getState();
    // Theme applied immediately to BOTH mirrors...
    expect(state.current.ui.theme).toBe('dark');
    expect(state.draft.ui.theme).toBe('dark');
    // ...but `current` (what telemetry/history use) keeps the OLD technical
    // settings — the draft leak is the defect this regression pins.
    expect(state.current.mqtt).toEqual(validSettings.mqtt);
    expect(state.current.influx).toEqual(validSettings.influx);
    // The technical draft edits are retained, still unsaved.
    expect(state.draft.mqtt.host).toBe('edited.local');
    expect(state.draft.influx.token).toBe('tok-2');

    // Persistence: old technical settings + new theme — never the unsaved
    // draft values.
    expect(repository.saved?.mqtt).toEqual(validSettings.mqtt);
    expect(repository.saved?.influx).toEqual(validSettings.influx);
    expect(repository.saved?.ui.theme).toBe('dark');

    // The technical reconfiguration event contains no unsaved values.
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.mqtt).toEqual(validSettings.mqtt);
    expect(snapshots[0]?.influx.token).toBe('tok');
    expect(snapshots[0]?.ui.theme).toBe('dark');
  });

  it('an explicit save after a theme change persists the retained technical draft plus the selected theme', async () => {
    const { repository, store } = makeStore();
    store.getState().setCurrent(validSettings);
    store.getState().updateMqtt({ host: 'edited.local' });
    store.getState().updateInflux({ token: 'tok-2' });
    store.getState().updateUi({ theme: 'dark' });
    await flushAsync();

    await store.getState().save();

    // The later explicit Advanced save persists BOTH the retained technical
    // edits and the theme selected meanwhile.
    expect(repository.saved?.mqtt.host).toBe('edited.local');
    expect(repository.saved?.influx.token).toBe('tok-2');
    expect(repository.saved?.ui.theme).toBe('dark');
  });

  it('applyPersistedUi adopts the persisted ui but PRESERVES a divergent unsaved technical draft', () => {
    const { store } = makeStore();
    store.getState().setCurrent(validSettings);
    store.getState().updateMqtt({ host: 'edited.local' });
    store.getState().updateInflux({ token: 'tok-2' });

    // The App-level handler adopts a ui-only persisted snapshot
    // (technical values identical to the previously persisted ones).
    const persisted: AppSettings = {
      ...validSettings,
      ui: { theme: 'dark' },
    };
    store.getState().applyPersistedUi(persisted);

    const state = store.getState();
    // `current` = last persisted truth (technical A + new theme).
    expect(state.current).toEqual(persisted);
    expect(state.current.ui.theme).toBe('dark');
    // The draft KEEPS its unsaved technical edits, with the persisted ui
    // mirrored in (unlike setCurrent, which replaces the whole draft).
    expect(state.draft.mqtt.host).toBe('edited.local');
    expect(state.draft.influx.token).toBe('tok-2');
    expect(state.draft.ui.theme).toBe('dark');
  });

  it('setCurrent still adopts the full persisted snapshot (bootstrap/full saves)', () => {
    const { store } = makeStore();
    store.getState().setCurrent(validSettings);
    store.getState().updateMqtt({ host: 'edited.local' });

    const persisted: AppSettings = {
      ...validSettings,
      ui: { theme: 'dark' },
    };
    store.getState().setCurrent(persisted);

    const state = store.getState();
    expect(state.current).toEqual(persisted);
    // Full adoption replaces the draft wholesale — the unsaved edit is
    // intentionally discarded by THIS seam.
    expect(state.draft).toEqual(persisted);
  });

  it('updateUi tolerates persistence failures (apply-immediately)', async () => {
    const repository = new RejectingSettingsRepository();
    const bus = new InMemoryEventBus(createLogger('test'));
    const service = new SettingsServiceImpl(
      repository,
      bus,
      createLogger('test'),
    );
    const store = createSettingsStore(service);
    store.getState().setCurrent(validSettings);

    expect(() => store.getState().updateUi({ theme: 'dark' })).not.toThrow();
    expect(store.getState().current.ui.theme).toBe('dark');

    // Drain the rejected promise — the store must have swallowed it.
    await flushAsync();
    expect(store.getState().current.ui.theme).toBe('dark');
  });
});

/** Drain pending microtasks/timers of fire-and-forget persistence. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/** Repository whose save always rejects (persistence-failure tolerance). */
class RejectingSettingsRepository implements SettingsRepository {
  async load(): Promise<Result<AppSettings>> {
    return ok(validSettings);
  }
  async save(): Promise<Result<void>> {
    throw new Error('disk full');
  }
}
