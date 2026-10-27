/**
 * RuntimeRecoveryNotice tests — the setup-mode recovery notice for a
 * degraded PERSISTED runtime connection
 * (advanced-settings-sequential-recovery):
 * - `failed` renders the honest lost message (persisted runtime vs
 *   untouched draft) and offers the explicit actions;
 * - `Thử lại` forwards to the REAL telemetry lifecycle callback;
 * - `Cấu hình lại` forwards to the explicit reconfigure callback;
 * - `reconnecting` renders the calm variant WITHOUT actions (no timer
 *   may escalate or move the user);
 * - both severities render as an alert (accessibility).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import { RuntimeRecoveryNotice } from './RuntimeRecoveryNotice';

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

function makeNotice(severity: 'failed' | 'reconnecting') {
  let renderer!: TestRenderer.ReactTestRenderer;
  const onRetry = jest.fn();
  const onReconfigure = jest.fn();
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <RuntimeRecoveryNotice
          severity={severity}
          onRetry={onRetry}
          onReconfigure={onReconfigure}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return { renderer, onRetry, onReconfigure };
}

function press(renderer: TestRenderer.ReactTestRenderer, testID: string) {
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

describe('RuntimeRecoveryNotice', () => {
  it('failed: renders the alert with the persisted-runtime message and BOTH actions', () => {
    const { renderer } = makeNotice('failed');
    const notice = renderer.root.findByProps({
      testID: 'advanced-runtime-notice',
    });
    expect(notice.props.accessibilityRole).toBe('alert');
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.runtimeLostNotice);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-runtime-retry' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({
        testID: 'advanced-runtime-reconfigure',
      }).length,
    ).toBeGreaterThan(0);
  });

  it('failed: Thử lại drives the REAL telemetry lifecycle callback', () => {
    const { renderer, onRetry } = makeNotice('failed');
    press(renderer, 'advanced-runtime-retry');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('failed: Cấu hình lại is the ONLY reconfigure path (explicit, user-pressed)', () => {
    const { renderer, onReconfigure } = makeNotice('failed');
    press(renderer, 'advanced-runtime-reconfigure');
    expect(onReconfigure).toHaveBeenCalledTimes(1);
  });

  it('reconnecting: the calm variant renders WITHOUT actions (no timer yank)', () => {
    const { renderer, onRetry, onReconfigure } = makeNotice('reconnecting');
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.runtimeReconnectingNotice);
    expect(texts).not.toContain(STRINGS.settings.runtimeLostNotice);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-runtime-retry' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({
        testID: 'advanced-runtime-reconfigure',
      }).length,
    ).toBe(0);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onReconfigure).not.toHaveBeenCalled();
  });

  it('actions are optional (rendered only when the screen wires them)', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <RuntimeRecoveryNotice severity="failed" />
        </ThemeProvider>,
      );
    });
    openRenderers.push(renderer);
    expect(
      renderer.root.findAllByProps({ testID: 'advanced-runtime-retry' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({
        testID: 'advanced-runtime-reconfigure',
      }).length,
    ).toBe(0);
  });
});
