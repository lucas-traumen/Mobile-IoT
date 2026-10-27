/**
 * AdvancedSettingsScreen tests — composition level
 * (advanced-settings-sequential-recovery). Per-step presentation is
 * covered by the colocated `ui/advanced/*.test.tsx` suites; these tests
 * pin the SCREEN contract:
 * - MODE model: one flow with a setup mode (the official THREE-level
 *   stepper) and a post-save status mode (informally "step 4" — never a
 *   fourth stepper level, never a selectable tab). A persisted
 *   configuration opens status mode; first run opens setup Step 1;
 * - sequential gates: a mDNS selection fills the draft and the screen
 *   ADVANCES to Step 2 immediately (user-approved `ok` amendment); the
 *   explicit `Kiểm tra kết nối` probe gates Step 3 (QR fills never
 *   auto-probe or advance);
 * - save: success ENTERS status mode; failure STAYS on Step 3 with the
 *   draft, a primary `Thử lại`, and explicit contextual edit actions —
 *   never an automatic backward navigation;
 * - recovery: a runtime MQTT failure/reconnecting NEVER resets the
 *   step/mode/draft and never uses a timer yank — the setup-mode notice
 *   reports at the current step with `Thử lại`/`Cấu hình lại`; the
 *   status-mode card shows the failed state; `Cấu hình lại` is the only
 *   explicit path to setup Step 1;
 * - draft-bound probes (AD-5): a late result from an edited draft or a
 *   changed step can never unlock Step 3;
 * - the MQTT card drives the REAL retry path; web hides the flow (user
 *   decision 2a) while keeping the status cards.
 */

import React from 'react';
import { Share, StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';
import type { AppSettings } from '@modules/settings/api';

import type { DiscoveredServer } from '../internal/domain/mdnsDiscoveryContract';
import {
  type MdnsDiscoveryServiceLike,
  type MdnsScanResult,
  type MdnsScanSession,
} from '../internal/services/mdnsDiscoveryService';
import {
  MqttProbeError,
  type MqttProbeConfig,
  type MqttProbeErrorCode,
  type MqttProbeResult,
  type MqttProbeServiceLike,
} from '../internal/services/mqttProbeService';
import { AdvancedSettingsScreen } from './AdvancedSettingsScreen';
import { getWizardSessionStore } from '../internal/ui/wizardSessionStore';
import type {
  InfluxProbeConfig,
  InfluxProbeResult,
  InfluxProbeServiceLike,
} from '../internal/services/influxProbeService';
import { InfluxProbeError } from '../internal/services/influxProbeService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

// Hygiene: the zeroconf lib must never load under Jest — the screen talks
// to the MdnsDiscoveryServiceLike seam; tests always inject fakes.
jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/**
 * expo-camera mock (settings-secrets-qr): the CameraView stub renders a
 * placeholder node that CARRIES the `onBarcodeScanned` prop — tests drive
 * the credentials-QR scan through the generic QrScannerModal's
 * `onScanned` seam. Permission resolves granted by default.
 */
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    CameraView: (props: {
      onBarcodeScanned?: (event: {
        readonly data: string;
        readonly type: string;
      }) => void;
    }) =>
      React.createElement('View', {
        testID: 'qr-scanner-camera',
        onBarcodeScanned: props.onBarcodeScanned,
      }),
    Camera: {
      requestCameraPermissionsAsync: jest.fn(async () => ({
        granted: true,
        status: 'granted',
        canAskAgain: true,
        expires: 'never',
      })),
    },
  };
});

/** Mutable Platform.OS seam (web-hide test) — jest-expo is 'ios'. */
let mockPlatformOS = 'ios';

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

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    mqtt: {
      host: 'broker.local',
      port: 9001,
      username: undefined,
      password: undefined,
      prefix: 'home',
    },
    influx: {
      url: 'http://influx.local:8086',
      org: 'iot',
      bucket: 'sensors',
      token: 'tok',
    },
    ui: { theme: 'light' },
    ...overrides,
  };
}

/** Nothing persisted, nothing drafted — the first-run world. */
function emptySettings(): AppSettings {
  return settings({
    mqtt: {
      host: '',
      port: 9001,
      username: undefined,
      password: undefined,
      prefix: 'home',
    },
    influx: { url: '', org: '', bucket: '', token: '' },
  });
}

const SERVER: DiscoveredServer = {
  name: 'Smart Home Server',
  host: '192.168.2.28',
  port: 9001,
  txt: {
    prefix: 'smarthome',
    influxPort: 8086,
    influxOrg: 'smarthome',
    influxBucket: 'smarthome',
  },
};

/** Controllable fake of the mDNS discovery service (crash-fix seam). */
function makeFakeDiscovery() {
  let onDone: ((result: MdnsScanResult) => void) | null = null;
  const session: MdnsScanSession = { stop: () => undefined };
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
  };
}

/** Controllable fake of the one-shot MQTT probe service (D4 seam). */
function makeFakeProbe(
  outcome:
    | {
        ok: true;
      }
    | { ok: false; code: MqttProbeErrorCode },
) {
  const calls: MqttProbeConfig[] = [];
  const service: MqttProbeServiceLike = {
    probe: (config: MqttProbeConfig): Promise<MqttProbeResult> => {
      calls.push(config);
      if (outcome.ok) {
        return Promise.resolve({ ok: true, value: undefined });
      }
      return Promise.resolve({
        ok: false,
        error: new MqttProbeError(outcome.code, 'probe failed'),
      });
    },
  };
  return { service, calls };
}

/**
 * Deferred MQTT probe fake: the test settles the in-flight probe
 * EXPLICITLY (the AD-5 race-guard pins — late results after a draft edit
 * or a step change).
 */
function makeDeferredProbe() {
  const calls: MqttProbeConfig[] = [];
  const resolvers: ((result: MqttProbeResult) => void)[] = [];
  const service: MqttProbeServiceLike = {
    probe: (config: MqttProbeConfig) => {
      calls.push(config);
      return new Promise<MqttProbeResult>(resolve => {
        resolvers.push(resolve);
      });
    },
  };
  return {
    service,
    calls,
    settle: (result: MqttProbeResult) => {
      resolvers.shift()?.(result);
    },
  };
}

/** Controllable fake of the one-shot InfluxDB probe service (A3 seam). */
function makeFakeInfluxProbe(
  outcome:
    | {
        ok: true;
      }
    | { ok: false; code: MqttProbeErrorCode },
) {
  const calls: InfluxProbeConfig[] = [];
  const service: InfluxProbeServiceLike = {
    probe: (config: InfluxProbeConfig): Promise<InfluxProbeResult> => {
      calls.push(config);
      if (outcome.ok) {
        return Promise.resolve({ ok: true, value: undefined });
      }
      return Promise.resolve({
        ok: false,
        error: new InfluxProbeError(outcome.code, 'influx probe failed'),
      });
    },
  };
  return { service, calls };
}

/** Section equality (SettingsNavigator's JSON comparison). */
function sectionEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface HarnessOptions {
  readonly draft?: AppSettings;
  readonly persisted?: AppSettings;
  readonly connectionState?:
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'failed';
  readonly withDiscovery?: boolean;
  readonly probe?: ReturnType<typeof makeFakeProbe>;
  readonly influxProbe?: ReturnType<typeof makeFakeInfluxProbe>;
  /** The outcome of the EXISTING save path (default: success). */
  readonly saveResult?: { ok: boolean; message: string };
  /** Field errors keyed by dotted path (e.g. `mqtt.host`). */
  readonly errors?: Record<string, string>;
}

/**
 * Stateful harness simulating the coordinator wiring: `draft` is the
 * store draft, `persisted` the last-saved settings, the update actions
 * mutate the draft, save commits it (and flips the dirty flags) — the
 * same truthfulness the real store gives the screen.
 */
function makeHarness(options: HarnessOptions = {}) {
  const onBack = jest.fn();
  const onMqttRetry = jest.fn();
  const onCheckInflux = jest.fn<Promise<'ok' | 'fail'>, []>(() =>
    Promise.resolve<'ok' | 'fail'>('ok'),
  );
  let draft: AppSettings = options.draft ?? settings();
  let persisted: AppSettings = options.persisted ?? options.draft ?? settings();
  let connectionState = options.connectionState ?? 'connected';
  const saveResult = options.saveResult ?? { ok: true, message: 'Đã lưu' };
  const discovery =
    options.withDiscovery === false ? null : makeFakeDiscovery();
  const probe = options.probe ?? makeFakeProbe({ ok: true });
  const influxProbe = options.influxProbe ?? makeFakeInfluxProbe({ ok: true });

  let renderer!: TestRenderer.ReactTestRenderer;

  const element = () => (
    <ThemeProvider mode="light">
      <AdvancedSettingsScreen
        onBack={onBack}
        settings={draft}
        persistedMqtt={persisted.mqtt}
        persistedInflux={persisted.influx}
        errors={options.errors}
        onUpdateMqtt={patch => {
          draft = { ...draft, mqtt: { ...draft.mqtt, ...patch } };
          rerender();
        }}
        onUpdateInflux={patch => {
          draft = { ...draft, influx: { ...draft.influx, ...patch } };
          rerender();
        }}
        onSave={async candidate => {
          if (saveResult.ok) {
            persisted = candidate;
            draft = candidate;
            rerender();
          }
          return saveResult;
        }}
        connectionState={connectionState}
        lastErrorCode={null}
        mqttDirty={!sectionEqual(draft.mqtt, persisted.mqtt)}
        influxDirty={!sectionEqual(draft.influx, persisted.influx)}
        onMqttRetry={() => {
          onMqttRetry();
          connectionState = 'connecting';
          rerender();
        }}
        onCheckInflux={onCheckInflux}
        discoveryService={discovery === null ? undefined : discovery.service}
        mqttProbeService={probe.service}
        influxProbeService={influxProbe.service}
      />
    </ThemeProvider>
  );

  const rerender = () => {
    act(() => {
      renderer.update(element());
    });
  };

  act(() => {
    renderer = TestRenderer.create(element());
  });

  /** Drive the LIVE telemetry state (the store's setConnection mirror). */
  const setLive = (state: typeof connectionState) => {
    connectionState = state;
    rerender();
  };

  return {
    renderer,
    onBack,
    onMqttRetry,
    onCheckInflux,
    discovery,
    probe,
    influxProbe,
    rerender,
    setLive,
    getDraft: () => draft,
  };
}

/** Renderers still mounted (unmounted in afterEach — timer hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  // B2: the wizard session store is module-scoped — reset between cases.
  getWizardSessionStore().setState({
    currentStep: null,
    savedOk: false,
    mode: null,
  });
});

afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
  mockPlatformOS = 'ios';
});

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

/**
 * Press a pressable whose handler is ASYNC (the probe/save) and flush
 * the promise chain inside act so the resulting state lands before the
 * assertions.
 */
async function pressAsync(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): Promise<void> {
  const node = renderer.root
    .findAllByProps({ testID })
    .find(candidate => typeof candidate.props.onPress === 'function');
  if (!node) {
    throw new Error(`no pressable node for ${testID}`);
  }
  await act(async () => {
    node.props.onPress();
    await Promise.resolve();
  });
}

/**
 * Flush the mount auto-probe (Amendment 3): the screen schedules the
 * once-per-mount status probe in a timer callback (setState never runs
 * synchronously in the effect body), so both the macrotask timer AND the
 * probe's promise chain must settle inside act before asserting.
 */
async function flushMountAutoProbe(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

/** Tree-order index of a testID's FIRST occurrence (layout order pin). */
function orderOf(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): number {
  const all = renderer.root.findAll(() => true);
  const nodes = renderer.root.findAll(node => node.props.testID === testID);
  if (nodes.length === 0) {
    throw new Error(`no node for ${testID}`);
  }
  return all.indexOf(nodes[0]);
}

/** Flatten an RN style (or style array) into one object. */
function flattenStyle(style: unknown): Record<string, unknown> {
  const flatten = StyleSheet.flatten as unknown as (
    style: unknown,
  ) => Record<string, unknown>;
  return flatten(style);
}

describe('AdvancedSettingsScreen (composition)', () => {
  it('first run: title + stepper + step-1 card only — NO tab bar, no widgets', () => {
    const { renderer } = makeHarness({
      draft: emptySettings(),
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-settings-back' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'config-stepper' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    // The selectable sub-tab bar is RETIRED — it never renders anywhere.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-subtabs' }).length,
    ).toBe(0);
    // Nothing persisted → the widgets never render.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status' }).length,
    ).toBe(0);
  });

  it('a persisted configuration opens directly in the post-save Trạng thái mode', () => {
    const { renderer } = makeHarness();
    openRenderers.push(renderer);
    // Status content: widgets visible, wizard hidden.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-group-title' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'config-stepper' }).length,
    ).toBe(0);
    // No selectable tabs — the mode is not user-switchable chrome.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-subtabs' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'subtab-setup' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'subtab-status' }).length,
    ).toBe(0);
    // The explicit `Cấu hình lại` entry exists in status mode.
    expect(
      renderer.root.findAllByProps({ testID: 'status-edit-config' }).length,
    ).toBeGreaterThan(0);
  });

  it('the status mode layout orders: MQTT card → group title → InfluxDB card → Cấu hình lại', () => {
    const { renderer } = makeHarness();
    openRenderers.push(renderer);
    expect(orderOf(renderer, 'advanced-mqtt-status')).toBeLessThan(
      orderOf(renderer, 'advanced-influx-group-title'),
    );
    expect(orderOf(renderer, 'advanced-influx-group-title')).toBeLessThan(
      orderOf(renderer, 'advanced-influx-status'),
    );
    expect(orderOf(renderer, 'advanced-influx-status')).toBeLessThan(
      orderOf(renderer, 'status-edit-config'),
    );
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
  });

  it('the back arrow navigates back (no `Quay lại` text in the title bar)', () => {
    const { renderer, onBack } = makeHarness();
    openRenderers.push(renderer);
    press(renderer, 'advanced-settings-back');
    expect(onBack).toHaveBeenCalledTimes(1);
    // Scoped to the title bar: the auth step legitimately owns a `Quay
    // lại` button, but the title bar itself has none.
    const titleBar = renderer.root.findByProps({
      testID: 'advanced-title-bar',
    });
    const titleTexts = titleBar
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(titleTexts).toContain(STRINGS.settings.advancedTitle);
    expect(titleTexts).not.toContain(STRINGS.settings.back);
  });

  it('choosing a discovered server fills the draft and ADVANCES to step 2 (no probe, no save)', () => {
    const harness = makeHarness({
      draft: emptySettings(),
      persisted: emptySettings(),
    });
    const {
      renderer,
      discovery: d,
      rerender,
      probe,
      influxProbe,
      getDraft,
    } = harness;
    if (d === null) throw new Error('discovery expected');
    const discovery = d;
    openRenderers.push(renderer);
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [SERVER] });
    press(renderer, 'advanced-mdns-choose-0');
    rerender();

    // The IMMEDIATE advance (user-approved `ok` amendment): the auth
    // card replaces the server card — no extra `Tiếp tục` press.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
    // The fill happened (the non-secret mDNS patch reached the draft —
    // never secrets).
    expect(getDraft().mqtt.host).toBe(SERVER.host);
    expect(getDraft().mqtt.port).toBe(SERVER.port);
    // The step-2 InfluxDB section shows the mDNS-filled draft values
    // (applyDiscoveredService fills url/org/bucket — never the token).
    expect(
      renderer.root.findByProps({ testID: 'advanced-step-influx-url' }).props
        .value,
    ).toBe('http://192.168.2.28:8086');
    expect(
      renderer.root.findByProps({ testID: 'advanced-step-influx-org' }).props
        .value,
    ).toBe('smarthome');
    expect(
      renderer.root.findByProps({ testID: 'advanced-step-influx-bucket' }).props
        .value,
    ).toBe('smarthome');
    // Never a probe and never a save: still the SETUP mode at step 2
    // (no step-3 card, no status widgets).
    expect(probe.calls.length).toBe(0);
    expect(influxProbe.calls.length).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBe(0);
  });

  it('the manual fallback advances to step 2 through `Tiếp tục`', () => {
    const harness = makeHarness({
      draft: emptySettings(),
      persisted: emptySettings(),
    });
    const { renderer, discovery: d } = harness;
    if (d === null) throw new Error('discovery expected');
    const discovery = d;
    openRenderers.push(renderer);
    press(renderer, 'advanced-mdns-scan-start');
    discovery.deliver({ ok: true, value: [] });
    press(renderer, 'setup-manual-address-link');

    // Type a valid host → the store draft updates → `Tiếp tục` enables.
    const hostInput = renderer.root.findByProps({
      testID: 'advanced-host-input',
    });
    act(() => {
      hostInput.props.onChangeText('192.168.1.10');
    });
    press(renderer, 'setup-continue-manual');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
  });

  it('a SUCCESSFUL probe auto-advances to step 3 and sends the draft credentials', async () => {
    const probe = makeFakeProbe({ ok: true });
    const draft = settings({
      mqtt: { ...settings().mqtt, username: 'alice', password: 'secret' },
    });
    const { renderer } = makeHarness({
      draft,
      persisted: emptySettings(),
      probe,
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    // The probe ran against the DRAFT config with the draft credentials.
    expect(probe.calls[0]).toEqual({
      host: 'broker.local',
      port: 9001,
      username: 'alice',
      password: 'secret',
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('the no-auth option probes WITHOUT credentials', () => {
    const probe = makeFakeProbe({ ok: true });
    const draft = settings({
      mqtt: { ...settings().mqtt, username: 'alice', password: 'secret' },
    });
    const { renderer } = makeHarness({
      draft,
      persisted: emptySettings(),
      probe,
    });
    openRenderers.push(renderer);
    press(renderer, 'advanced-no-auth-checkbox');
    press(renderer, 'advanced-probe-start');
    expect(probe.calls[0]).toEqual({ host: 'broker.local', port: 9001 });
  });

  it('a FAILED probe stays on step 2, shows the inline cause and keeps the data', async () => {
    const probe = makeFakeProbe({ ok: false, code: 'auth' });
    const draft = settings({
      mqtt: { ...settings().mqtt, username: 'alice', password: 'secret' },
    });
    const { renderer } = makeHarness({
      draft,
      persisted: emptySettings(),
      probe,
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findByProps({ testID: 'advanced-probe-error' }).props
        .children,
    ).toBe(STRINGS.settings.probeFailedAuth);
    // Data preserved: the inputs still carry the draft values.
    expect(
      renderer.root.findByProps({ testID: 'advanced-username-input' }).props
        .value,
    ).toBe('alice');
    expect(
      renderer.root.findByProps({ testID: 'advanced-password-input' }).props
        .value,
    ).toBe('secret');
  });

  it('the QR fill fills the drafts and does NOT auto-probe or advance', async () => {
    const probe = makeFakeProbe({ ok: true });
    const influxProbe = makeFakeInfluxProbe({ ok: true });
    const { renderer, getDraft } = makeHarness({
      draft: settings({
        mqtt: { ...settings().mqtt, username: undefined, password: undefined },
      }),
      persisted: emptySettings(),
      probe,
      influxProbe,
    });
    openRenderers.push(renderer);
    press(renderer, 'setup-scan-qr');
    await act(async () => {
      await Promise.resolve();
    });
    const camera = renderer.root.findByProps({ testID: 'qr-scanner-camera' });
    act(() => {
      camera.props.onBarcodeScanned({
        data: JSON.stringify({
          schemaVersion: 1,
          kind: 'credentials',
          mqttUsername: 'qr-user',
          mqttPassword: 'qr-pass',
          influxToken: 'qr-token',
        }),
        type: 'qr',
      });
    });
    // Filled (fill-never-save): the inputs carry the QR values and the
    // user stays on step 2.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findByProps({ testID: 'advanced-username-input' }).props
        .value,
    ).toBe('qr-user');
    // The QR's influxToken reached the Influx DRAFT (fill-never-save —
    // the token is edited/masked in the step's InfluxDB section).
    expect(getDraft().influx.token).toBe('qr-token');
    // NO auto-probe (AD-3): the explicit `Kiểm tra kết nối` gate is the
    // sole path forward.
    expect(probe.calls.length).toBe(0);
    expect(influxProbe.calls.length).toBe(0);
  });

  it('a full 11-field QR fills host/port/prefix/url/org/bucket AND the secrets in ONE scan', async () => {
    // M27b: the M27a backend QR carries the connection fields too — one
    // scan fills the whole first-run configuration; the user still saves.
    const draft = settings({
      mqtt: {
        ...settings().mqtt,
        host: '',
        username: undefined,
        password: undefined,
      },
      influx: {
        ...settings().influx,
        url: '',
        org: '',
        bucket: '',
        token: '',
      },
    });
    // Open the wizard directly on step 2 (the QR affordance lives there) —
    // the blank host would otherwise resolve the mount to step 1.
    getWizardSessionStore().setState({ mode: 'setup', currentStep: 2 });
    const { renderer, getDraft, probe } = makeHarness({ draft });
    openRenderers.push(renderer);
    press(renderer, 'setup-scan-qr');
    await act(async () => {
      await Promise.resolve();
    });
    const camera = renderer.root.findByProps({ testID: 'qr-scanner-camera' });
    act(() => {
      camera.props.onBarcodeScanned({
        data: JSON.stringify({
          schemaVersion: 1,
          kind: 'credentials',
          mqttUsername: 'homeuser',
          mqttPassword: 's3cret-pass',
          influxToken: 'influx-token-abc',
          mqttHost: '192.168.3.105',
          mqttPort: 9001,
          mqttPrefix: 'smarthome',
          influxUrl: 'http://192.168.3.105:8086',
          influxOrg: 'smarthome',
          influxBucket: 'telemetry',
        }),
        type: 'qr',
      });
    });
    // Connection fields reached the MQTT DRAFT (port as a NUMBER).
    expect(getDraft().mqtt.host).toBe('192.168.3.105');
    expect(getDraft().mqtt.port).toBe(9001);
    expect(getDraft().mqtt.prefix).toBe('smarthome');
    // Secrets reached the draft verbatim.
    expect(getDraft().mqtt.username).toBe('homeuser');
    expect(getDraft().mqtt.password).toBe('s3cret-pass');
    // InfluxDB fields reached the draft.
    expect(getDraft().influx.url).toBe('http://192.168.3.105:8086');
    expect(getDraft().influx.org).toBe('smarthome');
    expect(getDraft().influx.bucket).toBe('telemetry');
    expect(getDraft().influx.token).toBe('influx-token-abc');
    // Scanner closed, the user stays on step 2 — fill-never-save: Lưu is
    // still the explicit next action (no probe ran, no step advance).
    expect(
      renderer.root.findAllByProps({ testID: 'qr-scanner-camera' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(probe.calls.length).toBe(0);
  });

  it('a QR with IPv6 mqttHost + malformed IPv6 influxUrl fills bare MQTT host + bracketed Influx URL (influx-ipv6-url-normalization)', async () => {
    const draft = settings({
      mqtt: {
        ...settings().mqtt,
        host: '',
        username: undefined,
        password: undefined,
      },
      influx: { ...settings().influx, url: '', org: '', bucket: '', token: '' },
    });
    getWizardSessionStore().setState({ mode: 'setup', currentStep: 2 });
    const { renderer, getDraft, probe } = makeHarness({ draft });
    openRenderers.push(renderer);
    press(renderer, 'setup-scan-qr');
    await act(async () => {
      await Promise.resolve();
    });
    const camera = renderer.root.findByProps({ testID: 'qr-scanner-camera' });
    act(() => {
      camera.props.onBarcodeScanned({
        data: JSON.stringify({
          schemaVersion: 1,
          kind: 'credentials',
          mqttUsername: 'homeuser',
          mqttHost: 'fe80::9b78:6845:8077:4ce2:9001',
          mqttPort: 9001,
          influxUrl: 'http://fe80::9b78:6845:8077:4ce2:9001:8086',
          influxOrg: 'smarthome',
          influxBucket: 'telemetry',
        }),
        type: 'qr',
      });
    });
    // MQTT host stays BARE (original); the Influx URL is repaired to the
    // RFC-compliant bracketed form before it can reach validation.
    expect(getDraft().mqtt.host).toBe('fe80::9b78:6845:8077:4ce2:9001');
    expect(getDraft().influx.url).toBe(
      'http://[fe80::9b78:6845:8077:4ce2:9001]:8086',
    );
    // Scanner closed, no auto-probe/save/advance (fill-never-save intact).
    expect(
      renderer.root.findAllByProps({ testID: 'qr-scanner-camera' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(probe.calls.length).toBe(0);
  });

  it('a junk STRING mqttPort drops ONLY the port — the rest of the QR still fills', async () => {
    const { renderer, getDraft } = makeHarness({
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    press(renderer, 'setup-scan-qr');
    await act(async () => {
      await Promise.resolve();
    });
    const camera = renderer.root.findByProps({ testID: 'qr-scanner-camera' });
    act(() => {
      camera.props.onBarcodeScanned({
        data: JSON.stringify({
          schemaVersion: 1,
          kind: 'credentials',
          mqttUsername: 'homeuser',
          mqttHost: '192.168.3.105',
          mqttPort: '9001',
          influxBucket: 'telemetry',
        }),
        type: 'qr',
      });
    });
    // The port keeps its current draft value (9001 from the fixture) —
    // the junk string never reached it — while host + secrets fill.
    expect(getDraft().mqtt.host).toBe('192.168.3.105');
    expect(getDraft().mqtt.port).toBe(9001);
    expect(getDraft().mqtt.username).toBe('homeuser');
    expect(getDraft().influx.bucket).toBe('telemetry');
  });

  it('Lưu cấu hình success ENTERS the post-save Trạng thái mode (no tab press, no fourth step)', async () => {
    const draft = settings({
      mqtt: { ...settings().mqtt, username: 'alice', password: 'secret' },
    });
    const { renderer } = makeHarness({
      draft,
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    // Reach step 3 through the real probe.
    await pressAsync(renderer, 'advanced-probe-start');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);

    press(renderer, 'setup-save');
    await act(async () => {
      await Promise.resolve();
    });
    // The mode transition happened automatically: the widgets render and
    // the wizard (stepper) is gone — no selectable tab was pressed.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'config-stepper' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-subtabs' }).length,
    ).toBe(0);
    // The status mode owns the live state; the official stepper keeps
    // exactly three levels wherever it renders (never a fourth).
    expect(
      renderer.root.findAllByProps({ testID: 'stepper-step-4' }).length,
    ).toBe(0);
  });

  it('a FAILED save STAYS on step 3: draft kept, retryable error, primary Thử lại, no backward navigation', async () => {
    const { renderer, getDraft } = makeHarness({
      draft: settings({
        mqtt: { ...settings().mqtt, username: 'alice', password: 'secret' },
      }),
      persisted: emptySettings(),
      saveResult: { ok: false, message: 'Không ghi được cài đặt' },
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
    const draftBeforeSave = getDraft();

    press(renderer, 'setup-save');
    await act(async () => {
      await Promise.resolve();
    });

    // NO automatic backward navigation: the user is still on Step 3.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
    // NOT marked persisted: the wizard still shows the setup mode.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBe(0);
    // The retryable error renders near the save action…
    expect(
      renderer.root.findByProps({ testID: 'completion-save-error' }).props
        .children,
    ).toBe('Không ghi được cài đặt');
    // …and `Thử lại` is the PRIMARY recovery label.
    const saveButton = renderer.root
      .findAllByProps({ testID: 'setup-save' })
      .find(node => typeof node.props.onPress === 'function');
    if (!saveButton) {
      throw new Error('save button missing');
    }
    const labelText = saveButton
      .findAll(node => typeof node.props.children === 'string')
      .at(0);
    expect(labelText?.props.children).toBe(STRINGS.settings.retry);
    // The draft is preserved verbatim.
    expect(getDraft()).toEqual(draftBeforeSave);
  });

  it('Thử lại after a failed save retries the SAME save path (success recovers)', async () => {
    const { renderer } = makeHarness({
      persisted: emptySettings(),
      saveResult: { ok: true, message: 'Đã lưu' },
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    press(renderer, 'setup-save');
    await act(async () => {
      await Promise.resolve();
    });
    // Success after retry: the save path ran and the mode transitioned.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBeGreaterThan(0);
  });

  it('Chỉnh sửa xác thực returns to step 2 with the draft kept; step 3 needs a fresh probe', async () => {
    const { renderer, getDraft } = makeHarness({
      persisted: emptySettings(),
      saveResult: { ok: false, message: 'Không ghi được cài đặt' },
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    press(renderer, 'setup-save');
    await act(async () => {
      await Promise.resolve();
    });
    const draftAfterFailure = getDraft();

    // The EXPLICIT contextual edit action (never automatic).
    press(renderer, 'setup-edit-auth');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBe(0);
    // Draft preserved across the manual return.
    expect(getDraft()).toEqual(draftAfterFailure);

    // The probe gate re-arms: step 3 does NOT reopen until a fresh
    // successful probe runs (the old result is invalidated — AD-5).
    await pressAsync(renderer, 'advanced-probe-start');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('Chỉnh sửa máy chủ renders when a server field is flagged and returns to step 1', async () => {
    const { renderer } = makeHarness({
      persisted: emptySettings(),
      saveResult: { ok: false, message: 'Cấu hình không hợp lệ' },
      errors: { 'mqtt.host': 'Địa chỉ không hợp lệ' },
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    press(renderer, 'setup-save');
    await act(async () => {
      await Promise.resolve();
    });
    // Both contextual actions are offered (the server fields need
    // changing).
    expect(
      renderer.root.findAllByProps({ testID: 'setup-edit-server' }).length,
    ).toBeGreaterThan(0);
    press(renderer, 'setup-edit-server');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBe(0);
  });

  it('web hides the guided flow but keeps the status cards (user decision 2a)', () => {
    mockPlatformOS = 'web';
    const { renderer } = makeHarness();
    openRenderers.push(renderer);
    expect(
      renderer.root.findAllByProps({ testID: 'config-stepper' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-subtabs' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'setup-web-hint' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status' }).length,
    ).toBeGreaterThan(0);
    // No reconfigure entry on web — setup happens on the phone.
    expect(
      renderer.root.findAllByProps({ testID: 'status-edit-config' }).length,
    ).toBe(0);
  });

  it('the MQTT card retry drives the REAL lifecycle (the wired composition callback)', async () => {
    const { renderer, onMqttRetry, setLive } = makeHarness();
    openRenderers.push(renderer);
    // A persisted world mounts directly in the Trạng thái mode — the
    // widget is visible without any wizard navigation.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBeGreaterThan(0);
    // `idle` (service stopped/backgrounded) = the honest `lost` card
    // state — it does NOT move the user anywhere.
    setLive('idle');
    // C3: the retry button lives INSIDE the detail now — open it via
    // the widget body tap.
    press(renderer, 'advanced-mqtt-status-body');
    press(renderer, 'advanced-mqtt-retry');
    expect(onMqttRetry).toHaveBeenCalledTimes(1);
    // The real state transition is mirrored: the card honestly shows the
    // reconnecting progress.
    expect(
      renderer.root.findAllByProps({ testID: 'status-dot-progress' }).length,
    ).toBeGreaterThan(0);
  });

  it('the unconfigured MQTT detail `Cấu hình` action returns to setup step 1', async () => {
    // Persisted InfluxDB only — the MQTT side was never saved. A persisted
    // world mounts in the Trạng thái mode, where the widget exists and
    // truthfully shows the unconfigured PERSISTED mqtt side.
    const persisted = settings({ mqtt: { ...settings().mqtt, host: '' } });
    const { renderer } = makeHarness({ persisted });
    openRenderers.push(renderer);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBeGreaterThan(0);
    // Open the detail, then the relocated Cấu hình action.
    press(renderer, 'advanced-mqtt-status-body');
    press(renderer, 'advanced-mqtt-configure');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    // The mode switched to setup: the wizard shows, the widgets do not.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'config-stepper' }).length,
    ).toBeGreaterThan(0);
  });

  it('a status-mode mount auto-probes InfluxDB ONCE and the manual Kiểm tra still works', async () => {
    const { renderer, onCheckInflux } = makeHarness();
    openRenderers.push(renderer);
    // Amendment 3: a persisted world mounts in the Trạng thái mode; the
    // sufficient persisted InfluxDB target auto-probes ONCE at mount —
    // no press needed (this is the "re-entry" probe per ADR-018).
    await flushMountAutoProbe();
    expect(onCheckInflux).toHaveBeenCalledTimes(1);
    expect(
      renderer.root.findAllByProps({ testID: 'status-dot-healthy' }).length,
    ).toBeGreaterThan(0);
    // The manual contract is unchanged: `Kiểm tra` still runs the EXISTING
    // handler after the auto-probe settled.
    press(renderer, 'advanced-influx-status-body');
    press(renderer, 'advanced-influx-check');
    await act(async () => {
      await Promise.resolve();
    });
    expect(onCheckInflux).toHaveBeenCalledTimes(2);
    expect(
      renderer.root.findAllByProps({ testID: 'status-dot-healthy' }).length,
    ).toBeGreaterThan(0);
  });

  it('a setup-mode mount does NOT auto-probe InfluxDB (the step-2 dual probe owns setup)', async () => {
    // Nothing persisted → first-run setup mode, even though the DRAFT
    // InfluxDB fields are fully filled.
    const { renderer, onCheckInflux } = makeHarness({
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    await flushMountAutoProbe();
    expect(onCheckInflux).not.toHaveBeenCalled();
  });

  it('an insufficient persisted InfluxDB target does NOT auto-probe', async () => {
    const persisted = settings({
      influx: { ...settings().influx, token: '' },
    });
    const { renderer, onCheckInflux } = makeHarness({ persisted });
    openRenderers.push(renderer);
    await flushMountAutoProbe();
    expect(onCheckInflux).not.toHaveBeenCalled();
  });

  it('the InfluxDB `Kiểm tra` is disabled while the config is insufficient', async () => {
    const draft = settings({ influx: { ...settings().influx, token: '' } });
    const { renderer } = makeHarness({ draft, persisted: draft });
    openRenderers.push(renderer);
    // Status-mode mount + the check inside the detail (C3).
    press(renderer, 'advanced-influx-status-body');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-check' }).at(0)
        ?.props.disabled,
    ).toBe(true);
  });

  it('the InfluxDB detail opens from the widget body and patches the store draft', async () => {
    const { renderer } = makeHarness();
    openRenderers.push(renderer);
    // Status-mode mount; B3 moved the form INTO the detail (widget body
    // tap).
    press(renderer, 'advanced-influx-status-body');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status-detail' })
        .length,
    ).toBeGreaterThan(0);
    const url = renderer.root.findByProps({
      testID: 'advanced-influx-url-input',
    });
    act(() => {
      url.props.onChangeText('http://192.168.2.30:8086');
    });
    expect(
      renderer.root.findByProps({ testID: 'advanced-influx-url-input' }).props
        .value,
    ).toBe('http://192.168.2.30:8086');
  });

  // ---- The dual probe (D4 MQTT gate + A3 InfluxDB half) ----------------
  it('the dual probe checks InfluxDB with the DRAFT config when sufficient', async () => {
    const influxProbe = makeFakeInfluxProbe({ ok: true });
    const draft = settings({
      mqtt: { ...settings().mqtt, username: 'alice', password: 'secret' },
      influx: {
        url: 'http://192.168.2.28:8086',
        org: 'smarthome',
        bucket: 'smarthome',
        token: 'tok',
      },
    });
    const { renderer } = makeHarness({
      draft,
      persisted: emptySettings(),
      influxProbe,
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    expect(influxProbe.calls[0]).toEqual({
      url: 'http://192.168.2.28:8086',
      org: 'smarthome',
      bucket: 'smarthome',
      token: 'tok',
    });
    // MQTT gate unchanged: both ok → step 3.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
    // The settled InfluxDB result carries into the summary row.
    const influxRow = renderer.root
      .findByProps({ testID: 'completion-influx' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(influxRow).toContain(STRINGS.settings.summaryVerified);
  });

  it('the dual probe skips InfluxDB honestly when the draft is insufficient', async () => {
    const influxProbe = makeFakeInfluxProbe({ ok: true });
    const draft = settings({
      influx: { ...settings().influx, token: '' },
    });
    const { renderer } = makeHarness({
      draft,
      persisted: emptySettings(),
      influxProbe,
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    expect(influxProbe.calls.length).toBe(0);
    // The skip line shows on step 2... and MQTT ok still advances (the
    // gate is unchanged), so the settled state carries as `skipped`.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
    const skippedRow = renderer.root
      .findByProps({ testID: 'completion-influx' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(skippedRow).toContain(STRINGS.settings.summaryInfluxSkipped);
  });

  it('MQTT failure keeps step 2 with BOTH inline results (influx non-blocking)', async () => {
    const probe = makeFakeProbe({ ok: false, code: 'auth' });
    const influxProbe = makeFakeInfluxProbe({ ok: false, code: 'network' });
    const { renderer } = makeHarness({
      probe,
      influxProbe,
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    // Stays on step 2 with BOTH results inline.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findByProps({ testID: 'advanced-probe-error' }).props
        .children,
    ).toBe(STRINGS.settings.probeFailedAuth);
    const influxLine = renderer.root.findByProps({
      testID: 'advanced-influx-probe-result',
    }).props.children as string;
    expect(influxLine).toContain(STRINGS.settings.influxProbeFailed);
    // Never a secret, never a raw body.
    expect(influxLine).not.toContain('tok');
  });

  it('MQTT ok + InfluxDB failure still advances (non-blocking) and the row reads thất bại', async () => {
    const influxProbe = makeFakeInfluxProbe({ ok: false, code: 'auth' });
    const { renderer } = makeHarness({
      persisted: emptySettings(),
      influxProbe,
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
    const failedRow = renderer.root
      .findByProps({ testID: 'completion-influx' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(failedRow).toContain(STRINGS.settings.failed);
  });

  it('post-save seeding shows the InfluxDB card result (no `Chưa kiểm tra`)', async () => {
    const influxProbe = makeFakeInfluxProbe({ ok: true });
    const { renderer } = makeHarness({
      persisted: emptySettings(),
      influxProbe,
    });
    openRenderers.push(renderer);
    await pressAsync(renderer, 'advanced-probe-start');
    press(renderer, 'setup-save');
    await act(async () => {
      await Promise.resolve();
    });
    // The status card was seeded from the step-2 probe (no extra call).
    expect(influxProbe.calls.length).toBe(1);
    expect(
      renderer.root.findAllByProps({ testID: 'status-dot-healthy' }).length,
    ).toBeGreaterThan(0);
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).not.toContain('Chưa kiểm tra');
  });

  it('a fresh status-mode screen auto-probes and settles — never `Chưa kiểm tra`, never `—`', async () => {
    const { renderer } = makeHarness();
    openRenderers.push(renderer);
    // Amendment 3: re-entering the Settings tab remounts the screen; a
    // sufficient persisted InfluxDB target auto-probes at mount, so the
    // card can no longer open on its never-probed placeholder.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status' }).length,
    ).toBeGreaterThan(0);
    await flushMountAutoProbe();
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    // Settled to the successful result.
    expect(texts).toContain(STRINGS.settings.success);
    // The old never-probed placeholder AND the retired `—` placeholder
    // never appear.
    expect(texts).not.toContain('Chưa kiểm tra');
    expect(texts).not.toContain('—');
  });

  // ---- Cấu hình lại: the explicit status → setup path ------------------
  it('Cấu hình lại is the ONLY path back to setup: step 1, draft kept, no auto-save', async () => {
    const { renderer, getDraft } = makeHarness();
    openRenderers.push(renderer);
    const draftInStatus = getDraft();

    press(renderer, 'status-edit-config');
    // Setup mode, Step 1: the stepper shows, the widgets do not.
    expect(
      renderer.root.findAllByProps({ testID: 'config-stepper' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBe(0);
    // Draft preserved, nothing auto-saved.
    expect(getDraft()).toEqual(draftInStatus);

    // The stepper is monotonic after the explicit return:
    // [current, upcoming, upcoming] — the seal unsealed.
    const dot = (i: number) =>
      flattenStyle(
        renderer.root.findByProps({ testID: `stepper-dot-${i}` }).props.style,
      ).backgroundColor as string;
    expect(dot(1)).toBe(LIGHT_TOKENS.smart.colors.amber);
    expect(dot(2)).toBe(LIGHT_TOKENS.smart.colors.textSecondary);
    expect(dot(3)).toBe(LIGHT_TOKENS.smart.colors.textSecondary);
  });

  // ---- Runtime failure recovery (replaces the old automatic fallback) --
  it('a runtime `failed` NEVER moves the user: setup mode shows the notice at the current step', () => {
    // A persisted world with the wizard open at step 2 (the user's chosen
    // position, seeded through the session store).
    getWizardSessionStore().setState({ mode: 'setup', currentStep: 2 });
    const { renderer, setLive } = makeHarness();
    openRenderers.push(renderer);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    setLive('failed');
    // The user is NOT moved: same step, same mode, same draft card.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
    // The notice reports the PERSISTED runtime loss at the current step.
    expect(
      renderer.root.findAllByProps({
        testID: 'advanced-runtime-notice',
      }).length,
    ).toBeGreaterThan(0);
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.runtimeLostNotice);
    expect(texts).not.toContain(STRINGS.settings.runtimeReconnectingNotice);
  });

  it('the setup-mode notice offers Thử lại (real lifecycle) and Cấu hình lại (explicit)', async () => {
    getWizardSessionStore().setState({ mode: 'setup', currentStep: 2 });
    const { renderer, onMqttRetry, setLive } = makeHarness();
    openRenderers.push(renderer);
    setLive('failed');
    press(renderer, 'advanced-runtime-retry');
    expect(onMqttRetry).toHaveBeenCalledTimes(1);
    // The retry started the real lifecycle (connecting) — the failure
    // notice yields to it. A NEW failure episode re-arms the notice.
    setLive('failed');
    expect(
      renderer.root.findAllByProps({
        testID: 'advanced-runtime-notice',
      }).length,
    ).toBeGreaterThan(0);
    press(renderer, 'advanced-runtime-reconfigure');
    // Only NOW the flow moves — to setup Step 1, draft kept.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBe(0);
  });

  it('a reconnecting episode NEVER yanks — however long it lasts (no 60 s timer)', () => {
    getWizardSessionStore().setState({ mode: 'setup', currentStep: 2 });
    const { renderer, setLive } = makeHarness();
    openRenderers.push(renderer);
    // An arbitrarily old episode start — the retired fallback would have
    // fired after 60 s; nothing happens now.
    setLive('reconnecting');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
    // The calm reconnecting notice shows (no actions to escalate).
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.runtimeReconnectingNotice);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-runtime-retry' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({
        testID: 'advanced-runtime-reconfigure',
      }).length,
    ).toBe(0);
  });

  it('runtime `failed` in status mode never resets the mode; Cấu hình lại moves only on press', () => {
    const { renderer, setLive } = makeHarness();
    openRenderers.push(renderer);
    setLive('failed');
    // Same status mode, same widgets — the failed card is the truthful
    // notice here; no automatic jump to setup Step 1.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({
        testID: 'advanced-runtime-notice',
      }).length,
    ).toBe(0);
    press(renderer, 'status-edit-config');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'config-stepper' }).length,
    ).toBeGreaterThan(0);
  });

  it('a failed transition while a probe is in flight reports WITHOUT moving the user; the result stands', async () => {
    const deferred = makeDeferredProbe();
    const { renderer, setLive } = makeHarness({
      probe: deferred,
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    // Probe in flight at step 2 (first-run world → setup mode).
    press(renderer, 'advanced-probe-start');
    expect(deferred.calls.length).toBe(1);
    // The old client dies MID-PROBE: no yank — the user keeps their step
    // (nothing is persisted here, so there is no runtime card to lose).
    setLive('failed');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBe(0);
    // The probe settles with success — the result STANDS (no automatic
    // reset happened underneath) and the flow advances to step 3.
    deferred.settle({ ok: true, value: undefined });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-probe-error' }).length,
    ).toBe(0);
  });

  // ---- AD-5: draft-bound probe results ---------------------------------
  it('a late probe result after a draft edit is DROPPED (can never unlock step 3)', async () => {
    const deferred = makeDeferredProbe();
    const { renderer } = makeHarness({
      probe: deferred,
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    press(renderer, 'advanced-probe-start');
    expect(deferred.calls.length).toBe(1);
    // The user edits the password mid-probe — the in-flight result is now
    // bound to a stale draft.
    const passwordInput = renderer.root.findByProps({
      testID: 'advanced-password-input',
    });
    act(() => {
      passwordInput.props.onChangeText('changed-secret');
    });
    deferred.settle({ ok: true, value: undefined });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // The stale success is DROPPED: the user stays on step 2 and the
    // loading flag released (the button is pressable again).
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    const probeButton = renderer.root
      .findAllByProps({ testID: 'advanced-probe-start' })
      .find(node => typeof node.props.onPress === 'function');
    expect(probeButton?.props.disabled).toBe(false);
  });

  it('a late probe result after a manual step change is DROPPED', async () => {
    const deferred = makeDeferredProbe();
    const { renderer } = makeHarness({
      probe: deferred,
      persisted: emptySettings(),
    });
    openRenderers.push(renderer);
    press(renderer, 'advanced-probe-start');
    // The user goes back to step 1 while the probe is in flight.
    press(renderer, 'setup-back');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    deferred.settle({ ok: true, value: undefined });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // The stale result can neither advance the flow nor surface errors.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-server' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBe(0);
  });

  // ---- B2: the session position/mode survive remount -------------------
  it('the wizard position AND mode survive leave/return within the session', async () => {
    // Visit 1: fill the draft via mDNS select (advances immediately),
    // then "leave".
    const first = makeHarness({
      draft: emptySettings(),
      persisted: emptySettings(),
    });
    const { renderer, discovery: d1 } = first;
    if (d1 === null) {
      throw new Error('discovery expected');
    }
    press(renderer, 'advanced-mdns-scan-start');
    d1.deliver({ ok: true, value: [SERVER] });
    press(renderer, 'advanced-mdns-choose-0');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-step-auth' }).length,
    ).toBeGreaterThan(0);
    act(() => {
      renderer.unmount();
    });
    openRenderers.length = 0; // unmounted manually above

    // Visit 2: a fresh mount restores the stored position (step 2). The
    // in-flight draft carries a host (the wizard store persists only the
    // POSITION, not the form values) so the visit-2 save can actually
    // persist a config.
    const second = makeHarness({
      draft: settings(),
      persisted: emptySettings(),
    });
    openRenderers.push(second.renderer);
    expect(
      second.renderer.root.findAllByProps({ testID: 'advanced-step-auth' })
        .length,
    ).toBeGreaterThan(0);

    // Drive to step 3 and save — the mode becomes Trạng thái.
    await pressAsync(second.renderer, 'advanced-probe-start');
    press(second.renderer, 'setup-save');
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      second.renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' })
        .length,
    ).toBeGreaterThan(0);
    act(() => {
      second.renderer.unmount();
    });
    openRenderers.length = 0;

    const third = makeHarness({
      draft: settings(),
      persisted: settings(),
    });
    openRenderers.push(third.renderer);
    // The stored mode is `status` — the remount restores the status mode
    // (never an independently selectable tab; never setup Step 1).
    expect(
      third.renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      third.renderer.root.findAllByProps({ testID: 'advanced-step-completion' })
        .length,
    ).toBe(0);
  });
});

describe('AdvancedSettingsScreen status-mode share button (dashboard-history-board-touch-share)', () => {
  /** Persisted settings WITH MQTT credentials (the share payload's source). */
  const persistedWithCreds: AppSettings = settings({
    mqtt: {
      host: '192.168.100.3',
      port: 9001,
      username: 'admin',
      password: 'mqtt-pw',
      prefix: 'home',
    },
  });
  const shareSpy = jest.spyOn(Share, 'share');

  beforeEach(() => {
    shareSpy.mockReset();
    shareSpy.mockResolvedValue({ action: 'sharedAction' });
  });

  function flatStyle(style: unknown): Record<string, unknown> {
    const layers = Array.isArray(style) ? style : [style];
    return Object.assign(
      {},
      ...(layers.filter(
        layer => layer !== null && typeof layer === 'object',
      ) as Record<string, unknown>[]),
    );
  }

  it('renders the ≥44pt `Chia sẻ cấu hình` button in the post-save status mode only', () => {
    const harness = makeHarness({ persisted: persistedWithCreds });
    openRenderers.push(harness.renderer);

    const node = harness.renderer.root
      .findAllByProps({ testID: 'status-share-config' })
      .find(candidate => typeof candidate.props.onPress === 'function');
    expect(node).toBeTruthy();
    expect(
      flatStyle(node!.props.style).minHeight as number,
    ).toBeGreaterThanOrEqual(44);
    // The label comes from STRINGS — visible screen text.
    expect(
      harness.renderer.root.findByProps({
        children: STRINGS.settings.shareConfigAction,
      }),
    ).toBeTruthy();
  });

  it('shares the persisted MQTT fields AND the Influx fields including the token', async () => {
    const harness = makeHarness({ persisted: persistedWithCreds });
    openRenderers.push(harness.renderer);

    await act(async () => {
      harness.renderer.root
        .findAllByProps({ testID: 'status-share-config' })
        .find(candidate => typeof candidate.props.onPress === 'function')!
        .props.onPress();
    });

    expect(shareSpy).toHaveBeenCalledTimes(1);
    const message = shareSpy.mock.calls[0][0].message as string;
    expect(message).toContain('192.168.100.3');
    expect(message).toContain('9001');
    expect(message).toContain('admin');
    expect(message).toContain('mqtt-pw');
    expect(message).toContain('http://influx.local:8086');
    expect(message).toContain('iot');
    expect(message).toContain('sensors');
    expect(message).toContain('tok');
  });

  it('never renders the Influx token as screen text', () => {
    const harness = makeHarness({ persisted: persistedWithCreds });
    openRenderers.push(harness.renderer);

    const allText = harness.renderer.root
      .findAllByType(Text)
      .map(node => String(node.props.children))
      .join('\n');
    expect(allText).not.toContain('tok');
  });

  it('setup steps 1–3 never show the share button', () => {
    for (const step of [1, 2, 3] as const) {
      getWizardSessionStore().setState({
        mode: 'setup',
        currentStep: step,
        savedOk: false,
      });
      const harness = makeHarness({ persisted: persistedWithCreds });
      openRenderers.push(harness.renderer);
      expect(
        harness.renderer.root.findAllByProps({ testID: 'status-share-config' })
          .length,
      ).toBe(0);
    }
  });

  it('a share failure changes nothing (no crash, no mode/step transition)', async () => {
    shareSpy.mockRejectedValue(new Error('user cancelled'));
    const harness = makeHarness({ persisted: persistedWithCreds });
    openRenderers.push(harness.renderer);

    await act(async () => {
      harness.renderer.root
        .findAllByProps({ testID: 'status-share-config' })
        .find(candidate => typeof candidate.props.onPress === 'function')!
        .props.onPress();
    });

    expect(shareSpy).toHaveBeenCalledTimes(1);
    // Still in status mode — the status card is still mounted.
    expect(
      harness.renderer.root.findAllByProps({ testID: 'advanced-mqtt-status' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      harness.renderer.root.findAllByProps({ testID: 'status-edit-config' })
        .length,
    ).toBeGreaterThan(0);
  });
});
