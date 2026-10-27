/**
 * InfluxDbStatusCard (Amendment 2, B3 restructure) — the InfluxDB status
 * area as a compact ConnectionWidget + centered detail panel.
 *
 * WIDGET: leading D3 dot, the service name, the SHORT probe status, and
 * ONE quick action — `Kiểm tra` (the existing explicit probe; disabled +
 * readable until the config is sufficient / while checking). The widget
 * body carries the long-lived `advanced-influx-status` testID (visibility
 * v2 pins) and opens the detail; the quick action keeps the long-lived
 * `advanced-influx-check`.
 *
 * DETAIL (centered dialog recipe — the form MOVED INSIDE from the old
 * standalone dialog): the current status, the 4-field form
 * (url/org/bucket/token, masked token + reveal toggle) whose edits go
 * through the store patch (NEVER auto-saved), the manual-probe hint line
 * (the old info box folded in), and the gated `Kiểm tra` action.
 *
 * Symmetry with the MQTT detail is the point of B3: BOTH widgets open
 * their details identically. The probe + fingerprint staleness logic is
 * UNCHANGED — the screen derives dot + status text as before.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import type { InfluxSettings } from '@modules/settings/api';

import { ConnectionWidget } from './ConnectionWidget';
import type { ServiceDotStatus } from './ConnectionStatusBadge';
import { FieldRow } from './FieldRow';

export interface InfluxDbStatusCardProps {
  /** D3 dot status of the last probe (screen-derived, staleness bound). */
  readonly dot: ServiceDotStatus;
  /** The screen-derived status text (probe truthfulness copy). */
  readonly statusText: string;
  /** Whether the draft Influx config is sufficient for a probe. */
  readonly configured: boolean;
  /** A probe is in flight. */
  readonly checking: boolean;
  /** `Kiểm tra` — the screen's existing explicit probe. */
  readonly onCheck: () => void;
  /** The draft Influx config (the form's prefilled values). */
  readonly influx: InfluxSettings;
  /** Update Influx fields in the store draft (never saves). */
  readonly onPatch: (patch: Partial<InfluxSettings>) => void;
  /** Field errors keyed by dotted path (e.g. `influx.url`). */
  readonly errors?: Record<string, string>;
}

export function InfluxDbStatusCard({
  dot,
  statusText,
  configured,
  checking,
  onCheck,
  influx,
  onPatch,
  errors,
}: InfluxDbStatusCardProps) {
  const { tokens } = useTheme();
  // The detail panel owns the 4-field form (moved in from the old
  // standalone dialog — B3).
  const [detailOpen, setDetailOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const inputStyle = [
    styles.input,
    {
      backgroundColor: tokens.smart.colors.card,
      borderColor: tokens.smart.colors.cardBorder,
      color: tokens.smart.colors.textPrimary,
    },
  ];

  return (
    <ConnectionWidget
      testID="advanced-influx-status"
      name={STRINGS.settings.influxCardTitle}
      dot={dot}
      statusLabel={statusText}
      detailOpen={detailOpen}
      onOpenDetail={() => setDetailOpen(true)}
      onCloseDetail={() => setDetailOpen(false)}
    >
      {/* Detail body: status + the 4-field form + hint + the gated probe. */}
      <Text
        style={[styles.detailState, { color: tokens.smart.colors.textPrimary }]}
      >
        {statusText}
      </Text>
      <FieldRow
        label={STRINGS.settings.url}
        tokens={tokens}
        error={errors ? errors['influx.url'] : undefined}
      >
        <TextInput
          style={inputStyle}
          value={influx.url}
          onChangeText={value => onPatch({ url: value })}
          placeholder="http://192.168.1.10:8086"
          placeholderTextColor={tokens.smart.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          testID="advanced-influx-url-input"
        />
      </FieldRow>
      <FieldRow
        label={STRINGS.settings.org}
        tokens={tokens}
        error={errors ? errors['influx.org'] : undefined}
      >
        <TextInput
          style={inputStyle}
          value={influx.org}
          onChangeText={value => onPatch({ org: value })}
          autoCapitalize="none"
          autoCorrect={false}
          testID="advanced-influx-org-input"
        />
      </FieldRow>
      <FieldRow
        label={STRINGS.settings.bucket}
        tokens={tokens}
        error={errors ? errors['influx.bucket'] : undefined}
      >
        <TextInput
          style={inputStyle}
          value={influx.bucket}
          onChangeText={value => onPatch({ bucket: value })}
          autoCapitalize="none"
          autoCorrect={false}
          testID="advanced-influx-bucket-input"
        />
      </FieldRow>
      <FieldRow
        label={STRINGS.settings.token}
        tokens={tokens}
        error={errors ? errors['influx.token'] : undefined}
      >
        <View style={styles.passwordRow}>
          <TextInput
            style={[inputStyle, styles.tokenInput]}
            value={influx.token}
            onChangeText={value => onPatch({ token: value })}
            secureTextEntry={!showToken}
            autoCapitalize="none"
            autoCorrect={false}
            testID="advanced-token-input"
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowToken(visible => !visible)}
            accessibilityRole="button"
            accessibilityLabel={
              showToken ? STRINGS.settings.hide : STRINGS.settings.show
            }
            testID="advanced-influx-token-reveal"
          >
            <Text style={[styles.eyeText, { color: tokens.primary }]}>
              {showToken ? STRINGS.settings.hide : STRINGS.settings.show}
            </Text>
          </TouchableOpacity>
        </View>
      </FieldRow>
      {/* The manual-probe hint (the old info box, folded in). */}
      <Text
        style={[
          styles.detailHint,
          { color: tokens.smart.colors.textSecondary },
        ]}
      >
        {STRINGS.settings.influxProbeInfo}
      </Text>
      <TouchableOpacity
        style={[
          styles.detailButton,
          { borderColor: tokens.primary },
          (!onCheck || checking || !configured) && styles.actionDisabled,
        ]}
        onPress={onCheck}
        disabled={!onCheck || checking || !configured}
        accessibilityRole="button"
        accessibilityLabel={STRINGS.settings.checkNow}
        testID="advanced-influx-check"
      >
        <Text style={[styles.detailButtonText, { color: tokens.primary }]}>
          {checking ? STRINGS.settings.checking : STRINGS.settings.checkNow}
        </Text>
      </TouchableOpacity>
    </ConnectionWidget>
  );
}

const styles = StyleSheet.create({
  detailState: { fontSize: 14, fontWeight: '600' },
  detailHint: { fontSize: 11, lineHeight: 15 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  tokenInput: { flex: 1 },
  eyeButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  eyeText: { fontSize: 13, fontWeight: '600' },
  detailButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  detailButtonText: { fontSize: 14, fontWeight: '600' },
  /** READABLE disabled probe action (spec §8 opacity floor). */
  actionDisabled: { opacity: 0.4 },
});
