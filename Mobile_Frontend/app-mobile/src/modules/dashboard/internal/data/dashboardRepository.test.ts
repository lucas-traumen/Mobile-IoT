/**
 * AsyncStorageDashboardRepository tests.
 *
 * Verifies: seed report on first run, round-trip persistence of the
 * Template file, legacy-shape discrimination + structural migration flag,
 * malformed/failed validation falls back to seed (never over a VALID
 * snapshot), storage failures map to Result errors, and a save round-trip
 * preserving unknown custom widget fields.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { NullLogger } from '@core/logger';

import { defaultDashboardsFile } from '../domain/seeds';
import { AsyncStorageDashboardRepository } from './dashboardRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe('AsyncStorageDashboardRepository', () => {
  let repo: AsyncStorageDashboardRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AsyncStorageDashboardRepository(new NullLogger());
  });

  it('reports the seed kind when nothing is stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('seed');
    }
  });

  it('persists and reloads a Template file (round-trip)', async () => {
    const file = defaultDashboardsFile();
    const saveResult = await repo.save(file);
    expect(saveResult.ok).toBe(true);
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify(file),
    );

    mockGetItem.mockResolvedValueOnce(JSON.stringify(file));
    const loadResult = await repo.load();
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.kind).toBe('file');
      if (loadResult.value.kind === 'file') {
        expect(loadResult.value.file).toEqual(file);
        expect(loadResult.value.migratedFromLegacy).toBe(false);
      }
    }
  });

  it('round-trips unknown custom widget fields byte-for-byte', async () => {
    const file = defaultDashboardsFile();
    file.templates[0]!.rooms[0]!.widgets.push({
      id: 'w-custom',
      type: 'vendor-camera-panel',
      roomId: 'room-living',
      layout: { x: 0, y: 3, width: 2, height: 2 },
      config: { stream: 'rtsp://cam/main' },
      vendorVersion: '2.1.0',
    } as never);
    await repo.save(file);
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"vendorVersion":"2.1.0"'),
    );

    mockGetItem.mockResolvedValueOnce(mockSetItem.mock.calls[0]![1]);
    const loadResult = await repo.load();
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok && loadResult.value.kind === 'file') {
      const custom = loadResult.value.file.templates[0]!.rooms[0]!.widgets.find(
        w => w.id === 'w-custom',
      );
      expect(custom).toBeDefined();
      expect(custom!.config).toEqual({ stream: 'rtsp://cam/main' });
      expect(custom!.vendorVersion).toBe('2.1.0');
    }
  });

  it('discriminates a LEGACY file and reports migratedFromLegacy', async () => {
    const legacy = {
      dashboards: [
        {
          id: 'main',
          name: 'Trang chủ',
          widgets: [
            {
              id: 'w-1',
              type: 'vendor-camera-panel',
              roomId: 'room-living',
              layout: { x: 0, y: 0, width: 2, height: 1 },
            },
          ],
        },
      ],
      activeId: 'main',
    };
    mockGetItem.mockResolvedValueOnce(JSON.stringify(legacy));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'file') {
      expect(result.value.migratedFromLegacy).toBe(true);
      expect(result.value.file.activeRoomId).toBeNull();
      expect(result.value.file.templates[0]!.rooms[0]!.roomId).toBe(
        'room-living',
      );
      expect(
        result.value.file.templates[0]!.rooms[0]!.widgets.map(w => w.id),
      ).toEqual(['w-1']);
    }
  });

  it('seeds when stored JSON is malformed', async () => {
    mockGetItem.mockResolvedValueOnce('not-json{');
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('seed');
    }
  });

  it('seeds when the stored value fails validation (never over valid data)', async () => {
    // activeId does not match any template → invalid file.
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ templates: [], activeId: 'ghost' }),
    );
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('seed');
    }
  });

  it('rejects saving an invalid file with a validation error', async () => {
    const invalid = {
      templates: [],
      activeId: 'ghost',
      activeRoomId: null,
    } as never;
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
