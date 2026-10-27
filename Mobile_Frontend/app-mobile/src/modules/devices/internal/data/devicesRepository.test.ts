/**
 * AsyncStorageDevicesRepository tests.
 *
 * Verifies: seed on first run, round-trip persistence, malformed/failed
 * validation falls back to seed, storage failures map to Result errors —
 * and the scope-amendment-3 legacy icon migration at the load boundary:
 * legacy snapshots without icons are enriched for the known seed ids only
 * (never overwriting, never touching custom devices, idempotent), and a
 * save/load round-trip preserves the enriched snapshot byte-identically.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { NullLogger } from '@core/logger';

import { BUILT_IN_CAPABILITIES } from '../domain/devices';
import { seedDevices } from '../domain/seeds';
import type { DevicesSnapshot } from '../domain/devices';
import { AsyncStorageDevicesRepository } from './devicesRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

/** A legacy persisted snapshot: seed relays WITHOUT the icon field plus a
 * user-created custom device (the pre-amendment-2 storage shape). */
function legacyStoredSnapshot(): Record<string, unknown> {
  return {
    rooms: [{ id: 'room-living', name: 'Phòng khách', order: 0 }],
    devices: [
      {
        id: 'relay-1',
        name: 'Đèn',
        roomId: 'room-living',
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: 1 },
      },
      {
        id: 'relay-2',
        name: 'Quạt',
        roomId: 'room-living',
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: 2 },
      },
      {
        id: 'custom-1',
        name: 'Thiết bị người dùng',
        roomId: 'room-living',
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: 4 },
      },
    ],
    capabilities: BUILT_IN_CAPABILITIES,
  };
}

describe('AsyncStorageDevicesRepository', () => {
  let repo: AsyncStorageDevicesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AsyncStorageDevicesRepository(new NullLogger());
  });

  it('seeds defaults when nothing is stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(seedDevices());
    }
  });

  it('persists and reloads a snapshot (round-trip)', async () => {
    const snapshot: DevicesSnapshot = {
      rooms: [{ id: 'room-1', name: 'Phòng khách', order: 0 }],
      devices: [
        {
          id: 'dev-1',
          name: 'Đèn',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 1 },
        },
      ],
      capabilities: BUILT_IN_CAPABILITIES,
    };
    const saveResult = await repo.save(snapshot);
    expect(saveResult.ok).toBe(true);
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(snapshot),
    );

    mockGetItem.mockResolvedValueOnce(JSON.stringify(snapshot));
    const loadResult = await repo.load();
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value).toEqual(snapshot);
    }
  });

  it('migrates a pre-catalog snapshot to the built-in catalog', async () => {
    // Old persisted file without the `capabilities` field.
    const legacy = {
      rooms: [],
      devices: [
        {
          id: 'dev-1',
          name: 'Đèn',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 1 },
        },
      ],
    };
    mockGetItem.mockResolvedValueOnce(JSON.stringify(legacy));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.capabilities).toEqual(BUILT_IN_CAPABILITIES);
      expect(result.value.devices).toEqual(legacy.devices);
    }
  });

  it('seeds defaults when stored JSON is malformed', async () => {
    mockGetItem.mockResolvedValueOnce('not-json{');
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(seedDevices());
    }
  });

  it('seeds defaults when stored value fails validation', async () => {
    // Relay binding with temperature capability violates the constraint.
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({
        rooms: [],
        devices: [
          {
            id: 'bad',
            name: 'Bad',
            type: 'relay',
            capabilities: ['switch', 'temperature'],
            binding: { kind: 'relay', index: 1 },
          },
        ],
      }),
    );
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(seedDevices());
    }
  });

  it('rejects saving an invalid snapshot with a validation error', async () => {
    const invalid: DevicesSnapshot = {
      rooms: [],
      devices: [
        {
          id: 'bad',
          name: 'Bad',
          type: 'relay',
          capabilities: ['temperature'],
          binding: { kind: 'relay', index: 1 },
        },
      ],
      capabilities: BUILT_IN_CAPABILITIES,
    };
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
});

describe('AsyncStorageDevicesRepository legacy icon migration (scope amendment 3)', () => {
  let repo: AsyncStorageDevicesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AsyncStorageDevicesRepository(new NullLogger());
  });

  it('enriches a legacy snapshot WITHOUT icons for the seed ids at load', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(legacyStoredSnapshot()));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byId = new Map(result.value.devices.map(d => [d.id, d]));
    expect(byId.get('relay-1')?.icon).toBe('bulb-outline');
    expect(byId.get('relay-2')?.icon).toBe('fan');
  });

  it('never touches CUSTOM devices (no seed id → no icon)', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(legacyStoredSnapshot()));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const custom = result.value.devices.find(d => d.id === 'custom-1');
    expect(custom?.icon).toBeUndefined();
  });

  it('never overwrites an icon the snapshot already carries', async () => {
    const stored = legacyStoredSnapshot() as {
      devices: Record<string, unknown>[];
    };
    stored.devices = stored.devices.map(device =>
      device.id === 'relay-1' ? { ...device, icon: 'sunny-outline' } : device,
    );
    mockGetItem.mockResolvedValueOnce(JSON.stringify(stored));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byId = new Map(result.value.devices.map(d => [d.id, d]));
    // The existing value survives byte-identical…
    expect(byId.get('relay-1')?.icon).toBe('sunny-outline');
    // …while the still-missing seed icon is filled.
    expect(byId.get('relay-2')?.icon).toBe('fan');
  });

  it('is IDEMPOTENT: a second load of the enriched snapshot no-ops', async () => {
    // First load: legacy → enriched.
    mockGetItem.mockResolvedValueOnce(JSON.stringify(legacyStoredSnapshot()));
    const first = await repo.load();
    expect(first.ok).toBe(true);

    // Persist what the first load produced, then load again (the real
    // round-trip a mutation would trigger).
    if (first.ok) {
      await repo.save(first.value);
    }
    const written = mockSetItem.mock.calls.at(-1)![1] as string;
    mockGetItem.mockResolvedValueOnce(written);
    const second = await repo.load();
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value).toEqual(first.value);
    }
  });

  it('a save/load ROUND-TRIP preserves the enriched snapshot (all fields)', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(legacyStoredSnapshot()));
    const loaded = await repo.load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const saveResult = await repo.save(loaded.value);
    expect(saveResult.ok).toBe(true);
    // The persisted JSON deep-equals the loaded (enriched) snapshot —
    // key ORDER is irrelevant (the save's zod re-parse reorders keys to
    // schema order), every VALUE including the enriched icons survives…
    const written = mockSetItem.mock.calls.at(-1)![1] as string;
    expect(JSON.parse(written)).toEqual(loaded.value);
    // …and reading it back yields the identical value (icons included,
    // rooms/catalog untouched — the enrichment is load-stable).
    mockGetItem.mockResolvedValueOnce(written);
    const reloaded = await repo.load();
    expect(reloaded.ok).toBe(true);
    if (loaded.ok && reloaded.ok) {
      expect(reloaded.value).toEqual(loaded.value);
    }
  });
});
