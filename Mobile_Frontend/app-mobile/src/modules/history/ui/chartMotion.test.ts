/**
 * chartMotion tests (history-chart-reveal-downsample): the timing
 * constants are pinned by test (AD-8 — no magic numbers in assertions)
 * and the `useChartReduceMotion` hook contract mirrors the
 * `OperationBanner` reduced-motion pattern (fix cycle 8 J) — with the
 * AD-6 divergence: the hook starts animate-ON (`false`), because a chart
 * reveal is decorative (a ≤450ms window) unlike the banner's
 * operational feedback (starts disabled-until-confirmed).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';

import {
  MAX_RENDER_POINTS,
  REVEAL_COARSE_POINTS,
  REVEAL_SWEEP_MS,
  SETTLE_DELAY_MS,
  useChartReduceMotion,
} from './chartMotion';

/** The value the hook returned on the harness's most recent render. */
const captured: { value?: boolean } = {};

/** Render-time capture (kept out of the component per react-hooks rules). */
const capture = (value: boolean) => {
  captured.value = value;
};

function HookHarness(): null {
  capture(useChartReduceMotion());
  return null;
}

describe('chartMotion constants (AD-8)', () => {
  it('pins the approved motion budget', () => {
    expect(REVEAL_SWEEP_MS).toBe(450);
    expect(SETTLE_DELAY_MS).toBe(300);
    // dashboard-history-board-touch-share (AD-2): the Flux query
    // aggregates server-side, so the render cap is a safety net ABOVE the
    // largest expected window (168) — the settle phase draws the FULL
    // aggregated series, never a 50-point stride.
    expect(MAX_RENDER_POINTS).toBe(200);
    expect(MAX_RENDER_POINTS).toBeGreaterThan(168);
    expect(REVEAL_COARSE_POINTS).toBe(10);
  });
});

describe('useChartReduceMotion (AD-6: default animate-ON)', () => {
  let isReduceMotionEnabledSpy: jest.SpyInstance;
  let addEventListenerSpy: jest.SpyInstance;
  let changeListener: ((enabled: boolean) => void) | null;
  let subscriptionRemoved: boolean;

  beforeEach(() => {
    captured.value = undefined;
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
  });

  afterEach(() => {
    isReduceMotionEnabledSpy.mockRestore();
    addEventListenerSpy.mockRestore();
  });

  /** Flush the mocked preference promise (one microtask hop). */
  const flushPreference = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('starts FALSE (animate-on) before the OS preference is confirmed', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness));
    });
    expect(captured.value).toBe(false);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('resolves the OS preference (true → reduce motion ON)', async () => {
    isReduceMotionEnabledSpy.mockResolvedValue(true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness));
    });
    await flushPreference();
    expect(captured.value).toBe(true);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('resolves the OS preference (false → stays animate-on)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness));
    });
    await flushPreference();
    expect(captured.value).toBe(false);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('follows live reduceMotionChanged events while mounted', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness));
    });
    await flushPreference();
    expect(changeListener).not.toBeNull();

    act(() => {
      changeListener?.(true);
    });
    expect(captured.value).toBe(true);

    act(() => {
      changeListener?.(false);
    });
    expect(captured.value).toBe(false);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('removes the OS listener on unmount (no delivery to a dead hook)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHarness));
    });
    await flushPreference();
    await act(async () => {
      renderer.unmount();
    });
    expect(subscriptionRemoved).toBe(true);
    expect(changeListener).toBeNull();
  });
});
