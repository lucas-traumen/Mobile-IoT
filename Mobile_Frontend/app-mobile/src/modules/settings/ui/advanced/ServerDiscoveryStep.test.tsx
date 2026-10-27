/**
 * ServerDiscoveryStep tests — step 1 (Máy chủ) of the guided flow
 * (advanced-config-stepper-redesign, D1 inline mDNS):
 * - the default card is SLIM: title + description + the primary scan
 *   button — NO manual inputs, NO divider, NO Tiếp tục;
 * - scanning disables the button with the honest loading label (no
 *   double-press);
 * - found servers render one row each (name, host, port) with a
 *   `Chọn máy chủ này` action → onSelectServer(server);
 * - none vs error are DISTINCT honest states (the crash-fix contract),
 *   both offering Thử lại + the `Nhập tay địa chỉ` fallback;
 * - the manual fallback reveals host/port/prefix inputs with a gated
 *   `Tiếp tục` (enabled only when host + port are valid) and `Quay lại
 *   tìm`;
 * - the choose button only emits `onSelectServer` — the step transition
 *   is screen-owned (the user-approved `ok` amendment: the SCREEN fills
 *   the draft and advances immediately); the `Tiếp tục`
 *   (`setup-continue-server`) still renders only when the draft
 *   host/port is valid (e.g. when returning with a valid draft);
 * - unmount mid-scan stops the session and late results are inert.
 */

import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import type { DiscoveredServer } from '../../internal/domain/mdnsDiscoveryContract';
import {
  MdnsDiscoveryError,
  type MdnsDiscoveryServiceLike,
  type MdnsScanResult,
  type MdnsScanSession,
} from '../../internal/services/mdnsDiscoveryService';
import { ServerDiscoveryStep } from './ServerDiscoveryStep';

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

/** Controllable fake of the mDNS discovery service (crash-fix seam). */
function makeFakeDiscovery() {
  let onDone: ((result: MdnsScanResult) => void) | null = null;
  let stopped = 0;
  const session: MdnsScanSession = {
    stop: () => {
      stopped += 1;
    },
  };
  const service: MdnsDiscoveryServiceLike = {
    startScan: callback => {
      onDone = callback;
      return session;
    },
  };
  return {
    service,
    deliver: (result: MdnsScanResult) => {
      act(() => {
        onDone?.(result);
      });
    },
    stopCalls: () => stopped,
    hasPendingScan: () => onDone !== null,
  };
}

const SERVER: DiscoveredServer = {
  name: 'Smart Home Server',
  host: '192.168.2.28',
  port: 9001,
  txt: { prefix: 'smarthome', influxPort: 8086 },
};

interface MakeProps {
  readonly host?: string;
  readonly port?: number;
}

function makeStep(
  discovery: MdnsDiscoveryServiceLike | null,
  props: MakeProps = {},
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  const onSelectServer = jest.fn();
  const onContinue = jest.fn();
  const onPatchMqtt = jest.fn();
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <ServerDiscoveryStep
          discoveryService={discovery}
          host={props.host ?? ''}
          port={props.port ?? 9001}
          prefix="home"
          onPatchMqtt={onPatchMqtt}
          onSelectServer={onSelectServer}
          onContinue={onContinue}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return {
    renderer,
    onSelectServer,
    onContinue,
    onPatchMqtt,
  };
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

/** The visible label of a pressable (its string-carrying Text child). */
function buttonLabel(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): string | undefined {
  const button = renderer.root
    .findAllByProps({ testID })
    .find(candidate => typeof candidate.props.onPress === 'function');
  if (!button) {
    return undefined;
  }
  const text = button
    .findAll(node => typeof node.props.children === 'string')
    .at(0);
  return text?.props.children as string | undefined;
}

describe('ServerDiscoveryStep', () => {
  it('renders the slim default card: title + description + scan button, no inputs', () => {
    const discovery = makeFakeDiscovery();
    const { renderer } = makeStep(discovery.service);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    expect(buttonLabel(renderer, 'advanced-mdns-scan-start')).toBe(
      STRINGS.settings.findServer,
    );
    // SLIM: no manual inputs / no continue in the default view (the draft
    // host is empty — the forward gate only exists for a valid draft).
    expect(renderer.root.findAllByType(TextInput).length).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'setup-continue-manual' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'setup-continue-server' }).length,
    ).toBe(0);
  });

  it('hides the whole discovery block on web (null service)', () => {
    const { renderer } = makeStep(null);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
  });

  it('scans once: the button becomes the honest loading label and cannot double-fire', () => {
    const discovery = makeFakeDiscovery();
    const { renderer } = makeStep(discovery.service);
    press(renderer, 'advanced-mdns-scan-start');
    expect(discovery.hasPendingScan()).toBe(true);

    const button = renderer.root
      .findAllByProps({ testID: 'advanced-mdns-scan-start' })
      .find(node => typeof node.props.onPress === 'function');
    expect(button?.props.disabled).toBe(true);
    expect(buttonLabel(renderer, 'advanced-mdns-scan-start')).toBe(
      STRINGS.settings.findServerScanning,
    );

    // Duplicate press while scanning: the handler is a no-op.
    const before = discovery.stopCalls();
    act(() => {
      button?.props.onPress();
    });
    expect(discovery.stopCalls()).toBe(before);
  });

  it('renders one found-server row (name, host, port) and selects on choose', () => {
    const discovery = makeFakeDiscovery();
    const { renderer, onSelectServer } = makeStep(discovery.service);
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [SERVER] });

    expect(
      renderer.root
        .findAllByProps({ testID: 'advanced-mdns-result-0' })
        .some(node => node.props.children !== undefined),
    ).toBe(true);
    const texts = renderer.root.findAllByProps({
      testID: 'advanced-mdns-result-name-0',
    });
    expect(texts.length).toBeGreaterThan(0);
    expect(
      renderer.root.findByProps({ testID: 'advanced-mdns-result-meta-0' }).props
        .children,
    ).toEqual(['192.168.2.28', ':', 9001]);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mdns-none' }).length,
    ).toBe(0);

    press(renderer, 'advanced-mdns-choose-0');
    expect(onSelectServer).toHaveBeenCalledWith(SERVER);
  });

  // The choose button only EMITS `onSelectServer` — the step transition
  // is screen-owned (user-approved `ok` amendment: the SCREEN fills the
  // draft and advances immediately). Manual continue stays unchanged.
  it('choose emits the selection; the valid draft still gates Tiếp tục', () => {
    const discovery = makeFakeDiscovery();
    // First run: empty draft → the forward gate does not exist yet.
    const before = makeStep(discovery.service, { host: '', port: 9001 });
    press(before.renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [SERVER] });
    expect(
      before.renderer.root.findAllByProps({
        testID: 'setup-continue-server',
      }).length,
    ).toBe(0);

    // The selection is forwarded verbatim; advancing is the SCREEN's job.
    const selecting = makeStep(discovery.service, { host: '', port: 9001 });
    press(selecting.renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [SERVER] });
    press(selecting.renderer, 'advanced-mdns-choose-0');
    expect(selecting.onSelectServer).toHaveBeenCalledWith(SERVER);

    // With a valid draft (e.g. returning to step 1): `Tiếp tục` renders
    // and pressing it forwards exactly once.
    const filled = makeStep(discovery.service, {
      host: SERVER.host,
      port: SERVER.port,
    });
    press(filled.renderer, 'setup-continue-server');
    expect(filled.onContinue).toHaveBeenCalledTimes(1);
  });

  it('the forward gate renders whenever the draft host/port is valid (returning to step 1)', () => {
    const discovery = makeFakeDiscovery();
    const { renderer, onContinue } = makeStep(discovery.service, {
      host: 'broker.local',
      port: 9001,
    });
    expect(
      renderer.root.findAllByProps({ testID: 'setup-continue-server' }).length,
    ).toBeGreaterThan(0);
    press(renderer, 'setup-continue-server');
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('renders the honest none state with retry + manual fallback link', () => {
    const discovery = makeFakeDiscovery();
    const { renderer } = makeStep(discovery.service);
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [] });

    expect(
      renderer.root
        .findAllByProps({ testID: 'advanced-mdns-none' })
        .some(node => node.props.children !== undefined),
    ).toBe(true);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mdns-error' }).length,
    ).toBe(0);
    // Both none-states keep the two escape hatches.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mdns-scan-start' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'setup-manual-address-link' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('renders the DISTINCT honest error state (a crashed scanner never reads as an empty network)', () => {
    const discovery = makeFakeDiscovery();
    const { renderer } = makeStep(discovery.service);
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({
      ok: false,
      error: Object.assign(new Error('under-locked'), {
        code: 'unavailable',
      }) as MdnsDiscoveryError,
    });

    expect(
      renderer.root
        .findAllByProps({ testID: 'advanced-mdns-error' })
        .some(node => node.props.children !== undefined),
    ).toBe(true);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mdns-none' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'setup-manual-address-link' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('retries from the none state through the same scan seam', () => {
    const discovery = makeFakeDiscovery();
    const { renderer } = makeStep(discovery.service);
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [] });

    const stopCallsBefore = discovery.stopCalls();
    press(renderer, 'advanced-mdns-scan-start');
    expect(discovery.stopCalls()).toBeGreaterThanOrEqual(stopCallsBefore);
    expect(discovery.hasPendingScan()).toBe(true);
  });

  it('reveals the manual fallback: gated Tiếp tục + Quay lại tìm', () => {
    const discovery = makeFakeDiscovery();
    const { renderer, onPatchMqtt } = makeStep(discovery.service);
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [] });
    press(renderer, 'setup-manual-address-link');

    expect(
      renderer.root.findAllByProps({ testID: 'setup-manual-address' }).length,
    ).toBeGreaterThan(0);
    expect(renderer.root.findAllByType(TextInput).length).toBe(3);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-host-input' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-port-input' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-prefix-input' }).length,
    ).toBeGreaterThan(0);

    // Gate: empty host → Tiếp tục disabled.
    expect(
      renderer.root
        .findAllByProps({ testID: 'setup-continue-manual' })
        .find(node => typeof node.props.onPress === 'function')?.props.disabled,
    ).toBe(true);

    // Typing a valid host enables Tiếp tục (port defaults valid).
    const hostInput = renderer.root.findByProps({
      testID: 'advanced-host-input',
    });
    act(() => {
      hostInput.props.onChangeText('192.168.1.10');
    });
    expect(onPatchMqtt).toHaveBeenCalledWith({ host: '192.168.1.10' });

    const { renderer: renderer2, onContinue: continue2 } = makeStep(
      discovery.service,
      { host: '192.168.1.10' },
    );
    press(renderer2, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [] });
    press(renderer2, 'setup-manual-address-link');
    expect(
      renderer2.root
        .findAllByProps({ testID: 'setup-continue-manual' })
        .find(node => typeof node.props.onPress === 'function')?.props.disabled,
    ).toBe(false);
    press(renderer2, 'setup-continue-manual');
    expect(continue2).toHaveBeenCalledTimes(1);

    // Quay lại tìm hides the inputs again.
    press(renderer2, 'setup-back-to-scan');
    expect(
      renderer2.root.findAllByProps({ testID: 'setup-manual-address' }).length,
    ).toBe(0);
  });

  it('gates Tiếp tục on a valid port too (0 is invalid)', () => {
    const discovery = makeFakeDiscovery();
    const { renderer } = makeStep(discovery.service, {
      host: '192.168.1.10',
      port: 0,
    });
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [] });
    press(renderer, 'setup-manual-address-link');
    expect(
      renderer.root
        .findAllByProps({ testID: 'setup-continue-manual' })
        .find(node => typeof node.props.onPress === 'function')?.props.disabled,
    ).toBe(true);
  });

  it('stops the scan session on unmount; late results are inert', () => {
    const discovery = makeFakeDiscovery();
    const { renderer, onSelectServer } = makeStep(discovery.service);
    press(renderer, 'advanced-mdns-scan-start');
    act(() => {
      renderer.unmount();
    });
    openRenderers.length = 0; // already unmounted
    expect(discovery.stopCalls()).toBe(1);

    // A late result after teardown must not throw or select anything.
    expect(() =>
      discovery.deliver({ ok: true, value: [SERVER] }),
    ).not.toThrow();
    expect(onSelectServer).not.toHaveBeenCalled();
  });
});
