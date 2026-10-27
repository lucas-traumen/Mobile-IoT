/**
 * OperationBanner tests — the single top-center feedback seam for nested
 * screens: renders the typed severity/message, auto-hides after
 * `AUTO_HIDE_MS`, and cancels its timer on unmount (timer-lifecycle safe —
 * no post-teardown state updates, fix cycle 1). The enter/exit animation
 * (fix cycle 7) is asserted ONLY through its deterministic timer contract:
 * the exit window (`BANNER_ANIMATION_MS`) elapses under fake timers before
 * absence is asserted — never through Animated internals. The
 * reduced-motion contract (fix cycle 8 J) is asserted through the PUBLIC
 * `Animated.timing` factory (the requested duration config — the
 * animation itself is never driven).
 */

import React from 'react';
import { AccessibilityInfo, Animated, Pressable, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';

import {
  AUTO_HIDE_MS,
  BANNER_ANIMATION_MS,
  OperationBanner,
  useOperationFeedback,
} from './OperationBanner';

/** Harness exposing the state helper's actions to the test. */
function BannerHarness() {
  const { feedback, exiting, show, clear } = useOperationFeedback();
  return (
    <ThemeProvider mode="light">
      {/* The banner gets its default internal testID — the caller does not
          pass one, so the rendered host View is the only match. */}
      <OperationBanner
        feedback={feedback}
        exiting={exiting}
        onDismiss={clear}
      />
      <Pressable
        testID="show-error"
        onPress={() => show({ severity: 'error', message: 'Xóa thất bại' })}
      />
      <Pressable
        testID="show-success"
        onPress={() => show({ severity: 'success', message: 'Đã lưu bố cục' })}
      />
      <Pressable testID="clear" onPress={clear} />
    </ThemeProvider>
  );
}

/** All visible text of the renderer. */
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
  return texts.join('');
}

describe('OperationBanner', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the feedback message and hides when cleared', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    // No feedback → banner hidden.
    expect(
      renderer.root.findAllByProps({ testID: 'operation-banner' }).length,
    ).toBe(0);

    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'operation-banner' }),
    ).toBeTruthy();

    await act(async () => {
      renderer.root.findByProps({ testID: 'show-success' }).props.onPress();
    });
    expect(visibleText(renderer)).toContain('Đã lưu bố cục');

    await act(async () => {
      renderer.root.findByProps({ testID: 'clear' }).props.onPress();
    });
    // The exit window elapses (deterministic, fake timers) before the
    // banner unmounts.
    await act(async () => {
      jest.advanceTimersByTime(BANNER_ANIMATION_MS);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'operation-banner' }).length,
    ).toBe(0);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('auto-hides after AUTO_HIDE_MS with no pending timer left behind', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'operation-banner' }),
    ).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(AUTO_HIDE_MS);
    });
    // Hidden again exactly when the window elapses (after the exit
    // animation window).
    await act(async () => {
      jest.advanceTimersByTime(BANNER_ANIMATION_MS);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'operation-banner' }).length,
    ).toBe(0);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('a re-show during the exit window cancels the pending unmount', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'clear' }).props.onPress();
    });
    // Re-show while the exit is still animating: the banner stays mounted
    // and shows the NEW message (no flicker-then-gone).
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-success' }).props.onPress();
    });
    await act(async () => {
      jest.advanceTimersByTime(BANNER_ANIMATION_MS);
    });
    expect(
      renderer.root.findByProps({ testID: 'operation-banner' }),
    ).toBeTruthy();
    expect(visibleText(renderer)).toContain('Đã lưu bố cục');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('cancels the auto-hide timer on unmount (no post-teardown updates)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });

    const clearSpy = jest.spyOn(global, 'clearTimeout');
    await act(async () => {
      renderer.unmount();
    });
    // The unmount cleanup cleared the pending auto-hide timer…
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();

    // …so firing every remaining timer is a safe no-op (the banner is gone
    // and no delayed state update exists to run).
    await act(async () => {
      jest.runAllTimers();
    });
  });
});

describe('OperationBanner reduced motion (fix cycle 8 J)', () => {
  let timingSpy: jest.SpyInstance;
  let isReduceMotionEnabledSpy: jest.SpyInstance;
  let addEventListenerSpy: jest.SpyInstance;
  let changeListener: ((enabled: boolean) => void) | null;
  let subscriptionRemoved: boolean;

  beforeEach(() => {
    jest.useFakeTimers();
    changeListener = null;
    subscriptionRemoved = false;
    isReduceMotionEnabledSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    addEventListenerSpy = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation(((
        _event: string,
        listener: (enabled: boolean) => void,
      ) => {
        changeListener = listener;
        return {
          remove: () => {
            subscriptionRemoved = true;
            changeListener = null;
          },
        };
      }) as unknown as typeof AccessibilityInfo.addEventListener);
    // Record the REQUESTED durations through the public Animated.timing
    // factory; the animation itself still runs (never driven here).
    timingSpy = jest.spyOn(Animated, 'timing');
  });

  afterEach(() => {
    timingSpy.mockRestore();
    isReduceMotionEnabledSpy.mockRestore();
    addEventListenerSpy.mockRestore();
    jest.useRealTimers();
  });

  /** Duration of the MOST RECENT requested timing (the active contract). */
  const lastDuration = (): number => {
    const calls = timingSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return (calls[calls.length - 1]![1] as { duration: number }).duration;
  };

  /** Flush the mocked preference promise (one microtask hop). */
  const flushPreference = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('reduce-motion enabled BEFORE the first feedback: enter AND exit use ZERO duration', async () => {
    isReduceMotionEnabledSpy.mockResolvedValue(true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    await flushPreference();
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    // ENTER: zero duration — the banner appears instantly, no animated
    // frame ever reaches a reduce-motion user.
    expect(lastDuration()).toBe(0);
    await act(async () => {
      renderer.root.findByProps({ testID: 'clear' }).props.onPress();
    });
    // EXIT: zero duration too.
    expect(lastDuration()).toBe(0);
    // The hook's retained-message exit window is UNCHANGED (the timer
    // contract stays — only the visual duration collapses).
    await act(async () => {
      jest.advanceTimersByTime(BANNER_ANIMATION_MS);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'operation-banner' }).length,
    ).toBe(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('normal motion confirmed before the first feedback: the banner animates with BANNER_ANIMATION_MS', async () => {
    isReduceMotionEnabledSpy.mockResolvedValue(false);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    await flushPreference();
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    expect(lastDuration()).toBe(BANNER_ANIMATION_MS);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('a live reduceMotionChanged event applies to subsequent feedback while mounted', async () => {
    isReduceMotionEnabledSpy.mockResolvedValue(false);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    await flushPreference();
    expect(changeListener).not.toBeNull();
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    expect(lastDuration()).toBe(BANNER_ANIMATION_MS);
    // The OS setting changes to reduce-motion WHILE mounted.
    await act(async () => {
      changeListener!(true);
    });
    // The preference flip immediately re-arms the active (exiting) state
    // with a zero-duration animation — the event took effect.
    expect(lastDuration()).toBe(0);
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-success' }).props.onPress();
    });
    expect(lastDuration()).toBe(0);
    // And back to normal motion — animated again.
    await act(async () => {
      changeListener!(false);
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    expect(lastDuration()).toBe(BANNER_ANIMATION_MS);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('unmount before the preference resolves: no late setState, subscription removed, stopAnimation runs', async () => {
    let resolvePreference: ((enabled: boolean) => void) | null = null;
    isReduceMotionEnabledSpy.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          resolvePreference = resolve;
        }),
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    const stopSpy = jest.spyOn(Animated.Value.prototype, 'stopAnimation');
    await act(async () => {
      renderer.unmount();
    });
    // The change subscription was removed with the effect (the OS can
    // never deliver to a dead listener).
    expect(subscriptionRemoved).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
    stopSpy.mockRestore();
    // The late preference answer lands AFTER unmount — it must be a safe
    // no-op (no setState on the dead component, no crash, no unhandled
    // rejection).
    await act(async () => {
      resolvePreference!(true);
      await Promise.resolve();
    });
  });

  it('feedback shown while the preference is STILL UNRESOLVED: the first Animated.timing request is ZERO-duration', async () => {
    // Pins the default-true window (fix cycle 8 J): the OS answer is
    // withheld, so the component mounts and receives feedback BEFORE
    // `isReduceMotionEnabled()` settles — the FIRST banner must already
    // request a zero-duration animation (a `useState(false)` regression
    // would request BANNER_ANIMATION_MS here).
    let resolvePreference: ((enabled: boolean) => void) | null = null;
    isReduceMotionEnabledSpy.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          resolvePreference = resolve;
        }),
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<BannerHarness />);
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-error' }).props.onPress();
    });
    // The banner IS shown during the unresolved window (the testID matches
    // the composite + host nodes — presence is what matters here).
    expect(
      renderer.root.findAllByProps({ testID: 'operation-banner' }).length,
    ).toBeGreaterThan(0);
    // Exactly ONE animation request so far — the enter of the first
    // feedback — and it was already zero-duration.
    expect(timingSpy.mock.calls).toHaveLength(1);
    expect(lastDuration()).toBe(0);
    // Resolving to TRUE afterwards keeps the animation off (the preference
    // is now confirmed; the first banner can never retroactively animate).
    await act(async () => {
      resolvePreference!(true);
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'show-success' }).props.onPress();
    });
    expect(lastDuration()).toBe(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});
