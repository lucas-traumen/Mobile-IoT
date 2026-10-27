/**
 * InfluxDbStatusCard tests (Amendment 2, B3 restructure) — the InfluxDB
 * status area as a compact widget + centered detail:
 * - widget: D3 dot, service name, SHORT probe status, ONE quick action
 *   (`Kiểm tra` — gated by configured/checking, disabled readable);
 * - widget body tap opens the detail;
 * - detail: status + the 4-field form (prefilled, masked token + reveal,
 *   edits patch the store — never auto-save) + the manual-probe hint
 *   (the old info box folded in) + the gated `Kiểm tra`;
 * - the long-lived testIDs carry over: `advanced-influx-status` (body),
 *   `advanced-influx-check` (quick action), `advanced-token-input`
 *   (form token field).
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import type { InfluxSettings } from '@modules/settings/api';

import { InfluxDbStatusCard } from './InfluxDbStatusCard';

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

const INFLUX: InfluxSettings = {
  url: 'http://192.168.2.28:8086',
  org: 'smarthome',
  bucket: 'smarthome',
  token: 'influx-token-1',
};

function makeCard(
  props: Partial<Parameters<typeof InfluxDbStatusCard>[0]> = {},
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  const onCheck = jest.fn();
  const onPatch = jest.fn();
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <InfluxDbStatusCard
          dot="gray"
          statusText={STRINGS.settings.influxNotConfigured}
          configured={props.configured ?? false}
          checking={props.checking ?? false}
          onCheck={onCheck}
          influx={props.influx ?? INFLUX}
          onPatch={onPatch}
          errors={props.errors}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return { renderer, onCheck, onPatch };
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

function openDetail(renderer: TestRenderer.ReactTestRenderer): void {
  act(() => {
    findPressable(renderer, 'advanced-influx-status-body').props.onPress();
  });
}

describe('InfluxDbStatusCard (widget + detail, C3)', () => {
  it('renders the widget: name + status + the D3 dot; NO action button on the widget', () => {
    const { renderer, onCheck } = makeCard();
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status' }).length,
    ).toBeGreaterThan(0);
    const widgetTexts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(widgetTexts).toContain(STRINGS.settings.influxCardTitle);
    expect(widgetTexts).toContain(STRINGS.settings.influxNotConfigured);
    // C3: the widget is buttonless — `advanced-influx-check` appears only
    // inside the detail (relocated, same ID), gated there.
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-check' }).length,
    ).toBe(0);
    expect(onCheck).not.toHaveBeenCalled();
  });

  it('the detail `Kiểm tra` (canonical ID, relocated) forwards the probe, gated', () => {
    const blocked = makeCard({ configured: false });
    openDetail(blocked.renderer);
    const blockedAction = blocked.renderer.root
      .findAllByProps({ testID: 'advanced-influx-check' })
      .at(0);
    expect(blockedAction?.props.disabled).toBe(true);
    // READABLE disabled (spec §8).
    expect(
      (flattenStyle(blockedAction?.props.style) as Record<string, unknown>)
        .opacity,
    ).toBeGreaterThanOrEqual(0.4);
    blocked.renderer.unmount();

    const { renderer, onCheck } = makeCard({ configured: true });
    openDetail(renderer);
    act(() => {
      findPressable(renderer, 'advanced-influx-check').props.onPress();
    });
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('the widget body opens the detail: status + 4-field form prefilled', () => {
    const { renderer } = makeCard({ configured: true });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status-detail' })
        .length,
    ).toBe(0);
    openDetail(renderer);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status-detail' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findByProps({ testID: 'advanced-influx-url-input' }).props
        .value,
    ).toBe(INFLUX.url);
    expect(
      renderer.root.findByProps({ testID: 'advanced-influx-org-input' }).props
        .value,
    ).toBe(INFLUX.org);
    expect(
      renderer.root.findByProps({ testID: 'advanced-influx-bucket-input' })
        .props.value,
    ).toBe(INFLUX.bucket);
    expect(
      renderer.root.findByProps({ testID: 'advanced-token-input' }).props.value,
    ).toBe(INFLUX.token);
    // The token is masked by default (secret) + the hint line folded in.
    expect(
      renderer.root.findByProps({ testID: 'advanced-token-input' }).props
        .secureTextEntry,
    ).toBe(true);
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.influxProbeInfo);
  });

  it('form edits go through the store patch (never auto-save)', () => {
    const { renderer, onPatch } = makeCard({ configured: true });
    openDetail(renderer);
    const url = renderer.root.findByProps({
      testID: 'advanced-influx-url-input',
    });
    act(() => {
      url.props.onChangeText('http://192.168.2.30:8086');
    });
    expect(onPatch).toHaveBeenCalledWith({ url: 'http://192.168.2.30:8086' });
    const token = renderer.root.findByProps({ testID: 'advanced-token-input' });
    act(() => {
      token.props.onChangeText('new-token');
    });
    expect(onPatch).toHaveBeenCalledWith({ token: 'new-token' });
  });

  it('the token reveal toggle unmasks the token input', () => {
    const { renderer } = makeCard({ configured: true });
    openDetail(renderer);
    act(() => {
      findPressable(renderer, 'advanced-influx-token-reveal').props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'advanced-token-input' }).props
        .secureTextEntry,
    ).toBe(false);
  });

  it('the detail `Kiểm tra` forwards the probe (gated by configured + checking)', () => {
    const { renderer, onCheck } = makeCard({ configured: true });
    openDetail(renderer);
    act(() => {
      findPressable(renderer, 'advanced-influx-check').props.onPress();
    });
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('✕ and the scrim close the detail; the widget stays', () => {
    const { renderer } = makeCard({ configured: true });
    openDetail(renderer);
    act(() => {
      findPressable(
        renderer,
        'advanced-influx-status-detail-close',
      ).props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status-detail' })
        .length,
    ).toBe(0);
    openDetail(renderer);
    act(() => {
      findPressable(
        renderer,
        'advanced-influx-status-detail-scrim',
      ).props.onPress();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status-detail' })
        .length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-influx-status' }).length,
    ).toBeGreaterThan(0);
  });
});
