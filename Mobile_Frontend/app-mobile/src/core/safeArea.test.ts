/**
 * Safe-area inset arithmetic tests — the pure seam behind the shell and
 * fixed/absolute footer surfaces.
 *
 * The runtime insets come from `react-native-safe-area-context`; these tests
 * verify the sanitization + padding policies for the representative bottom
 * insets: 0 (no inset), 24 (Android gesture navigation) and 34 (iOS home
 * indicator) — without an emulator.
 */

import { overlayFooterBottomPadding, safeInset } from './safeArea';

describe('safeInset', () => {
  it('passes through the representative device insets', () => {
    expect(safeInset(0)).toBe(0);
    expect(safeInset(24)).toBe(24);
    expect(safeInset(34)).toBe(34);
  });

  it('sanitizes invalid runtime values to 0', () => {
    expect(safeInset(NaN)).toBe(0);
    expect(safeInset(Infinity)).toBe(0);
    expect(safeInset(-12)).toBe(0);
  });
});

describe('overlayFooterBottomPadding', () => {
  it('keeps the comfortable minimum when the inset is smaller', () => {
    expect(overlayFooterBottomPadding(12, 0)).toBe(12);
    expect(overlayFooterBottomPadding(12, 8)).toBe(12);
  });

  it('respects Android gesture (24) and iOS home-indicator (34) insets', () => {
    expect(overlayFooterBottomPadding(12, 24)).toBe(24);
    expect(overlayFooterBottomPadding(12, 34)).toBe(34);
  });

  it('falls back to the minimum for invalid insets', () => {
    expect(overlayFooterBottomPadding(12, NaN)).toBe(12);
    expect(overlayFooterBottomPadding(12, Infinity)).toBe(12);
  });
});
