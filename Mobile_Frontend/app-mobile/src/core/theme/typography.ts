/**
 * Typography — custom font family names for the UI.
 *
 * Inter (Google Fonts) is loaded once at the App root (`useFonts` from
 * `@expo-google-fonts/inter`); the MAP KEYS passed there become the font
 * family names usable in `fontFamily` styles. These constants are that
 * single source of truth: screens/widgets reference them instead of
 * hard-coding family strings, and the App root uses them as the map keys so
 * the names can never drift apart.
 *
 * Loaded weights (approved set — do not add weights without a plan):
 * - Light 300 (`INTER_LIGHT`)
 * - Regular 400 (`INTER_REGULAR`)
 * - SemiBold 600 (`INTER_SEMIBOLD`)
 *
 * Only `core` lives here (core must not import modules).
 */

/** Inter Light 300 family name (map key at the App root). */
export const INTER_LIGHT = 'Inter_300Light';

/** Inter Regular 400 family name (map key at the App root). */
export const INTER_REGULAR = 'Inter_400Regular';

/** Inter SemiBold 600 family name (map key at the App root). */
export const INTER_SEMIBOLD = 'Inter_600SemiBold';
