/**
 * Default {@link SettingsService} implementation: validates + persists via
 * the repository and broadcasts `settings:changed` on the event bus.
 */

import type { EventBus } from '@core/eventbus';
import type { SettingsSnapshot } from '@core/events';
import { err, Errors, ok, type Result } from '@core/errors';
import type { Logger } from '@core/logger';

import type { AppSettings } from '../domain/settingsSchema';
import { parseSettings } from '../domain/settingsSchema';
import type { SettingsRepository } from '../data/settingsRepository';

function toSnapshot(
  settings: AppSettings,
  changeScope: 'full' | 'ui-only',
): SettingsSnapshot {
  return {
    mqtt: {
      host: settings.mqtt.host,
      port: settings.mqtt.port,
      username: settings.mqtt.username,
      password: settings.mqtt.password,
      prefix: settings.mqtt.prefix,
    },
    influx: {
      url: settings.influx.url,
      org: settings.influx.org,
      bucket: settings.influx.bucket,
      token: settings.influx.token,
    },
    ui: {
      theme: settings.ui.theme,
    },
    changeScope,
  };
}

/**
 * Options for {@link SettingsService.save}.
 */
export interface SettingsSaveOptions {
  /**
   * Scope stamped onto the emitted `settings:changed` snapshot: `'full'`
   * (default) = the complete persisted settings changed (bootstrap
   * adoption / explicit full save). `'ui-only'` = only UI preferences
   * changed and the technical fields are identical to the previously
   * persisted settings — the CALLER asserts this (the settings store's
   * `updateUi` is the only such caller); consumers must not replace a
   * divergent unsaved technical draft on this scope.
   */
  readonly changeScope?: 'full' | 'ui-only';
}

/**
 * Settings service — application-level operations exposed to the rest of the
 * app. The UI and other modules interact with settings only through here.
 *
 * Declared next to its implementation (and re-exported through the module
 * facade) so internal consumers can type against it without importing the
 * barrel that re-exports them (require-cycle prevention, ISSUE-006).
 */
export interface SettingsService {
  /**
   * Load persisted settings (defaults when nothing is stored yet).
   *
   * @returns `ok(settings)` with the persisted (or default) settings,
   *   `err` when storage read fails.
   */
  load(): Promise<Result<AppSettings>>;

  /**
   * Validate + persist new settings, then publish `settings:changed` on the
   * event bus so telemetry/relay/history can reconfigure.
   *
   * @param settings - candidate settings (validated with zod first).
   * @param options - change-scope metadata stamped onto the emitted
   *   snapshot (defaults to `'full'`); see {@link SettingsSaveOptions}.
   * @returns `ok(void)` on success; `err` with code `validation` when the
   *   input is invalid, or `unknown` when storage write fails.
   */
  save(
    settings: AppSettings,
    options?: SettingsSaveOptions,
  ): Promise<Result<void>>;

  /**
   * Subscribe to settings changes (payload: full {@link SettingsSnapshot}).
   *
   * @param handler - called with the new settings after a successful save.
   * @returns unsubscribe function.
   */
  onChanged(handler: (snapshot: SettingsSnapshot) => void): () => void;
}

/** Settings service bound to a repository + event bus. */
export class SettingsServiceImpl implements SettingsService {
  private readonly repository: SettingsRepository;
  private readonly bus: EventBus;
  private readonly logger: Logger;

  constructor(repository: SettingsRepository, bus: EventBus, logger: Logger) {
    this.repository = repository;
    this.bus = bus;
    this.logger = logger;
  }

  /** Load persisted settings (defaults when nothing is stored yet). */
  async load(): Promise<Result<AppSettings>> {
    return this.repository.load();
  }

  /** Validate + persist, then broadcast `settings:changed`. */
  async save(
    settings: AppSettings,
    options?: SettingsSaveOptions,
  ): Promise<Result<void>> {
    const validated = parseSettings(settings);
    if (!validated.ok) {
      return err(Errors.validation('Invalid settings', validated.errors));
    }
    const result = await this.repository.save(validated.value);
    if (!result.ok) {
      return result;
    }
    this.logger.info('Settings saved; broadcasting settings:changed');
    this.bus.emit(
      'settings:changed',
      toSnapshot(validated.value, options?.changeScope ?? 'full'),
    );
    return ok(undefined);
  }

  /** Subscribe to settings changes. */
  onChanged(handler: (snapshot: SettingsSnapshot) => void): () => void {
    return this.bus.subscribe('settings:changed', handler);
  }
}
