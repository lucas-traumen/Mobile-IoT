/**
 * Theme token tests — the approved Light/Dark design-system palette.
 *
 * Verifies the exact target values (dashboard-light-dark-responsive
 * redesign + settings-smart-home-sync): neutral page/surface layers,
 * semantic accents (teal primary — the D2 smart-teal invariant, green
 * success, teal temperature, blue humidity — scope amendment 2, amber
 * reserved for warning/connecting semantics, neutral off), the
 * contrast-sensitive `onPrimary` pairing per theme, the Dashboard surface
 * elevation recipe (subtle Light shadow; Dark relies on layer + border),
 * and the nested `smart` design-language block: light + dark palettes,
 * spacing/typography (incl. the History `statsValue` band 20–24)/radius
 * scale and the card shadow recipe.
 */

import { DARK_TOKENS, LIGHT_TOKENS } from './tokens';

describe('LIGHT_TOKENS (approved palette)', () => {
  it('matches the approved Light token table exactly', () => {
    expect(LIGHT_TOKENS.background).toBe('#f4f7fb');
    expect(LIGHT_TOKENS.surface).toBe('#ffffff');
    expect(LIGHT_TOKENS.surfaceDashboard).toBe('#ffffff');
    expect(LIGHT_TOKENS.textPrimary).toBe('#1e293b');
    expect(LIGHT_TOKENS.textSecondary).toBe('#64748b');
    // D2 (settings-smart-home-sync): the action accent is the smart teal.
    expect(LIGHT_TOKENS.primary).toBe('#168C88');
    expect(LIGHT_TOKENS.success).toBe('#22c55e');
    expect(LIGHT_TOKENS.off).toBe('#cbd5e1');
    expect(LIGHT_TOKENS.temperature).toBe('#168C88');
    // Scope amendment 2: humidity accent reads BLUE (amber stays reserved
    // for warning/offline semantics — the connection chip).
    expect(LIGHT_TOKENS.humidity).toBe('#3B7FC4');
    expect(LIGHT_TOKENS.border).toBe('#e2e8f0');
  });

  it('pairs white onPrimary text with the Light primary (contrast)', () => {
    expect(LIGHT_TOKENS.onPrimary).toBe('#ffffff');
  });

  it('elevates the dashboard surface with a subtle soft shadow', () => {
    const { dashboardShadow } = LIGHT_TOKENS;
    expect(dashboardShadow.shadowOpacity).toBeGreaterThan(0);
    expect(dashboardShadow.shadowOpacity).toBeLessThanOrEqual(0.1);
    expect(dashboardShadow.elevation).toBeGreaterThan(0);
  });
});

describe('DARK_TOKENS (approved palette)', () => {
  it('matches the approved Dark token table exactly', () => {
    expect(DARK_TOKENS.background).toBe('#0b1220');
    expect(DARK_TOKENS.surface).toBe('#172235');
    expect(DARK_TOKENS.surfaceDashboard).toBe('#111827');
    expect(DARK_TOKENS.textPrimary).toBe('#f8fafc');
    expect(DARK_TOKENS.textSecondary).toBe('#94a3b8');
    // D2 (settings-smart-home-sync): the dark action accent is the bright
    // smart teal.
    expect(DARK_TOKENS.primary).toBe('#2AA79F');
    expect(DARK_TOKENS.success).toBe('#22c55e');
    expect(DARK_TOKENS.off).toBe('#475569');
    expect(DARK_TOKENS.temperature).toBe('#2AA79F');
    // Scope amendment 2: dark humidity accent reads BLUE.
    expect(DARK_TOKENS.humidity).toBe('#6AA9E0');
    expect(DARK_TOKENS.border).toBe('#334155');
  });

  it('pairs a DARK onPrimary with the bright Dark primary (contrast)', () => {
    // #2AA79F is a mid-bright teal — dark text keeps the contrast; the dark
    // page color keeps the active tab/button text readable.
    expect(DARK_TOKENS.primary).toBe('#2AA79F');
    expect(DARK_TOKENS.onPrimary).toBe('#0b1220');
  });

  it('derives Dark depth from layer + border, not a shadow', () => {
    expect(DARK_TOKENS.dashboardShadow.shadowOpacity).toBe(0);
    expect(DARK_TOKENS.dashboardShadow.elevation).toBe(0);
  });

  it('keeps the semantic accent hues readable across both themes', () => {
    // Success is the shared active/online color; temperature/humidity get
    // the brighter dark variants per the approved table.
    expect(LIGHT_TOKENS.success).toBe(DARK_TOKENS.success);
    expect(LIGHT_TOKENS.temperature).not.toBe(DARK_TOKENS.temperature);
    expect(LIGHT_TOKENS.humidity).not.toBe(DARK_TOKENS.humidity);
  });
});

describe('gel retirement (settings-smart-home-sync)', () => {
  it('removes the legacy gel / elevated / legacy-shadow tokens from both themes', () => {
    for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
      // The gel + legacy surface set is GONE (fields deleted from
      // ThemeTokens — TS strict flags any stale consumer).
      expect('gradient' in tokens).toBe(false);
      expect('surfaceGlass' in tokens).toBe(false);
      expect('cardTintTemperature' in tokens).toBe(false);
      expect('cardTintHumidity' in tokens).toBe(false);
      expect('cardTintSwitchLight' in tokens).toBe(false);
      expect('cardTintSwitchFan' in tokens).toBe(false);
      expect('cardInnerEdge' in tokens).toBe(false);
      expect('chipActiveBg' in tokens).toBe(false);
      expect('surfaceElevated' in tokens).toBe(false);
      // The legacy root cardShadow is gone; the smart cardShadow remains.
      expect('cardShadow' in tokens).toBe(false);
      expect(typeof tokens.smart.cardShadow.shadowOpacity).toBe('number');
    }
  });
});

describe('smart tokens (dashboard-smart-home-redesign, user-approved palette)', () => {
  it('matches the approved LIGHT smart palette exactly', () => {
    const { colors } = LIGHT_TOKENS.smart;
    expect(colors.page).toBe('#F3F6F7');
    expect(colors.card).toBe('#FFFFFF');
    expect(colors.textPrimary).toBe('#16242C');
    expect(colors.textSecondary).toBe('#667780');
    expect(colors.teal).toBe('#168C88');
    expect(colors.amber).toBe('#E9A23B');
    expect(colors.cardBorder).toBe('rgba(30,55,65,0.10)');
    expect(colors.neutral).toBeTruthy();
  });

  it('matches the user-approved DARK smart palette exactly', () => {
    const { colors } = DARK_TOKENS.smart;
    expect(colors.page).toBe('#101A1D');
    expect(colors.card).toBe('#1A2529');
    expect(colors.textPrimary).toBe('#E8EEF0');
    expect(colors.textSecondary).toBe('#8FA0A8');
    expect(colors.teal).toBe('#2AA79F');
    expect(colors.amber).toBe('#F0B45C');
    expect(colors.cardBorder).toBe('rgba(255,255,255,0.08)');
  });

  it('keeps temperature synced with the smart teal and humidity BLUE (D2 + amendment 2)', () => {
    // The flat temperature/humidity accents changed VALUES in place so
    // History charts + management previews stay consistent through the
    // shared resolver; primary re-valued to the smart teal in
    // settings-smart-home-sync (D2). Amendment 2 moved humidity to blue —
    // the smart amber block stays RESERVED for the warning/connecting
    // semantics (connection chip), NOT a data accent.
    expect(LIGHT_TOKENS.temperature).toBe(LIGHT_TOKENS.smart.colors.teal);
    expect(LIGHT_TOKENS.humidity).toBe('#3B7FC4');
    expect(DARK_TOKENS.temperature).toBe(DARK_TOKENS.smart.colors.teal);
    expect(DARK_TOKENS.humidity).toBe('#6AA9E0');
    // The amber reservation: unchanged values, and NOT the humidity accent.
    expect(LIGHT_TOKENS.smart.colors.amber).toBe('#E9A23B');
    expect(DARK_TOKENS.smart.colors.amber).toBe('#F0B45C');
    expect(LIGHT_TOKENS.humidity).not.toBe(LIGHT_TOKENS.smart.colors.amber);
    expect(DARK_TOKENS.humidity).not.toBe(DARK_TOKENS.smart.colors.amber);
  });

  it('pins primary to the smart teal in BOTH themes (D2 invariant)', () => {
    // settings-smart-home-sync D2: the semantic action accent and the smart
    // teal are the SAME color per theme — every primary consumer (buttons,
    // links, drag highlights, switch ON track) follows one source.
    expect(LIGHT_TOKENS.primary).toBe(LIGHT_TOKENS.smart.colors.teal);
    expect(LIGHT_TOKENS.primary).toBe('#168C88');
    expect(DARK_TOKENS.primary).toBe(DARK_TOKENS.smart.colors.teal);
    expect(DARK_TOKENS.primary).toBe('#2AA79F');
    // onPrimary unchanged (contrast pairing intact).
    expect(LIGHT_TOKENS.onPrimary).toBe('#ffffff');
    expect(DARK_TOKENS.onPrimary).toBe('#0b1220');
  });

  it('provides the ambient wash tints at 3–5% alpha in both themes', () => {
    for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
      expect(tokens.smart.colors.tealTint).toContain('0.05');
      expect(tokens.smart.colors.amberTint).toContain('0.05');
    }
  });

  it('carries the documented spacing / typography / radius scale', () => {
    for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
      const { spacing, typography, radius } = tokens.smart;
      expect(spacing.screenH).toBe(16);
      expect(spacing.screenHWide).toBe(24);
      expect(spacing.cardPadding).toBeGreaterThanOrEqual(16);
      expect(spacing.cardPadding).toBeLessThanOrEqual(20);
      expect(spacing.cardGap).toBe(16);
      expect(typography.screenTitle).toBeGreaterThanOrEqual(26);
      expect(typography.screenTitle).toBeLessThanOrEqual(28);
      expect(typography.cardTitle).toBeGreaterThanOrEqual(16);
      expect(typography.cardTitle).toBeLessThanOrEqual(18);
      expect(typography.secondary).toBeGreaterThanOrEqual(13);
      expect(typography.secondary).toBeLessThanOrEqual(14);
      expect(typography.sensorValue).toBeGreaterThanOrEqual(40);
      expect(typography.sensorValue).toBeLessThanOrEqual(44);
      // Scope amendment 3: the no-data dash line (secondary color) sits at
      // 28–32 — big enough for the value slot, never the 40–44 accent
      // size (real readings keep sensorValue).
      expect(typography.sensorNoDataValue).toBeGreaterThanOrEqual(28);
      expect(typography.sensorNoDataValue).toBeLessThanOrEqual(32);
      expect(typography.sensorNoDataValue).toBeLessThan(typography.sensorValue);
      // history-smart-home-redesign: the chart-card statistic value (Thấp
      // nhất / Cao nhất / Trung bình) sits in the spec 20–24 band — bigger
      // than body text, smaller than the live sensor reading.
      expect(typography.statsValue).toBeGreaterThanOrEqual(20);
      expect(typography.statsValue).toBeLessThanOrEqual(24);
      expect(typography.statsValue).toBeLessThan(typography.sensorValue);
      expect(typography.unit).toBeGreaterThanOrEqual(16);
      expect(typography.unit).toBeLessThanOrEqual(18);
      expect(radius.card).toBe(14);
    }
  });

  it('elevates light cards with a shadow and dark cards with border-borne depth', () => {
    expect(LIGHT_TOKENS.smart.cardShadow.shadowOpacity).toBeGreaterThan(0);
    expect(LIGHT_TOKENS.smart.cardShadow.elevation).toBeGreaterThan(0);
    // Dark depth comes from the surface layer + hairline border instead.
    expect(DARK_TOKENS.smart.cardShadow.shadowOpacity).toBe(0);
    expect(DARK_TOKENS.smart.cardShadow.elevation).toBe(0);
  });
});
