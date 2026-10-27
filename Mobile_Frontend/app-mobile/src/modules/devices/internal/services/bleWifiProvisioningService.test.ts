/**
 * BLE provisioning service tests (boards-ble-wifi-provisioning +
 * `ble-provisioning-v2-broker-push`): the `react-native-ble-plx` stack is
 * fully mocked — these pins verify the CONTRACT sequence, not the BLE
 * hardware: service-UUID scan filter + localName→boardId mapping, connect
 * → best-effort MTU → discovery → Status subscription BEFORE the 6-value
 * write sequence SSID → WiFi Password → Broker → MQTT username → MQTT
 * password → PROVISION (write-with-response, Base64, contract order and
 * contract characteristic per value), CONNECTING→CONNECTED resolution,
 * FAILED:BAD_AUTH / FAILED:BAD_BROKER typed rejections, the pre-flight
 * VALIDATION rejection (no BLE call at all), the 30s app-side TIMEOUT,
 * transport failures mapped to TRANSPORT, the R5/AC7 web guard, and the
 * lastSsid memory (dedicated key; WiFi password + MQTT credentials never
 * persisted).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BleManager } from 'react-native-ble-plx';

import {
  BLE_BROKER_UUID,
  BLE_COMMAND_UUID,
  BLE_MQTT_PASSWORD_UUID,
  BLE_MQTT_USERNAME_UUID,
  BLE_PASSWORD_UUID,
  BLE_PROVISION_TIMEOUT_MS,
  BLE_SERVICE_UUID,
  BLE_SSID_UUID,
  utf8ToBase64,
} from '../domain/bleProvisioningContract';
import {
  BleWifiProvisioningService,
  type BleScannedBoard,
  type BleScanProblem,
} from './bleWifiProvisioningService';

/** Mutable Platform.OS seam (R5/AC7 web-guard test) — jest-expo is 'ios'. */
let mockPlatformOS = 'ios';

/**
 * Wrap the react-native module in a Proxy so `Platform.OS` reads the
 * mutable seam while every other export stays the untouched actual value
 * (a spread-based mock eagerly evaluates RN internals and crashes
 * jest-expo's setup; the shim path mock is bypassed by the index getter).
 */
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as Record<
    PropertyKey,
    unknown
  >;
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'Platform') {
        return {
          ...(target.Platform as Record<string, unknown>),
          get OS() {
            return mockPlatformOS;
          },
        };
      }
      return target[prop];
    },
  });
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

/**
 * The mocked BleManager instance every service construction receives.
 * `startDeviceScan`/`stopDeviceScan` return promises (the real API does —
 * the service voids/catches them); connect/scan responses are stubbed
 * per-test through mockResolvedValueOnce etc. Mock signatures carry the
 * real call arity so `mock.calls[i][n]` is typable.
 */
const mockManager = {
  startDeviceScan: jest.fn<Promise<void>, [unknown?, unknown?, unknown?]>(
    async () => undefined,
  ),
  stopDeviceScan: jest.fn<Promise<void>, []>(async () => undefined),
  connectToDevice: jest.fn<Promise<unknown>, [unknown?]>(async () => undefined),
  cancelDeviceConnection: jest.fn<Promise<unknown>, [unknown?]>(
    async () => undefined,
  ),
};

jest.mock('react-native-ble-plx', () => ({
  // Minimal mirror of the library's documented BleErrorCode members the
  // service maps (BluetoothPoweredOff=102, BluetoothUnauthorized=101,
  // BluetoothResetting=104).
  BleErrorCode: {
    BluetoothUnsupported: 100,
    BluetoothUnauthorized: 101,
    BluetoothPoweredOff: 102,
    BluetoothResetting: 104,
  },
  BleManager: jest.fn(() => mockManager),
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

/**
 * The BleManager constructor mock (instance assertions).
 */
const bleManagerCtor = BleManager as unknown as jest.Mock;

/**
 * Contract v2 broker/MQTT payload shared by the provision calls (each
 * call adds its own deviceId/ssid/password/onStatus).
 */
const V2_PAYLOAD = {
  broker: '192.168.100.3:1883',
  mqttUsername: 'admin',
  mqttPassword: 'mqtt-pw-ộ',
} as const;

/** Shape of the Device the service operates on (subset it touches). */
interface MockDevice {
  readonly id: string;
  readonly name: string | null;
  readonly localName: string | null;
  readonly rssi: number | null;
  readonly requestMTU: jest.Mock;
  readonly discoverAllServicesAndCharacteristics: jest.Mock;
  readonly monitorCharacteristicForService: jest.Mock;
  readonly writeCharacteristicWithResponseForService: jest.Mock;
}

/** Build a mock Device whose async methods resolve to itself. */
function makeMockDevice(
  id = 'AA:BB:CC:DD:EE:FF',
  localName: string | null = 'IoTBoard-0',
): MockDevice {
  const remove = jest.fn();
  const device: MockDevice = {
    id,
    name: localName,
    localName,
    rssi: -58,
    requestMTU: jest.fn<Promise<unknown>, [unknown?]>(async () => device),
    discoverAllServicesAndCharacteristics: jest.fn<Promise<unknown>, []>(
      async () => device,
    ),
    monitorCharacteristicForService: jest.fn<
      { remove: jest.Mock },
      [unknown?, unknown?, unknown?]
    >(() => ({ remove })),
    writeCharacteristicWithResponseForService: jest.fn<
      Promise<unknown>,
      [unknown?, unknown?, unknown?]
    >(async () => ({})),
  };
  return device;
}

/** The Status-notify listener captured from a device mock. */
function monitorListenerOf(
  device: MockDevice,
): (
  error: { errorCode?: number } | null,
  characteristic: { value: string | null } | null,
) => void {
  expect(device.monitorCharacteristicForService).toHaveBeenCalled();
  return device.monitorCharacteristicForService.mock.calls[0][2] as (
    error: { errorCode?: number } | null,
    characteristic: { value: string | null } | null,
  ) => void;
}

/** The `remove` of the Status subscription captured from a device mock. */
function subscriptionRemoveOf(device: MockDevice): jest.Mock {
  const subscription = device.monitorCharacteristicForService.mock.results[0]
    .value as { remove: jest.Mock };
  return subscription.remove;
}

/** Drain the provision chain's microtask steps (FIFO — deterministic). */
async function drain(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
  }
}

describe('BleWifiProvisioningService — scan', () => {
  let service: BleWifiProvisioningService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    service = new BleWifiProvisioningService();
  });

  it('scans filtered by the provisioning service UUID', () => {
    service.startScan(() => undefined);
    expect(mockManager.startDeviceScan).toHaveBeenCalledWith(
      [BLE_SERVICE_UUID],
      { allowDuplicates: false },
      expect.any(Function),
    );
  });

  it('maps the IoTBoard-{boardId} local name to the board and skips foreign devices', () => {
    const found: BleScannedBoard[] = [];
    const session = service.startScan(board => found.push(board));

    const listener = mockManager.startDeviceScan.mock.calls[0][2] as (
      error: unknown,
      device: MockDevice | null,
    ) => void;
    listener(null, makeMockDevice('MAC-1', 'IoTBoard-0'));
    listener(null, makeMockDevice('MAC-2', 'IoTBoard-board-7'));
    // Foreign / malformed advertisements never reach the list.
    listener(null, makeMockDevice('MAC-3', 'ESP32 Setup'));
    listener(null, makeMockDevice('MAC-4', null));
    listener(null, makeMockDevice('MAC-5', 'IoTBoard-'));
    listener(null, null);

    expect(found).toEqual([
      {
        deviceId: 'MAC-1',
        boardId: '0',
        localName: 'IoTBoard-0',
        rssi: -58,
      },
      {
        deviceId: 'MAC-2',
        boardId: 'board-7',
        localName: 'IoTBoard-board-7',
        rssi: -58,
      },
    ]);

    // Stopping is forwarded (once — idempotent for double-stop).
    session.stop();
    session.stop();
    expect(mockManager.stopDeviceScan).toHaveBeenCalledTimes(1);
  });

  it('maps mid-scan errors to honest problems (BT off / permission / other)', () => {
    const problems: BleScanProblem[] = [];
    service.startScan(
      () => undefined,
      problem => problems.push(problem),
    );

    const listener = mockManager.startDeviceScan.mock.calls[0][2] as (
      error: { errorCode?: number } | null,
      device: MockDevice | null,
    ) => void;
    listener({ errorCode: 102 }, null); // BluetoothPoweredOff
    listener({ errorCode: 101 }, null); // BluetoothUnauthorized
    listener({ errorCode: 100 }, null); // BluetoothUnsupported → unavailable
    listener({ errorCode: undefined }, null);

    expect(problems).toEqual([
      'bluetoothOff',
      'permissionDenied',
      'unavailable',
      'unavailable',
    ]);
  });

  it('surfaces a scan that cannot START (e.g. BT off at scan start)', async () => {
    mockManager.startDeviceScan.mockRejectedValueOnce(
      new Error('cannot start'),
    );
    const problems: BleScanProblem[] = [];
    service.startScan(
      () => undefined,
      problem => problems.push(problem),
    );
    await drain();
    expect(problems).toEqual(['unavailable']);
  });

  it('ignores notifications after the session was stopped', () => {
    const found: BleScannedBoard[] = [];
    const session = service.startScan(board => found.push(board));
    const listener = mockManager.startDeviceScan.mock.calls[0][2] as (
      error: unknown,
      device: MockDevice | null,
    ) => void;
    session.stop();
    listener(null, makeMockDevice('MAC-9', 'IoTBoard-9'));
    expect(found).toEqual([]);
  });
});

describe('BleWifiProvisioningService — provision sequence', () => {
  let service: BleWifiProvisioningService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    service = new BleWifiProvisioningService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function arrangeConnected(device = makeMockDevice()): MockDevice {
    mockManager.connectToDevice.mockResolvedValueOnce(device);
    return device;
  }

  it('runs connect → MTU 128 → discovery → Status subscription BEFORE the 6 contract writes, in contract order', async () => {
    const device = arrangeConnected();
    const onStatus = jest.fn();
    const callOrder: string[] = [];
    device.requestMTU.mockImplementation(async () => {
      callOrder.push('mtu');
      return device;
    });
    device.discoverAllServicesAndCharacteristics.mockImplementation(
      async () => {
        callOrder.push('discover');
        return device;
      },
    );
    device.monitorCharacteristicForService.mockImplementation(() => {
      callOrder.push('subscribe');
      return { remove: jest.fn() };
    });
    device.writeCharacteristicWithResponseForService.mockImplementation(
      async () => {
        callOrder.push('write');
        return {};
      },
    );

    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'Mạng nhà',
      password: 'secret ộ',
      ...V2_PAYLOAD,
      onStatus,
    });
    await drain();

    // MTU request is best-effort but requested with the contract value.
    expect(device.requestMTU).toHaveBeenCalledWith(128);
    // The writes target the CONTRACT characteristics with Base64 UTF-8
    // values, write-with-response, in the v2 order: SSID → WiFi Password
    // → Broker → MQTT username → MQTT password → PROVISION. The broker
    // address goes to the PLAIN char (3a07) and the command to 3a04; the
    // WiFi + MQTT credential chars (3a02/3a03/3a08/3a09) are the
    // encrypted-link ones the firmware enforces.
    const writes = device.writeCharacteristicWithResponseForService.mock
      .calls as unknown as readonly (readonly [string, string, string])[];
    expect(writes.map(([, characteristic]) => characteristic)).toEqual([
      BLE_SSID_UUID,
      BLE_PASSWORD_UUID,
      BLE_BROKER_UUID,
      BLE_MQTT_USERNAME_UUID,
      BLE_MQTT_PASSWORD_UUID,
      BLE_COMMAND_UUID,
    ]);
    expect(writes).toEqual([
      [BLE_SERVICE_UUID, BLE_SSID_UUID, utf8ToBase64('Mạng nhà')],
      [BLE_SERVICE_UUID, BLE_PASSWORD_UUID, utf8ToBase64('secret ộ')],
      [BLE_SERVICE_UUID, BLE_BROKER_UUID, utf8ToBase64('192.168.100.3:1883')],
      [BLE_SERVICE_UUID, BLE_MQTT_USERNAME_UUID, utf8ToBase64('admin')],
      [BLE_SERVICE_UUID, BLE_MQTT_PASSWORD_UUID, utf8ToBase64('mqtt-pw-ộ')],
      [BLE_SERVICE_UUID, BLE_COMMAND_UUID, utf8ToBase64('PROVISION')],
    ]);
    // Full observed order: MTU → discovery → Status subscription armed
    // BEFORE any write → then the six contract writes.
    expect(callOrder).toEqual([
      'mtu',
      'discover',
      'subscribe',
      'write',
      'write',
      'write',
      'write',
      'write',
      'write',
    ]);

    // CONNECTING then CONNECTED → resolved, statuses forwarded in order.
    const monitorListener = monitorListenerOf(device);
    monitorListener(null, { value: utf8ToBase64('CONNECTING') });
    monitorListener(null, { value: utf8ToBase64('CONNECTED') });
    await provisionPromise;

    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      { kind: 'connecting' },
      { kind: 'connected' },
    ]);
  });

  it('cleans up on success: status unsubscribed + device disconnected', async () => {
    const device = arrangeConnected();
    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: '',
      ...V2_PAYLOAD,
    });
    await drain();
    monitorListenerOf(device)(null, { value: utf8ToBase64('CONNECTED') });
    await provisionPromise;

    expect(subscriptionRemoveOf(device)).toHaveBeenCalled();
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith(device.id);
    // Success persists NOTHING (the modal saves the SSID explicitly).
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('survives a failed MTU negotiation (best-effort)', async () => {
    const device = arrangeConnected();
    device.requestMTU.mockRejectedValueOnce(new Error('MTU not supported'));

    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: 'pw',
      ...V2_PAYLOAD,
    });
    await drain();
    monitorListenerOf(device)(null, { value: utf8ToBase64('CONNECTED') });
    await expect(provisionPromise).resolves.toBeUndefined();
    // The writes still ran (all six).
    expect(
      device.writeCharacteristicWithResponseForService,
    ).toHaveBeenCalledTimes(6);
  });

  it('rejects FAILED:BAD_AUTH as a typed error and still cleans up', async () => {
    const device = arrangeConnected();
    const onStatus = jest.fn();
    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: 'wrong',
      ...V2_PAYLOAD,
      onStatus,
    });
    await drain();
    const monitorListener = monitorListenerOf(device);
    monitorListener(null, { value: utf8ToBase64('CONNECTING') });
    monitorListener(null, { value: utf8ToBase64('FAILED:BAD_AUTH') });

    await expect(provisionPromise).rejects.toMatchObject({
      name: 'BleProvisionError',
      reason: 'BAD_AUTH',
    });
    expect(onStatus).toHaveBeenCalledWith({ kind: 'connecting' });
    expect(onStatus).toHaveBeenCalledWith({
      kind: 'failed',
      reason: 'BAD_AUTH',
    });
    expect(subscriptionRemoveOf(device)).toHaveBeenCalled();
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith(device.id);
  });

  it('rejects FAILED:BAD_BROKER as a typed error (v2: broker/MQTT-auth failure) and still cleans up', async () => {
    const device = arrangeConnected();
    const onStatus = jest.fn();
    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: 'right',
      ...V2_PAYLOAD,
      onStatus,
    });
    await drain();
    const monitorListener = monitorListenerOf(device);
    monitorListener(null, { value: utf8ToBase64('CONNECTING') });
    monitorListener(null, { value: utf8ToBase64('FAILED:BAD_BROKER') });

    await expect(provisionPromise).rejects.toMatchObject({
      name: 'BleProvisionError',
      reason: 'BAD_BROKER',
    });
    expect(onStatus).toHaveBeenCalledWith({
      kind: 'failed',
      reason: 'BAD_BROKER',
    });
    expect(subscriptionRemoveOf(device)).toHaveBeenCalled();
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith(device.id);
  });

  it('ignores garbage notifications (never a terminal state)', async () => {
    const device = arrangeConnected();
    jest.useFakeTimers();
    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: '',
      ...V2_PAYLOAD,
    });
    await drain();
    const monitorListener = monitorListenerOf(device);
    monitorListener(null, { value: utf8ToBase64('WHAT') });
    monitorListener(null, { value: utf8ToBase64('FAILED:WIFI_DOWN') });
    monitorListener(null, { value: null });

    // Nothing terminal happened: just before the 30s window closes the
    // promise is still pending (the timer advances resolve it as TIMEOUT).
    jest.advanceTimersByTime(BLE_PROVISION_TIMEOUT_MS - 1);
    let settled = false;
    void provisionPromise
      .catch(() => undefined)
      .then(() => {
        settled = true;
      });
    await drain();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(1);
    await expect(provisionPromise).rejects.toMatchObject({
      reason: 'TIMEOUT',
    });
  });

  it('times out with the TIMEOUT reason when no status arrives in 30s', async () => {
    const device = arrangeConnected();
    jest.useFakeTimers();
    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: '',
      ...V2_PAYLOAD,
    });
    await drain();
    expect(
      device.writeCharacteristicWithResponseForService,
    ).toHaveBeenCalledTimes(6);

    jest.advanceTimersByTime(BLE_PROVISION_TIMEOUT_MS);
    await expect(provisionPromise).rejects.toMatchObject({ reason: 'TIMEOUT' });
    // Cleanup still ran after the timeout.
    expect(subscriptionRemoveOf(device)).toHaveBeenCalled();
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith(device.id);
  });

  it('maps a connect failure to TRANSPORT (and never disconnects what never connected)', async () => {
    mockManager.connectToDevice.mockRejectedValueOnce(
      new Error('device unreachable'),
    );
    await expect(
      service.provision({
        deviceId: 'MAC-X',
        ssid: 'net',
        password: '',
        ...V2_PAYLOAD,
      }),
    ).rejects.toMatchObject({ reason: 'TRANSPORT' });
    expect(mockManager.cancelDeviceConnection).not.toHaveBeenCalled();
  });

  it('maps a failed write to TRANSPORT and cleans up', async () => {
    const device = arrangeConnected();
    device.writeCharacteristicWithResponseForService
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('write failed'));

    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: 'pw',
      ...V2_PAYLOAD,
    });
    await expect(provisionPromise).rejects.toMatchObject({
      reason: 'TRANSPORT',
    });
    expect(subscriptionRemoveOf(device)).toHaveBeenCalled();
    expect(mockManager.cancelDeviceConnection).toHaveBeenCalledWith(device.id);
  });

  it('rejects an invalid broker with VALIDATION BEFORE any BLE call', async () => {
    const invalid = { ...V2_PAYLOAD, broker: 'not a broker (spaces)' };
    await expect(
      service.provision({
        deviceId: 'MAC-X',
        ssid: 'net',
        password: '',
        ...invalid,
      }),
    ).rejects.toMatchObject({
      name: 'BleProvisionError',
      reason: 'VALIDATION',
    });
    // Not even the manager was constructed: the payload never reached BLE.
    expect(bleManagerCtor).not.toHaveBeenCalled();
    expect(mockManager.connectToDevice).not.toHaveBeenCalled();
  });

  it('rejects an empty broker with VALIDATION (broker is required in v2)', async () => {
    await expect(
      service.provision({
        deviceId: 'MAC-X',
        ssid: 'net',
        password: '',
        broker: '',
        mqttUsername: '',
        mqttPassword: '',
      }),
    ).rejects.toMatchObject({ reason: 'VALIDATION' });
    expect(bleManagerCtor).not.toHaveBeenCalled();
  });

  it('rejects invalid WiFi or MQTT credentials with VALIDATION before BLE', async () => {
    // 33-byte SSID (limit 32).
    await expect(
      service.provision({
        deviceId: 'MAC-X',
        ssid: 'a'.repeat(33),
        password: '',
        ...V2_PAYLOAD,
      }),
    ).rejects.toMatchObject({ reason: 'VALIDATION' });
    // 65-byte MQTT username (limit 64).
    await expect(
      service.provision({
        deviceId: 'MAC-X',
        ssid: 'net',
        password: '',
        ...V2_PAYLOAD,
        mqttUsername: 'u'.repeat(65),
      }),
    ).rejects.toMatchObject({ reason: 'VALIDATION' });
    // 129-byte MQTT password (limit 128).
    await expect(
      service.provision({
        deviceId: 'MAC-X',
        ssid: 'net',
        password: '',
        ...V2_PAYLOAD,
        mqttPassword: 'p'.repeat(129),
      }),
    ).rejects.toMatchObject({ reason: 'VALIDATION' });
    expect(bleManagerCtor).not.toHaveBeenCalled();
    expect(mockManager.connectToDevice).not.toHaveBeenCalled();
  });
});

describe('BleWifiProvisioningService — lastSsid memory (AD-4)', () => {
  let service: BleWifiProvisioningService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    service = new BleWifiProvisioningService();
  });

  it('saves to the dedicated key and loads it back', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);
    await service.saveLastSsid('Mạng nhà');
    expect(mockSetItem).toHaveBeenCalledWith(
      'devices.ble.lastSsid',
      'Mạng nhà',
    );

    mockGetItem.mockResolvedValueOnce('Mạng nhà');
    await expect(service.loadLastSsid()).resolves.toBe('Mạng nhà');
  });

  it('loads null when nothing was saved', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await expect(service.loadLastSsid()).resolves.toBeNull();
  });

  it('swallows storage failures on both directions', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.saveLastSsid('net')).resolves.toBeUndefined();
    mockGetItem.mockRejectedValueOnce(new Error('disk error'));
    await expect(service.loadLastSsid()).resolves.toBeNull();
  });

  it('never persists a password: the save API takes only the SSID', async () => {
    const device = makeMockDevice();
    mockManager.connectToDevice.mockResolvedValueOnce(device);
    const provisionPromise = service.provision({
      deviceId: device.id,
      ssid: 'net',
      password: 'super-secret-ộ',
      ...V2_PAYLOAD,
    });
    await drain();
    monitorListenerOf(device)(null, { value: utf8ToBase64('CONNECTED') });
    await provisionPromise;

    // No storage write happened anywhere in the provisioning path — the
    // WiFi password AND the v2 MQTT credentials never reach AsyncStorage
    // (the only persisted key is the SSID, written explicitly by the
    // modal through saveLastSsid).
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(JSON.stringify(mockSetItem.mock.calls)).not.toContain('mqtt-pw-ộ');
  });
});

describe('BleWifiProvisioningService — R5/AC7 web guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('constructs the BleManager lazily (none until first use)', () => {
    mockPlatformOS = 'ios';
    new BleWifiProvisioningService();
    expect(bleManagerCtor).not.toHaveBeenCalled();
    const service = new BleWifiProvisioningService();
    service.startScan(() => undefined);
    expect(bleManagerCtor).toHaveBeenCalledTimes(1);
  });

  it('throws a typed TRANSPORT error on web instead of constructing the native manager', async () => {
    mockPlatformOS = 'web';
    const service = new BleWifiProvisioningService();

    expect(() => service.startScan(() => undefined)).toThrow(
      'BLE provisioning is not available on web',
    );
    await expect(
      service.provision({
        deviceId: 'X',
        ssid: 'net',
        password: '',
        ...V2_PAYLOAD,
      }),
    ).rejects.toMatchObject({ reason: 'TRANSPORT' });
    expect(bleManagerCtor).not.toHaveBeenCalled();
  });
});
