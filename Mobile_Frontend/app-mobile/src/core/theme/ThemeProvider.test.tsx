/**
 * Theme mode + provider resolution tests (settings-information-architecture
 * plan): exactly two explicit modes, no runtime `system` path, immediate
 * light/dark token application.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider, isDarkMode, useTheme } from './ThemeProvider';

describe('ThemeMode resolution (explicit light | dark only)', () => {
  it('resolves light to light and dark to dark', () => {
    expect(isDarkMode('light')).toBe(false);
    expect(isDarkMode('dark')).toBe(true);
  });

  it('keeps the selected mode in the context value', async () => {
    let observed: { mode: string; isDark: boolean } | null = null;
    function Probe() {
      const { mode, isDark } = useTheme();
      observed = { mode, isDark };
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="dark">
          <Probe />
        </ThemeProvider>,
      );
    });
    expect(observed).toEqual({ mode: 'dark', isDark: true });

    await act(async () => {
      renderer.update(
        <ThemeProvider mode="light">
          <Probe />
        </ThemeProvider>,
      );
    });
    expect(observed).toEqual({ mode: 'light', isDark: false });
    await act(async () => {
      renderer.unmount();
    });
  });
});
