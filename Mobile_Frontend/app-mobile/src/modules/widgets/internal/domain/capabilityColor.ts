/**
 * Capability accent resolver — the single place that decides a capability's
 * display accent (CP-R6).
 *
 * Built-in sensor capabilities (`temperature` / `humidity`) always resolve
 * from the active theme tokens so light/dark stay readable and match the
 * template; every other capability (custom catalog entries) uses its catalog
 * `color` when defined, falling back to the theme primary.
 */

import type { CapabilityDef } from '@modules/devices/api';
import type { ThemeTokens } from '@core/theme';

/**
 * Resolve the accent color for a capability in the active theme.
 *
 * @param type - capability type key (e.g. 'temperature', 'pressure').
 * @param def - the catalog definition when available (`undefined` allowed).
 * @param tokens - the active theme tokens.
 * @returns a hex color usable for text/icons/lines.
 */
export function resolveCapabilityAccent(
  type: string,
  def: CapabilityDef | undefined,
  tokens: ThemeTokens,
): string {
  if (type === 'temperature') {
    return tokens.temperature;
  }
  if (type === 'humidity') {
    return tokens.humidity;
  }
  return def?.color ?? tokens.primary;
}
