/**
 * SettingsScreen (root) tests — summary/navigation contract (approved
 * settings-information-architecture plan):
 * - exactly two explicit theme choices (Sáng/Tối) — no `Hệ thống`;
 * - NO permanent MQTT/Influx status cards and NO combined check button;
 * - a concise, actionable warning row appears ONLY for a confirmed MQTT
 *   failure and links to the advanced screen;
 * - navigation rows expose the Dashboard & Templates management entry
 *   (the Template → Room → Widget hierarchy hosted by the Settings tab's
 *   native stack), devices and advanced.
 *
 * settings-smart-home-sync: the ambient wash + smart card recipes are
 * pinned per theme (light AND dark). The demo-history toggle was REMOVED
 * from the root — a regression test pins its absence.
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { APP_VERSION } from '@core/constants';
import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import { SettingsScreen } from './SettingsScreen';

/** Flatten an RN style array into one object. */
function flatStyles(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}

/** Views whose flattened style carries ALL the given style entries. */
function viewsWithStyle(
  root: ReactTestInstance,
  match: Record<string, unknown>,
): ReactTestInstance[] {
  return root.findAllByType(View).filter(view => {
    if (!view.props.style) {
      return false;
    }
    const flat = flatStyles(view.props.style);
    if (!flat) {
      return false;
    }
    return Object.entries(match).every(([key, value]) => flat[key] === value);
  });
}

/** Renderers still mounted (unmounted in afterEach — teardown hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

function makeScreen(
  props: Partial<Parameters<typeof SettingsScreen>[0]> = {},
  mode: 'light' | 'dark' = 'light',
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <SettingsScreen
          settings={{ theme: mode }}
          onUpdateUi={props.onUpdateUi}
          onOpenDeviceManagement={
            props.onOpenDeviceManagement ?? (() => undefined)
          }
          onOpenAdvanced={props.onOpenAdvanced ?? (() => undefined)}
          connectionState={props.connectionState}
          lastErrorCode={props.lastErrorCode ?? null}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return renderer;
}

/** Unmount every renderer created by the suite (teardown hygiene). */
afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
});

/** All visible text of the renderer (flattening nested Text children). */
function visibleText(renderer: TestRenderer.ReactTestRenderer): string {
  const texts: string[] = [];
  const walk = (node: { props?: { children?: unknown } }) => {
    const children = node.props?.children;
    if (typeof children === 'string') {
      texts.push(children);
    } else if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child === 'string') {
          texts.push(child);
        } else if (child && typeof child === 'object') {
          walk(child as { props?: { children?: unknown } });
        }
      }
    } else if (children && typeof children === 'object') {
      walk(children as { props?: { children?: unknown } });
    }
  };
  for (const textNode of renderer.root.findAllByType(Text)) {
    walk(textNode as never);
  }
  return texts.join('\n');
}

describe('SettingsScreen root (summary/navigation)', () => {
  it('renders exactly two theme buttons (light/dark) — no system choice', () => {
    const renderer = makeScreen();
    expect(
      renderer.root.findByProps({ testID: 'settings-theme-light' }),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: 'settings-theme-dark' }),
    ).toBeTruthy();
    const text = visibleText(renderer);
    expect(text).toContain(STRINGS.settings.light);
    expect(text).toContain(STRINGS.settings.dark);
    // The removed `Hệ thống` option must never appear at the root.
    expect(text).not.toContain('Hệ thống');
  });

  it('applies the theme immediately via onUpdateUi (no save step)', async () => {
    const onUpdateUi = jest.fn();
    const renderer = makeScreen({ onUpdateUi });
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'settings-theme-dark' })
        .props.onPress();
    });
    expect(onUpdateUi).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('shows navigation rows for devices and the advanced screen only', () => {
    const renderer = makeScreen();
    expect(
      renderer.root.findByProps({ testID: 'settings-open-devices' }),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: 'settings-open-advanced' }),
    ).toBeTruthy();
    // The obsolete dashboard-editor entry must not exist under Settings.
    expect(
      renderer.root.findAllByProps({ testID: 'settings-open-editor' }),
    ).toHaveLength(0);
  });

  it('shows NO connection status cards and NO combined check button in the healthy state', () => {
    const renderer = makeScreen({ connectionState: 'connected' });
    expect(
      renderer.root.findAllByProps({ testID: 'settings-connection-warning' })
        .length,
    ).toBe(0);
    expect(visibleText(renderer)).not.toContain(
      STRINGS.settings.checkConnection,
    );
  });

  it('shows a concise failure-only warning row linking to the advanced screen', async () => {
    const onOpenAdvanced = jest.fn();
    const renderer = makeScreen({
      connectionState: 'failed',
      lastErrorCode: 'timeout',
      onOpenAdvanced,
    });
    // No combined check action exists at the root (approval contract).
    expect(visibleText(renderer)).not.toContain(
      STRINGS.settings.checkConnection,
    );
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'settings-connection-warning' })
        .props.onPress();
    });
    expect(onOpenAdvanced).toHaveBeenCalledTimes(1);
  });

  it('renders NO demo-history toggle (removed from the Settings root)', () => {
    const renderer = makeScreen();
    expect(
      renderer.root.findAllByProps({ testID: 'settings-demo-history-row' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'settings-demo-history' }),
    ).toHaveLength(0);
    expect(visibleText(renderer)).not.toContain(STRINGS.settings.demoHistory);
  });
});

describe('SettingsScreen smart visual language (settings-smart-home-sync)', () => {
  it('renders the ambient wash in light AND dark (tealTint → page → amberTint)', () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = makeScreen({}, mode);
      const gradient = renderer.root.findByType(LinearGradient);
      expect(gradient.props.colors).toEqual([
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]);
      expect(gradient.props.start).toEqual({ x: 0, y: 0 });
      expect(gradient.props.end).toEqual({ x: 1, y: 1 });
    }
  });

  it('renders the smart card rows + soft icon chips in light AND dark', () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = makeScreen({}, mode);
      // Smart card recipe: card surface + hairline border + token radius.
      const cards = viewsWithStyle(renderer.root, {
        backgroundColor: tokens.smart.colors.card,
        borderColor: tokens.smart.colors.cardBorder,
        borderRadius: tokens.smart.radius.card,
      });
      expect(cards.length).toBeGreaterThanOrEqual(2); // 2 manage rows (devices + advanced; demo row removed)
      // Icon chips: page surface + card border.
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.smart.colors.page,
          borderColor: tokens.smart.colors.cardBorder,
        }).length,
      ).toBeGreaterThanOrEqual(1);
      // No legacy plain surface/border recipe leaks.
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }),
      ).toHaveLength(0);
    }
  });

  it('renders the root title on the smart screen-title scale (27)', () => {
    const renderer = makeScreen();
    const title = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === STRINGS.settings.title);
    expect(title).toBeTruthy();
    const flat = flatStyles(title!.props.style);
    expect(flat.fontSize).toBe(LIGHT_TOKENS.smart.typography.screenTitle);
    expect(flat.color).toBe(LIGHT_TOKENS.smart.colors.textPrimary);
  });
});

describe('SettingsScreen version footer (branding-and-settings-version)', () => {
  /** True when any ancestor of `node` is a TouchableOpacity (pressable). */
  function hasPressableAncestor(node: ReactTestInstance): boolean {
    let current = node.parent;
    while (current !== null) {
      if (current.type === TouchableOpacity) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  it('renders exactly the approved version text from the APP_VERSION seam', () => {
    const renderer = makeScreen();
    const version = renderer.root.findByProps({ testID: 'settings-version' });
    expect(version).toBeTruthy();
    // The i18n template + APP_VERSION constant resolve to the approved copy.
    const expected = STRINGS.settings.versionLabel.replace(
      '{version}',
      APP_VERSION,
    );
    expect(expected).toBe('Phiên bản 1.0.0');
    expect(version.props.children).toBe(expected);
  });

  it('renders the version line muted with the active theme secondary color (light AND dark)', () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = makeScreen({}, mode);
      const version = renderer.root.findByProps({
        testID: 'settings-version',
      });
      const flat = flatStyles(version.props.style);
      expect(flat.color).toBe(tokens.smart.colors.textSecondary);
      expect(flat.textAlign).toBe('center');
      // Small informational text — below the standard body scale.
      expect(flat.fontSize).toBeLessThan(14);
    }
  });

  it('is a non-pressable plain Text placed last inside the scroll content', () => {
    const renderer = makeScreen();
    const version = renderer.root.findByProps({ testID: 'settings-version' });
    expect(version.type).toBe(Text);
    expect(hasPressableAncestor(version)).toBe(false);
    // Placement intent: the footer is the LAST element of the root
    // ScrollView content (after every management/connection row).
    const scrollView = renderer.root.findByType(ScrollView);
    const content = scrollView.props.children as ReactTestInstance[];
    const lastChild = content[content.length - 1];
    expect(lastChild.props.testID).toBe('settings-version');
  });

  it('still renders the version line when the failure warning row is shown', () => {
    const renderer = makeScreen({ connectionState: 'failed' });
    expect(
      renderer.root.findByProps({ testID: 'settings-connection-warning' }),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: 'settings-version' }),
    ).toBeTruthy();
  });
});
