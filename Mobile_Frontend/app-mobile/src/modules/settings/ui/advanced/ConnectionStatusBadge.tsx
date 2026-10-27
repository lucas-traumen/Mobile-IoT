/**
 * ConnectionStatusBadge — the shared status dot (+ optional label)
 * renderer of the D3 connection/health color contract: healthy = smart
 * teal, failed = `danger`, progress = smart amber, gray = smart
 * textSecondary. Colors always come from the ACTIVE theme tokens.
 *
 * Both status cards (MQTT / InfluxDB) and any future status row render
 * their dots through this module, so the color contract has exactly one
 * implementation. The `status-dot-{status}` testID contract is kept.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme, type ThemeTokens } from '@core/theme';

/** One service status-dot state (approved color semantics). */
export type ServiceDotStatus = 'healthy' | 'failed' | 'progress' | 'gray';

/** D3 color for a status, resolved from the theme tokens. */
export function serviceDotColor(
  status: ServiceDotStatus,
  tokens: ThemeTokens,
): string {
  switch (status) {
    case 'healthy':
      return tokens.smart.colors.teal;
    case 'failed':
      return tokens.danger;
    case 'progress':
      return tokens.smart.colors.amber;
    case 'gray':
      return tokens.smart.colors.textSecondary;
  }
}

/**
 * The shared status dot (+ optional label). `testID="status-dot-{status}"`
 * is the long-lived test seam both status cards share.
 */
export function ConnectionStatusBadge({
  status,
  label,
}: {
  readonly status: ServiceDotStatus;
  readonly label?: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={styles.row}>
      <View
        testID={`status-dot-${status}`}
        style={[
          styles.dot,
          { backgroundColor: serviceDotColor(status, tokens) },
        ]}
      />
      {label !== undefined ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 12 },
});
