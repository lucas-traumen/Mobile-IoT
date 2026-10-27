import AsyncStorage from '@react-native-async-storage/async-storage';

import { NullLogger } from '@core/logger';

import type { AppSettings } from '../domain/settingsSchema';
import { defaultSettings } from '../domain/settingsSchema';
import { AsyncStorageSettingsRepository } from './settingsRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

function validSettings(): AppSettings {
  return {
    mqtt: { host: '192.168.1.10', port: 9001, prefix: 'home' },
    influx: {
      url: 'http://192.168.1.10:8086',
      org: 'iot',
      bucket: 'sensors',
      token: 'secret-token',
    },
    ui: { theme: 'light' },
  };
}

describe('AsyncStorageSettingsRepository', () => {
  let repo: AsyncStorageSettingsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AsyncStorageSettingsRepository(new NullLogger());
  });

  it('returns defaults when nothing is stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(defaultSettings());
    }
  });

  it('loads persisted settings (round-trip)', async () => {
    const settings = validSettings();
    await repo.save(settings);
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(settings),
    );

    mockGetItem.mockResolvedValueOnce(JSON.stringify(settings));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(settings);
    }
  });

  it('returns defaults when stored JSON is malformed', async () => {
    mockGetItem.mockResolvedValueOnce('not-json{');
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(defaultSettings());
    }
  });

  it('returns defaults when stored value fails validation', async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ mqtt: { host: '' }, influx: {} }),
    );
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(defaultSettings());
    }
  });

  it('rejects saving invalid settings with a validation error', async () => {
    const invalid = validSettings();
    invalid.mqtt.host = '';
    const result = await repo.save(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('maps storage read failures to a Result error', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage boom'));
    const result = await repo.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown');
    }
  });

  it('migrates a persisted snapshot without ui (old format) to theme light', async () => {
    // Old persisted shape: no `ui` object at all.
    const oldFormat = {
      mqtt: { host: '192.168.1.10', port: 9001, prefix: 'home' },
      influx: {
        url: 'http://192.168.1.10:8086',
        org: 'iot',
        bucket: 'sensors',
        token: 'secret-token',
      },
    };
    mockGetItem.mockResolvedValueOnce(JSON.stringify(oldFormat));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ui.theme).toBe('light');
      expect(result.value.mqtt.host).toBe('192.168.1.10');
      expect(result.value.influx.token).toBe('secret-token');
    }
    // The normalized value is persisted back (best-effort write-through).
    await flushAsync();
    expect(mockSetItem).toHaveBeenCalled();
  });

  it('migrates a persisted legacy `system` theme to light and keeps credentials', async () => {
    const legacy = {
      mqtt: { host: 'broker.local', port: 9001, prefix: 'home' },
      influx: {
        url: 'http://influx.local:8086',
        org: 'iot',
        bucket: 'sensors',
        token: 'secret-token',
      },
      ui: { theme: 'system' },
    };
    mockGetItem.mockResolvedValueOnce(JSON.stringify(legacy));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ui.theme).toBe('light');
      // Nothing but the theme changed: valid credentials/data survive.
      expect(result.value.mqtt.host).toBe('broker.local');
      expect(result.value.influx.token).toBe('secret-token');
    }
    await flushAsync();
    const written = mockSetItem.mock.calls.at(-1)?.[1] as string;
    expect(JSON.parse(written)).toEqual(result.ok ? result.value : null);
  });

  it('does not rewrite storage for an already-normalized snapshot', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(validSettings()));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    await flushAsync();
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

/** Drain pending microtasks of the fire-and-forget normalization write. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}
