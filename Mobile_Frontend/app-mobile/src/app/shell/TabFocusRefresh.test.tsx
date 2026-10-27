/**
 * TabFocusRefresh tests (history-tab-focus-refresh).
 *
 * Verifies the wrapper through a REAL React Navigation bottom-tab
 * navigator using the same react-test-renderer + `tab-<name>` press
 * pattern as the RootTabs suites:
 * - the callback fires EXACTLY ONCE on the initial focus (with
 *   `lazy: true` the first mount ≡ the first focus);
 * - each later unfocused → focused transition fires it EXACTLY ONCE
 *   (away → back twice = one extra call per return, never doubled);
 * - an unrelated re-render while focused that changes the callback
 *   IDENTITY does NOT fire it again (the ref pattern — App re-renders
 *   from telemetry ticks must not re-query), and the LATEST callback
 *   identity is the one used on the next focus.
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';

import { TabFocusRefresh } from './TabFocusRefresh';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

// Same safe-area mock pattern as the RootTabs suites (the real provider
// cannot measure under react-test-renderer). jest.requireActual resolves
// the real React WITHOUT a require() call — keeping the known lint-warning
// count unchanged.
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

type TestTabParams = { main: undefined; other: undefined };

const Tab = createBottomTabNavigator<TestTabParams>();

/** The two-tab host tree for one callback identity. */
function treeFor(onFocus: jest.Mock): React.ReactElement {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          lazy: true,
          // The navigator-native way to pin a stable `tab-<name>` testID on
          // the default tab button (the same convention as the root shell),
          // so the tests press tabs exactly like the App/RootTabs suites.
          tabBarButtonTestID: `tab-${route.name}`,
        })}
      >
        <Tab.Screen name="main">
          {() => (
            <TabFocusRefresh onFocus={onFocus}>
              <Text testID="screen-main">main</Text>
            </TabFocusRefresh>
          )}
        </Tab.Screen>
        <Tab.Screen name="other">
          {() => <Text testID="screen-other">other</Text>}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

async function renderTwoTabs(onFocus: jest.Mock) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(treeFor(onFocus));
  });
  return renderer;
}

/** One tab press inside act (the App.test press pattern). */
async function pressTab(
  renderer: TestRenderer.ReactTestRenderer,
  name: keyof TestTabParams,
) {
  await act(async () => {
    renderer.root.findByProps({ testID: `tab-${name}` }).props.onPress();
  });
}

describe('TabFocusRefresh', () => {
  it('invokes the callback EXACTLY ONCE on the initial focus', async () => {
    const onFocus = jest.fn();
    const renderer = await renderTwoTabs(onFocus);
    expect(renderer.root.findByProps({ testID: 'screen-main' })).toBeTruthy();
    expect(onFocus).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('invokes the callback EXACTLY ONCE per later unfocused→focused transition', async () => {
    const onFocus = jest.fn();
    const renderer = await renderTwoTabs(onFocus);
    // Initial focus (mount under `lazy: true`) — counted above.
    expect(onFocus).toHaveBeenCalledTimes(1);

    // main → other: a blur fires nothing.
    await pressTab(renderer, 'other');
    expect(renderer.root.findByProps({ testID: 'screen-other' })).toBeTruthy();
    expect(onFocus).toHaveBeenCalledTimes(1);

    // other → main: the refocus fires EXACTLY ONE more call.
    await pressTab(renderer, 'main');
    expect(onFocus).toHaveBeenCalledTimes(2);

    // other → main again: one call per return, never doubled.
    await pressTab(renderer, 'other');
    await pressTab(renderer, 'main');
    expect(onFocus).toHaveBeenCalledTimes(3);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does NOT re-fire on an unrelated re-render with a NEW callback identity (latest identity wins on the next focus)', async () => {
    const first = jest.fn();
    const renderer = await renderTwoTabs(first);
    expect(first).toHaveBeenCalledTimes(1);

    // Re-render while focused with a NEW callback identity — exactly what
    // an App re-render (telemetry tick) does to an inline prop callback.
    const second = jest.fn();
    await act(async () => {
      renderer.update(treeFor(second));
    });
    // The identity change alone never fires either callback…
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // …and the next focus uses the LATEST identity, exactly once.
    await pressTab(renderer, 'other');
    await pressTab(renderer, 'main');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });
});
