/**
 * Settings domain: zod schema + pure validation helpers.
 *
 * Settings are the single source of truth for broker/InfluxDB connection
 * parameters. They are validated whenever they enter the app (form input,
 * persisted storage) — zod is the only authority on the shape.
 */

import { z } from 'zod';

import {
  DEFAULT_MQTT_PREFIX,
  DEFAULT_MQTT_WS_PORT,
  DEFAULT_THEME_MODE,
} from '@core/constants';

/** Validation for the MQTT broker settings. */
export const MqttSettingsSchema = z.object({
  /** Broker hostname or IP (e.g. `192.168.1.10`). */
  host: z.string().trim().min(1, 'MQTT host is required'),
  /** WebSocket listener port (mosquitto: `listener 9001`). */
  port: z
    .number()
    .int('Port must be an integer')
    .min(1, 'Port must be between 1 and 65535')
    .max(65535, 'Port must be between 1 and 65535'),
  /** Optional username. */
  username: z.string().trim().optional(),
  /** Optional password. */
  password: z.string().optional(),
  /** Topic prefix (e.g. `smarthome` → `smarthome/boards/<boardId>/status`). */
  prefix: z
    .string()
    .trim()
    .min(1, 'Topic prefix is required')
    .regex(
      /^[a-zA-Z0-9_/-]+$/,
      'Prefix may only contain letters, digits, _ / -',
    ),
});

/** Validation for the InfluxDB v2 read-only settings. */
export const InfluxSettingsSchema = z.object({
  /** Base URL of the InfluxDB instance (e.g. `http://192.168.1.10:8086`). */
  url: z.string().trim().url('InfluxDB URL must be a valid URL'),
  /** Organization name. */
  org: z.string().trim().min(1, 'Organization is required'),
  /** Bucket name. */
  bucket: z.string().trim().min(1, 'Bucket is required'),
  /** API token with read access (stored on device only, never committed). */
  token: z.string().trim().min(1, 'Token is required'),
});

/**
 * UI preferences (persisted with the settings).
 *
 * Theme migration (settings-information-architecture plan): the runtime
 * theme has exactly two explicit choices (`light | dark`). Persisted legacy
 * records carrying `'system'` (and snapshots with no `ui` at all) parse
 * deterministically to `'light'` while every other field (MQTT/Influx
 * credentials included) survives untouched — zod is the single authority
 * and no runtime path can observe `'system'` after parsing.
 */
export const UiSettingsSchema = z.object({
  theme: z
    .enum(['system', 'light', 'dark'])
    .default(DEFAULT_THEME_MODE)
    .transform(theme => (theme === 'system' ? DEFAULT_THEME_MODE : theme)),
});

/** Full settings snapshot. */
export const SettingsSchema = z.object({
  mqtt: MqttSettingsSchema,
  influx: InfluxSettingsSchema,
  ui: UiSettingsSchema.default({ theme: DEFAULT_THEME_MODE }),
});

/** Type of the persisted settings. */
export type AppSettings = z.infer<typeof SettingsSchema>;

/** Type of the MQTT settings subset. */
export type MqttSettings = z.infer<typeof MqttSettingsSchema>;

/** Type of the InfluxDB settings subset. */
export type InfluxSettings = z.infer<typeof InfluxSettingsSchema>;

/** Type of the UI settings subset. */
export type UiSettings = z.infer<typeof UiSettingsSchema>;

/** Build the default settings (local network broker, prefix `home`). */
export function defaultSettings(): AppSettings {
  return {
    mqtt: {
      host: '',
      port: DEFAULT_MQTT_WS_PORT,
      username: undefined,
      password: undefined,
      prefix: DEFAULT_MQTT_PREFIX,
    },
    influx: {
      url: '',
      org: '',
      bucket: '',
      token: '',
    },
    ui: {
      theme: 'light',
    },
  };
}

/**
 * Validate arbitrary input against the settings schema.
 * Returns the parsed settings or a list of human-readable field errors.
 */
export function parseSettings(
  input: unknown,
): { ok: true; value: AppSettings } | { ok: false; errors: string[] } {
  const result = SettingsSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      issue => `${issue.path.join('.') || 'settings'}: ${issue.message}`,
    ),
  };
}
