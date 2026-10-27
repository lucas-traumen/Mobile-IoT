/**
 * Motion timing constants + the reduce-motion seam for the History chart
 * reveal (history-chart-reveal-downsample, AD-6/AD-8).
 *
 * The reveal is a two-phase presentation of ONE fetch (AD-2): the chart
 * mounts on a COARSE 10-point sample spread across the full window sweeping
 * left→right (`REVEAL_SWEEP_MS`, via victory's built-in `onLoad` clip
 * reveal), then `SETTLE_DELAY_MS` after mount it settles onto the FULL
 * aggregated series (victory morphs between the two data shapes; the
 * phases overlap deliberately). `MAX_RENDER_POINTS` is a safety-net render
 * cap above every expected aggregated window — since the Flux query
 * aggregates server-side (dashboard-history-board-touch-share, AD-2), the
 * settle phase is the whole series, not a strided subset.
 *
 * Reduce-motion (AD-6) — DELIBERATE divergence from the
 * `OperationBanner` pattern (ADR-018 + fix cycle 8 J): the banner is
 * OPERATIONAL feedback, so it starts disabled-until-confirmed and a
 * reduce-motion user can never see an animated frame. The chart reveal
 * is DECORATIVE (pure motion, no information — the settled chart is the
 * same data), so this hook starts animate-ON (`false`) until the OS
 * confirms the preference. Accepted trade-off: a reduce-motion user may
 * see at most ONE ~`REVEAL_SWEEP_MS` window before the async answer (or
 * a `reduceMotionChanged` event) collapses the reveal to the settled
 * fine chart. `AccessibilityInfo.isReduceMotionEnabled` +
 * `reduceMotionChanged` keep the value in sync while mounted; neither
 * the async answer nor the event can setState after unmount, and the
 * subscription is removed with the effect (lifecycle-safe).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Left→right reveal sweep (victory `onLoad` clip duration), in ms. */
export const REVEAL_SWEEP_MS = 450;

/**
 * Mount delay before the coarse reveal settles onto the fine full-series
 * presentation (overlaps the tail of the sweep), in ms.
 */
export const SETTLE_DELAY_MS = 300;

/**
 * Render cap for one chart series (AD-4). With the Flux-side
 * `aggregateWindow` (dashboard-history-board-touch-share, AD-2) the
 * delivered series are already small (~60/96/168 points), so this cap is
 * only a safety net ABOVE the largest expected window (168) — the settle
 * phase renders the FULL aggregated series (passthrough), never a 50-point
 * stride of it.
 */
export const MAX_RENDER_POINTS = 200;

/** Coarse reveal sample size (first phase), spread across the full window. */
export const REVEAL_COARSE_POINTS = 10;

/**
 * Whether the chart reveal should be suppressed. Starts `false`
 * (animate-ON — see the AD-6 divergence in the module doc), then mirrors
 * the OS reduce-motion preference while the component stays mounted.
 */
export function useChartReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    // Lifecycle-safe acquisition (same contract as OperationBanner): the
    // async answer and the change event are ignored after unmount; the
    // subscription is removed with the effect so the OS never delivers to
    // a dead listener either. The answer is wrapped in `Promise.resolve`
    // and type-checked because the RN bridge (and its jest mocks) may
    // hand back `undefined` instead of a promise — the hook must stay
    // animate-ON in that case, never crash.
    let active = true;
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then(enabled => {
        if (active && typeof enabled === 'boolean') {
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

  return reduceMotion;
}
