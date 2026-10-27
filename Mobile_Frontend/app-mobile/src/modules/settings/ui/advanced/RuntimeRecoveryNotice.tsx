/**
 * RuntimeRecoveryNotice — the setup-mode recovery notice for a lost or
 * degraded PERSISTED runtime connection
 * (advanced-settings-sequential-recovery, recovery behavior 4).
 *
 * The old automatic fallback (jump to Step 1 on `failed`, 60 s
 * sustained-reconnecting timer) is retired: a runtime failure NEVER
 * resets the flow, never navigates, and never touches the draft. This
 * notice renders AT the user's current official step and states the
 * truth precisely — the LIVE persisted connection is in trouble, the
 * unsaved draft is untouched.
 *
 * Actions (explicit only):
 * - `Thử lại` — the real telemetry lifecycle (the wired composition-root
 *   stop → start callback); never a parallel MQTT client.
 * - `Cấu hình lại` — moves to setup Step 1 ONLY on the user's press.
 *
 * A `reconnecting` episode renders the calm amber variant without
 * actions (the client is already retrying); it may persist arbitrarily
 * long — no timer ever escalates or yanks.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

export interface RuntimeRecoveryNoticeProps {
  /** `failed` = terminal loss (actions offered); `reconnecting` = retrying. */
  readonly severity: 'failed' | 'reconnecting';
  /** `Thử lại` — the real telemetry stop/start lifecycle callback. */
  readonly onRetry?: () => void;
  /** `Cấu hình lại` — explicit user-only transition to setup Step 1. */
  readonly onReconfigure?: () => void;
}

export function RuntimeRecoveryNotice({
  severity,
  onRetry,
  onReconfigure,
}: RuntimeRecoveryNoticeProps) {
  const { tokens } = useTheme();
  const failed = severity === 'failed';
  const accent = failed ? tokens.danger : tokens.smart.colors.amber;
  return (
    <View
      style={[
        styles.notice,
        {
          borderColor: accent,
          backgroundColor: tokens.smart.colors.card,
        },
      ]}
      testID="advanced-runtime-notice"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.messageRow}>
        <Ionicons
          name={failed ? 'cloud-offline-outline' : 'sync-circle-outline'}
          size={18}
          color={accent}
        />
        <Text
          style={[styles.message, { color: tokens.smart.colors.textPrimary }]}
        >
          {failed
            ? STRINGS.settings.runtimeLostNotice
            : STRINGS.settings.runtimeReconnectingNotice}
        </Text>
      </View>
      {failed ? (
        <View style={styles.actions}>
          {onRetry ? (
            <TouchableOpacity
              style={[styles.actionButton, { borderColor: tokens.primary }]}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.settings.retry}
              testID="advanced-runtime-retry"
            >
              <Text style={[styles.actionText, { color: tokens.primary }]}>
                {STRINGS.settings.retry}
              </Text>
            </TouchableOpacity>
          ) : null}
          {onReconfigure ? (
            <TouchableOpacity
              style={[styles.actionButton, { borderColor: tokens.primary }]}
              onPress={onReconfigure}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.settings.reconfigureAction}
              testID="advanced-runtime-reconfigure"
            >
              <Text style={[styles.actionText, { color: tokens.primary }]}>
                {STRINGS.settings.reconfigureAction}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  message: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  actionButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  actionText: { fontSize: 13, fontWeight: '600' },
});
