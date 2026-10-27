/**
 * RootTabs appearance tests (Smart Home tab bar, dashboard-smart-home-
 * redesign, scope amendment 3).
 *
 * Verifies the restyle WITHOUT touching navigation behavior (the
 * inset/leave/re-press contracts keep their own suites):
 * - EXACTLY the three approved tabs with ONE icon family (Ionicons):
 *   Dashboard = `grid-outline` (the 2×2-squares OUTLINE glyph), Lịch sử =
 *   `time-outline`, Cài đặt = `settings-outline` — no fourth tab,
 * - the amendment-2 underline indicator is REMOVED (no 2pt/16pt underline
 *   row anywhere),
 * - the FOCUSED tab = teal icon + semibold label + a SUBTLE SELECTED
 *   BACKGROUND TINT behind the item (light teal fill, small radius,
 *   horizontal inset only); inactive tabs = muted blue-gray, no tint,
 * - bar surface = smart card color + hairline smart top border,
 * - stable `tab-<name>` testIDs preserved.
 */

import React from 'react';
import { Platform, Text, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Ionicons } from '@expo/vector-icons';

import { NavigationContainer } from '@react-navigation/native';

import { ThemeProvider, LIGHT_TOKENS } from '@core/theme';
import { RootTabs } from './RootTabs';

/** Mutated per test — the mock closure reads it lazily during render. */
const MOCK_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: { readonly children: React.ReactNode }) =>
      children,
    SafeAreaConsumer: ({
      children,
    }: {
      readonly children: (insets: typeof MOCK_INSETS) => React.ReactNode;
    }) => children(MOCK_INSETS),
    SafeAreaInsetsContext: React.createContext(MOCK_INSETS),
    SafeAreaFrameContext: React.createContext(frame),
    initialWindowMetrics: { insets: MOCK_INSETS, frame },
    useSafeAreaInsets: () => MOCK_INSETS,
    useSafeAreaFrame: () => frame,
  };
});

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

async function renderShell(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <NavigationContainer>
        <ThemeProvider mode="light">
          <RootTabs
            renderDashboard={() => <Text testID="screen-dashboard">D</Text>}
            renderHistory={() => <Text testID="screen-history">H</Text>}
            renderSettings={() => <Text testID="screen-settings">S</Text>}
            onSettingsLeave={jest.fn()}
          />
        </ThemeProvider>
      </NavigationContainer>,
    );
  });
  return renderer;
}

describe('RootTabs Smart Home tab bar (amendment 3: one family, tint, no underline)', () => {
  it('renders the three approved icons in ONE family: grid-outline / time-outline / settings-outline', async () => {
    const renderer = await renderShell();
    const icons = renderer.root.findAllByType(Ionicons);
    // React Navigation may render each bar icon more than once in the test
    // tree — assert the DISTINCT set: exactly the three approved glyphs,
    // all from the SAME Ionicons family (amendment 3 replaced the `apps`
    // filled-squares glyph with the OUTLINE `grid-outline`).
    const names = [...new Set(icons.map(icon => icon.props.name))].sort();
    expect(names).toEqual(['grid-outline', 'settings-outline', 'time-outline']);
    // The filled `apps` glyph is gone (one-family consistency rule).
    expect(names).not.toContain('apps');
    // The legacy `home` glyph stays gone (D6).
    expect(names).not.toContain('home');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('removes the amendment-2 underline indicator entirely', async () => {
    const renderer = await renderShell();
    // No View anywhere in the tab bar renders the 2×16 underline row.
    const underlines = renderer.root.findAllByType(View).filter(view => {
      const style = flatStyles(view.props.style);
      return style.height === 2 && style.width === 16;
    });
    expect(underlines).toHaveLength(0);
    // And nothing is tinted teal EXCEPT the selected-tint layer (asserted
    // below) — the old per-label teal underline is gone.
    await act(async () => {
      renderer.unmount();
    });
  });

  /** Predicate: the node's flattened style carries the teal selected tint. */
  function hasSelectedTint(node: TestRenderer.ReactTestInstance): boolean {
    return (
      node.props?.style != null &&
      flatStyles(node.props.style).backgroundColor ===
        LIGHT_TOKENS.smart.colors.tealTint
    );
  }

  it('tints the FOCUSED tab with the subtle selected background (teal fill, small radius)', async () => {
    const renderer = await renderShell();
    // The dashboard tab is focused initially. React Navigation may render
    // the bar more than once in the test tree — assert the DISTINCT
    // testIDs: ONLY the focused tab carries the tint.
    const tinted = renderer.root.findAll(hasSelectedTint);
    expect(tinted.length).toBeGreaterThan(0);
    const tintedTestIds = [
      ...new Set(tinted.map(node => node.props.testID as string)),
    ];
    expect(tintedTestIds).toEqual(['tab-dashboard']);
    const tintStyle = flatStyles(tinted[0]!.props.style);
    // Small radius + horizontal inset only (the navigator-owned ≥44pt
    // touch height is untouched — no vertical margins).
    expect(tintStyle.borderRadius).toBe(12);
    expect(tintStyle.marginHorizontal).toBe(8);
    expect(tintStyle.marginVertical).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('carries the presence rules: icon 22, label 12, semibold active / regular inactive', async () => {
    const renderer = await renderShell();
    const icons = renderer.root.findAllByType(Ionicons);
    const names = [...new Set(icons.map(icon => icon.props.name))];
    expect(names).toContain('grid-outline');
    // Every bar icon renders at size 22.
    for (const name of names) {
      for (const node of icons.filter(icon => icon.props.name === name)) {
        expect(node.props.size).toBe(22);
      }
    }
    // Focused label: fontSize 12 + semibold (600) + teal.
    const focusedButton = renderer.root.findByProps({
      testID: 'tab-dashboard',
    });
    const focusedLabel = focusedButton
      .findAllByType(Text)
      .find(node => node.props.children === 'Dashboard');
    const focusedStyle = flatStyles(focusedLabel!.props.style);
    expect(focusedStyle.fontSize).toBe(12);
    expect(focusedStyle.fontWeight).toBe('600');
    expect(focusedStyle.color).toBe(LIGHT_TOKENS.smart.colors.teal);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps inactive tabs muted with NO selected tint', async () => {
    const renderer = await renderShell();
    const inactiveButton = renderer.root.findByProps({ testID: 'tab-history' });
    const inactiveLabel = inactiveButton
      .findAllByType(Text)
      .find(node => node.props.children === 'Lịch sử');
    expect(inactiveLabel).toBeTruthy();
    expect(flatStyles(inactiveLabel!.props.style).color).toBe(
      LIGHT_TOKENS.smart.colors.textSecondary,
    );
    expect(flatStyles(inactiveLabel!.props.style).fontWeight).toBe('400');
    // No teal tint anywhere on the inactive button.
    expect(inactiveButton.findAll(hasSelectedTint)).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('paints the bar surface with the smart card color + hairline top border', async () => {
    const renderer = await renderShell();
    const bar = renderer.root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return (
        flat.backgroundColor === LIGHT_TOKENS.smart.colors.card &&
        flat.borderTopColor === LIGHT_TOKENS.smart.colors.cardBorder
      );
    });
    expect(bar).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the stable tab-<name> testIDs (no fourth tab)', async () => {
    const renderer = await renderShell();
    expect(renderer.root.findByProps({ testID: 'tab-dashboard' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'tab-history' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'tab-settings' })).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: 'tab-devices' }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('RootTabs tab-button accessibility semantics (reviewer-6 bridge repair)', () => {
  it('forwards the navigator-selected state to the pressable: focused tab selected, inactive unselected', async () => {
    const renderer = await renderShell();
    // The custom tab-button path must FORWARD the navigator-provided
    // `aria-selected` to the native pressable (RN maps a forwarded
    // `aria-selected` into the accessible selected state — View.js
    // ariaSelected → accessibilityState.selected). Consuming it only as a
    // styling signal hides the selected-tab semantics from assistive tech.
    const focused = renderer.root.findByProps({ testID: 'tab-dashboard' });
    expect(focused.props['aria-selected']).toBe(true);
    // Every inactive tab exposes the unselected semantics.
    for (const name of ['history', 'settings'] as const) {
      const inactive = renderer.root.findByProps({ testID: `tab-${name}` });
      expect(inactive.props['aria-selected']).toBe(false);
    }
    await act(async () => {
      renderer.unmount();
    });
  });

  it('preserves the navigator-provided role/label: no forced button role, no fabricated state', async () => {
    const renderer = await renderShell();
    const focused = renderer.root.findByProps({ testID: 'tab-dashboard' });
    // The tab `role` is EXACTLY what BottomTabItem supplies (a
    // Platform-selected 'tab' — 'button' on iOS) — forwarded, not dropped.
    expect(focused.props.role).toBe(
      Platform.select({ ios: 'button', default: 'tab' }),
    );
    // The forced `accessibilityRole="button"` is gone…
    expect(focused.props.accessibilityRole).toBeUndefined();
    // …and no `accessibilityState` is fabricated (React Navigation v7.18
    // supplies none on tab buttons — selection rides `aria-selected`).
    expect(focused.props.accessibilityState).toBeUndefined();
    // The navigator's `aria-label` prop is forwarded (not dropped): with a
    // render-function label BottomTabBar builds no string label (undefined
    // here), but the prop reaches the pressable whenever the navigator
    // supplies one.
    expect('aria-label' in focused.props).toBe(true);
    await act(async () => {
      renderer.unmount();
    });
  });
});
