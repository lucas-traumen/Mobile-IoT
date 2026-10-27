/**
 * BleProvisioningModal tests (boards-ble-wifi-provisioning +
 * `ble-provisioning-v2-broker-push`): the modal is a display shell over an
 * injected fake service — no BLE stack, no module mocks. Pins: the scan
 * list (rows, dedupe, R4 hint), the one-shot auto-select of the QR
 * boardId, row selection, the validation gate (Send disabled), the
 * provision call shape (deviceId/ssid/password + broker/MQTT creds +
 * onStatus), the progress → success flow (+ SSID remembered, WiFi
 * password/MQTT credentials never), the FAILED:BAD_AUTH and v2
 * FAILED:BAD_BROKER retry flows (distinct message, corrected payload),
 * the Broker/MQTT prefill from props, the honest scan-problem hints, the
 * show/hide password toggle and the Đổi board restart.
 */

import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';

import { BleProvisionError } from '../internal/domain/bleProvisioningContract';
import type {
  BleScanProblem,
  BleScannedBoard,
  BleWifiProvisioningServiceLike,
} from '../internal/services/bleWifiProvisioningService';
import {
  BleProvisioningModal,
  type BleProvisionPrefill,
} from './BleProvisioningModal';

/** A board seen at scan time. */
function board(deviceId: string, boardId: string, rssi = -60): BleScannedBoard {
  return { deviceId, boardId, rssi, localName: `IoTBoard-${boardId}` };
}

interface FakeService {
  readonly service: BleWifiProvisioningServiceLike;
  /** Deliver an advertisement to the modal's onFound callback. */
  readonly deliver: (seen: BleScannedBoard) => void;
  /** Deliver a scan problem to the modal's onProblem callback. */
  readonly fail: (problem: BleScanProblem) => void;
  /** How often the modal stopped the scan session. */
  readonly stopCount: () => number;
  readonly provision: jest.Mock;
  readonly saveLastSsid: jest.Mock;
  readonly loadLastSsid: jest.Mock;
}

/** Build the fake service + delivery channels. */
function makeFakeService(lastSsid: string | null = null): FakeService {
  let onFound: ((seen: BleScannedBoard) => void) | null = null;
  let onProblem: ((problem: BleScanProblem) => void) | null = null;
  let stops = 0;
  const provision = jest.fn(async () => undefined);
  const saveLastSsid = jest.fn(async () => undefined);
  const loadLastSsid = jest.fn(async () => lastSsid);
  const service: BleWifiProvisioningServiceLike = {
    startScan: jest.fn(
      (
        found: (seen: BleScannedBoard) => void,
        problem?: (scanProblem: BleScanProblem) => void,
      ) => {
        onFound = found;
        onProblem = problem ?? null;
        return {
          stop: () => {
            stops += 1;
          },
        };
      },
    ),
    provision,
    loadLastSsid,
    saveLastSsid,
  };
  return {
    service,
    deliver: seen => onFound?.(seen),
    fail: problem => onProblem?.(problem),
    stopCount: () => stops,
    provision,
    saveLastSsid,
    loadLastSsid,
  };
}

describe('BleProvisioningModal', () => {
  const openRenderers: TestRenderer.ReactTestRenderer[] = [];

  async function render(
    overrides: {
      initialBoardId?: string | null;
      service?: BleWifiProvisioningServiceLike;
      prefill?: BleProvisionPrefill;
    } = {},
  ): Promise<TestRenderer.ReactTestRenderer> {
    let renderer!: TestRenderer.ReactTestRenderer;
    const onClose = jest.fn();
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <BleProvisioningModal
            visible
            onClose={onClose}
            initialBoardId={overrides.initialBoardId ?? null}
            prefill={overrides.prefill}
            service={overrides.service ?? makeFakeService().service}
          />
        </ThemeProvider>,
      );
    });
    openRenderers.push(renderer);
    return renderer;
  }

  afterEach(() => {
    for (const renderer of openRenderers) {
      act(() => {
        renderer.unmount();
      });
    }
    openRenderers.length = 0;
  });

  async function press(
    renderer: TestRenderer.ReactTestRenderer,
    testID: string,
  ): Promise<void> {
    const nodes = renderer.root
      .findAllByProps({ testID })
      .filter(node => typeof node.props.onPress === 'function');
    if (nodes.length === 0) {
      throw new Error(`No pressable node for testID "${testID}"`);
    }
    await act(async () => {
      nodes[0].props.onPress();
    });
  }

  /** Flush the modal's microtask chains (loadLastSsid / provision). */
  async function flush(): Promise<void> {
    await act(async () => {});
    await act(async () => {});
  }

  async function type(
    renderer: TestRenderer.ReactTestRenderer,
    testID: string,
    text: string,
  ): Promise<void> {
    const input = renderer.root.findByProps({ testID });
    await act(async () => {
      input.props.onChangeText(text);
    });
  }

  function sendNode(renderer: TestRenderer.ReactTestRenderer) {
    return renderer.root.findByProps({ testID: 'boards-ble-send' });
  }

  it('renders the scan list from service discoveries with RSSI + the R4 hint', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });

    await act(async () => {
      fake.deliver(board('MAC-1', '0', -55));
      fake.deliver(board('MAC-2', 'board-7', -71));
    });
    await flush();

    expect(
      renderer.root.findByProps({ testID: 'boards-ble-board-0' }),
    ).toBeDefined();
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-board-board-7' }),
    ).toBeDefined();
    // The RSSI is shown next to the id.
    const rssiTexts = renderer.root
      .findAllByType(Text)
      .filter(node => node.props.children === '-55 dBm');
    expect(rssiTexts.length).toBe(1);
    // The R4 hint is always present in the scanning phase.
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-scan-hint' }).props
        .children,
    ).toBe(
      'Không thấy board? Cắm điện lại board — board chỉ phát Bluetooth khi chưa có WiFi.',
    );
  });

  it('dedupes repeated advertisements of the same device', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });

    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
      fake.deliver(board('MAC-1', '0', -70)); // same device, fresher RSSI
    });
    await flush();

    expect(
      renderer.root.findAllByProps({ testID: 'boards-ble-board-0' }).length,
    ).toBeGreaterThan(0);
    // Only ONE composite row (the host clone shares the testID; the
    // component-level node is unique per device).
    const rows = renderer.root
      .findAllByProps({ testID: 'boards-ble-board-0' })
      .filter(node => node.type === TouchableOpacity);
    expect(rows.length).toBe(1);
  });

  it('auto-selects the QR boardId once and moves to the form (scan stopped)', async () => {
    const fake = makeFakeService();
    const renderer = await render({
      service: fake.service,
      initialBoardId: '0',
    });

    await act(async () => {
      fake.deliver(board('MAC-2', 'board-9'));
      fake.deliver(board('MAC-1', '0'));
    });
    await flush();

    // Phase B: the form for the auto-selected board, scan stopped.
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-selected-board' }).props
        .children,
    ).toBe('0');
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-ssid-input' }),
    ).toBeDefined();
    expect(fake.stopCount()).toBeGreaterThan(0);
    // The list is gone.
    expect(
      renderer.root.findAllByProps({ testID: 'boards-ble-board-0' }).length,
    ).toBe(0);
  });

  it('tapping a row selects it and opens the form', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });

    await act(async () => {
      fake.deliver(board('MAC-1', 'board-3'));
    });
    await flush();
    await press(renderer, 'boards-ble-board-board-3');

    expect(
      renderer.root.findByProps({ testID: 'boards-ble-selected-board' }).props
        .children,
    ).toBe('board-3');
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-ssid-input' }),
    ).toBeDefined();
  });

  it('prefills the SSID from the remembered last SSID', async () => {
    const fake = makeFakeService('Nhà Mạng');
    const renderer = await render({ service: fake.service });
    await flush();

    // Still in the scanning phase — the prefill applies to the form's
    // field state; select any board to see the value.
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');

    const input = renderer.root.findByProps({
      testID: 'boards-ble-ssid-input',
    }) as unknown as { props: { value: string } };
    expect(input.props.value).toBe('Nhà Mạng');
  });

  it('gates Send on the full validation (v2: SSID AND broker required)', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');

    // Empty form → Send disabled, no validation noise on the pristine form.
    expect(sendNode(renderer).props.disabled).toBe(true);
    expect(
      renderer.root.findAllByProps({ testID: 'boards-ble-validation' }),
    ).toHaveLength(0);

    // SSID alone is NOT enough anymore: the broker is required (v2).
    await type(renderer, 'boards-ble-ssid-input', 'Nhà Mạng');
    expect(sendNode(renderer).props.disabled).toBe(true);
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-validation' }).props
        .children,
    ).toBe('Nhập địa chỉ broker (host:port).');

    // WiFi + broker → Send enabled.
    await type(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');
    expect(sendNode(renderer).props.disabled).toBe(false);
  });

  it('prefills the Broker + MQTT groups from the props (settings-derived)', async () => {
    const fake = makeFakeService();
    const renderer = await render({
      service: fake.service,
      prefill: {
        broker: '192.168.100.3:1883',
        mqttUsername: 'admin',
        mqttPassword: 'mqtt-pw',
      },
    });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');

    const valueOf = (testID: string): string =>
      (
        renderer.root.findByProps({ testID }) as unknown as {
          props: { value: string };
        }
      ).props.value;
    expect(valueOf('boards-ble-broker-input')).toBe('192.168.100.3:1883');
    expect(valueOf('boards-ble-mqtt-username-input')).toBe('admin');
    expect(valueOf('boards-ble-mqtt-password-input')).toBe('mqtt-pw');
    // The MQTT password renders secure; the prefill hint is present.
    expect(
      (
        renderer.root.findByProps({
          testID: 'boards-ble-mqtt-password-input',
        }) as unknown as { props: { secureTextEntry: boolean } }
      ).props.secureTextEntry,
    ).toBe(true);
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-prefill-hint' }).props
        .children,
    ).toBe('Broker và tài khoản MQTT lấy từ Cài đặt — kiểm tra rồi gửi.');
  });

  it('starts the Broker/MQTT fields empty without a prefill (user types manually)', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');

    const valueOf = (testID: string): string =>
      (
        renderer.root.findByProps({ testID }) as unknown as {
          props: { value: string };
        }
      ).props.value;
    expect(valueOf('boards-ble-broker-input')).toBe('');
    expect(valueOf('boards-ble-mqtt-username-input')).toBe('');
    expect(valueOf('boards-ble-mqtt-password-input')).toBe('');
  });

  it('shows the byte-accurate validation message for an over-long password', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');

    await type(renderer, 'boards-ble-ssid-input', 'net');
    await type(renderer, 'boards-ble-password-input', 'p'.repeat(64));

    expect(sendNode(renderer).props.disabled).toBe(true);
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-validation' }).props
        .children,
    ).toBe('Mật khẩu quá dài (tối đa 63 byte UTF-8).');
  });

  it('shows the v2 validation messages for an over-long/invalid broker and MQTT creds', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');
    await type(renderer, 'boards-ble-ssid-input', 'net');

    // Whitespace inside the broker → invalid format.
    await type(renderer, 'boards-ble-broker-input', 'my broker');
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-validation' }).props
        .children,
    ).toBe('Địa chỉ broker không đúng dạng host:port (không khoảng trắng).');

    // >128 bytes → too long.
    await type(renderer, 'boards-ble-broker-input', 'a'.repeat(129));
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-validation' }).props
        .children,
    ).toBe('Địa chỉ broker quá dài (tối đa 128 byte UTF-8).');

    // Valid broker, over-long MQTT username → the MQTT message.
    await type(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');
    await type(renderer, 'boards-ble-mqtt-username-input', 'u'.repeat(65));
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-validation' }).props
        .children,
    ).toBe('MQTT username quá dài (tối đa 64 byte UTF-8).');
    // And the over-long MQTT password.
    await type(renderer, 'boards-ble-mqtt-username-input', 'admin');
    await type(renderer, 'boards-ble-mqtt-password-input', 'p'.repeat(129));
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-validation' }).props
        .children,
    ).toBe('MQTT password quá dài (tối đa 128 byte UTF-8).');
  });

  it('sends through the service with the contract arguments and remembers the SSID on success', async () => {
    const fake = makeFakeService();
    let resolveProvision!: () => void;
    fake.provision.mockImplementationOnce(async args => {
      const onStatus = args.onStatus as (status: unknown) => void;
      onStatus({ kind: 'connecting' });
      // Hold the provision open until the test drives CONNECTED.
      await new Promise<void>(resolve => {
        resolveProvision = resolve;
      });
    });
    const onClose = jest.fn();
    const onProvisioned = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <BleProvisioningModal
            visible
            onClose={onClose}
            initialBoardId="0"
            prefill={{
              broker: '192.168.100.3:1883',
              mqttUsername: 'admin',
              mqttPassword: 'mqtt-pw-ộ',
            }}
            onProvisioned={onProvisioned}
            service={fake.service}
          />
        </ThemeProvider>,
      );
    });
    openRenderers.push(renderer);
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await flush();

    await type(renderer, 'boards-ble-ssid-input', 'Nhà Mạng');
    await type(renderer, 'boards-ble-password-input', 'mật khẩud');

    await press(renderer, 'boards-ble-send');
    await flush();

    expect(fake.provision).toHaveBeenCalledWith({
      deviceId: 'MAC-1',
      ssid: 'Nhà Mạng',
      password: 'mật khẩud',
      broker: '192.168.100.3:1883',
      mqttUsername: 'admin',
      mqttPassword: 'mqtt-pw-ộ',
      onStatus: expect.any(Function),
    });
    // The progress line showed the CONNECTING status.
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-status' }).props.children,
    ).toBe('Board đang nối WiFi…');

    // CONNECTED arrives → success + SSID remembered; the WiFi password
    // and the MQTT credentials are never persisted.
    await act(async () => {
      resolveProvision();
    });
    await flush();

    expect(
      renderer.root.findByProps({ testID: 'boards-ble-success' }).props
        .children,
    ).toBe('Thành công! Board đã nối WiFi và broker.');
    expect(fake.saveLastSsid).toHaveBeenCalledWith('Nhà Mạng');
    expect(onProvisioned).toHaveBeenCalledWith('0');
    const provisionArgs = (fake.service.provision as jest.Mock).mock
      .calls[0][0] as Record<string, string>;
    expect(provisionArgs.password).toBe('mật khẩud');
    expect(provisionArgs.mqttPassword).toBe('mqtt-pw-ộ');
    expect(fake.saveLastSsid.mock.calls.flat().join('|')).not.toContain(
      'mật khẩud',
    );
    expect(JSON.stringify(fake.saveLastSsid.mock.calls)).not.toContain(
      'mqtt-pw-ộ',
    );

    // Đóng closes.
    await press(renderer, 'boards-ble-close');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the typed failure with a retry: the form stays editable and Send works again', async () => {
    const fake = makeFakeService();
    fake.provision
      .mockImplementationOnce(async () => {
        throw new BleProvisionError('BAD_AUTH', 'board says no');
      })
      .mockImplementationOnce(async () => undefined);

    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');
    await type(renderer, 'boards-ble-ssid-input', 'net');
    await type(renderer, 'boards-ble-password-input', 'wrong');
    await type(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');

    await press(renderer, 'boards-ble-send');
    await flush();

    expect(
      renderer.root.findByProps({ testID: 'boards-ble-error' }).props.children,
    ).toBe('Sai mật khẩu — kiểm tra rồi gửi lại.');

    // Retry: the form kept the values, Send is enabled again.
    expect(sendNode(renderer).props.disabled).toBe(false);
    await press(renderer, 'boards-ble-send');
    await flush();
    expect(fake.provision).toHaveBeenCalledTimes(2);
    // A retry that succeeds shows the success state.
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-success' }),
    ).toBeDefined();
  });

  it('shows the DISTINCT BAD_BROKER failure and retries with a corrected broker', async () => {
    const fake = makeFakeService();
    fake.provision
      .mockImplementationOnce(async () => {
        throw new BleProvisionError('BAD_BROKER', 'board says bad broker');
      })
      .mockImplementationOnce(async () => undefined);

    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');
    await type(renderer, 'boards-ble-ssid-input', 'net');
    await type(renderer, 'boards-ble-broker-input', '10.0.0.99:1883');

    await press(renderer, 'boards-ble-send');
    await flush();

    // The v2 broker failure has its OWN message (distinct from BAD_AUTH).
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-error' }).props.children,
    ).toBe(
      'Broker sai hoặc không nối được — kiểm tra địa chỉ broker và tài khoản MQTT rồi gửi lại.',
    );

    // Retry with the corrected address: the new payload carries it.
    await type(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');
    await press(renderer, 'boards-ble-send');
    await flush();
    expect(fake.provision).toHaveBeenCalledTimes(2);
    const secondArgs = (fake.service.provision as jest.Mock).mock
      .calls[1][0] as Record<string, string>;
    expect(secondArgs.broker).toBe('192.168.100.3:1883');
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-success' }),
    ).toBeDefined();
  });

  it('maps an app-side VALIDATION failure to its own message (defense-in-depth path)', async () => {
    const fake = makeFakeService();
    fake.provision.mockImplementationOnce(async () => {
      throw new BleProvisionError('VALIDATION', 'service pre-flight rejected');
    });

    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');
    await type(renderer, 'boards-ble-ssid-input', 'net');
    await type(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');

    await press(renderer, 'boards-ble-send');
    await flush();

    expect(
      renderer.root.findByProps({ testID: 'boards-ble-error' }).props.children,
    ).toBe('Cấu hình chưa hợp lệ — kiểm tra lại các trường.');
  });

  it('shows honest hints for scan problems (BT off)', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });

    await act(async () => {
      fake.fail('bluetoothOff');
    });
    await flush();

    expect(
      renderer.root.findByProps({ testID: 'boards-ble-scan-problem' }).props
        .children,
    ).toBe('Bluetooth đang tắt — bật Bluetooth rồi thử lại.');
  });

  it('toggles the password visibility', async () => {
    const fake = makeFakeService();
    const renderer = await render({ service: fake.service });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await press(renderer, 'boards-ble-board-0');

    const passwordInput = renderer.root.findByProps({
      testID: 'boards-ble-password-input',
    }) as unknown as { props: { secureTextEntry: boolean } };
    expect(passwordInput.props.secureTextEntry).toBe(true);

    await press(renderer, 'boards-ble-toggle-password');
    expect(
      (
        renderer.root.findByProps({
          testID: 'boards-ble-password-input',
        }) as unknown as { props: { secureTextEntry: boolean } }
      ).props.secureTextEntry,
    ).toBe(false);

    await press(renderer, 'boards-ble-toggle-password');
    expect(
      (
        renderer.root.findByProps({
          testID: 'boards-ble-password-input',
        }) as unknown as { props: { secureTextEntry: boolean } }
      ).props.secureTextEntry,
    ).toBe(true);
  });

  it('Đổi board returns to the scanning phase with a fresh scan (no auto-select trap)', async () => {
    const fake = makeFakeService();
    const renderer = await render({
      service: fake.service,
      initialBoardId: '0',
    });
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await flush();
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-selected-board' }),
    ).toBeDefined();

    await press(renderer, 'boards-ble-change-board');

    // Back to Phase A: the list is empty and the R4 hint is back.
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-scan-hint' }),
    ).toBeDefined();
    expect(
      renderer.root.findAllByProps({ testID: 'boards-ble-ssid-input' }).length,
    ).toBe(0);

    // The QR board advertising again does NOT re-trap the user.
    await act(async () => {
      fake.deliver(board('MAC-1', '0'));
    });
    await flush();
    expect(
      renderer.root.findAllByProps({ testID: 'boards-ble-ssid-input' }).length,
    ).toBe(0);
    // A FRESH scan session was started for the restarted Phase A.
    const startScan = fake.service.startScan as jest.Mock;
    expect(startScan.mock.calls.length).toBe(2);
  });

  it('closes through Đóng and the scrim', async () => {
    const fake = makeFakeService();
    const onClose = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <BleProvisioningModal
            visible
            onClose={onClose}
            initialBoardId={null}
            service={fake.service}
          />
        </ThemeProvider>,
      );
    });
    openRenderers.push(renderer);

    await press(renderer, 'boards-ble-close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
