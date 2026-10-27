/**
 * RootTabs Settings-tab leave-reset tests (fix cycle 7, item K).
 *
 * User decision (supersedes part of the cycle-3 re-press behavior):
 * LEAVING the Settings tab resets it — returning always shows the
 * Settings root — and any in-progress editor draft is discarded
 * (`onSettingsLeave` → cancelEdit; never silently persisted). The
 * re-press of the FOCUSED tab still pops to root (cycle 3 B). Dashboard /
 * History are single screens (no-op).
 */

import React from 'react';
import { Pressable, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import {
  NavigationContainer,
  useNavigation,
  usePreventRemove,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useStore } from 'zustand';

import { ThemeProvider } from '@core/theme';
import { createDashboardStore } from '@modules/dashboard/api';
import { defaultDashboardsFile } from '@modules/dashboard/internal/domain/seeds';
import { RootTabs } from './RootTabs';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

// Same safe-area mock pattern as RootTabs.insets.test.tsx (the real
// provider cannot measure under react-test-renderer). jest.requireActual
// resolves the real React WITHOUT a require() call — keeping the known
// lint-warning count unchanged.
jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const zero = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: { readonly children: React.ReactNode }) =>
      children,
    SafeAreaConsumer: ({
      children,
    }: {
      readonly children: (insets: typeof zero) => React.ReactNode;
    }) => children(zero),
    SafeAreaInsetsContext: React.createContext(zero),
    SafeAreaFrameContext: React.createContext(frame),
    initialWindowMetrics: { insets: zero, frame },
    useSafeAreaInsets: () => zero,
    useSafeAreaFrame: () => frame,
  };
});

const SettingsStack = createNativeStackNavigator<{
  'settings-root': undefined;
  'settings-deep': undefined;
}>();

/** The root of the settings stack: a one-press path to the deep screen. */
function SettingsRoot() {
  const navigation = useNavigation() as {
    navigate: (name: 'settings-deep') => void;
  };
  return (
    <Pressable
      testID="go-deep"
      onPress={() => navigation.navigate('settings-deep')}
    >
      <Text>root</Text>
    </Pressable>
  );
}

function SettingsDeep() {
  return <Text testID="screen-deep">deep</Text>;
}

describe('RootTabs — Settings tab leave reset (item K)', () => {
  it('Dashboard → Settings(deep) → Dashboard → Settings lands on the ROOT + discards the draft', async () => {
    const store = createDashboardStore(defaultDashboardsFile());
    store.getState().enterEdit('main', 'room-living');
    expect(store.getState().editMode).toBe(true);
    const onSettingsLeave = jest.fn(() => store.getState().cancelEdit());

    const routes: string[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <NavigationContainer
          onStateChange={state => {
            // The active leaf route name of the settings tab (approximate:
            // the deepest focused route across the tree).
            type NavState = {
              index: number;
              routes: readonly { name?: string; state?: NavState }[];
            };
            const walk = (nav: NavState): string => {
              const route = nav.routes[nav.index];
              if (route?.state) {
                return walk(route.state);
              }
              return String(route?.name);
            };
            routes.push(walk(state as NavState));
          }}
        >
          <ThemeProvider mode="light">
            <RootTabs
              renderDashboard={() => <Text testID="screen-dashboard">D</Text>}
              renderHistory={() => <Text testID="screen-history">H</Text>}
              renderSettings={() => (
                <SettingsStack.Navigator>
                  <SettingsStack.Screen
                    name="settings-root"
                    component={SettingsRoot}
                  />
                  <SettingsStack.Screen
                    name="settings-deep"
                    component={SettingsDeep}
                  />
                </SettingsStack.Navigator>
              )}
              onSettingsLeave={onSettingsLeave}
            />
          </ThemeProvider>
        </NavigationContainer>,
      );
    });

    const press = async (testID: string) => {
      await act(async () => {
        renderer.root.findByProps({ testID }).props.onPress();
      });
      // The tab-leave reset defers its popToTop by one macrotask (the
      // draft must be discarded BEFORE the removal event fires — no
      // usePreventRemove dialog on tab leave). Flush it deterministically.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    };

    // Deep into the settings stack.
    await press('tab-settings');
    await press('go-deep');
    expect(renderer.root.findByProps({ testID: 'screen-deep' })).toBeTruthy();

    // LEAVE the settings tab: blur fires → stack resets + draft discarded.
    await press('tab-dashboard');
    expect(onSettingsLeave).toHaveBeenCalledTimes(1);
    expect(store.getState().editMode).toBe(false);
    expect(store.getState().draftWidgets).toBeNull();

    // RETURN to the settings tab: the ROOT is the active route (the deep
    // screen may stay MOUNTED in the native stack — an implementation
    // detail; the route state is the user-visible truth).
    await press('tab-settings');
    expect(routes.at(-1)).toBe('settings-root');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('re-press of the FOCUSED settings tab still pops to root (cycle-3 B intact)', async () => {
    const store = createDashboardStore(defaultDashboardsFile());
    const onSettingsLeave = jest.fn(() => store.getState().cancelEdit());
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <NavigationContainer>
          <ThemeProvider mode="light">
            <RootTabs
              renderDashboard={() => <Text testID="screen-dashboard">D</Text>}
              renderHistory={() => <Text testID="screen-history">H</Text>}
              renderSettings={() => (
                <SettingsStack.Navigator>
                  <SettingsStack.Screen
                    name="settings-root"
                    component={SettingsRoot}
                  />
                  <SettingsStack.Screen
                    name="settings-deep"
                    component={SettingsDeep}
                  />
                </SettingsStack.Navigator>
              )}
              onSettingsLeave={onSettingsLeave}
            />
          </ThemeProvider>
        </NavigationContainer>,
      );
    });

    const press = async (testID: string) => {
      await act(async () => {
        renderer.root.findByProps({ testID }).props.onPress();
      });
    };

    await press('tab-settings');
    await press('go-deep');
    expect(renderer.root.findByProps({ testID: 'screen-deep' })).toBeTruthy();
    // Re-press the FOCUSED tab → pops to root (blur does NOT fire — the
    // tab never lost focus — so onSettingsLeave is NOT called).
    await press('tab-settings');
    expect(renderer.root.findAllByProps({ testID: 'screen-deep' }).length).toBe(
      0,
    );
    expect(onSettingsLeave).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('tab leave with a DIRTY editor draft: discarded silently — no usePreventRemove dialog', async () => {
    // A miniature of the REAL editor route's guard (same mechanism as
    // hierarchyRoutes' EditRoomDashboardRoute): usePreventRemove(dirty)
    // with an explicit discard dialog when a removal is prevented.
    let openDiscardDialog = false;
    const store = createDashboardStore(defaultDashboardsFile());
    store.getState().enterEdit('main', 'room-living');
    // Make the draft DIRTY (rename a seed widget).
    store.getState().renameDraftWidget('w-temp', 'Bản nháp bẩn');
    expect(store.getState().editMode).toBe(true);

    function MiniEditor() {
      const dirty = useStore(store, state => state.editMode);
      // Same guard shape as the route: prevent removals while dirty.
      usePreventRemove(Boolean(dirty), () => {
        openDiscardDialog = true;
      });
      return <Text testID="screen-deep">editor</Text>;
    }

    const onSettingsLeave = jest.fn(() => store.getState().cancelEdit());
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <NavigationContainer>
          <ThemeProvider mode="light">
            <RootTabs
              renderDashboard={() => <Text testID="screen-dashboard">D</Text>}
              renderHistory={() => <Text testID="screen-history">H</Text>}
              renderSettings={() => (
                <SettingsStack.Navigator>
                  <SettingsStack.Screen
                    name="settings-root"
                    component={SettingsRoot}
                  />
                  <SettingsStack.Screen
                    name="settings-deep"
                    component={MiniEditor}
                  />
                </SettingsStack.Navigator>
              )}
              onSettingsLeave={onSettingsLeave}
            />
          </ThemeProvider>
        </NavigationContainer>,
      );
    });

    const press = async (testID: string) => {
      await act(async () => {
        renderer.root.findByProps({ testID }).props.onPress();
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    };

    await press('tab-settings');
    await press('go-deep');
    // LEAVE mid-edit: the draft is discarded (never persisted) and the
    // popToTop completes WITHOUT the guard's discard dialog.
    await press('tab-dashboard');
    expect(store.getState().editMode).toBe(false);
    expect(store.getState().draftWidgets).toBeNull();
    expect(openDiscardDialog).toBe(false);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('staying on the Dashboard tab: blur side effects never fire', async () => {
    const onSettingsLeave = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <NavigationContainer>
          <ThemeProvider mode="light">
            <RootTabs
              renderDashboard={() => <Text testID="screen-dashboard">D</Text>}
              renderHistory={() => <Text testID="screen-history">H</Text>}
              renderSettings={() => <Text testID="screen-settings">S</Text>}
              onSettingsLeave={onSettingsLeave}
            />
          </ThemeProvider>
        </NavigationContainer>,
      );
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-dashboard' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'tab-history' }).props.onPress();
    });
    expect(onSettingsLeave).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});
