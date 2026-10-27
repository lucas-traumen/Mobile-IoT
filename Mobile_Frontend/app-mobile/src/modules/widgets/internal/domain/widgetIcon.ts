/**
 * Widget glyph resolution (scope amendment 2, per-device icons; amendment 3,
 * per-icon-FAMILY support): the icon a widget card renders is resolved per
 * DEVICE first, then from the capability definition, then from the widget's
 * own default — so Đèn and Quạt no longer duplicate the capability `switch`
 * glyph.
 *
 * Every candidate name is type-checked against the INSTALLED glyph maps of
 * BOTH icon families the app renders: Ionicons AND MaterialCommunityIcons
 * (scope amendment 3 — Ionicons has no fan glyph, so Quạt renders the
 * MaterialCommunityIcons `fan`). A stale/unknown name (bad persisted data,
 * renamed glyph) falls through to the next source instead of rendering
 * nothing, and the resolver reports WHICH family the glyph belongs to so
 * the render site can pick the matching vector component.
 *
 * Source of truth: the same glyph-map JSONs the icon components themselves
 * import (`@expo/vector-icons/build/vendor/react-native-vector-icons/
 * glyphmaps/*.json`), so device and test environments validate against the
 * identical tables. (Reading the components' `glyphMap` statics instead is
 * unreliable: jest-expo's component stubs carry EMPTY maps, while these
 * JSONs always resolve.)
 *
 * Family precedence: a name present in BOTH maps resolves as Ionicons
 * (deterministic; no currently-used glyph collides — `fan` exists only in
 * MaterialCommunityIcons, `bulb-outline` only in Ionicons).
 */

import ionGlyphMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
import mciGlyphMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';

/**
 * The installed Ionicons glyph table (name → codepoint). The JSON import
 * keeps the LITERAL glyph-name keys, so {@link IonGlyphName} is exactly the
 * union the `<Ionicons name={…}>` prop accepts.
 */
const IONICONS_GLYPHS = ionGlyphMap;

/** The installed MaterialCommunityIcons glyph table (name → codepoint). */
const MATERIAL_COMMUNITY_GLYPHS = mciGlyphMap;

/** A glyph name the installed Ionicons map can actually render. */
export type IonGlyphName = Extract<keyof typeof IONICONS_GLYPHS, string>;

/** A glyph name the installed MaterialCommunityIcons map can render. */
export type MciGlyphName = Extract<
  keyof typeof MATERIAL_COMMUNITY_GLYPHS,
  string
>;

/** The icon families a widget card can render (amendment 3). */
export type WidgetIconFamily = 'ionicons' | 'material-community';

/**
 * A validated, renderable widget glyph: the FAMILY plus its name, so the
 * render site picks the matching vector component.
 */
export type ResolvedWidgetIcon =
  | { readonly family: 'ionicons'; readonly name: IonGlyphName }
  | {
      readonly family: 'material-community';
      readonly name: MciGlyphName;
    };

/**
 * Type-check a glyph name against Ionicons' glyph map.
 *
 * @param name - candidate Ionicons glyph name (arbitrary persisted string).
 * @returns `true` when the installed glyph map contains `name`.
 */
export function isWidgetGlyph(name: string): name is IonGlyphName {
  return Object.prototype.hasOwnProperty.call(IONICONS_GLYPHS, name);
}

/**
 * Type-check a glyph name against MaterialCommunityIcons' glyph map
 * (amendment 3 — the fan family).
 *
 * @param name - candidate MaterialCommunityIcons glyph name.
 * @returns `true` when the installed glyph map contains `name`.
 */
export function isMaterialCommunityGlyph(name: string): name is MciGlyphName {
  return Object.prototype.hasOwnProperty.call(MATERIAL_COMMUNITY_GLYPHS, name);
}

/**
 * Validate ONE candidate name against the installed family maps (Ionicons
 * first — deterministic precedence, see the module docblock).
 *
 * @param name - arbitrary persisted candidate glyph name.
 * @returns the family-resolved glyph, or `null` when NO installed map
 *   contains the name (the caller falls through to the next source).
 */
function resolveValidatedGlyph(name: string): ResolvedWidgetIcon | null {
  if (isWidgetGlyph(name)) {
    return { family: 'ionicons', name };
  }
  if (isMaterialCommunityGlyph(name)) {
    return { family: 'material-community', name };
  }
  return null;
}

/**
 * Resolve the glyph a widget card renders (amendment-2 resolution order,
 * amendment-3 per-family validation): per-DEVICE icon → capability
 * definition icon → widget default. Empty/unknown names (validated against
 * the installed family maps) fall through to the next source, so a glyph is
 * ALWAYS renderable.
 *
 * Pure + platform-independent.
 *
 * @param deviceIcon - the bound device's optional per-device icon.
 * @param capabilityIcon - the capability definition's optional icon.
 * @param fallback - the widget's documented default glyph (family + name).
 */
export function resolveWidgetIcon(
  deviceIcon: string | undefined,
  capabilityIcon: string | undefined,
  fallback: ResolvedWidgetIcon,
): ResolvedWidgetIcon {
  if (deviceIcon !== undefined && deviceIcon !== '') {
    const resolved = resolveValidatedGlyph(deviceIcon);
    if (resolved) {
      return resolved;
    }
  }
  if (capabilityIcon !== undefined && capabilityIcon !== '') {
    const resolved = resolveValidatedGlyph(capabilityIcon);
    if (resolved) {
      return resolved;
    }
  }
  return fallback;
}
