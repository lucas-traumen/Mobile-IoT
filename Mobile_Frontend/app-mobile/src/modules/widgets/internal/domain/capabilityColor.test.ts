/**
 * Capability accent resolver tests (CP-R6).
 *
 * Built-in temperature/humidity must follow the active theme (light vs dark
 * tokens), while custom capabilities use their catalog color and everything
 * else falls back to the theme primary.
 */

import { DARK_TOKENS, LIGHT_TOKENS } from '@core/theme';
import type { CapabilityDef } from '@modules/devices/api';

import { resolveCapabilityAccent } from './capabilityColor';

const PRESSURE: CapabilityDef = {
  type: 'pressure',
  label: 'Áp suất',
  kind: 'sensor',
  unit: 'hPa',
  color: '#6a1b9a',
};

const NO_COLOR: CapabilityDef = {
  type: 'co2',
  label: 'CO₂',
  kind: 'sensor',
};

describe('resolveCapabilityAccent', () => {
  it('temperature follows the theme (light vs dark)', () => {
    expect(
      resolveCapabilityAccent('temperature', undefined, LIGHT_TOKENS),
    ).toBe(LIGHT_TOKENS.temperature);
    expect(resolveCapabilityAccent('temperature', undefined, DARK_TOKENS)).toBe(
      DARK_TOKENS.temperature,
    );
    // The catalog color never overrides the themed built-ins.
    expect(resolveCapabilityAccent('temperature', PRESSURE, LIGHT_TOKENS)).toBe(
      LIGHT_TOKENS.temperature,
    );
  });

  it('humidity follows the theme (light vs dark)', () => {
    expect(resolveCapabilityAccent('humidity', undefined, LIGHT_TOKENS)).toBe(
      LIGHT_TOKENS.humidity,
    );
    expect(resolveCapabilityAccent('humidity', undefined, DARK_TOKENS)).toBe(
      DARK_TOKENS.humidity,
    );
  });

  it('custom capabilities use their catalog color', () => {
    expect(resolveCapabilityAccent('pressure', PRESSURE, LIGHT_TOKENS)).toBe(
      '#6a1b9a',
    );
    expect(resolveCapabilityAccent('pressure', PRESSURE, DARK_TOKENS)).toBe(
      '#6a1b9a',
    );
  });

  it('unknown capabilities fall back to the theme primary', () => {
    expect(resolveCapabilityAccent('co2', NO_COLOR, LIGHT_TOKENS)).toBe(
      LIGHT_TOKENS.primary,
    );
    expect(resolveCapabilityAccent('co2', undefined, DARK_TOKENS)).toBe(
      DARK_TOKENS.primary,
    );
  });
});
