/**
 * Dashboard persistence: AsyncStorage adapter (port + implementation).
 *
 * Same pattern as the settings/devices repositories: load → seed on first
 * run, validate with zod before trusting anything, map IO failures to
 * {@link Result}. Invalid stored data is logged and replaced with seeds
 * (never thrown).
 *
 * Template-era load contract: the repository discriminates the persisted
 * shape and reports it — `{ kind: 'seed' }` when nothing (valid) is stored,
 * `{ kind: 'file' }` with `migratedFromLegacy` when a pre-Template file was
 * structurally migrated. The dashboard SERVICE owns every migration decision
 * (stamping, registry ordering, persisting the migrated snapshot) — the
 * repository only validates, discriminates and stores. A VALID user snapshot
 * (current or legacy) is never reseeded; only unusable garbage falls back to
 * the seed (logged, never thrown).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '@core/constants';
import { err, Errors, ok, type Result } from '@core/errors';
import type { Logger } from '@core/logger';

import type { DashboardsFile } from '../domain/dashboardSchema';
import {
  parseCurrentDashboardsFile,
  parseDashboardsFile,
} from '../domain/dashboardSchema';

/** What a successful `load()` found in storage. */
export type LoadedDashboardsFile =
  | {
      /** Nothing valid was persisted (first run or unusable garbage). */
      readonly kind: 'seed';
    }
  | {
      /** A valid persisted file (current, or migrated from the legacy shape). */
      readonly kind: 'file';
      readonly file: DashboardsFile;
      /** True when the stored file used the pre-Template legacy shape. */
      readonly migratedFromLegacy: boolean;
    };

/** Port: persisted dashboards access (no storage knowledge in domain). */
export interface DashboardRepository {
  /**
   * Load the persisted file. Reports `seed` when nothing valid is stored
   * (the service decides what a first-run file looks like) and the
   * `migratedFromLegacy` flag so the service can persist the migration.
   */
  load(): Promise<Result<LoadedDashboardsFile>>;
  /** Persist a file; validates before writing. */
  save(file: DashboardsFile): Promise<Result<void>>;
}

/** AsyncStorage-backed implementation of {@link DashboardRepository}. */
export class AsyncStorageDashboardRepository implements DashboardRepository {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async load(): Promise<Result<LoadedDashboardsFile>> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.dashboards);
      if (raw === null) {
        return ok({ kind: 'seed' });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        this.logger.warn(
          'Dashboards: stored value is not valid JSON, seeding defaults',
          e,
        );
        return ok({ kind: 'seed' });
      }
      const result = parseDashboardsFile(parsed);
      if (!result.ok) {
        this.logger.warn(
          'Dashboards: stored value failed validation, seeding defaults',
          result.errors,
        );
        return ok({ kind: 'seed' });
      }
      return ok({
        kind: 'file',
        file: result.value,
        migratedFromLegacy: result.migrated,
      });
    } catch (e) {
      return err(Errors.unknown('Failed to read dashboards from storage', e));
    }
  }

  async save(file: DashboardsFile): Promise<Result<void>> {
    // Save-time validation: only the CURRENT (Template) shape is persistable
    // — the legacy shape can never be written back (the service migrates
    // before any save).
    const result = parseCurrentDashboardsFile(file);
    if (!result.ok) {
      return err(
        Errors.validation(
          'Cannot persist invalid dashboards file',
          result.errors,
        ),
      );
    }
    try {
      const serialized = JSON.stringify(result.value);
      await AsyncStorage.setItem(STORAGE_KEYS.dashboards, serialized);
      return ok(undefined);
    } catch (e) {
      return err(Errors.unknown('Failed to write dashboards to storage', e));
    }
  }
}
