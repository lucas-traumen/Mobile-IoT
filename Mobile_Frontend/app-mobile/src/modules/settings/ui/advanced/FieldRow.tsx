/**
 * FieldRow — the shared labelled-input row of the guided flow's forms
 * (the manual-address fallback, the auth step, the InfluxDB config
 * dialog): label above, themed input inside, optional inline field error
 * below. Pure presentation — colors come from the passed theme tokens.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ThemeTokens } from '@core/theme';

export function FieldRow({
  label,
  tokens,
  error,
  children,
}: {
  label: string;
  tokens: ThemeTokens;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text
        style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
      >
        {label}
      </Text>
      {children}
      {error ? (
        <Text style={[styles.error, { color: tokens.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginTop: 12, marginBottom: 4 },
  error: { fontSize: 12, marginTop: 4 },
});
