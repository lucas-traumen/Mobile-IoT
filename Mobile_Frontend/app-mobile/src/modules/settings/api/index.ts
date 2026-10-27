/**
 * Settings module — public facade.
 *
 * The only entry point other modules may use. Everything else lives in
 * `internal/` and must not be imported across modules (enforced by
 * `eslint-plugin-boundaries`).
 */

import type { SettingsSnapshot } from '@core/events';

import type {
  AppSettings,
  InfluxSettings,
  MqttSettings,
} from '../internal/domain/settingsSchema';
import type { SettingsRepository } from '../internal/data/settingsRepository';

/** UI preferences (theme mode) persisted with the settings. */
export type { UiSettings } from '../internal/domain/settingsSchema';
/** Full persisted settings shape (mqtt + influx + ui). */
export type { AppSettings, InfluxSettings, MqttSettings };
/** Persistence port (implemented by {@link AsyncStorageSettingsRepository}). */
export type { SettingsRepository };
/** Event payload type broadcast on `settings:changed`. */
export type { SettingsSnapshot };

/** Settings domain: zod schemas + defaults + pure validation (single source of truth). */
export {
  defaultSettings,
  parseSettings,
  SettingsSchema,
} from '../internal/domain/settingsSchema';
/** zod schema for the UI settings subset (`theme`). */
export { UiSettingsSchema } from '../internal/domain/settingsSchema';
/** AsyncStorage persistence adapter (zod-validated round-trip). */
export { AsyncStorageSettingsRepository } from '../internal/data/settingsRepository';
/**
 * Default {@link SettingsService} implementation (repository + event bus).
 * The {@link SettingsService} interface is declared next to it and
 * re-exported below (internal declaration, facade re-export — no cycle).
 */
export {
  SettingsServiceImpl,
  type SettingsService,
} from '../internal/services/settingsService';
/** zustand ViewModel factory for the settings form (draft/current/errors). */
export { createSettingsStore } from '../internal/ui/settingsStore';
/**
 * Store shape + field-error map (dotted paths).
 */
export type {
  SettingsFormErrors,
  SettingsStore,
} from '../internal/ui/settingsStore';
