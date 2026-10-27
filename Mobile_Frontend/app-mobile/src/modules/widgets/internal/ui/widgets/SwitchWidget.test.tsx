/**
 * SwitchWidget tests (dashboard-smart-home-redesign anatomy).
 *
 * Optimistic toggle: the rendered switch flips IMMEDIATELY on tap via a
 * local optimistic override — even while the relay is offline / before any
 * feedback arrives — instead of waiting on the committed store value. When
 * `sendCommand` fails, the override rolls back to the committed value and
 * the failure reason is shown inline. When the committed feedback catches up
 * with the override, the override is cleared so later external state changes
 * stay visible.
 *
 * Title fallback chain (M2 title fix): `config.title ?? bound device name ??
 * capability label ?? generic switch label` — seeded widgets carry no title,
 * so the bound DEVICE name ("Đèn"/"Quạt") must win over the capability label
 * ("Công tắc") without any data reset.
 *
 * Smart Home states (approved + amendments 2–3): ON = the TEAL accent
 * (track + icon; an explicitly defined catalog color keeps its precedence),
 * OFF = neutral gray, UNKNOWN (no state entry at all) = muted neutral
 * rendering at reduced opacity — visually DISTINCT from OFF — with the
 * visible "Chưa rõ trạng thái" caption under the device name and the
 * accessible value text stating the unknown status (never plain OFF).
 * OFFLINE = the switch DISABLED + the "Không thể điều khiển" caption, with
 * the ICON kept visually clear (amendment 3 — only the switch wrapper
 * stays muted). Tapping an unknown switch still toggles optimistically and
 * rolls back on a command error. The per-device glyph resolves per icon
 * FAMILY (Quạt's `fan` renders via MaterialCommunityIcons).
 */

import React from 'react';
import { Text, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';
import { Errors, err, ok, type AppError, type Result } from '@core/errors';
import type {
  CapabilityDef,
  Device,
  DeviceCapabilityValue,
  Room,
  SeriesPoint,
} from '@modules/devices/api';

import type { WidgetConfig } from '../../domain/widgetTypes';
import {
  WidgetServicesProvider,
  type WidgetConnectionState,
  type WidgetServices,
} from '../widgetContext';
import { SwitchWidget } from './SwitchWidget';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const CATALOG: readonly CapabilityDef[] = [
  // The capability def icon ('toggle-outline') is deliberately DIFFERENT
  // from the seeded per-device glyphs so the resolution order is provable.
  { type: 'switch', label: 'Công tắc', kind: 'switch', icon: 'toggle-outline' },
];

const ROOMS: readonly Room[] = [
  { id: 'room-l', name: 'Phòng', order: 0, icon: 'home-outline' },
];

/** Seed-shaped relay devices (relay-1 = Đèn, relay-2 = Quạt) with their
 * per-device glyphs (scope amendment 2). */
const DEVICES: readonly Device[] = [
  {
    id: 'relay-1',
    name: 'Đèn',
    roomId: 'room-l',
    type: 'relay',
    capabilities: ['switch'],
    icon: 'bulb-outline',
    binding: { kind: 'relay', index: 1 },
  },
  {
    id: 'relay-2',
    name: 'Quạt',
    roomId: 'room-l',
    type: 'relay',
    capabilities: ['switch'],
    // Scope amendment 3: the REAL fan glyph (MaterialCommunityIcons).
    icon: 'fan',
    binding: { kind: 'relay', index: 2 },
  },
];

const NO_SERIES: readonly SeriesPoint[] = [];

const CONFIG: WidgetConfig = {
  id: 'w-switch',
  type: 'switch',
  binding: { deviceId: 'relay-1', capability: 'switch' },
  layout: { x: 0, y: 0, width: 1, height: 1 },
};

/**
 * Controllable services: the committed value and the live MQTT connection
 * live in single stable snapshots (`useSyncExternalStore` requires
 * identity stability) and can be driven by the test to simulate relay
 * feedback, external changes and connection drops.
 */
function makeControllableServices(options: {
  initial: boolean | undefined;
  sendResult: Result<void, AppError>;
  devices?: readonly Device[];
  capabilities?: readonly CapabilityDef[];
  /** Initial MQTT connection state (default `connected`). */
  connection?: WidgetConnectionState['state'];
}): {
  services: WidgetServices;
  setCommitted: (next: boolean | undefined) => void;
  setCommandError: (message: string | null) => void;
  setConnection: (next: WidgetConnectionState['state']) => void;
} {
  let state: DeviceCapabilityValue | undefined =
    options.initial === undefined
      ? undefined
      : { value: options.initial, updatedAt: 1000 };
  const listeners = new Set<() => void>();
  // Stable connection snapshots per state (identity stability).
  const CONNECTION_SNAPSHOTS: Record<
    WidgetConnectionState['state'],
    WidgetConnectionState
  > = {
    connected: { state: 'connected', label: 'Đã kết nối' },
    failed: { state: 'failed', label: 'Mất kết nối' },
    connecting: { state: 'connecting', label: 'Đang kết nối…' },
    reconnecting: { state: 'reconnecting', label: 'Đang kết nối lại…' },
    idle: { state: 'idle', label: 'Mất kết nối' },
  };
  let connection = CONNECTION_SNAPSHOTS[options.connection ?? 'connected']!;
  const connectionListeners = new Set<() => void>();
  // Async command-error channel (M13-4): rides the SAME listener set as the
  // device state (one store, one notify) so the hook re-renders on error
  // transitions.
  let commandError: string | null = null;
  const services: WidgetServices = {
    getState: () => state,
    getSeries: () => NO_SERIES,
    sendCommand: () => options.sendResult,
    getCommandError: () => commandError,
    queryHistory: async () => ok([]),
    getRooms: () => ROOMS,
    getDevices: () => options.devices ?? [],
    getCapabilities: () => options.capabilities ?? CATALOG,
    getActiveRoomId: () => 'room-l',
    subscribeDeviceState: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getConnectionState: () => connection,
    subscribeConnection: listener => {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
  };
  const setCommitted = (next: boolean | undefined) => {
    state = next === undefined ? undefined : { value: next, updatedAt: 2000 };
    for (const listener of listeners) {
      listener();
    }
  };
  const setCommandError = (message: string | null) => {
    commandError = message;
    for (const listener of listeners) {
      listener();
    }
  };
  const setConnection = (next: WidgetConnectionState['state']) => {
    connection = CONNECTION_SNAPSHOTS[next]!;
    for (const listener of connectionListeners) {
      listener();
    }
  };
  return { services, setCommitted, setCommandError, setConnection };
}

async function renderSwitch(services: WidgetServices) {
  return renderSwitchWith(CONFIG, services);
}

async function renderSwitchWith(
  config: WidgetConfig,
  services: WidgetServices,
  mode: 'light' | 'dark' = 'light',
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <WidgetServicesProvider services={services}>
          <SwitchWidget config={config} />
        </WidgetServicesProvider>
      </ThemeProvider>,
    );
  });
  return renderer;
}

/**
 * The DRAWN switch control (dashboard-history-board-touch-share): a
 * Pressable carrying the switch accessibility semantics — the platform
 * `Switch` is gone. Every state/behavior assertion below rides this seam.
 */
function findSwitchControl(
  renderer: TestRenderer.ReactTestRenderer,
): TestRenderer.ReactTestInstance {
  const control = renderer.root
    .findAllByProps({ accessibilityRole: 'switch' })
    .find(node => typeof node.props.onPress === 'function');
  if (!control) {
    throw new Error('Drawn switch control not found');
  }
  return control;
}

/** The painted track (teal ON / neutral gray OFF). */
function findTrack(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'switch-track' });
}

/** The painted thumb (on-primary ON / surface OFF). */
function findThumb(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'switch-thumb' });
}

/** Tap the drawn control (fires the same handler a real press does). */
async function pressSwitch(
  renderer: TestRenderer.ReactTestRenderer,
): Promise<void> {
  await act(async () => {
    findSwitchControl(renderer).props.onPress();
  });
}

/** The value currently rendered on the drawn switch (checked state). */
function renderedValue(renderer: TestRenderer.ReactTestRenderer): boolean {
  const state = findSwitchControl(renderer).props.accessibilityState as Record<
    string,
    boolean
  >;
  return state.checked;
}

/** All text rendered by the widget (title + optional inline error). */
function renderedText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .filter((child): child is string => typeof child === 'string')
    .join('\n');
}

/** Flatten an RN style (object or array of objects) into one plain object. */
function flatStyles(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  return Object.assign(
    {},
    ...(layers.filter(
      layer => layer !== null && typeof layer === 'object',
    ) as Record<string, unknown>[]),
  );
}

describe('SwitchWidget compact card anatomy (gel follow-up)', () => {
  it('renders the friendly title only — the bound device id is not visible', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    // Friendly device name stays; the technical relay id is gone.
    expect(renderedText(renderer)).toContain('Đèn');
    expect(renderedText(renderer)).not.toContain('relay-1');
    expect(renderedText(renderer)).not.toContain('relay-2');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders no visible Đang bật/Đang tắt caption in either state', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    // OFF: no status caption.
    expect(renderedText(renderer)).not.toContain(STRINGS.widgets.off);

    // Relay feedback arrives (ON): still no status caption.
    await act(async () => {
      setCommitted(true);
    });
    expect(renderedText(renderer)).not.toContain(STRINGS.widgets.on);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('exposes ON/OFF through the switch accessibility state and value', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    const switchProps = () => findSwitchControl(renderer).props;
    // The accessible name is the friendly title; the ON/OFF state rides the
    // switch semantics (checked) + accessible value text (the kept
    // STRINGS.widgets.on/off) — never redundant visual copy.
    expect(switchProps().accessibilityLabel).toBe('Đèn');
    expect(switchProps().accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(switchProps().accessibilityValue).toEqual({
      text: STRINGS.widgets.off,
    });

    // Optimistic flip: accessibility state follows the rendered value
    // immediately (before any relay feedback).
    await pressSwitch(renderer);
    expect(switchProps().accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    expect(switchProps().accessibilityValue).toEqual({
      text: STRINGS.widgets.on,
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('uses the teal track for ON and the neutral track for OFF', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    const trackColor = () =>
      flatStyles(findTrack(renderer).props.style).backgroundColor;
    expect(trackColor()).toBe(LIGHT_TOKENS.smart.colors.neutral);

    await act(async () => {
      setCommitted(true);
    });
    expect(trackColor()).toBe(LIGHT_TOKENS.smart.colors.teal);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the relay icon glyph neutral while OFF and teal while ON', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    // The built-in switch capability carries NO explicit color → the glyph
    // must follow the state-aware semantic rule (NOT the brand blue).
    const glyphColor = () =>
      renderer.root.findAllByType(Ionicons)[0].props.color as string;
    expect(glyphColor()).toBe(LIGHT_TOKENS.smart.colors.neutral);

    // Relay feedback arrives → the glyph turns the teal active accent.
    await act(async () => {
      setCommitted(true);
    });
    expect(glyphColor()).toBe(LIGHT_TOKENS.smart.colors.teal);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('flips the icon glyph color immediately with the optimistic override', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    const glyphColor = () =>
      renderer.root.findAllByType(Ionicons)[0].props.color as string;
    expect(glyphColor()).toBe(LIGHT_TOKENS.smart.colors.neutral);

    await pressSwitch(renderer);
    // Optimistic: the glyph shows the teal accent before any feedback.
    expect(glyphColor()).toBe(LIGHT_TOKENS.smart.colors.teal);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('preserves an explicit capability color for the icon glyph (both states)', async () => {
    // A user-defined catalog color is an intentional per-capability
    // contract — it must win over the state-aware semantic fallback in BOTH
    // states (same precedence as resolveCapabilityAccent).
    const coloredCatalog: readonly CapabilityDef[] = [
      {
        type: 'switch',
        label: 'Công tắc',
        kind: 'switch',
        icon: 'bulb-outline',
        color: '#123456',
      },
    ];
    const { services, setCommitted } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
      capabilities: coloredCatalog,
    });
    const renderer = await renderSwitch(services);
    const glyphColor = () =>
      renderer.root.findAllByType(Ionicons)[0].props.color as string;
    expect(glyphColor()).toBe('#123456');

    await act(async () => {
      setCommitted(true);
    });
    expect(glyphColor()).toBe('#123456');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget optimistic toggle', () => {
  it('flips immediately on tap while connected with no feedback yet', async () => {
    // Connected + no committed state at all (device never reported) and
    // the command is accepted for delivery — the switch must still flip
    // optimistically (the amendment-2 offline lock only binds while the
    // MQTT connection is NOT live).
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    expect(renderedValue(renderer)).toBe(false);

    await pressSwitch(renderer);
    // The optimistic override flipped the switch with NO state change.
    expect(renderedValue(renderer)).toBe(true);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('rolls the override back and shows the inline error when sendCommand fails', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: err(Errors.network('MQTT chưa kết nối')),
    });
    const renderer = await renderSwitch(services);
    expect(renderedValue(renderer)).toBe(false);

    await pressSwitch(renderer);
    // Rolled back to the committed value (no stuck optimistic flip)...
    expect(renderedValue(renderer)).toBe(false);
    // ...and the failure reason is shown inline.
    expect(renderedText(renderer)).toContain('MQTT chưa kết nối');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('clears the override once the committed feedback matches', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    expect(renderedValue(renderer)).toBe(false);

    await pressSwitch(renderer);
    expect(renderedValue(renderer)).toBe(true);

    // Relay feedback arrives: committed === override → override cleared.
    await act(async () => {
      setCommitted(true);
    });
    expect(renderedValue(renderer)).toBe(true);

    // A later EXTERNAL change (feedback back to false) must be visible —
    // proof the override no longer masks the committed value.
    await act(async () => {
      setCommitted(false);
    });
    expect(renderedValue(renderer)).toBe(false);

    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget UNKNOWN state (never plain OFF)', () => {
  /** Flatten an RN style (object or array of objects) into one object. */
  const flat = (style: unknown): Record<string, unknown> =>
    Object.assign(
      {},
      ...((Array.isArray(style) ? style : [style]).filter(
        layer => layer !== null && typeof layer === 'object',
      ) as Record<string, unknown>[]),
    );

  it('renders muted + distinct from OFF with the unknown accessible value', async () => {
    // No state entry at all (device never reported) → UNKNOWN.
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    const switchNode = findSwitchControl(renderer);
    // Muted: the switch renders at reduced opacity (distinct from OFF at
    // full opacity)…
    expect(flat(switchNode.parent!.props.style).opacity).toBeLessThan(1);
    // …and the accessible value STATES the unknown status (never OFF).
    expect(switchNode.props.accessibilityValue).toEqual({
      text: STRINGS.widgets.stateUnknown,
    });
    expect(switchNode.props.accessibilityValue.text).not.toBe(
      STRINGS.widgets.off,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps OFF at full opacity with the regular off accessible value', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    const switchNode = findSwitchControl(renderer);
    expect(flat(switchNode.parent!.props.style).opacity).toBeUndefined();
    expect(switchNode.props.accessibilityValue).toEqual({
      text: STRINGS.widgets.off,
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('still toggles optimistically from UNKNOWN and renders the ON accent', async () => {
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    // Tap the unknown switch → the optimistic flip takes over (teal ON).
    await pressSwitch(renderer);
    expect(renderedValue(renderer)).toBe(true);
    expect(flatStyles(findTrack(renderer).props.style).backgroundColor).toBe(
      LIGHT_TOKENS.smart.colors.teal,
    );
    expect(findSwitchControl(renderer).props.accessibilityValue).toEqual({
      text: STRINGS.widgets.on,
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('rolls an unknown-state tap back to the muted UNKNOWN on command error', async () => {
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: err(Errors.network('MQTT chưa kết nối')),
    });
    const renderer = await renderSwitch(services);
    await pressSwitch(renderer);
    // Rolled back: muted UNKNOWN rendering + inline error, no stuck flip.
    expect(renderedValue(renderer)).toBe(false);
    expect(
      flat(findSwitchControl(renderer).parent!.props.style).opacity,
    ).toBeLessThan(1);
    expect(renderedText(renderer)).toContain('MQTT chưa kết nối');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('leaves UNKNOWN once relay feedback arrives', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    expect(
      flat(findSwitchControl(renderer).parent!.props.style).opacity,
    ).toBeLessThan(1);
    // Feedback arrives (ON) → full-opacity teal ON, regular on value.
    await act(async () => {
      setCommitted(true);
    });
    const switchNode = findSwitchControl(renderer);
    expect(flat(switchNode.parent!.props.style).opacity).toBeUndefined();
    expect(switchNode.props.accessibilityValue).toEqual({
      text: STRINGS.widgets.on,
    });
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget title fallback (M2 title fix)', () => {
  it('shows the bound DEVICE name for a title-less seeded widget', async () => {
    // Seed shape: no config.title → the device name (relay-1 = "Đèn") must
    // win over the capability label ("Công tắc") — no data reset needed.
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    expect(renderedText(renderer)).toContain('Đèn');
    expect(renderedText(renderer)).not.toContain('Công tắc');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('resolves the device name per binding (relay-2 = "Quạt")', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, binding: { deviceId: 'relay-2', capability: 'switch' } },
      services,
    );
    expect(renderedText(renderer)).toContain('Quạt');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('prefers config.title over the device name', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, title: 'Đèn phòng khách' },
      services,
    );
    expect(renderedText(renderer)).toContain('Đèn phòng khách');
    expect(renderedText(renderer)).not.toContain('Công tắc');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('falls back to the capability label when the device is unknown', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: [], // binding points at a device no longer registered
    });
    const renderer = await renderSwitch(services);
    expect(renderedText(renderer)).toContain('Công tắc');

    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget reflow (no data-hiding clamps — fix cycle 1)', () => {
  it('carries NO numberOfLines clamp on any text (font-scale reflow)', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: err(Errors.network('MQTT chưa kết nối')),
    });
    const renderer = await renderSwitch(services);
    // Trigger the inline error too — the error line must be unclamped.
    await pressSwitch(renderer);
    const texts = renderer.root.findAllByType(Text);
    expect(texts.length).toBeGreaterThan(1); // title + error
    for (const node of texts) {
      expect(node.props.numberOfLines).toBeUndefined();
    }
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders a LONG title and a LONG inline error in full (nothing truncated)', async () => {
    const LONG_TITLE =
      'Đèn trần phòng khách lớn khu vực bàn ăn cạnh cửa sổ hướng vườn';
    const LONG_ERROR =
      'MQTT chưa kết nối — lệnh không thể gửi đến relay-1, vui lòng kiểm tra broker và kết nối mạng rồi thử lại sau khi trạng thái được khôi phục.';
    const { services } = makeControllableServices({
      initial: false,
      sendResult: err(Errors.network(LONG_ERROR)),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, title: LONG_TITLE },
      services,
    );
    await pressSwitch(renderer);
    const text = renderedText(renderer);
    expect(text).toContain(LONG_TITLE);
    expect(text).toContain(LONG_ERROR);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget dark-mode smart anatomy (rendered values)', () => {
  it('renders the dark neutral OFF track + dark text/icon chip colors', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(CONFIG, services, 'dark');
    expect(flatStyles(findTrack(renderer).props.style).backgroundColor).toBe(
      DARK_TOKENS.smart.colors.neutral,
    );
    // Title text uses the dark smart textPrimary.
    const titleNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Đèn');
    expect(flatStyles(titleNode!.props.style).color).toBe(
      DARK_TOKENS.smart.colors.textPrimary,
    );
    // Icon chip sits on the dark smart page tint with the dark border.
    const chipNode = renderer.root.findAllByType(View).find(view => {
      const style = flatStyles(view.props.style);
      return (
        style.width === 40 &&
        style.height === 40 &&
        style.borderColor === DARK_TOKENS.smart.colors.cardBorder
      );
    });
    expect(flatStyles(chipNode!.props.style).backgroundColor).toBe(
      DARK_TOKENS.smart.colors.page,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the dark teal ON track once the relay feedback arrives', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(CONFIG, services, 'dark');
    await act(async () => {
      setCommitted(true);
    });
    expect(flatStyles(findTrack(renderer).props.style).backgroundColor).toBe(
      DARK_TOKENS.smart.colors.teal,
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget offline lock (scope amendment 2)', () => {
  it('disables the switch with the visible "Không thể điều khiển" caption when offline', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      connection: 'failed',
    });
    const renderer = await renderSwitch(services);
    const switchNode = findSwitchControl(renderer);
    // The switch is disabled…
    expect(switchNode.props.disabled).toBe(true);
    expect(switchNode.props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });
    // …the lock caption is VISIBLE text…
    expect(renderedText(renderer)).toContain(STRINGS.widgets.offlineCaption);
    // …and the accessible value states the lock (never plain OFF).
    expect(switchNode.props.accessibilityValue).toEqual({
      text: STRINGS.widgets.offlineCaption,
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the ICON visually clear while offline (amendment 3); the switch wrapper stays muted', async () => {
    const { services } = makeControllableServices({
      initial: true,
      sendResult: ok(undefined),
      connection: 'reconnecting',
    });
    const renderer = await renderSwitch(services);
    const switchNode = findSwitchControl(renderer);
    // The switch wrapper keeps the muted distinct styling…
    expect(flatStyles(switchNode.parent!.props.style).opacity).toBeLessThan(1);
    // …but the ICON CHIP is at FULL opacity — the disabled switch + the
    // "Không thể điều khiển" caption carry the offline signal (scope
    // amendment 3: no opacity muting on the glyph).
    const chip = renderer.root.findAllByType(View).find(view => {
      const style = flatStyles(view.props.style);
      return style.width === 40 && style.height === 40;
    });
    expect(chip).toBeTruthy();
    expect(flatStyles(chip!.props.style).opacity).toBe(1);
    expect(renderedText(renderer)).toContain(STRINGS.widgets.offlineCaption);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the icon chip FULL opacity when offline AND unconfirmed (offline wins for the glyph)', async () => {
    // Reviewer-6 regression: the offline ∩ unconfirmed intersection. The
    // connection is down AND no relay state has ever been confirmed — the
    // offline lock (disabled switch + "Không thể điều khiển" caption) is
    // fully present and the switch wrapper stays muted, but the GLYPH must
    // NOT fall into the 0.45 connected-unknown muting: offline WINS for
    // the icon chip (scope amendment 3 icon clarity).
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
      connection: 'failed',
    });
    const renderer = await renderSwitch(services);
    const switchNode = findSwitchControl(renderer);
    // The offline lock: disabled switch + the visible lock caption…
    expect(switchNode.props.disabled).toBe(true);
    expect(renderedText(renderer)).toContain(STRINGS.widgets.offlineCaption);
    // …the switch wrapper keeps the muted distinct offline styling…
    expect(flatStyles(switchNode.parent!.props.style).opacity).toBeLessThan(1);
    // …while the ICON CHIP is at FULL opacity (NOT the unknown muting).
    const chip = renderer.root.findAllByType(View).find(view => {
      const style = flatStyles(view.props.style);
      return style.width === 40 && style.height === 40;
    });
    expect(chip).toBeTruthy();
    expect(flatStyles(chip!.props.style).opacity).toBe(1);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('never flips optimistically while offline (supersedes optimistic-offline)', async () => {
    const sendCommand = jest.fn(() => ok(undefined));
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      connection: 'failed',
    });
    // The sendCommand spy rides the fake: rebuild the services with it.
    const spied: WidgetServices = {
      ...services,
      sendCommand,
    };
    const renderer = await renderSwitch(spied);
    await pressSwitch(renderer);
    // Disabled switch → no command, no optimistic flip, caption stays.
    expect(sendCommand).not.toHaveBeenCalled();
    expect(renderedValue(renderer)).toBe(false);
    expect(renderedText(renderer)).toContain(STRINGS.widgets.offlineCaption);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('re-enables the switch when the connection comes back (live seam)', async () => {
    const { services, setConnection } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      connection: 'failed',
    });
    const renderer = await renderSwitch(services);
    expect(findSwitchControl(renderer).props.disabled).toBe(true);

    // The MQTT connection recovers → the switch is operational again and
    // the lock caption disappears (the unknown caption takes over only if
    // there is still no confirmed state).
    await act(async () => {
      setConnection('connected');
    });
    const switchNode = findSwitchControl(renderer);
    expect(switchNode.props.disabled).toBe(false);
    expect(renderedText(renderer)).not.toContain(
      STRINGS.widgets.offlineCaption,
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget visible unknown caption (scope amendment 2)', () => {
  it('shows "Chưa rõ trạng thái" as VISIBLE text while connected-unknown', async () => {
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    // Visible caption (not only opacity/a11y)…
    expect(renderedText(renderer)).toContain(STRINGS.widgets.unknownCaption);
    // …muted distinct rendering…
    expect(
      flatStyles(findSwitchControl(renderer).parent!.props.style).opacity,
    ).toBeLessThan(1);
    // …and the a11y value still states the unknown status (never OFF).
    expect(findSwitchControl(renderer).props.accessibilityValue).toEqual({
      text: STRINGS.widgets.stateUnknown,
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('shows no state caption once a confirmed state exists', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    expect(renderedText(renderer)).toContain(STRINGS.widgets.unknownCaption);
    await act(async () => {
      setCommitted(true);
    });
    expect(renderedText(renderer)).not.toContain(
      STRINGS.widgets.unknownCaption,
    );
    expect(renderedText(renderer)).not.toContain(
      STRINGS.widgets.offlineCaption,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('prefers the offline lock caption over the unknown caption', async () => {
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
      connection: 'failed',
    });
    const renderer = await renderSwitch(services);
    expect(renderedText(renderer)).toContain(STRINGS.widgets.offlineCaption);
    expect(renderedText(renderer)).not.toContain(
      STRINGS.widgets.unknownCaption,
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget per-device glyph (scope amendment 2)', () => {
  it('renders the per-DEVICE icon over the capability icon (Đèn → bulb)', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    // relay-1 carries the per-device 'bulb-outline'; the capability def
    // icon is 'toggle-outline' — the DEVICE icon must win.
    expect(renderer.root.findAllByType(Ionicons)[0].props.name).toBe(
      'bulb-outline',
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('resolves the fan glyph per binding (Quạt → MCI `fan`)', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, binding: { deviceId: 'relay-2', capability: 'switch' } },
      services,
    );
    // Scope amendment 3: `fan` renders via MaterialCommunityIcons (its own
    // family) — never as a (missing) Ionicons glyph.
    const mci = renderer.root.findAllByType(MaterialCommunityIcons);
    expect(mci).toHaveLength(1);
    expect(mci[0]!.props.name).toBe('fan');
    expect(
      renderer.root.findAllByType(Ionicons).map(node => node.props.name),
    ).not.toContain('fan');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('falls back to the capability def icon when the device has none', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: [
        {
          id: 'relay-9',
          name: 'Bơm',
          roomId: 'room-l',
          type: 'relay',
          capabilities: ['switch'],
          binding: { kind: 'relay', index: 9 },
        },
      ],
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, binding: { deviceId: 'relay-9', capability: 'switch' } },
      services,
    );
    expect(renderer.root.findAllByType(Ionicons)[0].props.name).toBe(
      'toggle-outline',
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('falls back to the widget default when neither source defines a glyph', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: [],
      capabilities: [{ type: 'switch', label: 'Công tắc', kind: 'switch' }],
    });
    const renderer = await renderSwitch(services);
    expect(renderer.root.findAllByType(Ionicons)[0].props.name).toBe(
      'power-outline',
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('ignores a stale unknown device glyph (validated against Ionicons)', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: [
        {
          id: 'relay-1',
          name: 'Đèn',
          roomId: 'room-l',
          type: 'relay',
          capabilities: ['switch'],
          icon: 'not-a-real-glyph',
          binding: { kind: 'relay', index: 1 },
        },
      ],
    });
    const renderer = await renderSwitch(services);
    // The unknown name falls through to the capability def icon.
    expect(renderer.root.findAllByType(Ionicons)[0].props.name).toBe(
      'toggle-outline',
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget caption placement + icon clarity (scope amendment 3)', () => {
  it('stacks the state caption UNDER the device name (same name column)', async () => {
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, binding: { deviceId: 'relay-1', capability: 'switch' } },
      services,
    );
    const titleText = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Đèn');
    const captionText = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === STRINGS.widgets.unknownCaption);
    expect(titleText).toBeTruthy();
    expect(captionText).toBeTruthy();
    // The caption is a DIRECT SIBLING of the title inside the same name
    // column (icon chip left, switch right) — not a row-level footer.
    expect(captionText!.parent).toBe(titleText!.parent);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the connected-UNKNOWN icon muted (only offline gains clarity)', async () => {
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    const chip = renderer.root.findAllByType(View).find(view => {
      const style = flatStyles(view.props.style);
      return style.width === 40 && style.height === 40;
    });
    expect(flatStyles(chip!.props.style).opacity).toBeLessThan(1);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the card free of fixed heights beyond the switch internals (growth allowed)', async () => {
    const { services } = makeControllableServices({
      initial: undefined,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    // No View carries a fixed height OTHER than the drawn switch's own
    // painted geometry (40pt icon chip, 31pt track, 27pt thumb) — the
    // smart view's per-type floor lives in the grid layer; the card itself
    // stays floor+grow — the caption column can grow without clipping.
    const fixedHeights = renderer.root.findAllByType(View).filter(view => {
      const height = flatStyles(view.props.style).height;
      return (
        typeof height === 'number' &&
        height !== 40 &&
        height !== 31 &&
        height !== 27
      );
    });
    expect(fixedHeights).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget async command error (M13-4 timeout seam)', () => {
  it('renders the async timeout error inline when it appears', async () => {
    const { services, setCommandError } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    expect(renderedText(renderer)).not.toContain('đã hết thời gian chờ');

    // The relay command timed out (relay:commandFailed → store).
    await act(async () => {
      setCommandError('đã hết thời gian chờ');
    });
    expect(renderedText(renderer)).toContain('đã hết thời gian chờ');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('clears the optimistic override when the async error arrives (rolled-back state visible)', async () => {
    const { services, setCommitted, setCommandError } =
      makeControllableServices({
        initial: false,
        sendResult: ok(undefined),
      });
    const renderer = await renderSwitch(services);

    // Optimistic flip: the switch shows ON with no committed state change.
    await pressSwitch(renderer);
    expect(renderedValue(renderer)).toBe(true);

    // Timeout: the store rolled the committed value back to the
    // pre-command state (false) and the error appeared. The override must
    // clear so the ROLLED-BACK state is visible instead of the stale flip.
    await act(async () => {
      setCommitted(false);
      setCommandError('đã hết thời gian chờ');
    });
    expect(renderedValue(renderer)).toBe(false);
    expect(renderedText(renderer)).toContain('đã hết thời gian chờ');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('clears the async error on the next success (store error cleared)', async () => {
    const { services, setCommandError } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);

    await act(async () => {
      setCommandError('đã hết thời gian chờ');
    });
    expect(renderedText(renderer)).toContain('đã hết thời gian chờ');

    // The next successful command/feedback cleared the store error.
    await act(async () => {
      setCommandError(null);
    });
    expect(renderedText(renderer)).not.toContain('đã hết thời gian chờ');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('the synchronous send rejection still wins over a stale async error', async () => {
    const { services, setCommandError } = makeControllableServices({
      initial: false,
      sendResult: err(Errors.network('MQTT chưa kết nối')),
    });
    const renderer = await renderSwitch(services);
    await act(async () => {
      setCommandError('stale');
    });
    await pressSwitch(renderer);
    // The fresh sync rejection replaces the stale async message.
    expect(renderedText(renderer)).toContain('MQTT chưa kết nối');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget narrow-slot compact layout (1x1 editor fix)', () => {
  /** Flat style of an instance (object or array of objects). */
  const isIconChipView = (view: TestRenderer.ReactTestInstance) => {
    const style = flatStyles(view.props.style);
    return style.width === 40 && style.height === 40;
  };

  /** The 40pt soft icon chip (width 40 + height 40 are unique to it). */
  const findIconChip = (renderer: TestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByType(View).find(isIconChipView);

  /**
   * The enclosing flex-ROW view of an instance. Climb stops at the nearest
   * View styled `flexDirection: 'row'` — with the RN jest mocks a `<View>`
   * renders as a component→host fiber pair, so `.parent` alone is NOT the
   * logical parent; the flexDirection guard makes the anchor explicit and
   * the containment queries below topology-proof.
   */
  const enclosingRow = (
    inst: TestRenderer.ReactTestInstance,
  ): TestRenderer.ReactTestInstance => {
    let current: TestRenderer.ReactTestInstance | null = inst.parent;
    while (current !== null) {
      if (
        current.type === View &&
        flatStyles(current.props.style).flexDirection === 'row'
      ) {
        return current;
      }
      current = current.parent;
    }
    throw new Error('No enclosing row view found');
  };

  it('moves the switch to its own row below the identity in the narrow 1x1 layout', async () => {
    // The bug: chip + name column + native switch shared ONE row; a 1x1
    // card left the name column too narrow, so short Vietnamese names
    // wrapped mid-word ("Đèn" → "Đè/n"). The compact presentation must
    // separate the identity row (chip + name) from the switch row.
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, layout: { x: 0, y: 0, width: 1, height: 1 } },
      services,
    );
    const chip = findIconChip(renderer);
    expect(chip).toBeTruthy();
    // The chip's identity row contains NO switch — the switch moved to its
    // own dedicated row below.
    const identityRow = enclosingRow(chip!);
    expect(
      identityRow.findAllByProps({ accessibilityRole: 'switch' }),
    ).toHaveLength(0);
    // That dedicated switch row carries ONLY the switch: no title/caption
    // text and no icon chip (the identity stays in the row above).
    const switchRow = enclosingRow(findSwitchControl(renderer));
    expect(switchRow.findAllByType(Text)).toHaveLength(0);
    expect(switchRow.findAllByType(View).filter(isIconChipView)).toHaveLength(
      0,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the single-row anatomy in the full-width 2x1 layout', async () => {
    // Full-width cards keep the approved one-row anatomy: chip, name
    // column and switch share the same row (no compact reflow).
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, layout: { x: 0, y: 0, width: 2, height: 1 } },
      services,
    );
    const chip = findIconChip(renderer);
    expect(chip).toBeTruthy();
    // One shared row: the chip's row still contains the switch, and the
    // switch's row still contains the icon chip.
    expect(
      enclosingRow(chip!)
        .findAllByProps({ accessibilityRole: 'switch' })
        .filter(n => typeof n.props.onPress === 'function'),
    ).toHaveLength(1);
    const switchRow = enclosingRow(findSwitchControl(renderer));
    expect(switchRow.findAllByType(View).filter(isIconChipView).length).toBe(1);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the full Vietnamese title readable and untruncated in the compact layout', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitchWith(
      { ...CONFIG, binding: { deviceId: 'relay-2', capability: 'switch' } },
      services,
    );
    // The full name stays in the render tree (a structural reflow — never
    // a truncation/ellipsis that hides characters).
    expect(renderedText(renderer)).toContain('Quạt');
    const titleNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Quạt');
    expect(titleNode).toBeTruthy();
    expect(titleNode!.props.numberOfLines).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('pins the switch a11y contract and optimistic toggle in the compact layout', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services); // CONFIG is 1x1 (compact)
    const switchNode = findSwitchControl(renderer);
    // Same accessibility contract as the full-width anatomy.
    expect(switchNode.props.accessibilityLabel).toBe('Đèn');
    expect(switchNode.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(switchNode.props.accessibilityValue).toEqual({
      text: STRINGS.widgets.off,
    });
    // The compact switch stays fully operable (optimistic flip).
    await pressSwitch(renderer);
    expect(renderedValue(renderer)).toBe(true);
    expect(switchNode.props.accessibilityValue).toEqual({
      text: STRINGS.widgets.on,
    });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('leaves the drawn switch control free of scale transforms in the compact layout', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services); // CONFIG is 1x1 (compact)
    // The reflow must not shrink/transform the control — no transform on
    // the control or its wrapper (AD-1: hit target = painted bounds).
    const control = findSwitchControl(renderer);
    expect(flatStyles(control.props.style).transform).toBeUndefined();
    expect(flatStyles(control.parent!.props.style).transform).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SwitchWidget drawn switch control (dashboard-history-board-touch-share)', () => {
  /**
   * AD-1: hit target and painted size are the same bounds. The drawn
   * control must expose EXPLICIT ≥44×44 pressable bounds (minWidth /
   * minHeight — not hitSlop) and the platform Switch must be gone from
   * the tree in BOTH card widths.
   */
  async function renderWidth(width: 1 | 2) {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    return renderSwitchWith(
      { ...CONFIG, layout: { x: 0, y: 0, width, height: 1 } },
      services,
    );
  }

  for (const width of [1, 2] as const) {
    it(`presents an explicit ≥44×44 pressable on a width-${width} card — no platform Switch, no scale`, async () => {
      const renderer = await renderWidth(width);
      // The platform Switch is gone entirely: exactly ONE drawn control
      // (pressable) carries the switch role, and no node carries the RN
      // Switch's prop API (trackColor/onValueChange).
      expect(
        renderer.root
          .findAllByProps({ accessibilityRole: 'switch' })
          .filter(node => typeof node.props.onPress === 'function'),
      ).toHaveLength(1);
      expect(
        renderer.root.findAllByProps({ trackColor: expect.anything() }),
      ).toHaveLength(0);
      expect(
        renderer.root.findAllByProps({ onValueChange: expect.anything() }),
      ).toHaveLength(0);
      const control = findSwitchControl(renderer);
      const style = flatStyles(control.props.style);
      expect(typeof style.minWidth).toBe('number');
      expect(style.minWidth as number).toBeGreaterThanOrEqual(44);
      expect(typeof style.minHeight).toBe('number');
      expect(style.minHeight as number).toBeGreaterThanOrEqual(44);
      // AD-1: no transform:scale — scaling never grows the hit target.
      expect(style.transform).toBeUndefined();
      // The switch semantics ride the drawn control.
      expect(control.props.accessibilityRole).toBe('switch');
      expect(control.props.accessibilityLabel).toBe('Đèn');
      expect(control.props.accessibilityState).toEqual({
        checked: false,
        disabled: false,
      });
      await act(async () => {
        renderer.unmount();
      });
    });
  }

  it('paints the thumb with the on-primary token when ON and the surface token when OFF', async () => {
    const { services, setCommitted } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      devices: DEVICES,
    });
    const renderer = await renderSwitch(services);
    const thumbColor = () =>
      flatStyles(findThumb(renderer).props.style).backgroundColor;
    expect(thumbColor()).toBe(LIGHT_TOKENS.surface);

    await act(async () => {
      setCommitted(true);
    });
    expect(thumbColor()).toBe(LIGHT_TOKENS.onPrimary);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('flips the drawn track+thumb with the optimistic override before feedback', async () => {
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
    });
    const renderer = await renderSwitch(services);
    expect(flatStyles(findTrack(renderer).props.style).backgroundColor).toBe(
      LIGHT_TOKENS.smart.colors.neutral,
    );
    expect(flatStyles(findThumb(renderer).props.style).backgroundColor).toBe(
      LIGHT_TOKENS.surface,
    );
    // Optimistic: the drawn control paints teal + on-primary thumb BEFORE
    // any relay feedback arrives.
    await pressSwitch(renderer);
    expect(flatStyles(findTrack(renderer).props.style).backgroundColor).toBe(
      LIGHT_TOKENS.smart.colors.teal,
    );
    expect(flatStyles(findThumb(renderer).props.style).backgroundColor).toBe(
      LIGHT_TOKENS.onPrimary,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('disables the drawn control offline (no optimistic flip on press)', async () => {
    const sendCommand = jest.fn(() => ok(undefined));
    const { services } = makeControllableServices({
      initial: false,
      sendResult: ok(undefined),
      connection: 'failed',
    });
    const renderer = await renderSwitch({ ...services, sendCommand });
    const control = findSwitchControl(renderer);
    expect(control.props.disabled).toBe(true);
    expect(control.props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });
    await pressSwitch(renderer);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(renderedValue(renderer)).toBe(false);
    await act(async () => {
      renderer.unmount();
    });
  });
});
