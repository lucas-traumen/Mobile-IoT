/**
 * Theme module — semantic color tokens + React provider.
 *
 * The app composition root wraps the shell in a `ThemeProvider` (mode from
 * settings). Screens read tokens via `useTheme()` and never hard-code colors.
 */

export type { SmartTokens, ThemeTokens } from './tokens';
export { DARK_TOKENS, LIGHT_TOKENS } from './tokens';
export { INTER_LIGHT, INTER_REGULAR, INTER_SEMIBOLD } from './typography';
export type { ThemeMode } from './ThemeMode';
export { isDarkMode, ThemeProvider, useTheme } from './ThemeProvider';
export type { ThemeContextValue } from './ThemeProvider';
