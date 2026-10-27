/**
 * AuthenticationStep tests — step 2 (Xác thực) of the guided flow:
 * - title + username + password (masked by default, reveal toggle);
 * - the `Broker không yêu cầu xác thực` checkbox (clears the requirement);
 * - `Quay lại` + the compact `Quét QR từ server` affordance;
 * - the InfluxDB DRAFT section (url/org/bucket + masked token with
 *   reveal) forwarding partial patches only — never saves, never probes;
 * - `Kiểm tra kết nối`: loading (disabled, honest label, no double-press),
 *   gated on a valid host, failure keeps the entered data and shows the
 *   short inline error (the probe itself is the screen's injected service
 *   — this component only renders + forwards).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import type { InfluxSettings } from '@modules/settings/api';

import { AuthenticationStep } from './AuthenticationStep';

/** Renderers still mounted (unmounted in afterEach — act hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
});

interface MakeProps {
  readonly probing?: boolean;
  readonly probeErrorText?: string | null;
  readonly hostValid?: boolean;
  readonly influxState?: 'skipped' | 'checking' | 'ok' | 'failed';
  readonly influxResultText?: string | null;
  readonly influx?: InfluxSettings;
  readonly errors?: Record<string, string>;
}

function makeStep(props: MakeProps = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  const callbacks = {
    onPatchMqtt: jest.fn(),
    onPatchInflux: jest.fn(),
    onToggleNoAuth: jest.fn(),
    onBack: jest.fn(),
    onProbe: jest.fn(),
    onScanQr: jest.fn(),
  };
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <AuthenticationStep
          username="alice"
          password="secret"
          hostValid={props.hostValid ?? true}
          probing={props.probing ?? false}
          probeErrorText={props.probeErrorText ?? null}
          noAuth={false}
          influxState={props.influxState ?? 'skipped'}
          influxResultText={props.influxResultText ?? null}
          onToggleNoAuth={callbacks.onToggleNoAuth}
          onPatchMqtt={callbacks.onPatchMqtt}
          influx={
            props.influx ?? {
              url: 'http://influx.local:8086',
              org: 'iot',
              bucket: 'sensors',
              token: 'tok',
            }
          }
          onPatchInflux={callbacks.onPatchInflux}
          errors={props.errors}
          onBack={callbacks.onBack}
          onProbe={callbacks.onProbe}
          onScanQr={callbacks.onScanQr}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return { renderer, ...callbacks };
}

/** Press a pressable by testID (pressable-filtered per repo convention). */
function press(renderer: TestRenderer.ReactTestRenderer, testID: string): void {
  const node = renderer.root
    .findAllByProps({ testID })
    .find(candidate => typeof candidate.props.onPress === 'function');
  if (!node) {
    throw new Error(`no pressable node for ${testID}`);
  }
  act(() => {
    node.props.onPress();
  });
}

function findPressable(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance {
  const node = renderer.root
    .findAllByProps({ testID })
    .find(candidate => typeof candidate.props.onPress === 'function');
  if (!node) {
    throw new Error(`no pressable node for ${testID}`);
  }
  return node;
}

describe('AuthenticationStep', () => {
  it('renders the title, the username and the masked password inputs', () => {
    const { renderer } = makeStep();
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.authTitle);

    const username = renderer.root.findByProps({
      testID: 'advanced-username-input',
    });
    expect(username.props.value).toBe('alice');
    const password = renderer.root.findByProps({
      testID: 'advanced-password-input',
    });
    expect(password.props.value).toBe('secret');
    // Masked by default (secrets stay masked until revealed).
    expect(password.props.secureTextEntry).toBe(true);
  });

  it('the reveal toggle unmasks the password', () => {
    const { renderer } = makeStep();
    press(renderer, 'advanced-password-reveal');
    const password = renderer.root.findByProps({
      testID: 'advanced-password-input',
    });
    expect(password.props.secureTextEntry).toBe(false);
  });

  it('typing forwards the store patch (data is never saved here)', () => {
    const { renderer, onPatchMqtt } = makeStep();
    const username = renderer.root.findByProps({
      testID: 'advanced-username-input',
    });
    act(() => {
      username.props.onChangeText('bob');
    });
    expect(onPatchMqtt).toHaveBeenCalledWith({ username: 'bob' });
  });

  it('the no-auth checkbox toggles through onToggleNoAuth', () => {
    const { renderer, onToggleNoAuth } = makeStep();
    const checkbox = findPressable(renderer, 'advanced-no-auth-checkbox');
    expect(checkbox.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    press(renderer, 'advanced-no-auth-checkbox');
    expect(onToggleNoAuth).toHaveBeenCalledWith(true);
  });

  it('Quay lại and the compact QR affordance forward their taps', () => {
    const { renderer, onBack, onScanQr } = makeStep();
    press(renderer, 'setup-back');
    expect(onBack).toHaveBeenCalledTimes(1);
    press(renderer, 'setup-scan-qr');
    expect(onScanQr).toHaveBeenCalledTimes(1);
  });

  it('Kiểm tra kết nối forwards to the probe and shows the honest loading state', () => {
    const { renderer, onProbe } = makeStep();
    const probe = findPressable(renderer, 'advanced-probe-start');
    expect(probe.props.disabled).toBe(false);
    press(renderer, 'advanced-probe-start');
    expect(onProbe).toHaveBeenCalledTimes(1);
  });

  it('while probing the button is disabled with the loading label', () => {
    const { renderer } = makeStep({ probing: true });
    const probe = findPressable(renderer, 'advanced-probe-start');
    // Disabled (no double-press) + the honest loading label; the probe
    // double-fire guard itself lives in the screen's handleProbe.
    expect(probe.props.disabled).toBe(true);
    const label = probe
      .findAll(node => typeof node.props.children === 'string')
      .at(0);
    expect(label?.props.children).toBe(STRINGS.settings.checking);
  });

  it('Kiểm tra kết nối is disabled when the host is not valid', () => {
    const { renderer } = makeStep({ hostValid: false });
    expect(findPressable(renderer, 'advanced-probe-start').props.disabled).toBe(
      true,
    );
  });

  it('renders the short inline probe error without touching the entered data', () => {
    const { renderer } = makeStep({ probeErrorText: 'Sai tên đăng nhập' });
    expect(
      renderer.root.findByProps({ testID: 'advanced-probe-error' }).props
        .children,
    ).toBe('Sai tên đăng nhập');
    // Data preserved.
    expect(
      renderer.root.findByProps({ testID: 'advanced-username-input' }).props
        .value,
    ).toBe('alice');
    expect(
      renderer.root.findByProps({ testID: 'advanced-password-input' }).props
        .value,
    ).toBe('secret');
  });

  // Amendment 1 (A3) — the dual probe's InfluxDB half: honest inline
  // states, failure non-blocking, secrets never surfaced.
  it('renders the honest InfluxDB skip line when the draft influx is insufficient', () => {
    const { renderer } = makeStep({
      influxState: 'skipped',
      influxResultText: STRINGS.settings.influxProbeSkipped,
    });
    expect(
      renderer.root.findByProps({ testID: 'advanced-influx-probe-result' })
        .props.children,
    ).toBe(STRINGS.settings.influxProbeSkipped);
  });

  it('renders the InfluxDB checking state', () => {
    const { renderer } = makeStep({
      influxState: 'checking',
      influxResultText: STRINGS.settings.influxProbeChecking,
    });
    expect(
      renderer.root.findByProps({ testID: 'advanced-influx-probe-result' })
        .props.children,
    ).toBe(STRINGS.settings.influxProbeChecking);
  });

  it('renders the InfluxDB ok and failed states inline (non-blocking)', () => {
    const okRun = makeStep({
      influxState: 'ok',
      influxResultText: STRINGS.settings.influxProbeOk,
    });
    expect(
      okRun.renderer.root.findByProps({
        testID: 'advanced-influx-probe-result',
      }).props.children,
    ).toBe(STRINGS.settings.influxProbeOk);
    okRun.renderer.unmount();

    const failedRun = makeStep({
      influxState: 'failed',
      influxResultText: `${STRINGS.settings.influxProbeFailed} — ${STRINGS.settings.probeFailedAuth}`,
    });
    const text = failedRun.renderer.root.findByProps({
      testID: 'advanced-influx-probe-result',
    }).props.children as string;
    expect(text).toContain(STRINGS.settings.influxProbeFailed);
    // The failure reason is the friendly cause — never a token/body.
    expect(text).not.toContain('secret');
  });

  // The InfluxDB DRAFT section (user request): the same four fields the
  // post-save status detail owns, edited HERE against the draft.
  it('renders the InfluxDB section with the draft values and a masked token', () => {
    const { renderer } = makeStep({
      errors: { 'influx.url': 'URL không hợp lệ' },
    });
    const url = renderer.root.findByProps({
      testID: 'advanced-step-influx-url',
    });
    expect(url.props.value).toBe('http://influx.local:8086');
    const org = renderer.root.findByProps({
      testID: 'advanced-step-influx-org',
    });
    expect(org.props.value).toBe('iot');
    const bucket = renderer.root.findByProps({
      testID: 'advanced-step-influx-bucket',
    });
    expect(bucket.props.value).toBe('sensors');
    const token = renderer.root.findByProps({
      testID: 'advanced-step-influx-token',
    });
    expect(token.props.value).toBe('tok');
    // Masked by default, like every secret on this flow.
    expect(token.props.secureTextEntry).toBe(true);
  });

  it('the Influx token reveal unmasks the token', () => {
    const { renderer } = makeStep();
    press(renderer, 'advanced-step-influx-token-reveal');
    const token = renderer.root.findByProps({
      testID: 'advanced-step-influx-token',
    });
    expect(token.props.secureTextEntry).toBe(false);
  });

  it('Influx edits forward partial patches (never saved here)', () => {
    const { renderer, onPatchInflux } = makeStep();
    const url = renderer.root.findByProps({
      testID: 'advanced-step-influx-url',
    });
    act(() => {
      url.props.onChangeText('http://192.168.9.9:8086');
    });
    expect(onPatchInflux).toHaveBeenLastCalledWith({
      url: 'http://192.168.9.9:8086',
    });
    const org = renderer.root.findByProps({
      testID: 'advanced-step-influx-org',
    });
    act(() => {
      org.props.onChangeText('neworg');
    });
    expect(onPatchInflux).toHaveBeenLastCalledWith({ org: 'neworg' });
    const bucket = renderer.root.findByProps({
      testID: 'advanced-step-influx-bucket',
    });
    act(() => {
      bucket.props.onChangeText('newbucket');
    });
    expect(onPatchInflux).toHaveBeenLastCalledWith({ bucket: 'newbucket' });
    const token = renderer.root.findByProps({
      testID: 'advanced-step-influx-token',
    });
    act(() => {
      token.props.onChangeText('new-token');
    });
    expect(onPatchInflux).toHaveBeenLastCalledWith({ token: 'new-token' });
  });
});
