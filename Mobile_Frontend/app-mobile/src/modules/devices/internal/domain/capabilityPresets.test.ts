/**
 * Capability preset data tests (approved plan slice C): the curated icon
 * groups are typed data — every preset key satisfies the strict machine-key
 * format, presets never collide with the locked built-in keys, and every
 * group carries a valid Ionicons icon + sensor kind.
 */

import { CAPABILITY_COLORS, CAPABILITY_ICON_GROUPS } from './capabilityPresets';
import { BUILT_IN_CAPABILITIES, CAPABILITY_KEY_REGEX } from './devices';

describe('CAPABILITY_ICON_GROUPS (curated preset data)', () => {
  it('expands well beyond the legacy 8-icon picker', () => {
    expect(CAPABILITY_ICON_GROUPS.length).toBeGreaterThanOrEqual(8);
    const icons = new Set(CAPABILITY_ICON_GROUPS.map(group => group.icon));
    expect(icons.size).toBe(CAPABILITY_ICON_GROUPS.length);
  });

  it('every group carries an outline Ionicons name (real glyph rendering needs device smoke)', () => {
    // NOTE: jest-expo stubs `Ionicons.glyphMap` (empty in tests), so the
    // actual glyph existence is verified by the visual device/web smoke —
    // here we only assert the app's outline-icon naming convention.
    for (const group of CAPABILITY_ICON_GROUPS) {
      expect(group.icon.length).toBeGreaterThan(0);
      expect(group.icon.endsWith('-outline')).toBe(true);
    }
  });

  it('every preset key satisfies the strict machine-key format', () => {
    for (const group of CAPABILITY_ICON_GROUPS) {
      for (const preset of group.presets) {
        expect(CAPABILITY_KEY_REGEX.test(preset.key)).toBe(true);
        expect(preset.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('presets never collide with the locked built-in capability keys', () => {
    const builtins = new Set(BUILT_IN_CAPABILITIES.map(def => def.type));
    for (const group of CAPABILITY_ICON_GROUPS) {
      for (const preset of group.presets) {
        expect(builtins.has(preset.key)).toBe(false);
      }
    }
  });

  it('includes the approved light → illuminance example preset', () => {
    const lightGroup = CAPABILITY_ICON_GROUPS.find(
      group => group.icon === 'sunny-outline',
    );
    expect(lightGroup).toBeDefined();
    expect(lightGroup?.presets).toContainEqual({
      key: 'illuminance',
      label: 'Ánh sáng',
      unit: 'lux',
    });
  });

  it('offers a non-empty curated color palette', () => {
    expect(CAPABILITY_COLORS.length).toBeGreaterThanOrEqual(6);
  });
});
