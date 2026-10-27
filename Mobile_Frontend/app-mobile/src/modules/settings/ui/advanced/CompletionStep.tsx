/**
 * CompletionStep — step 3 (Hoàn tất) of the guided MQTT configuration
 * flow (advanced-config-stepper-redesign; save-failure policy as of
 * advanced-settings-sequential-recovery).
 *
 * Large ✓ icon + `Kết nối thành công` + a read-only summary of what will
 * be persisted: broker address, WS port, and the auth status (the
 * username, or `không xác thực` — the password itself is NEVER shown)
 * with the `đã kiểm tra` marker (reaching this step means the real probe
 * succeeded).
 *
 * Primary `Lưu cấu hình` drives the EXISTING screen save path (the one
 * handleSave — validation failures surface per current behavior). On a
 * FAILED save the user STAYS here (never navigated backward): the error
 * message renders near the save action and the primary button becomes
 * `Thử lại` — the approved primary recovery action. The contextual edit
 * actions are EXPLICIT and draft-preserving: `Chỉnh sửa xác thực` returns
 * to step 2; `Chỉnh sửa máy chủ` (rendered only when the candidate server
 * fields need changing — the screen passes the handler conditionally)
 * returns to step 1. Nothing here saves on its own and nothing navigates
 * automatically.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

export interface CompletionStepProps {
  /** Draft broker host. */
  readonly host: string;
  /** Draft broker WS port. */
  readonly port: number;
  /** Draft MQTT username ('' = no auth configured). */
  readonly username: string;
  /** A save is in flight (honest loading on the primary button). */
  readonly saving: boolean;
  /**
   * The settled InfluxDB half of the dual probe (Amendment 1, A3):
   * non-secret states only — the token is NEVER shown.
   */
  readonly influxState: 'ok' | 'failed' | 'skipped';
  /** `Lưu cấu hình` — the screen's existing save path. */
  readonly onSave: () => void;
  /**
   * The LAST failed save's message (null = none). Renders near the save
   * action and turns the primary button into `Thử lại`; the user is
   * never navigated away by a failure.
   */
  readonly saveError: string | null;
  /** `Chỉnh sửa xác thực` — the screen returns to step 2 (draft kept). */
  readonly onEditAuth: () => void;
  /**
   * `Chỉnh sửa máy chủ` — the screen returns to step 1 (draft kept).
   * Rendered only when the candidate server fields need changing.
   */
  readonly onEditServer?: () => void;
}

export function CompletionStep({
  host,
  port,
  username,
  saving,
  influxState,
  onSave,
  saveError,
  onEditAuth,
  onEditServer,
}: CompletionStepProps) {
  const { tokens } = useTheme();
  const authValue =
    username.length > 0 ? username : STRINGS.settings.summaryNoAuth;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
          borderRadius: tokens.smart.radius.card,
        },
        tokens.smart.cardShadow,
      ]}
      testID="advanced-step-completion"
    >
      <View
        style={[
          styles.checkBadge,
          { backgroundColor: tokens.smart.colors.teal },
        ]}
        testID="completion-check"
      >
        {/* `primary === smart.colors.teal` is test-pinned, so `onPrimary`
            is the readable-on-teal token (CP6). */}
        <Ionicons name="checkmark" size={34} color={tokens.onPrimary} />
      </View>
      <Text
        style={[styles.cardTitle, { color: tokens.smart.colors.textPrimary }]}
      >
        {STRINGS.settings.completionTitle}
      </Text>

      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text
            style={[
              styles.summaryLabel,
              { color: tokens.smart.colors.textSecondary },
            ]}
          >
            {STRINGS.settings.summaryAddress}
          </Text>
          <Text
            testID="completion-address"
            style={[
              styles.summaryValue,
              { color: tokens.smart.colors.textPrimary },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {host}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text
            style={[
              styles.summaryLabel,
              { color: tokens.smart.colors.textSecondary },
            ]}
          >
            {STRINGS.settings.summaryPort}
          </Text>
          <Text
            testID="completion-port"
            style={[
              styles.summaryValue,
              { color: tokens.smart.colors.textPrimary },
            ]}
          >
            {port}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text
            style={[
              styles.summaryLabel,
              { color: tokens.smart.colors.textSecondary },
            ]}
          >
            {STRINGS.settings.summaryAuth}
          </Text>
          <View testID="completion-auth" style={styles.summaryAuthValue}>
            <Text
              style={[
                styles.summaryValue,
                { color: tokens.smart.colors.textPrimary },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {authValue}
            </Text>
            <Text
              style={[styles.verified, { color: tokens.smart.colors.teal }]}
            >
              {STRINGS.settings.summaryVerified}
            </Text>
          </View>
        </View>
        {/* Amendment 1 (A3): the InfluxDB summary row — non-secret states
            only; the token is NEVER shown. */}
        <View style={styles.summaryRow}>
          <Text
            style={[
              styles.summaryLabel,
              { color: tokens.smart.colors.textSecondary },
            ]}
          >
            {STRINGS.settings.influx}
          </Text>
          <View testID="completion-influx" style={styles.summaryAuthValue}>
            {influxState === 'ok' ? (
              <>
                <Ionicons
                  name="checkmark"
                  size={14}
                  color={tokens.smart.colors.teal}
                />
                <Text
                  style={[
                    styles.summaryValue,
                    { color: tokens.smart.colors.textPrimary },
                  ]}
                >
                  {STRINGS.settings.summaryVerified}
                </Text>
              </>
            ) : influxState === 'failed' ? (
              <Text style={[styles.summaryValue, { color: tokens.danger }]}>
                {STRINGS.settings.failed}
              </Text>
            ) : (
              <Text
                style={[
                  styles.summaryValue,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.settings.summaryInfluxSkipped}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Save-failure recovery (approved policy): the user STAYS on step
          3 — the retryable error renders near the save action and `Thử
          lại` becomes the primary label. No automatic backward
          navigation; the explicit edit actions below are the only way
          back. */}
      {saveError !== null ? (
        <Text
          style={[styles.saveError, { color: tokens.danger }]}
          testID="completion-save-error"
        >
          {saveError}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[
          styles.primaryButton,
          { backgroundColor: tokens.primary },
          saving && styles.buttonDisabled,
        ]}
        onPress={onSave}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel={STRINGS.settings.saveConfig}
        testID="setup-save"
      >
        <Text style={[styles.primaryButtonText, { color: tokens.onPrimary }]}>
          {saving
            ? STRINGS.settings.saving
            : saveError !== null
            ? STRINGS.settings.retry
            : STRINGS.settings.saveConfig}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.secondaryButton, { borderColor: tokens.primary }]}
        onPress={onEditAuth}
        accessibilityRole="button"
        accessibilityLabel={STRINGS.settings.editAuthAction}
        testID="setup-edit-auth"
      >
        <Text style={[styles.secondaryButtonText, { color: tokens.primary }]}>
          {STRINGS.settings.editAuthAction}
        </Text>
      </TouchableOpacity>
      {onEditServer ? (
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: tokens.primary }]}
          onPress={onEditServer}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.settings.editServerAction}
          testID="setup-edit-server"
        >
          <Text style={[styles.secondaryButtonText, { color: tokens.primary }]}>
            {STRINGS.settings.editServerAction}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
    gap: 10,
    alignItems: 'center',
  },
  checkBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  summary: {
    alignSelf: 'stretch',
    gap: 8,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryLabel: { fontSize: 13, fontWeight: '600', width: 64 },
  summaryValue: { fontSize: 14, flexShrink: 1 },
  summaryAuthValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verified: { fontSize: 12, fontWeight: '600' },
  primaryButton: {
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 4,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  saveError: { fontSize: 13, lineHeight: 18 },
  buttonDisabled: { opacity: 0.5 },
});
