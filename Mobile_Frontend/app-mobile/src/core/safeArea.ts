/**
 * Safe-area inset arithmetic — pure helpers shared by the app shell and
 * fixed/absolute footer surfaces (Add Widget flow).
 *
 * The runtime values come from `react-native-safe-area-context`
 * (`useSafeAreaInsets`). Ownership contract (single source of truth):
 *
 * - `RootTabs` (app layer) owns the tabbed frame's insets: the React
 *   Navigation tab bar pads the bottom by the runtime bottom inset (its
 *   surface background fills the inset area) and the tab-screen content
 *   container pads its top by the runtime top inset. Child screens never
 *   apply insets themselves.
 * - Full-window absolute surfaces that must cover the status-bar strip
 *   (AddWidgetFlow) offset by `-safeInset(insets.top)` and pad their own
 *   header; footers on such surfaces use `overlayFooterBottomPadding` so the
 *   actions stay tappable above the system navigation / home indicator.
 *
 * Pure + platform-independent so Jest can verify the policies without an
 * emulator.
 */

/**
 * Sanitize a runtime inset value: finite and non-negative, `0` otherwise.
 *
 * Safe-area providers can transiently report `NaN`/`undefined`-shaped
 * numbers on some platforms before the first metrics event.
 *
 * @param value - the runtime inset (points).
 * @returns the usable inset (points, >= 0).
 */
export function safeInset(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Bottom padding for an absolute overlay footer (e.g. the Add Widget flow).
 *
 * Policy: keep the designer's comfortable minimum, but raise it to the
 * runtime bottom inset when that is larger, so the footer actions remain
 * tappable above the Android navigation area / iOS home indicator.
 *
 * @param minPadding - the designer's minimum bottom padding (points).
 * @param bottomInset - the runtime bottom safe-area inset (points).
 * @returns the footer bottom padding (points).
 */
export function overlayFooterBottomPadding(
  minPadding: number,
  bottomInset: number,
): number {
  return Math.max(minPadding, safeInset(bottomInset));
}
