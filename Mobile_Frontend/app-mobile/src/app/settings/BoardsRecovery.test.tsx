import React from 'react';
import { StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_MQTT_PREFIX, STORAGE_KEYS } from '@core/constants';
import { STRINGS } from '@core/i18n';
import { ThemeProvider } from '@core/theme';
import type { WidgetServices } from '@modules/widgets/api';
import { buildContainer } from '../wiring/container';
import { SettingsNavigator } from './SettingsNavigator';

// Only external persistence, camera and BLE native boundaries are replaced.
// The navigator, scanner router, registry, inventory, event bus and stores are real.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

jest.mock('expo-camera', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    CameraView: (props: {
      onBarcodeScanned?: (event: { data: string; type: string }) => void;
    }) => React.createElement('View', { ...props, testID: 'recovery-camera' }),
    Camera: {
      requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
    },
  };
});

type NativeScanListener = (
  error: null,
  device: { id: string; localName: string; rssi: number },
) => void;
type NativeStatusListener = (
  error: null,
  characteristic: { value: string },
) => void;
const mockBleManager = {
  startDeviceScan: jest.fn<
    Promise<void>,
    [unknown, unknown, NativeScanListener]
  >(async () => undefined),
  stopDeviceScan: jest.fn(async () => undefined),
  connectToDevice: jest.fn(),
  cancelDeviceConnection: jest.fn(async () => undefined),
};
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn(() => mockBleManager),
  BleErrorCode: {
    BluetoothUnsupported: 100,
    BluetoothUnauthorized: 101,
    BluetoothPoweredOff: 102,
    BluetoothResetting: 104,
  },
}));

const RAW_QR =
  '{"schemaVersion":1,"boardId":"3b6baf6c","boardType":"IoT_ESP32-S2R3"}';
const BOARD_ID = '3b6baf6c';
const DESCRIPTOR = {
  schemaVersion: 1,
  boardId: BOARD_ID,
  boardType: 'IoT_ESP32-S2R3',
  sensors: [
    { channel: 'S1', field: 'temperature', unit: '°C' },
    { channel: 'S2', field: 'humidity', unit: '%' },
  ],
  relays: [{ channel: 'K1' }, { channel: 'K2' }, { channel: 'K3' }],
};
type Deps = ReturnType<typeof buildContainer>;
type Renderer = TestRenderer.ReactTestRenderer;
const storage = new Map<string, string>();
const renderers: Renderer[] = [];

function widgetServices(deps: Deps): WidgetServices {
  const connection = { state: 'idle' as const, label: 'Offline' };
  return {
    getState: (id, capability) =>
      deps.deviceStateStore.getState().values[`${id}:${capability}`],
    getSeries: (id, capability) =>
      deps.deviceStateStore.getState().getSeriesPoints(id, capability),
    sendCommand: (id, capability, value) =>
      deps.deviceCommandService.sendCommand(id, capability, value),
    getCommandError: (id, capability) =>
      deps.deviceStateStore.getState().getCommandError(id, capability) ?? null,
    queryHistory: query => deps.historySource.query(query),
    getRooms: () => deps.devicesRegistry.getRooms(),
    getDevices: () => deps.devicesRegistry.getDevices(),
    getCapabilities: () => deps.devicesRegistry.getCapabilities(),
    getActiveRoomId: () => deps.dashboardService.getActiveRoomId(),
    subscribeDeviceState: listener => deps.deviceStateStore.subscribe(listener),
    getConnectionState: () => connection,
    subscribeConnection: listener => deps.telemetryStore.subscribe(listener),
  };
}

async function press(renderer: Renderer, testID: string): Promise<void> {
  await act(async () => {
    renderer.root.findByProps({ testID }).props.onPress();
  });
}

async function renderBoards(deps: Deps): Promise<Renderer> {
  let renderer!: Renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <NavigationContainer>
        <ThemeProvider mode="light">
          <SettingsNavigator deps={deps} services={widgetServices(deps)} />
        </ThemeProvider>
      </NavigationContainer>,
    );
  });
  renderers.push(renderer);
  await press(renderer, 'settings-open-boards');
  return renderer;
}

async function scan(renderer: Renderer, raw = RAW_QR): Promise<void> {
  await press(renderer, 'boards-scan-button');
  await act(async () => {
    renderer.root
      .findByProps({ testID: 'recovery-camera' })
      .props.onBarcodeScanned({ data: raw, type: 'qr' });
  });
}

function card(renderer: Renderer, code = BOARD_ID) {
  return renderer.root.findByProps({ testID: `boards-card-${code}` });
}

function expectHighlighted(renderer: Renderer, code = BOARD_ID): void {
  expect(StyleSheet.flatten(card(renderer, code).props.style).borderWidth).toBe(
    2,
  );
}

function expectQrCard(renderer: Renderer): void {
  expect(card(renderer)).toBeDefined();
  expect(
    renderer.root.findByProps({ testID: `boards-type-${BOARD_ID}` }).props
      .children,
  ).toBe('IoT_ESP32-S2R3');
  const status = renderer.root.findByProps({
    testID: `boards-status-${BOARD_ID}`,
  });
  expect(
    status
      .findAllByType(Text)
      .some(node => node.props.children === STRINGS.boards.seen),
  ).toBe(true);
  expect(
    renderer.root.findAllByProps({ testID: `boards-sensors-${BOARD_ID}` }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({ testID: `boards-relays-${BOARD_ID}` }),
  ).toHaveLength(0);
  expectHighlighted(renderer);
}

async function search(renderer: Renderer, value: string): Promise<void> {
  await act(async () => {
    renderer.root
      .findByProps({ testID: 'boards-search-input' })
      .props.onChangeText(value);
  });
}

function expectStatus(renderer: Renderer, expected: string): void {
  const status = renderer.root.findByProps({
    testID: `boards-status-${BOARD_ID}`,
  });
  expect(
    status.findAllByType(Text).some(node => node.props.children === expected),
  ).toBe(true);
}

function descriptor(deps: Deps): void {
  deps.boardInventory.handleDescriptorMessage({
    topic: `${DEFAULT_MQTT_PREFIX}/boards/${BOARD_ID}/descriptor`,
    payload: JSON.stringify(DESCRIPTOR),
  });
}

function online(deps: Deps): void {
  deps.boardInventory.handleStatusMessage({
    topic: `${DEFAULT_MQTT_PREFIX}/boards/${BOARD_ID}/status`,
    payload: 'online',
  });
}

async function coldHidden(): Promise<Deps> {
  const first = buildContainer();
  expect((await first.devicesRegistry.load()).ok).toBe(true);
  expect((await first.devicesRegistry.removeBoard(BOARD_ID)).ok).toBe(true);
  const next = buildContainer();
  expect((await next.devicesRegistry.load()).ok).toBe(true);
  expect(next.devicesRegistry.getDeletedBoardCodes()).toEqual([BOARD_ID]);
  return next;
}

beforeEach(() => {
  storage.clear();
  jest.clearAllMocks();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async key => storage.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    storage.set(key, value);
  });
});

afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount();
    }
  });
});

describe('real SettingsNavigator board QR recovery', () => {
  it('immediately renders the exact QR card with an empty inventory and no deletion marker', async () => {
    const deps = buildContainer();
    expect((await deps.devicesRegistry.load()).ok).toBe(true);
    const renderer = await renderBoards(deps);
    expect(
      renderer.root.findAllByProps({ testID: `boards-card-${BOARD_ID}` }),
    ).toHaveLength(0);

    await scan(renderer);

    expectQrCard(renderer);
  });

  it('deletes and rescans through the UI in the same session without changing room/device/dashboard data', async () => {
    const deps = buildContainer();
    expect((await deps.devicesRegistry.load()).ok).toBe(true);
    expect(
      (await deps.devicesRegistry.rebindRoomBoard(BOARD_ID, 'room-living')).ok,
    ).toBe(true);
    expect((await deps.dashboardService.load()).ok).toBe(true);
    const roomsBefore = deps.devicesRegistry.getRooms();
    const devicesBefore = deps.devicesRegistry.getDevices();
    const dashboardsBefore = deps.dashboardService.getTemplates();
    descriptor(deps);
    online(deps);
    const renderer = await renderBoards(deps);
    expectStatus(renderer, STRINGS.boards.online);
    for (const testID of [
      `boards-card-menu-${BOARD_ID}`,
      `boards-sheet-delete-${BOARD_ID}`,
      'boards-delete-confirm',
    ]) {
      await press(renderer, testID);
    }
    expect(
      renderer.root.findAllByProps({ testID: `boards-card-${BOARD_ID}` }),
    ).toHaveLength(0);
    // Retained broker replay does not undo local deletion.
    await act(async () => {
      descriptor(deps);
      online(deps);
    });
    expect(
      renderer.root.findAllByProps({ testID: `boards-card-${BOARD_ID}` }),
    ).toHaveLength(0);
    // A different board exposes the search field while this one is hidden.
    await act(async () => {
      deps.boardInventory.handleStatusMessage({
        topic: `${DEFAULT_MQTT_PREFIX}/boards/other-board/status`,
        payload: 'online',
      });
    });
    await search(renderer, 'hides-all-cards');
    await scan(renderer);
    expect(card(renderer)).toBeDefined();
    expectHighlighted(renderer);
    expectStatus(renderer, STRINGS.boards.online);
    expect(
      renderer.root.findByProps({ testID: 'boards-search-input' }).props.value,
    ).toBe('');
    expect(deps.devicesRegistry.getDeletedBoardCodes()).toEqual([]);
    expect(deps.devicesRegistry.getRooms()).toEqual(roomsBefore);
    expect(deps.devicesRegistry.getDevices()).toEqual(devicesBefore);
    expect(deps.dashboardService.getTemplates()).toEqual(dashboardsBefore);
  });

  it('restores an empty cold inventory with a persisted deletion marker', async () => {
    const deps = await coldHidden();
    const renderer = await renderBoards(deps);
    await scan(renderer);
    expectQrCard(renderer);
    expect(deps.devicesRegistry.getDeletedBoardCodes()).toEqual([]);
    expect(storage.get(STORAGE_KEYS.devices)).toContain(
      '"deletedBoardCodes":[]',
    );
  });

  it.each(['status-first', 'descriptor-first'])(
    'updates the rendered QR card from MQTT in %s order',
    async order => {
      const deps = buildContainer();
      await deps.devicesRegistry.load();
      const renderer = await renderBoards(deps);
      await scan(renderer);
      expectQrCard(renderer);
      if (order === 'status-first') {
        await act(async () => online(deps));
        expectStatus(renderer, STRINGS.boards.online);
        expect(
          renderer.root.findAllByProps({
            testID: `boards-sensors-${BOARD_ID}`,
          }),
        ).toHaveLength(0);
        await act(async () => descriptor(deps));
      } else {
        await act(async () => descriptor(deps));
        expectStatus(renderer, STRINGS.boards.seen);
        await act(async () => online(deps));
      }
      expectStatus(renderer, STRINGS.boards.online);
      const sensors = renderer.root.findByProps({
        testID: `boards-sensors-${BOARD_ID}`,
      });
      expect(
        sensors.findAllByType(Text).map(node => node.props.children),
      ).toEqual(expect.arrayContaining(['S1 · Nhiệt độ', 'S2 · Độ ẩm']));
      expect(
        renderer.root
          .findByProps({ testID: `boards-relays-${BOARD_ID}` })
          .findAllByType(Text)
          .some(node => node.props.children === 'K1–K3'),
      ).toBe(true);
      expect(
        renderer.root
          .findAllByProps({ testID: `boards-card-${BOARD_ID}` })
          .filter(node => typeof node.type === 'string'),
      ).toHaveLength(1);
    },
  );

  it('keeps failed restoration hidden and retries from the reopened scanner after storage recovers', async () => {
    const deps = await coldHidden();
    const renderer = await renderBoards(deps);
    jest
      .mocked(AsyncStorage.setItem)
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await scan(renderer);
    expect(
      renderer.root.findAllByProps({ testID: `boards-card-${BOARD_ID}` }),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({ testID: 'boards-scanner-error' }).props
        .children,
    ).toBe('Failed to write devices to storage');
    expect(deps.devicesRegistry.getDeletedBoardCodes()).toEqual([BOARD_ID]);
    // The scanner has remounted and rearmed. Retry without manually reopening.
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'recovery-camera' })
        .props.onBarcodeScanned({ data: RAW_QR, type: 'qr' });
    });
    expectQrCard(renderer);
    expect(deps.devicesRegistry.getDeletedBoardCodes()).toEqual([]);
    expect(
      renderer.root.findAllByProps({ testID: 'boards-scanner-modal' }),
    ).toHaveLength(0);
  });

  it('rejects unsafe QR ids without restoring them and accepts a valid immediate rescan', async () => {
    const deps = buildContainer();
    await deps.devicesRegistry.load();
    const renderer = await renderBoards(deps);
    await scan(
      renderer,
      '{"schemaVersion":1,"boardId":"3b6baf6c/other","boardType":"IoT_ESP32-S2R3"}',
    );
    expect(
      renderer.root.findByProps({ testID: 'boards-scanner-error' }).props
        .children,
    ).toBe(STRINGS.boards.scanInvalid);
    expect(deps.boardStore.getState().boards).toEqual([]);
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'recovery-camera' })
        .props.onBarcodeScanned({ data: RAW_QR, type: 'qr' });
    });
    expectQrCard(renderer);
  });

  it('restores the selected BLE board through the real native service and clears a hiding search', async () => {
    const deps = buildContainer();
    await deps.devicesRegistry.load();
    const renderer = await renderBoards(deps);
    await scan(renderer);
    expectQrCard(renderer);
    await press(renderer, `boards-sheet-ble-${BOARD_ID}`);
    // Change the selection to another physical board. Its deletion marker
    // exists, but no inventory entry exists; BLE success must seed that card.
    await act(async () => {
      await deps.devicesRegistry.removeBoard('other-board');
    });
    await search(renderer, 'hides-all-cards');
    const listener = mockBleManager.startDeviceScan.mock.calls.at(-1)?.[2];
    expect(listener).toBeDefined();
    await act(async () => {
      listener?.(null, {
        id: 'AA:BB:CC:DD:EE:FF',
        localName: 'IoTBoard-other-board',
        rssi: -58,
      });
    });
    await press(renderer, 'boards-ble-board-other-board');
    let notify: NativeStatusListener | undefined;
    const device = {
      requestMTU: async () => undefined,
      discoverAllServicesAndCharacteristics: async () => undefined,
      monitorCharacteristicForService: (
        _service: string,
        _characteristic: string,
        listener: NativeStatusListener,
      ) => {
        notify = listener;
        return { remove: () => undefined };
      },
      writeCharacteristicWithResponseForService: async (
        _service: string,
        _characteristic: string,
        value: string,
      ) => {
        if (value === 'UFJPVklTSU9O') {
          // Native CONNECTED is the provisioning result; the board card
          // still requires its MQTT status to show online.
          notify?.(null, { value: 'Q09OTkVDVEVE' });
        }
      },
    };
    mockBleManager.connectToDevice.mockResolvedValue(device);
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'boards-ble-ssid-input' })
        .props.onChangeText('home-wifi');
      renderer.root
        .findByProps({ testID: 'boards-ble-broker-input' })
        .props.onChangeText('192.168.2.34:1883');
    });
    await press(renderer, 'boards-ble-send');
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-success' }),
    ).toBeDefined();
    await press(renderer, 'boards-ble-close');
    expect(card(renderer, 'other-board')).toBeDefined();
    expectHighlighted(renderer, 'other-board');
    expect(
      renderer.root.findByProps({ testID: 'boards-search-input' }).props.value,
    ).toBe('');
    expect(deps.devicesRegistry.getDeletedBoardCodes()).toEqual([]);
    expect(
      deps.boardStore
        .getState()
        .boards.find(board => board.code === 'other-board')?.status,
    ).toBe('seen');
  });
});
