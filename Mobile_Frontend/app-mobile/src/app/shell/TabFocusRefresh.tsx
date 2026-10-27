/**
 * TabFocusRefresh — a shell wrapper that runs an `onFocus` callback every
 * time the tab screen hosting it gains focus (history-tab-focus-refresh).
 *
 * Placement: the SHELL (composition/shell layer), not a module UI — tab
 * focus is a navigation concern, so screens stay purely prop-driven (the
 * History screen no longer owns a mount-time fetch; this wrapper subsumes
 * it because with `lazy: true` the first mount ≡ the first focus).
 *
 * Callback-stability contract: the effect callback handed to
 * `useFocusEffect` is `useCallback(..., [])`-stable, and the latest
 * `onFocus` prop is read through a ref. A parent re-render that changes
 * the callback IDENTITY (App re-renders on every telemetry tick with an
 * inline arrow prop) therefore NEVER re-fires the focus work — the
 * callback runs once when the screen is initially focused and once per
 * later unfocused → focused transition, and each run uses the most recent
 * `onFocus` identity.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

interface TabFocusRefreshProps {
  /**
   * Runs once when the host screen is initially focused and once for each
   * later unfocused → focused transition. Identity changes between renders
   * never re-trigger it (the latest identity is used on the next focus).
   */
  readonly onFocus: () => void;
  readonly children: React.ReactNode;
}

/**
 * Generic focus-refresh wrapper around any tab screen content.
 *
 * @param props - see {@link TabFocusRefreshProps}.
 */
export function TabFocusRefresh({ onFocus, children }: TabFocusRefreshProps) {
  // Latest-callback ref: the stable focus effect below reads the CURRENT
  // prop identity at fire time instead of closing over a stale one. The
  // sync runs in an effect — never during render (react-hooks/refs) — and
  // since effects flush before any focus listener can fire, the ref is
  // always the latest identity when the callback runs.
  const focusRef = useRef(onFocus);
  useEffect(() => {
    focusRef.current = onFocus;
  });
  useFocusEffect(
    useCallback(() => {
      focusRef.current();
    }, []),
  );
  return <>{children}</>;
}
