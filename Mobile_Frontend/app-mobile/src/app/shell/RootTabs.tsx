/**
 * RootTabs — the root bottom-tab navigator (React Navigation), restyled to
 * the Smart Home design language (dashboard-smart-home-redesign). EXACTLY
 * three root tabs: Dashboard (`grid-outline` — the 2×2-squares OUTLINE
 * glyph, scope amendment 3's one-family rule; verified present in the
 * installed Ionicons map) / Lịch sử (`time-outline`) / Cài đặt
 * (`settings-outline`) — all THREE tabs use the SAME Ionicons family. The
 * Dashboard tab renders the view-only dashboard screen; the Template →
 * Room → Widget management hierarchy lives INSIDE the Settings tab's
 * native stack (Template and Room are never tabs and never screens of the
 * Dashboard tab).
 *
 * Tab bar style (scope amendment 3): active tab = TEAL icon (22) +
 * semibold label (12) + a SUBTLE SELECTED BACKGROUND TINT behind the item
 * (a light teal fill with a small radius — the amendment-2 underline
 * indicator is REMOVED); inactive tabs = regular-weight muted blue-gray
 * (`smart` textSecondary) with no tint. Bar surface = smart card color +
 * hairline top border. Touch targets stay ≥44 (navigator-owned bar
 * height; the tint adds no vertical inset). Navigation structure, stable
 * `tab-<name>` testIDs and press semantics are unchanged.
 *
 * Safe-area ownership (single source of truth, same contract as the
 * previous shell): the ROOT content container applies the runtime TOP
 * inset exactly once for every tab screen (children never pad the same
 * inset again; absolute overlays like AddWidgetFlow keep offsetting
 * against this padded container). The BOTTOM inset is owned by the React
 * Navigation tab bar (its built-in safe-area handling) — screens must not
 * pad it a second time.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
} from '@react-navigation/bottom-tabs';
import { NavigationAction, StackActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { safeInset } from '@core/safeArea';
import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

/**
 * The three root tabs (Dashboard hosts the view-only dashboard screen; the
 * Settings tab hosts the management stack).
 */
export type RootTabParams = {
  dashboard: undefined;
  history: undefined;
  settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParams>();

// One family for ALL tabs (scope amendment 3): Ionicons throughout — the
// Dashboard glyph is the 2×2-squares OUTLINE `grid-outline` (verified in
// the installed Ionicons glyph map), replacing the amendment-2 `apps`
// filled-squares glyph that broke the outline consistency.
const TAB_ICONS: Record<keyof RootTabParams, keyof typeof Ionicons.glyphMap> = {
  dashboard: 'grid-outline',
  history: 'time-outline',
  settings: 'settings-outline',
};

const TAB_LABELS: Record<keyof RootTabParams, string> = {
  dashboard: STRINGS.tabs.dashboard,
  history: STRINGS.tabs.history,
  settings: STRINGS.tabs.settings,
};

interface RootTabsProps {
  /** The Dashboard tab content (the view-only dashboard screen). */
  readonly renderDashboard: () => React.ReactNode;
  /** The History tab content (unchanged screen). */
  readonly renderHistory: () => React.ReactNode;
  /** The Settings tab content (the typed Settings management stack). */
  readonly renderSettings: () => React.ReactNode;
  /**
   * LEAVING the Settings tab (user decision, supersedes part of the
   * re-press behavior): reset side effects — the composition root
   * discards any open editor draft (cancelEdit; never silently
   * persisted). The STACK reset itself (popToTop) is owned here.
   */
  readonly onSettingsLeave: () => void;
}

/**
 * The root tab navigator.
 *
 * @param props - see {@link RootTabsProps}.
 */
export function RootTabs({
  renderDashboard,
  renderHistory,
  renderSettings,
  onSettingsLeave,
}: RootTabsProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    // Shell-owned background so the inset-filled strips use the theme
    // background instead of the window default (previous shell contract).
    <View style={[styles.flex, { backgroundColor: tokens.background }]}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          lazy: true,
          // Smart Home tab bar: teal active accent, muted blue-gray
          // inactive, card surface + hairline top border.
          tabBarActiveTintColor: tokens.smart.colors.teal,
          tabBarInactiveTintColor: tokens.smart.colors.textSecondary,
          tabBarStyle: {
            backgroundColor: tokens.smart.colors.card,
            borderTopColor: tokens.smart.colors.cardBorder,
            borderTopWidth: 1,
            // The React Navigation tab bar owns the bottom inset (single
            // ownership — screens never pad the bottom for the tab bar).
          },
          tabBarIcon: ({ color }) => (
            <Ionicons
              name={TAB_ICONS[route.name as keyof RootTabParams]}
              size={22}
              color={color}
            />
          ),
          // Scope amendment 3: active label semibold + teal (the active
          // tint arrives via `tabBarActiveTintColor`), the inactive label
          // regular-weight gray-blue. The amendment-2 underline indicator
          // is REMOVED — the selected state rides the icon/label accent +
          // the tinted button background below.
          tabBarLabel: ({ focused, color }) => (
            <Text
              style={[
                styles.labelText,
                { color },
                focused ? styles.labelTextActive : styles.labelTextInactive,
              ]}
            >
              {TAB_LABELS[route.name as keyof RootTabParams]}
            </Text>
          ),
          tabBarButton: (props: BottomTabBarButtonProps) => (
            <TabButtonBridge
              {...props}
              testID={`tab-${route.name}`}
              selectedBackgroundColor={tokens.smart.colors.tealTint}
            />
          ),
        })}
      >
        <Tab.Screen name="dashboard">
          {({ navigation, route }) => (
            <TabScreenContainer topInset={safeInset(insets.top)}>
              <TabPressPop navigation={navigation} routeKey={route.key}>
                {renderDashboard()}
              </TabPressPop>
            </TabScreenContainer>
          )}
        </Tab.Screen>
        <Tab.Screen name="history">
          {({ navigation, route }) => (
            <TabScreenContainer topInset={safeInset(insets.top)}>
              <TabPressPop navigation={navigation} routeKey={route.key}>
                {renderHistory()}
              </TabPressPop>
            </TabScreenContainer>
          )}
        </Tab.Screen>
        <Tab.Screen name="settings">
          {({ navigation, route }) => (
            <TabScreenContainer topInset={safeInset(insets.top)}>
              <TabPressPop navigation={navigation} routeKey={route.key}>
                <TabLeaveReset
                  navigation={navigation}
                  routeKey={route.key}
                  onLeave={onSettingsLeave}
                >
                  {renderSettings()}
                </TabLeaveReset>
              </TabPressPop>
            </TabScreenContainer>
          )}
        </Tab.Screen>
      </Tab.Navigator>
    </View>
  );
}

/**
 * Re-press the ALREADY-FOCUSED tab → that tab's navigator pops to its
 * root screen (the hand-written shell's behavior, restored): deep in the
 * Settings management stack, tapping "Cài đặt" again returns to the
 * settings root. Pressing a DIFFERENT tab keeps the default switch.
 * `popToTop` is a harmless no-op on single-screen tabs (Dashboard /
 * History render one screen each), keeping the behavior uniform.
 */
function TabPressPop({
  navigation,
  routeKey,
  children,
}: {
  /** This tab screen's own navigation object (emits `tabPress`). */
  readonly navigation: TabScreenNavigation;
  /** THIS tab screen's route key (finds its nested navigator state). */
  readonly routeKey: string;
  readonly children: React.ReactNode;
}) {
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', event => {
      // `isFocused()` is evaluated at press time — pressing the focused
      // tab pops its stack to the root; pressing another tab lets the
      // default switch proceed (no preventDefault).
      if (!navigation.isFocused()) {
        return;
      }
      event.preventDefault();
      popTabToRoot(navigation, routeKey);
    });
    return unsubscribe;
  }, [navigation, routeKey]);
  return <>{children}</>;
}

/**
 * LEAVING the Settings tab (user decision, supersedes part of the
 * re-press behavior): on `blur` the tab's stack pops to its root AND
 * `onLeave` runs (the composition root discards any open editor draft —
 * cancelEdit, never silently persisted). Returning to the tab always
 * shows the Settings root.
 *
 * NOTE: `blur` fires AFTER the tab navigator already switched (the newly
 * focused tab owns `routes[index]`), so the reset must locate THIS tab's
 * route by its own `routeKey` — never by the current index.
 */
function TabLeaveReset({
  navigation,
  routeKey,
  onLeave,
  children,
}: {
  readonly navigation: TabScreenNavigation;
  readonly routeKey: string;
  readonly onLeave: () => void;
  readonly children: React.ReactNode;
}) {
  const exitTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      // Discard FIRST (synchronous store write → the editor's
      // useSyncExternalStore re-render clears `dirty` and disables its
      // usePreventRemove guard), THEN pop in a macrotask — the removal
      // event can never hit a stale dirty guard (no discard dialog on
      // tab leave: ONE clear discard path).
      onLeave();
      exitTimer.current = setTimeout(() => {
        exitTimer.current = null;
        popTabToRoot(navigation, routeKey);
      }, 0);
    });
    return () => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
      }
      unsubscribe();
    };
  }, [navigation, routeKey, onLeave]);
  return <>{children}</>;
}

/** The slice of a bottom-tab screen's navigation object the shell needs. */
interface TabScreenNavigation {
  addListener: (
    type: 'tabPress' | 'blur',
    listener: (event: { preventDefault: () => void }) => void,
  ) => () => void;
  isFocused: () => boolean;
  getState: () => {
    index: number;
    routes: readonly {
      readonly key: string;
      readonly state?: { readonly key: string };
    }[];
  };
  dispatch: (action: NavigationAction) => void;
}

/**
 * POP_TO_TOP targeted at THIS tab screen's nested navigator (found by the
 * screen's own route key — index-based lookup breaks on `blur`, when the
 * tab switch already moved `routes[index]`).
 */
function popTabToRoot(navigation: TabScreenNavigation, routeKey: string): void {
  const state = navigation.getState();
  const myRoute = state.routes.find(route => route.key === routeKey);
  const childKey = myRoute?.state?.key;
  if (childKey) {
    navigation.dispatch({ ...StackActions.popToTop(), target: childKey });
  }
}

/**
 * One top-inset owner: every tab screen starts below the status bar; the
 * inset is applied HERE exactly once (children must not re-apply it).
 */
function TabScreenContainer({
  children,
  topInset,
}: {
  readonly children: React.ReactNode;
  readonly topInset: number;
}) {
  return (
    <View style={[styles.flex, { paddingTop: topInset }]}>{children}</View>
  );
}

/**
 * One tab button with a stable `tab-<name>` testID (tests + a11y).
 *
 * Accessibility semantics (reviewer-6 bridge repair): the bridge FORWARDS
 * the navigator-provided props to the native pressable — React Navigation
 * v7.18 `BottomTabItem` supplies the tab `role` (a `Platform.select`
 * 'tab' — 'button' on iOS), `'aria-selected': focused` and `'aria-label'`.
 * RN maps a forwarded `aria-selected` into the accessible selected state,
 * so assistive technology sees the TRUE selected-tab semantics. The bridge
 * never forces `accessibilityRole="button"` and never fabricates an
 * `accessibilityState` (the navigator provides none); it only consumes the
 * forwarded `aria-selected` as the selected signal for the tint below.
 *
 * Scope amendment 3 (selected background tint): the SELECTED tab renders a
 * subtle light-teal fill behind the icon+label (small radius, horizontal
 * inset only — no vertical margin, so the navigator-owned ≥44pt touch
 * height is untouched). Inactive tabs keep the plain button surface. The
 * tint color arrives from the active theme via the bridge's own
 * `selectedBackgroundColor` prop.
 */
function TabButtonBridge({
  testID,
  children,
  onPress,
  style,
  role,
  'aria-selected': ariaSelected,
  'aria-label': ariaLabel,
  disabled,
  selectedBackgroundColor,
}: BottomTabBarButtonProps & {
  testID?: string;
  /** The theme's light-teal tint (applied only when selected). */
  readonly selectedBackgroundColor?: string;
}) {
  // React Navigation v7 signals the focused tab through `aria-selected`
  // (it no longer ships `accessibilityState.selected` on tab buttons).
  const selected = ariaSelected === true;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[
        style as never,
        selected && selectedBackgroundColor
          ? {
              backgroundColor: selectedBackgroundColor,
              borderRadius: 12,
              marginHorizontal: 8,
            }
          : null,
      ]}
      role={role}
      aria-selected={ariaSelected}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children as React.ReactNode}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Smart Home label (scope amendment 3): plain text — the underline
  // indicator is removed; the selected state is the teal accent + the
  // semibold weight + the tinted button background.
  labelText: { fontSize: 12 },
  // Scope amendment 2 (tab bar presence): the ACTIVE label is semibold;
  // the inactive label is regular gray-blue.
  labelTextActive: { fontWeight: '600' },
  labelTextInactive: { fontWeight: '400' },
});
