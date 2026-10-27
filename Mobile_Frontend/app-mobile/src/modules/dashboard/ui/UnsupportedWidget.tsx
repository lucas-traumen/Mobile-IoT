/**
 * UnsupportedWidget — fallback for a widget type missing from the registry.
 *
 * Keeps the grid stable (the card still renders its controls) and tells the
 * user what is wrong instead of a blank/white card.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import type { WidgetConfig } from '@modules/widgets/api';

/**
 * Unsupported widget card.
 *
 * @param props.config - the persisted widget whose type is unknown.
 */
export function UnsupportedWidget({ config }: { config: WidgetConfig }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.content}>
      <Text style={[styles.title, { color: tokens.textPrimary }]}>
        {STRINGS.dashboard.unsupportedWidget}
      </Text>
      <Text style={[styles.type, { color: tokens.textSecondary }]}>
        {config.type}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, flex: 1, justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: '600' },
  type: { fontSize: 12, marginTop: 2 },
});
