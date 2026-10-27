/**
 * Devices persistence: AsyncStorage adapter (port + implementation).
 *
 * Same pattern as the settings repository: load → seed on first run, validate
 * with zod before trusting anything, map IO failures to {@link Result}.
 *
 * Scope amendment 3 (legacy icon migration): a successfully parsed stored
 * snapshot passes through {@link enrichLegacyDeviceIcons} so devices
 * persisted before the per-device `icon` field existed render their seed
 * glyphs (relay-1 → `bulb-outline`, relay-2 → `fan`). The enrichment fills
 * ONLY missing seed-id icons, never overwrites, and is idempotent; the
 * first save after the load persists the enriched values (plain round
 * trips preserve everything). The seed path needs no enrichment (seeds
 * already carry their glyphs), and `save` performs no migration — parsing
 * and persistence stay side-effect-free.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '@core/constants';
import { err, Errors, ok, type Result } from '@core/errors';
import type { Logger } from '@core/logger';

import type { DevicesSnapshot } from '../domain/devices';
import {
  enrichLegacyDeviceIcons,
  parseDevicesSnapshot,
} from '../domain/devices';
import { seedDevices } from '../domain/seeds';

/** Port: persisted devices access (no storage knowledge leaks into domain). */
export interface DevicesRepository {
  /** Load the persisted snapshot; seeds defaults when nothing was saved. */
  load(): Promise<Result<DevicesSnapshot>>;
  /** Persist a snapshot; validates before writing. */
  save(snapshot: DevicesSnapshot): Promise<Result<void>>;
}

/** AsyncStorage-backed implementation of {@link DevicesRepository}. */
export class AsyncStorageDevicesRepository implements DevicesRepository {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async load(): Promise<Result<DevicesSnapshot>> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.devices);
      if (raw === null) {
        return ok(seedDevices());
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        this.logger.warn(
          'Devices: stored value is not valid JSON, seeding defaults',
          e,
        );
        return ok(seedDevices());
      }
      const result = parseDevicesSnapshot(parsed);
      if (!result.ok) {
        this.logger.warn(
          'Devices: stored value failed validation, seeding defaults',
          result.errors,
        );
        return ok(seedDevices());
      }
      // Scope amendment 3: legacy icon enrichment at the load boundary
      // (fills ONLY missing seed-id icons; idempotent; never overwrites).
      return ok(enrichLegacyDeviceIcons(result.value));
    } catch (e) {
      return err(Errors.unknown('Failed to read devices from storage', e));
    }
  }

  async save(snapshot: DevicesSnapshot): Promise<Result<void>> {
    const result = parseDevicesSnapshot(snapshot);
    if (!result.ok) {
      return err(
        Errors.validation(
          'Cannot persist invalid devices snapshot',
          result.errors,
        ),
      );
    }
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.devices,
        JSON.stringify(result.value),
      );
      return ok(undefined);
    } catch (e) {
      return err(Errors.unknown('Failed to write devices to storage', e));
    }
  }
}
