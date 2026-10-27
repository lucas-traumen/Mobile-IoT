/**
 * Theme provider + context.
 *
 * `core` must never import a module: the provider only receives a
 * `ThemeMode` prop. The app (composition root) reads the persisted theme
 * mode from the settings store and passes it down. There is no runtime
 * system-theme resolution: the user picks Light or Dark explicitly (legacy
 * persisted `system` migrates to `light` in the settings module).
 */

import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import { DARK_TOKENS, LIGHT_TOKENS, type ThemeTokens } from './tokens';
import type { ThemeMode } from './ThemeMode';

/** Resolve the actual dark/light flag for a mode (no system fallback). */
export function isDarkMode(mode: ThemeMode): boolean {
  return mode === 'dark';
}

/** Theme context value provided to the whole app. */
export interface ThemeContextValue {
  /** Active theme mode (exactly what the user selected — light | dark). */
  readonly mode: ThemeMode;
  /** True when the *effective* theme is dark. */
  readonly isDark: boolean;
  /** Active token set (light or dark). */
  readonly tokens: ThemeTokens;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * React context provider for the theme.
 *
 * @param props.mode - the explicit theme preference (`'light' | 'dark'`).
 * @returns The provider; screens consume the context via {@link useTheme}.
 */
export function ThemeProvider({
  mode,
  children,
}: {
  readonly mode: ThemeMode;
  readonly children: ReactNode;
}) {
  // The mode only changes through an explicit user selection, so the memo
  // depends solely on it (no `useColorScheme` subscription anymore).
  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      isDark: isDarkMode(mode),
      tokens: isDarkMode(mode) ? DARK_TOKENS : LIGHT_TOKENS,
    }),
    [mode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Access the active theme context.
 *
 * @returns `{ mode, isDark, tokens }`.
 * @throws When used outside a {@link ThemeProvider}.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return context;
}
