/**
 * CreateTemplateScreen tests — focused render + visual contract (reviewer
 * MAJOR-3, settings-smart-home-sync fix cycle 1).
 *
 * The screen is a dumb two-callback form (see `hierarchyRoutes.tsx`
 * CreateTemplateRoute for the realistic wiring), so these tests pin the
 * presentation contract only, not the create flow:
 * - AMBIENT WASH: the diagonal Smart Home wash (tealTint → page →
 *   amberTint) in light AND dark,
 * - SMART FORM: the name input renders on the smart card surface with the
 *   hairline `cardBorder`; the primary action uses the smart teal
 *   (`primary === smart.colors.teal`) with the readable `onPrimary` label;
 *   the cancel button follows the smart hairline + smart secondary text.
 */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import { OK_OUTCOME } from './ConfirmDialog';
import { CreateTemplateScreen } from './CreateTemplateScreen';

/** Render the form with realistic props (CreateTemplateRoute shape). */
function renderScreen(mode: 'light' | 'dark'): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <CreateTemplateScreen
          onSubmit={async () => OK_OUTCOME}
          onCancel={() => undefined}
        />
      </ThemeProvider>,
    );
  });
  return renderer;
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

describe('CreateTemplateScreen ambient wash (settings-smart-home-sync)', () => {
  it('renders the diagonal teal→page→amber wash in light AND dark', () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = renderScreen(mode);
      const gradient = renderer.root.findByType(LinearGradient);
      expect(gradient.props.colors).toEqual([
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]);
      expect(gradient.props.start).toEqual({ x: 0, y: 0 });
      expect(gradient.props.end).toEqual({ x: 1, y: 1 });
      act(() => {
        renderer.unmount();
      });
    }
  });
});

describe('CreateTemplateScreen smart form (light AND dark)', () => {
  for (const [mode, tokens] of [
    ['light', LIGHT_TOKENS],
    ['dark', DARK_TOKENS],
  ] as const) {
    it(`renders the smart input + teal action in ${mode}`, () => {
      const renderer = renderScreen(mode);

      // The name input sits on the smart card surface with the hairline
      // card border (no legacy plain border).
      const input = renderer.root.findByProps({
        testID: 'create-template-name',
      }) as ReactTestInstance;
      expect(input.type).toBe(TextInput);
      const inputStyle = flatStyles(input.props.style);
      expect(inputStyle.backgroundColor).toBe(tokens.smart.colors.card);
      expect(inputStyle.borderColor).toBe(tokens.smart.colors.cardBorder);

      // The primary action is the smart teal (D2 invariant) with the
      // readable onPrimary label.
      const submit = renderer.root.findByProps({
        testID: 'create-template-submit',
      }) as ReactTestInstance;
      const submitStyle = flatStyles(submit.props.style);
      expect(submitStyle.backgroundColor).toBe(tokens.primary);
      expect(submitStyle.borderColor).toBe(tokens.primary);
      const submitText = submit.findByType(Text);
      expect(flatStyles(submitText.props.style).color).toBe(tokens.onPrimary);

      // The cancel affordance follows the smart hairline + secondary text.
      const cancelText = renderer.root
        .findAllByType(Text)
        .find(node => node.props.children === STRINGS.templates.cancel);
      expect(cancelText).toBeTruthy();
      expect(flatStyles(cancelText!.props.style).color).toBe(
        tokens.smart.colors.textSecondary,
      );
    });
  }
});

describe('CreateTemplateScreen 44pt touch targets (dashboard-history-board-touch-share)', () => {
  it('the back button carries explicit ≥44×44 hit bounds (not hitSlop)', () => {
    const renderer = renderScreen('light');
    const back = renderer.root.findByProps({
      testID: 'create-template-back',
    });
    const flat = flatStyles(back.props.style);
    expect(typeof flat.minWidth).toBe('number');
    expect(flat.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof flat.minHeight).toBe('number');
    expect(flat.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});
