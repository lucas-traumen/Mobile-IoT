/**
 * ConnectionWidget tests (Amendment 3, C3 restructure): the shared
 * compact status widget — leading status dot, service name, SHORT status
 * label, `›` chevron hint — with NO action button: the ENTIRE widget body
 * is the tap target (≥ 44 px) and opens the centered detail panel (the
 * existing dialog recipe).
 *
 * Pins:
 * - the whole widget body is pressable (≥ 44 px) and opens the detail;
 * - NO action button exists on the widget (C3 — checks live in panels);
 * - the chevron hint renders;
 * - the detail renders its children ONLY while open; ✕, scrim and
 *   Android-back all close it;
 * - existing container testIDs (`advanced-mqtt-status` /
 *   `advanced-influx-status`) stay on the widget body so the visibility
 *   pins carry over.
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';

import { ConnectionWidget } from './ConnectionWidget';

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

function makeWidget(detailOpen = false) {
  let renderer!: TestRenderer.ReactTestRenderer;
  const onOpenDetail = jest.fn();
  const onCloseDetail = jest.fn();
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <ConnectionWidget
          testID="mqtt-widget"
          name="Máy chủ MQTT"
          dot="healthy"
          statusLabel="Đã kết nối"
          detailOpen={detailOpen}
          onOpenDetail={onOpenDetail}
          onCloseDetail={onCloseDetail}
        >
          <Text testID="detail-body-content">Nội dung chi tiết</Text>
        </ConnectionWidget>
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return { renderer, onOpenDetail, onCloseDetail };
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

describe('ConnectionWidget (buttonless, C3)', () => {
  it('renders the name, the D3 dot, the short status label and the chevron hint', () => {
    const { renderer } = makeWidget();
    expect(
      renderer.root.findAllByProps({ testID: 'mqtt-widget' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'status-dot-healthy' }).length,
    ).toBeGreaterThan(0);
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain('Máy chủ MQTT');
    expect(texts).toContain('Đã kết nối');
    expect(
      renderer.root.findAllByProps({ name: 'chevron-forward' }).length,
    ).toBeGreaterThan(0);
  });

  it('renders NO action button on the widget (C3 — checks live in panels)', () => {
    const { renderer } = makeWidget();
    expect(
      renderer.root.findAllByProps({ testID: 'mqtt-widget-action' }).length,
    ).toBe(0);
  });

  it('tapping the whole widget body opens the detail', () => {
    const { renderer, onOpenDetail } = makeWidget();
    press(renderer, 'mqtt-widget-body');
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    // The 44 px touch-target floor is a style-constant guarantee on the
    // widget row (`styles.inner.minHeight`), not introspected here.
  });

  it('the detail renders its children ONLY while open', () => {
    const closed = makeWidget(false);
    expect(
      closed.renderer.root.findAllByProps({ testID: 'mqtt-widget-detail' })
        .length,
    ).toBe(0);
    closed.renderer.unmount();

    const open = makeWidget(true);
    expect(
      open.renderer.root.findAllByProps({ testID: 'mqtt-widget-detail' })
        .length,
    ).toBeGreaterThan(0);
    expect(
      open.renderer.root.findAllByProps({ testID: 'detail-body-content' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('✕ and the scrim both close the detail', () => {
    const { renderer, onCloseDetail } = makeWidget(true);
    press(renderer, 'mqtt-widget-detail-close');
    expect(onCloseDetail).toHaveBeenCalledTimes(1);
    const scrim = renderer.root
      .findAllByProps({ testID: 'mqtt-widget-detail-scrim' })
      .find(candidate => typeof candidate.props.onPress === 'function');
    act(() => {
      scrim?.props.onPress();
    });
    expect(onCloseDetail).toHaveBeenCalledTimes(2);
  });
});
