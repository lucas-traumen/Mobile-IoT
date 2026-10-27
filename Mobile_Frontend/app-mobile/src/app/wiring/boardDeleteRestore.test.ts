import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_MQTT_PREFIX } from '@core/constants';
import { parseBoardQrLabel } from '@modules/devices/ui/boardQrLabel';

import { buildContainer } from './container';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

/**
 * The exact payload printed by `board-qr.sh -m 5c:01:3b:6b:af:6c` — the label
 * the user actually scans. Note the underscore in the type: the label is a
 * printer payload, not a topic segment, so it is not charset-restricted.
 */
const RAW_QR =
  '{"schemaVersion":1,"boardId":"3b6baf6c","boardType":"IoT_ESP32-S2R3"}';

const DESCRIPTOR = {
  schemaVersion: 1,
  boardId: '3b6baf6c',
  boardType: 'IoT_ESP32-S2R3',
  sensors: [{ channel: 'S1', field: 'temperature', unit: '°C' }],
  relays: [{ channel: 'K1' }],
};

const DESCRIPTOR_TOPIC = `${DEFAULT_MQTT_PREFIX}/boards/3b6baf6c/descriptor`;
const STATUS_TOPIC = `${DEFAULT_MQTT_PREFIX}/boards/3b6baf6c/status`;

type Deps = ReturnType<typeof buildContainer>;

/** Mirrors `SettingsNavigator`'s `onRestoreBoard` (the composition root). */
async function rescanQr(deps: Deps, raw: string): Promise<void> {
  const label = parseBoardQrLabel(raw);
  if (label === null) {
    throw new Error('the QR label failed to parse');
  }
  const result = await deps.devicesRegistry.restoreBoard(label.boardId);
  if (result.ok) {
    deps.boardInventory.restoreFromQr(label.boardId, label.boardType);
  }
}

function visibleCodes(deps: Deps): string[] {
  return deps.boardStore.getState().boards.map(board => board.code);
}

function announceOnline(deps: Deps): void {
  deps.boardInventory.handleDescriptorMessage({
    topic: DESCRIPTOR_TOPIC,
    payload: JSON.stringify(DESCRIPTOR),
  });
  deps.boardInventory.handleStatusMessage({
    topic: STATUS_TOPIC,
    payload: 'online',
  });
}

describe('deleting a board and bringing it back with the QR label', () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  it('restores the card in the same session while the board is online', async () => {
    const deps = buildContainer();
    await deps.devicesRegistry.load();
    announceOnline(deps);
    expect(visibleCodes(deps)).toEqual(['3b6baf6c']);

    await deps.devicesRegistry.removeBoard('3b6baf6c');
    expect(visibleCodes(deps)).toEqual([]);

    await rescanQr(deps, RAW_QR);
    expect(visibleCodes(deps)).toEqual(['3b6baf6c']);
    expect(deps.devicesRegistry.getDeletedBoardCodes()).toEqual([]);
  });

  it('restores the card after an app restart, from the retained descriptor', async () => {
    const first = buildContainer();
    await first.devicesRegistry.load();
    announceOnline(first);
    await first.devicesRegistry.removeBoard('3b6baf6c');
    const persisted = (AsyncStorage.setItem as jest.Mock).mock.calls.at(
      -1,
    )?.[1] as string;
    expect(persisted).toContain('3b6baf6c');

    // Cold start: the hide marker survives, the inventory starts empty again.
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(persisted);
    const second = buildContainer();
    await second.devicesRegistry.load();
    expect(second.devicesRegistry.getDeletedBoardCodes()).toEqual(['3b6baf6c']);

    // The board never went away, so the broker replays its retained
    // descriptor. It must stay hidden until the user rescans the label.
    announceOnline(second);
    expect(visibleCodes(second)).toEqual([]);

    await rescanQr(second, RAW_QR);
    expect(visibleCodes(second)).toEqual(['3b6baf6c']);
  });

  it('seeds the card for a label whose board was never discovered', async () => {
    const deps = buildContainer();
    await deps.devicesRegistry.load();
    expect(visibleCodes(deps)).toEqual([]);

    await rescanQr(deps, RAW_QR);

    expect(visibleCodes(deps)).toEqual(['3b6baf6c']);
    // The label's own type keys the card artwork, so the card is not blank
    // while the board has yet to publish a descriptor in this session.
    expect(deps.boardStore.getState().boards[0]?.descriptor?.boardType).toBe(
      'IoT_ESP32-S2R3',
    );
  });
});
