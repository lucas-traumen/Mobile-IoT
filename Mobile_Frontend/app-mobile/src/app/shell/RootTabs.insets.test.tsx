/**
 * RootTabs safe-area seam tests.
 *
 * The shell contract (single ownership) after the React Navigation
 * migration: the ROOT tab-screen container applies the runtime TOP inset
 * exactly once (children never pad it again) and the shell itself never
 * pads the BOTTOM inset (the React Navigation tab bar owns it). Mocked
 * `react-native-safe-area-context` insets at representative values —
 * 0, 24 (Android gesture navigation) and 34 (iOS home indicator).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ThemeProvider } from '@core/theme';
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

/** The effective `paddingTop` across a (possibly array) style. */
function stylePaddingTop(style: unknown): number | undefined {
  const styles = Array.isArray(style) ? [...style].reverse() : [style];
  for (const entry of styles) {
    if (entry !== null && typeof entry === 'object' && 'paddingTop' in entry) {
      return (entry as { paddingTop: number }).paddingTop;
    }
  }
  return undefined;
}

describe.each([
  ['zero insets (no inset area)', 0],
  ['Android gesture navigation', 24],
  ['iOS home indicator', 34],
])('RootTabs insets — %s', (_label, topInset) => {
  beforeEach(() => {
    MOCK_INSETS.top = topInset;
    MOCK_INSETS.bottom = topInset;
  });
  afterEach(() => {
    MOCK_INSETS.top = 0;
    MOCK_INSETS.bottom = 0;
  });

  it('pads the dashboard screen container by the TOP inset exactly once', async () => {
    const renderer = await renderShell();
    const screen = renderer.root.findByProps({ testID: 'screen-dashboard' });
    // Walk up to the TabScreenContainer (the View that carries the inset).
    let container = screen.parent as TestRenderer.ReactTestInstance | null;
    while (container && stylePaddingTop(container.props.style) === undefined) {
      container = container.parent as TestRenderer.ReactTestInstance | null;
    }
    expect(container).toBeTruthy();
    expect(stylePaddingTop(container!.props.style)).toBe(topInset);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders exactly the three approved tabs', async () => {
    const renderer = await renderShell();
    expect(renderer.root.findByProps({ testID: 'tab-dashboard' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'tab-history' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'tab-settings' })).toBeTruthy();
    // No removed/extra tab ids exist (e.g. a devices tab).
    expect(
      renderer.root.findAllByProps({ testID: 'tab-devices' }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

/** A two-level mini stack for the Settings tab (root → deep). */
const MiniStack = createNativeStackNavigator<{
  'settings-root': undefined;
  deep: undefined;
}>();

async function renderShellWithStack(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <NavigationContainer>
        <ThemeProvider mode="light">
          <RootTabs
            renderDashboard={() => <Text testID="screen-dashboard">D</Text>}
            renderHistory={() => <Text testID="screen-history">H</Text>}
            renderSettings={() => (
              <MiniStack.Navigator screenOptions={{ headerShown: false }}>
                <MiniStack.Screen name="settings-root">
                  {({ navigation }) => (
                    <Pressable
                      testID="settings-mini-push"
                      accessibilityRole="button"
                      onPress={() => navigation.navigate('deep')}
                    >
                      <Text testID="settings-mini-root">push</Text>
                    </Pressable>
                  )}
                </MiniStack.Screen>
                <MiniStack.Screen name="deep">
                  {() => <Text testID="settings-mini-deep">deep</Text>}
                </MiniStack.Screen>
              </MiniStack.Navigator>
            )}
            onSettingsLeave={jest.fn()}
          />
        </ThemeProvider>
      </NavigationContainer>,
    );
  });
  return renderer;
}

/**
 * Re-press the FOCUSED tab → that tab pops to its root (the hand-written
 * shell's feel restored). Pressing an INACTIVE tab switches without
 * popping anything, and another tab's stack survives the switch.
 */
describe('RootTabs tabPress pops the focused tab to its root', () => {
  it('pressing the focused settings tab pops its stack to the root', async () => {
    const renderer = await renderShellWithStack();
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-settings' }).props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'settings-mini-root' }),
    ).toBeTruthy();
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'settings-mini-push' })
        .props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'settings-mini-deep' }),
    ).toBeTruthy();
    // Re-press the FOCUSED tab → the settings stack pops back to root.
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-settings' }).props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'settings-mini-root' }),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: 'settings-mini-deep' }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('pressing an INACTIVE tab switches; the settings stack RESETS on leave (fix cycle 7 K)', async () => {
    const renderer = await renderShellWithStack();
    // Same deterministic press recipe as RootTabs.tableave.test.tsx: the
    // tab-leave reset defers its popToTop by one production macrotask
    // (setTimeout(0)) so the draft discard lands BEFORE the removal event
    // — every press flushes that macrotask explicitly.
    const press = async (testID: string) => {
      await act(async () => {
        renderer.root.findByProps({ testID }).props.onPress();
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    };
    await press('tab-settings');
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'settings-mini-push' })
        .props.onPress();
    });
    // Switch to Dashboard (inactive tab) — the settings tab is left.
    await press('tab-dashboard');
    expect(
      renderer.root.findByProps({ testID: 'screen-dashboard' }),
    ).toBeTruthy();
    // Re-press the FOCUSED dashboard tab — popToTop is a harmless no-op.
    await press('tab-dashboard');
    expect(
      renderer.root.findByProps({ testID: 'screen-dashboard' }),
    ).toBeTruthy();
    // Back to Settings: the stack was RESET on leave (supersedes the
    // cycle-3 preserve-on-switch behavior) — the ROOT is shown.
    await press('tab-settings');
    expect(
      renderer.root.findByProps({ testID: 'settings-mini-root' }),
    ).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });
});
