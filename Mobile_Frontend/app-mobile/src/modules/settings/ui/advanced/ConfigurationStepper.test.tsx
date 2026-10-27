/**
 * ConfigurationStepper tests — the guided flow's 3-step progress header
 * (advanced-config-stepper-redesign): Máy chủ / Xác thực / Hoàn tất, thin
 * connector lines, amber = current, teal + ✓ = completed, gray = not
 * reached, labels BELOW the dot, no overflow on small screens.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { LIGHT_TOKENS, ThemeProvider } from '@core/theme';

import {
  ConfigurationStepper,
  type StepperStepState,
} from './ConfigurationStepper';

/** Renderers still mounted (unmounted in afterEach — act hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

function makeStepper(
  statuses: readonly StepperStepState[],
): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <ConfigurationStepper
          steps={[
            { label: 'Máy chủ', state: statuses[0] },
            { label: 'Xác thực', state: statuses[1] },
            { label: 'Hoàn tất', state: statuses[2] },
          ]}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return renderer;
}

/** Unmount every renderer created by the suite (act hygiene). */
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

describe('ConfigurationStepper', () => {
  it('renders all three labels below their dots', () => {
    const renderer = makeStepper(['current', 'upcoming', 'upcoming']);
    const labels = ['Máy chủ', 'Xác thực', 'Hoàn tất'];
    for (const [i, label] of labels.entries()) {
      const node = renderer.root.findByProps({
        testID: `stepper-label-${i + 1}`,
      });
      expect(node.props.children).toBe(label);
      // Label rendering carries numberOfLines=1 (no overflow on small screens).
      expect(node.props.numberOfLines).toBe(1);
    }
  });

  it('colors dots per state: amber current, teal completed, gray upcoming', () => {
    const renderer = makeStepper(['completed', 'current', 'upcoming']);
    const expected: Record<string, string> = {
      'stepper-dot-1': LIGHT_TOKENS.smart.colors.teal,
      'stepper-dot-2': LIGHT_TOKENS.smart.colors.amber,
      'stepper-dot-3': LIGHT_TOKENS.smart.colors.textSecondary,
    };
    for (const [testID, color] of Object.entries(expected)) {
      const dot = flattenStyle(
        renderer.root.findByProps({ testID }).props.style,
      );
      expect(dot.backgroundColor).toBe(color);
    }
  });

  it('renders the check icon only inside completed dots', () => {
    const renderer = makeStepper(['completed', 'current', 'upcoming']);
    expect(
      renderer.root.findByProps({ testID: 'stepper-check-1' }),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: 'stepper-check-2' }).length,
    ).toBe(0);
    expect(
      renderer.root.findAllByProps({ testID: 'stepper-check-3' }).length,
    ).toBe(0);
  });

  it('renders thin connector lines between consecutive steps', () => {
    const renderer = makeStepper(['current', 'upcoming', 'upcoming']);
    // Presence/absence only — react-test-renderer double-counts host nodes
    // (DevicesScreen.test.tsx convention: no exact positive counts).
    expect(
      renderer.root.findAllByProps({ testID: 'stepper-connector-1' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'stepper-connector-2' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'stepper-connector-3' }).length,
    ).toBe(0);
  });

  it('colors a connector teal once the step before it is completed', () => {
    const renderer = makeStepper(['completed', 'current', 'upcoming']);
    const done = flattenStyle(
      renderer.root.findByProps({ testID: 'stepper-connector-1' }).props.style,
    );
    const pending = flattenStyle(
      renderer.root.findByProps({ testID: 'stepper-connector-2' }).props.style,
    );
    expect(done.backgroundColor).toBe(LIGHT_TOKENS.smart.colors.teal);
    expect(pending.backgroundColor).toBe(
      LIGHT_TOKENS.smart.colors.textSecondary,
    );
  });

  it('keeps labels shrinkable so the row never overflows small screens', () => {
    const renderer = makeStepper(['current', 'upcoming', 'upcoming']);
    const label = flattenStyle(
      renderer.root.findByProps({ testID: 'stepper-label-1' }).props.style,
    );
    expect(label.flexShrink).toBe(1);
    // The step column itself must be allowed to shrink too.
    const step = renderer.root.findByProps({ testID: 'stepper-step-1' });
    expect(step.props.style).toEqual(
      expect.objectContaining({ flexShrink: 1 }),
    );
  });
});
