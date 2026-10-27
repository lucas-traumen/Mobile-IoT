/**
 * Settings domain schema tests — legacy theme migration + validation.
 *
 * Verifies that settings persisted in the old shape (no `ui` key) still parse
 * and default `theme` to `'light'`, that the persisted legacy `'system'`
 * value migrates deterministically to `'light'` (credentials survive), and
 * that unknown theme values are still rejected.
 */

import { parseSettings, defaultSettings } from './settingsSchema';

describe('SettingsSchema migration (ui.theme)', () => {
  it('defaults theme to light when ui is missing (old persisted format)', () => {
    const oldFormat = {
      mqtt: { host: '192.168.1.10', port: 9001, prefix: 'home' },
      influx: {
        url: 'http://192.168.1.10:8086',
        org: 'iot',
        bucket: 'sensors',
        token: 'tok',
      },
    };
    const result = parseSettings(oldFormat);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ui).toEqual({ theme: 'light' });
      // Valid credentials survive the migration untouched.
      expect(result.value.mqtt.host).toBe('192.168.1.10');
      expect(result.value.influx.token).toBe('tok');
    }
  });

  it('migrates a persisted legacy `system` theme to `light`', () => {
    const legacy = {
      mqtt: { host: '192.168.1.10', port: 9001, prefix: 'home' },
      influx: {
        url: 'http://192.168.1.10:8086',
        org: 'iot',
        bucket: 'sensors',
        token: 'secret-token',
      },
      ui: { theme: 'system' },
    };
    const result = parseSettings(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ui).toEqual({ theme: 'light' });
      // The migrated record keeps every non-theme field intact.
      expect(result.value.mqtt).toEqual(legacy.mqtt);
      expect(result.value.influx).toEqual(legacy.influx);
    }
  });

  it('keeps an explicit ui.theme when present', () => {
    const current = {
      mqtt: { host: '192.168.1.10', port: 9001, prefix: 'home' },
      influx: {
        url: 'http://192.168.1.10:8086',
        org: 'iot',
        bucket: 'sensors',
        token: 'tok',
      },
      ui: { theme: 'dark' },
    };
    const result = parseSettings(current);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ui).toEqual({ theme: 'dark' });
    }
  });

  it('rejects an unknown ui.theme value', () => {
    const invalid = {
      mqtt: { host: '192.168.1.10', port: 9001, prefix: 'home' },
      influx: {
        url: 'http://192.168.1.10:8086',
        org: 'iot',
        bucket: 'sensors',
        token: 'tok',
      },
      ui: { theme: 'matrix' },
    };
    const result = parseSettings(invalid);
    expect(result.ok).toBe(false);
  });

  it('defaults to the light theme (no runtime `system` path)', () => {
    expect(defaultSettings().ui.theme).toBe('light');
  });
});
