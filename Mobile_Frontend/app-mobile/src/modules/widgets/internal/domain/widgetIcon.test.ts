/**
 * Widget glyph resolution tests (scope amendments 2–3 — per-device icons,
 * per-icon-FAMILY validation): resolution order device → capability def →
 * widget default, and every candidate is type-checked against the INSTALLED
 * glyph map of ITS family (Ionicons AND MaterialCommunityIcons) so a
 * stale/unknown name can never render as a missing glyph.
 */

import {
  resolveWidgetIcon,
  isWidgetGlyph,
  isMaterialCommunityGlyph,
} from './widgetIcon';

const ION_FALLBACK = { family: 'ionicons', name: 'power-outline' } as const;
const ION_PULSE = { family: 'ionicons', name: 'pulse-outline' } as const;

describe('widgetIcon resolution (per-device icons, amendment 2)', () => {
  it('prefers the per-DEVICE icon over the capability def icon', () => {
    expect(
      resolveWidgetIcon('bulb-outline', 'toggle-outline', ION_FALLBACK),
    ).toEqual({ family: 'ionicons', name: 'bulb-outline' });
  });

  it('falls back to the capability def icon when the device has none', () => {
    expect(resolveWidgetIcon(undefined, 'water-outline', ION_PULSE)).toEqual({
      family: 'ionicons',
      name: 'water-outline',
    });
  });

  it('falls back to the widget default when neither source defines one', () => {
    expect(resolveWidgetIcon(undefined, undefined, ION_FALLBACK)).toEqual(
      ION_FALLBACK,
    );
    expect(resolveWidgetIcon(undefined, undefined, ION_PULSE)).toEqual(
      ION_PULSE,
    );
  });

  it('treats unknown glyph names as absent (validated against Ionicons)', () => {
    expect(isWidgetGlyph('bulb-outline')).toBe(true);
    expect(isWidgetGlyph('not-a-real-glyph')).toBe(false);
    // A stale persisted device icon falls through to the capability icon.
    expect(
      resolveWidgetIcon('not-a-real-glyph', 'toggle-outline', ION_FALLBACK),
    ).toEqual({ family: 'ionicons', name: 'toggle-outline' });
    // An unknown capability icon falls through to the widget default.
    expect(resolveWidgetIcon(undefined, 'nope', ION_PULSE)).toEqual(ION_PULSE);
  });

  it('treats empty strings as absent', () => {
    expect(resolveWidgetIcon('', 'toggle-outline', ION_FALLBACK)).toEqual({
      family: 'ionicons',
      name: 'toggle-outline',
    });
    expect(resolveWidgetIcon('', '', ION_FALLBACK)).toEqual(ION_FALLBACK);
  });
});

describe('widgetIcon per-family validation (scope amendment 3)', () => {
  it('resolves the MaterialCommunityIcons `fan` glyph with its family', () => {
    // Verified against the INSTALLED map: `fan` exists in
    // MaterialCommunityIcons and NOT in Ionicons.
    expect(isMaterialCommunityGlyph('fan')).toBe(true);
    expect(isWidgetGlyph('fan')).toBe(false);
    // A device icon of 'fan' (Quạt) resolves as the material family —
    // the render site picks <MaterialCommunityIcons> for it.
    expect(resolveWidgetIcon('fan', 'toggle-outline', ION_FALLBACK)).toEqual({
      family: 'material-community',
      name: 'fan',
    });
  });

  it('keeps Ionicons names in the Ionicons family', () => {
    expect(isWidgetGlyph('bulb-outline')).toBe(true);
    expect(isMaterialCommunityGlyph('bulb-outline')).toBe(false);
    expect(resolveWidgetIcon('bulb-outline', undefined, ION_FALLBACK)).toEqual({
      family: 'ionicons',
      name: 'bulb-outline',
    });
  });

  it('a capability-def MCI icon resolves through the same family seam', () => {
    expect(resolveWidgetIcon(undefined, 'fan', ION_FALLBACK)).toEqual({
      family: 'material-community',
      name: 'fan',
    });
  });

  it('a name present in BOTH maps resolves as Ionicons (deterministic precedence)', () => {
    // 'home' exists in both installed maps — the documented Ionicons-first
    // precedence keeps the resolution deterministic.
    expect(isWidgetGlyph('home')).toBe(true);
    expect(isMaterialCommunityGlyph('home')).toBe(true);
    expect(resolveWidgetIcon('home', undefined, ION_FALLBACK)).toEqual({
      family: 'ionicons',
      name: 'home',
    });
  });

  it('an unknown name in EITHER family falls through to the next source', () => {
    // A name contained in NEITHER installed map — the resolver must not
    // accept it from any source.
    expect(isWidgetGlyph('not-a-real-glyph')).toBe(false);
    expect(isMaterialCommunityGlyph('not-a-real-glyph')).toBe(false);
    expect(
      resolveWidgetIcon('not-a-real-glyph', 'toggle-outline', ION_FALLBACK),
    ).toEqual({ family: 'ionicons', name: 'toggle-outline' });
    expect(
      resolveWidgetIcon(undefined, 'not-a-real-glyph', ION_FALLBACK),
    ).toEqual(ION_FALLBACK);
  });
});
