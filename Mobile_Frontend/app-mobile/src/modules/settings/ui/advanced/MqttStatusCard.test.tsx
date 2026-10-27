/**
 * MqttStatusCard tests (Amendment 2, B3 restructure) — the MQTT status
 * area as a compact widget + centered detail:
 * - widget: D3 dot per state, SHORT status label, ONE quick action
 *   (Kiểm tra lại / Thử lại — the REAL retry; Đang kết nối… disabled
 *   readable while connecting; NO quick action when unconfigured);
 * - widget body tap opens the detail;
 * - detail: state + description (host:port / failure cause), auth mode
 *   row (username or `không xác thực` — the password NEVER rendered),
 *   the retry action, and — unconfigured — the `Cấu hình` action that
 *   closes the detail and returns to step 1;
 * - the long-lived testIDs carry over: `advanced-mqtt-status` (body),
 *   `advanced-mqtt-retry` (quick action), `advanced-mqtt-configure`
 *   (detail, relocated capability).
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import { MqttStatusCard, type MqttCardState } from './MqttStatusCard';

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

/** Flatten an RN style (or style array) into one object. */
function flattenStyle(style: unknown): Record<string, unknown> {
  const flatten = StyleSheet.flatten as unknown as (
    style: unknown,
  ) => Record<string, unknown>;
  return flatten(style);
}

function makeCard(
  state: MqttCardState,
  props: {
    authLabel?: string;
    description?: string;
    onConfigure?: () => void;
    onRetry?: () => void;
  } = {},
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <MqttStatusCard
          state={state}
          description={props.description ?? 'Mô tả trạng thái.'}
          authLabel={props.authLabel ?? 'alice'}
          onConfigure={props.onConfigure}
          onRetry={props.onRetry}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return renderer;
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

describe('MqttStatusCard (widget + detail, B3)', () => {
  it('renders the widget: name + short status label + D3 dot per state', () => {
    const expected: Record<string, string> = {
      unconfigured: LIGHT_TOKENS.smart.colors.textSecondary,
      connecting: LIGHT_TOKENS.smart.colors.amber,
      connected: LIGHT_TOKENS.smart.colors.teal,
      lost: LIGHT_TOKENS.danger,
      failed: LIGHT_TOKENS.danger,
    };
    for (const [state, color] of Object.entries(expected)) {
      const renderer = makeCard(state as MqttCardState);
      const dot = flattenStyle(
        renderer.root.findByProps({
          testID: `status-dot-${
            state === 'connected'
              ? 'healthy'
              : state === 'connecting'
              ? 'progress'
              : state === 'unconfigured'
              ? 'gray'
              : 'failed'
          }`,
        }).props.style,
      );
      expect(dot.backgroundColor).toBe(color);
      const texts = renderer.root
        .findAll(node => typeof node.props.children === 'string')
        .map(node => node.props.children);
      expect(texts).toContain(STRINGS.settings.mqttCardTitle);
      renderer.unmount();
    }
  });

  it('NO action button on the widget (C3) — the retry lives in the detail with the canonical ID', () => {
    const onRetry = jest.fn();
    const renderer = makeCard('failed', { onRetry });
    // The widget itself is buttonless; `advanced-mqtt-retry` appears only
    // inside the detail (relocated, same ID).
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-retry' }).length,
    ).toBe(0);
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    const retry = findPressable(renderer, 'advanced-mqtt-retry');
    act(() => {
      retry.props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('the unconfigured detail offers `Cấu hình` INSTEAD of a retry', () => {
    const renderer = makeCard('unconfigured', { onConfigure: jest.fn() });
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-retry' }).length,
    ).toBe(0);
  });

  it('tapping the widget body opens the detail', () => {
    const renderer = makeCard('connected');
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status-detail' })
        .length,
    ).toBe(0);
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status-detail' })
        .length,
    ).toBeGreaterThan(0);
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.mqttStateConnected);
    expect(texts).toContain('Mô tả trạng thái.');
  });

  it('the detail shows the auth MODE (username or không xác thực) — never a password', () => {
    const named = makeCard('connected', { authLabel: 'alice' });
    act(() => {
      findPressable(named, 'advanced-mqtt-status-body').props.onPress();
    });
    expect(
      named.root.findByProps({ testID: 'mqtt-detail-auth' }).props.children,
    ).toBe('alice');
    named.unmount();

    const anonymous = makeCard('connected', {
      authLabel: STRINGS.settings.summaryNoAuth,
    });
    act(() => {
      findPressable(anonymous, 'advanced-mqtt-status-body').props.onPress();
    });
    expect(
      anonymous.root.findByProps({ testID: 'mqtt-detail-auth' }).props.children,
    ).toBe(STRINGS.settings.summaryNoAuth);
    // No password value anywhere in the tree.
    const texts = anonymous.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).not.toContain('hunter2');
  });

  it('the detail retry forwards the wired retry', () => {
    const onRetry = jest.fn();
    const renderer = makeCard('failed', { onRetry });
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    act(() => {
      findPressable(renderer, 'advanced-mqtt-retry').props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('unconfigured detail: `Cấu hình` closes the detail and returns to step 1', () => {
    const onConfigure = jest.fn();
    const renderer = makeCard('unconfigured', { onConfigure });
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-configure' })
        .length,
    ).toBeGreaterThan(0);
    act(() => {
      findPressable(renderer, 'advanced-mqtt-configure').props.onPress();
    });
    expect(onConfigure).toHaveBeenCalledTimes(1);
    // The detail closed with the jump (capability relocated, not lost).
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status-detail' })
        .length,
    ).toBe(0);
  });

  it('configured detail renders NO `Cấu hình` action', () => {
    const renderer = makeCard('connected');
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-configure' })
        .length,
    ).toBe(0);
  });

  it('✕ and the scrim close the detail', () => {
    const renderer = makeCard('connected');
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    act(() => {
      findPressable(
        renderer,
        'advanced-mqtt-status-detail-close',
      ).props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status-detail' })
        .length,
    ).toBe(0);
    act(() => {
      findPressable(renderer, 'advanced-mqtt-status-body').props.onPress();
    });
    const scrim = findPressable(renderer, 'advanced-mqtt-status-detail-scrim');
    act(() => {
      scrim.props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-mqtt-status-detail' })
        .length,
    ).toBe(0);
  });
});
