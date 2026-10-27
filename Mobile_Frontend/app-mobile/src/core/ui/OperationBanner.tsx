/**
 * OperationBanner — the ONE presentation seam for general nested-screen
 * operation feedback (approved settings-information-architecture plan).
 *
 * A compact top-center banner below the safe-area/header that receives a
 * typed severity + message + visibility. Field-level validation stays
 * inline in the forms and destructive actions keep their confirmation
 * dialogs — this module is only for whole-operation outcomes (saved, add
 * failed, quota exceeded, …).
 *
 * `useOperationFeedback` is the tiny state owner screens reuse so each
 * nested screen gets the same auto-timeout behavior without duplicating
 * logic. The component itself is pure: no timers, no navigation knowledge.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, type ThemeTokens } from '@core/theme';

/** Severity of an operation outcome. */
export type OperationSeverity = 'success' | 'error' | 'info';

/** One operation outcome shown by the banner. */
export interface OperationFeedback {
  readonly severity: OperationSeverity;
  readonly message: string;
}

/**
 * How long one outcome stays visible before auto-hiding. Exported for
 * timer-lifecycle tests.
 */
export const AUTO_HIDE_MS = 4000;

/** Enter/exit animation duration (fade + vertical slide). */
export const BANNER_ANIMATION_MS = 200;

/** Enter/exit offsets: the banner slides down from 8px above its slot. */
const ENTER_Y = -8;

/**
 * State helper for screens showing operation feedback: `show` replaces the
 * current outcome and restarts the auto-hide timer; `clear` hides it now.
 *
 * Exit ownership (fix cycle 7 J): when an outcome hides (auto-hide or
 * `clear`), the hook keeps the message available for the exit animation
 * window (`exiting: true`) and clears it after `BANNER_ANIMATION_MS` —
 * ALL transitions ride plain timer callbacks (event handlers / timer
 * callbacks only — never synchronous setState inside effects), so the
 * lifecycle stays deterministic under fake timers.
 */
export function useOperationFeedback(): {
  feedback: OperationFeedback | null;
  exiting: boolean;
  show: (feedback: OperationFeedback) => void;
  clear: () => void;
} {
  const [state, setState] = useState<{
    feedback: OperationFeedback | null;
    exiting: boolean;
  }>({ feedback: null, exiting: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armExitCompletion = () => {
    timer.current = setTimeout(() => {
      timer.current = null;
      setState({ feedback: null, exiting: false });
    }, BANNER_ANIMATION_MS);
  };

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setState(s => (s.feedback ? { feedback: s.feedback, exiting: true } : s));
    armExitCompletion();
  };

  const show = (next: OperationFeedback) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setState({ feedback: next, exiting: false });
    timer.current = setTimeout(() => {
      timer.current = null;
      setState(s => (s.feedback ? { feedback: s.feedback, exiting: true } : s));
      armExitCompletion();
    }, AUTO_HIDE_MS);
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return { feedback: state.feedback, exiting: state.exiting, show, clear };
}

/** Accent + icon per severity (theme-token driven). */
function severityStyle(
  severity: OperationSeverity,
  tokens: ThemeTokens,
): { color: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (severity) {
    case 'success':
      return { color: tokens.success, icon: 'checkmark-circle-outline' };
    case 'error':
      return { color: tokens.danger, icon: 'alert-circle-outline' };
    default:
      return { color: tokens.primary, icon: 'information-circle-outline' };
  }
}

interface OperationBannerProps {
  /** The current outcome, or `null` when nothing should show. */
  readonly feedback: OperationFeedback | null;
  /** True while the outcome is animating out (message still rendered). */
  readonly exiting?: boolean;
  /** Dismiss the banner immediately (optional). */
  readonly onDismiss?: () => void;
  /** Test hook. */
  readonly testID?: string;
}

/**
 * The top-center operation banner. Renders `null` without feedback so
 * screens can mount it unconditionally at the top of their container.
 *
 * Animation (fix cycle 7): enter is a fade + subtle vertical slide
 * (opacity 0→1, translateY -8→0); while `exiting` runs the reverse — the
 * hook keeps the message rendered for the exit window and clears it
 * afterwards, so this component owns NO timers (fully deterministic under
 * fake timers). When the OS reports reduced motion
 * (`AccessibilityInfo.isReduceMotionEnabled`), both durations collapse to
 * 0 — the banner appears/disappears instantly.
 *
 * Reduced-motion reliability (fix cycle 8 J — reviewer major): the
 * preference starts DISABLED-ANIMATION (`true`) until the OS answers, so a
 * reduce-motion user can never see an animated frame — not even during
 * the async query window of the FIRST banner render (previously the
 * default `false` animated 200ms before the answer arrived). The live
 * `reduceMotionChanged` event keeps the component in sync while mounted,
 * and the async answer/change listener are lifecycle-safe: neither can
 * setState after unmount. The trade-off is intentional: a normal-motion
 * user's first banner may appear instantly (before the preference
 * resolves) — strictly better than animating for a reduce-motion user.
 */
export function OperationBanner({
  feedback,
  exiting = false,
  onDismiss,
  testID = 'operation-banner',
}: OperationBannerProps) {
  const { tokens } = useTheme();
  // Start with animation DISABLED until the OS preference is confirmed —
  // the safe direction for the first-render window (see the doc above).
  const [reduceMotion, setReduceMotion] = useState(true);
  const [animation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // Lifecycle-safe acquisition: the async answer and the change event
    // are ignored after unmount; the subscription is removed with the
    // effect so the OS never delivers to a dead listener either.
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(enabled => {
        if (active) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (active) {
          setReduceMotion(enabled);
        }
      },
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  // Stop any in-flight animation when the banner unmounts — a detached
  // node must never receive late animation frames.
  useEffect(() => () => animation.stopAnimation(), [animation]);

  useEffect(() => {
    const duration = reduceMotion ? 0 : BANNER_ANIMATION_MS;
    if (!feedback) {
      return;
    }
    Animated.timing(animation, {
      toValue: exiting ? 0 : 1,
      duration,
      useNativeDriver: true,
    }).start();
  }, [feedback, exiting, reduceMotion, animation]);

  if (!feedback || !feedback.message) {
    return null;
  }
  const { color, icon } = severityStyle(feedback.severity, tokens);
  return (
    <Animated.View
      testID={testID}
      pointerEvents="box-none"
      style={[
        styles.banner,
        // Smart card recipe (settings-smart-home-sync): smart card surface
        // + token radius + the theme's card shadow; the severity accent
        // stays the border color (success/danger/info semantics unchanged).
        {
          backgroundColor: tokens.smart.colors.card,
          borderColor: color,
          borderRadius: tokens.smart.radius.card,
        },
        tokens.smart.cardShadow,
        {
          opacity: animation,
          transform: [
            {
              translateY: animation.interpolate({
                inputRange: [0, 1],
                outputRange: [ENTER_Y, 0],
              }),
            },
          ],
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <Ionicons name={icon} size={16} color={color} />
        <Text
          style={[styles.message, { color: tokens.smart.colors.textPrimary }]}
          numberOfLines={3}
        >
          {feedback.message}
        </Text>
        {onDismiss ? (
          <TouchableOpacity
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Đóng thông báo"
            hitSlop={8}
          >
            <Ionicons
              name="close-outline"
              size={16}
              color={tokens.smart.colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    alignSelf: 'center',
    maxWidth: 560,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  message: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
});
