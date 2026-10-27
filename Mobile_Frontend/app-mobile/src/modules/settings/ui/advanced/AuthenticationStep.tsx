/**
 * AuthenticationStep — step 2 (Xác thực) of the guided MQTT configuration
 * flow (advanced-config-stepper-redesign).
 *
 * Title `Xác thực MQTT`; the two credential inputs (username; password
 * masked by default with a reveal toggle) and the
 * `Broker không yêu cầu xác thực` checkbox — when checked the two inputs
 * are not required and the probe connects WITHOUT credentials.
 *
 * D2: the QR fill affordance (`Quét QR từ server`) stays — compact
 * secondary action; the existing `QrScannerModal` + `secretsQrContract`
 * flow is screen-owned (fill-never-save, influxToken → the influx draft).
 *
 * D4: the primary `Kiểm tra kết nối` runs the REAL one-shot probe
 * (screen-owned injected {@link MqttProbeServiceLike} — this component
 * only renders the states and forwards taps). Loading state on the
 * button (no double-press); failure keeps all entered data and shows a
 * short inline error in the card; success auto-advances (the screen).
 *
 * InfluxDB section (user request): the four DRAFT fields (url/org/
 * bucket + masked token with reveal) render below the MQTT credentials.
 * Typing only emits partial patches through
 * {@link AuthenticationStepProps.onPatchInflux} — nothing saves and
 * nothing probes from field edits (the dual probe still checks this
 * config when it is sufficient).
 *
 * Pure presentation: fields live in the store draft through
 * {@link AuthenticationStepProps.onPatchMqtt}; nothing here saves.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import type { InfluxSettings } from '@modules/settings/api';

import { FieldRow } from './FieldRow';

export interface AuthenticationStepProps {
  /** Draft MQTT username (verbatim secret). */
  readonly username: string;
  /** Draft MQTT password (verbatim secret, masked by default). */
  readonly password: string;
  /** Whether the step-1 address (host + port) is valid — gates the probe. */
  readonly hostValid: boolean;
  /** A probe is in flight (honest loading on the primary button). */
  readonly probing: boolean;
  /** Short friendly inline error of the last failed probe (null = none). */
  readonly probeErrorText: string | null;
  /**
   * The dual probe's InfluxDB half (Amendment 1, A3): `skipped` when the
   * draft influx is insufficient, otherwise checking/ok/failed — failure
   * is NON-blocking (MQTT alone gates step 3).
   */
  readonly influxState: 'skipped' | 'checking' | 'ok' | 'failed';
  /** The friendly InfluxDB result line (null = nothing to show). */
  readonly influxResultText: string | null;
  /** The `Broker không yêu cầu xác thực` option state. */
  readonly noAuth: boolean;
  /** Toggle the no-auth option. */
  readonly onToggleNoAuth: (value: boolean) => void;
  /** Update the secret fields in the store draft (never saves). */
  readonly onPatchMqtt: (patch: {
    username?: string;
    password?: string;
  }) => void;
  /** `Quay lại` — the screen returns to step 1 (draft kept). */
  readonly onBack: () => void;
  /** `Kiểm tra kết nối` — the screen runs the real dual probe. */
  readonly onProbe: () => void;
  /** `Quét QR từ server` — the screen opens the QR scanner modal. */
  readonly onScanQr: () => void;
  /** The draft InfluxDB config (the step's editable Influx section). */
  readonly influx: InfluxSettings;
  /** Update Influx fields in the store draft (never saves). */
  readonly onPatchInflux: (patch: Partial<InfluxSettings>) => void;
  /** Field errors keyed by dotted path (e.g. `influx.url`). */
  readonly errors?: Record<string, string>;
}

export function AuthenticationStep({
  username,
  password,
  hostValid,
  probing,
  probeErrorText,
  influxState,
  influxResultText,
  noAuth,
  onToggleNoAuth,
  onPatchMqtt,
  influx,
  onPatchInflux,
  errors,
  onBack,
  onProbe,
  onScanQr,
}: AuthenticationStepProps) {
  const { tokens } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
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
      testID="advanced-step-auth"
    >
      <Text
        style={[styles.cardTitle, { color: tokens.smart.colors.textPrimary }]}
      >
        {STRINGS.settings.authTitle}
      </Text>

      {/* Compact QR fill affordance (D2 — keep the affordance, shrink the
          presence): fill-never-save through the screen-owned contract. */}
      <TouchableOpacity
        style={[styles.qrButton, { borderColor: tokens.primary }]}
        onPress={onScanQr}
        accessibilityRole="button"
        accessibilityLabel={STRINGS.settings.stepScanQr}
        testID="setup-scan-qr"
      >
        <Ionicons name="camera-outline" size={16} color={tokens.primary} />
        <Text style={[styles.qrButtonText, { color: tokens.primary }]}>
          {STRINGS.settings.stepScanQr}
        </Text>
      </TouchableOpacity>

      <FieldRow label={STRINGS.settings.username} tokens={tokens}>
        <TextInput
          style={inputStyle}
          value={username}
          onChangeText={value => onPatchMqtt({ username: value })}
          autoCapitalize="none"
          autoCorrect={false}
          testID="advanced-username-input"
        />
      </FieldRow>
      <FieldRow label={STRINGS.settings.password} tokens={tokens}>
        <View style={styles.passwordRow}>
          <TextInput
            style={[inputStyle, styles.passwordInput]}
            value={password}
            onChangeText={value => onPatchMqtt({ password: value })}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            testID="advanced-password-input"
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword(visible => !visible)}
            accessibilityRole="button"
            accessibilityLabel={
              showPassword ? STRINGS.settings.hide : STRINGS.settings.show
            }
            testID="advanced-password-reveal"
          >
            <Text style={[styles.eyeText, { color: tokens.primary }]}>
              {showPassword ? STRINGS.settings.hide : STRINGS.settings.show}
            </Text>
          </TouchableOpacity>
        </View>
      </FieldRow>

      {/* The no-auth option: checked = the inputs are not required and the
          probe connects without credentials. */}
      <TouchableOpacity
        style={styles.noAuthRow}
        onPress={() => onToggleNoAuth(!noAuth)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: noAuth }}
        accessibilityLabel={STRINGS.settings.noAuthOption}
        testID="advanced-no-auth-checkbox"
      >
        <View
          style={[
            styles.checkbox,
            { borderColor: tokens.primary },
            noAuth && { backgroundColor: tokens.primary },
          ]}
        >
          {noAuth ? (
            <Ionicons name="checkmark" size={14} color={tokens.onPrimary} />
          ) : null}
        </View>
        <Text
          style={[
            styles.noAuthText,
            { color: tokens.smart.colors.textPrimary },
          ]}
        >
          {STRINGS.settings.noAuthOption}
        </Text>
      </TouchableOpacity>

      {/* The InfluxDB DRAFT section (user request): the same four fields
          the post-save status detail owns — edited HERE against the
          draft. Typing only emits partial patches (never saves, never
          probes); the dual probe still checks this config when it is
          sufficient. */}
      <Text
        style={[
          styles.sectionTitle,
          { color: tokens.smart.colors.textPrimary },
        ]}
      >
        {STRINGS.settings.influx}
      </Text>
      <FieldRow
        label={STRINGS.settings.url}
        tokens={tokens}
        error={errors?.['influx.url']}
      >
        <TextInput
          style={inputStyle}
          value={influx.url}
          onChangeText={value => onPatchInflux({ url: value })}
          placeholder="http://192.168.1.10:8086"
          placeholderTextColor={tokens.smart.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          testID="advanced-step-influx-url"
        />
      </FieldRow>
      <FieldRow
        label={STRINGS.settings.org}
        tokens={tokens}
        error={errors?.['influx.org']}
      >
        <TextInput
          style={inputStyle}
          value={influx.org}
          onChangeText={value => onPatchInflux({ org: value })}
          autoCapitalize="none"
          autoCorrect={false}
          testID="advanced-step-influx-org"
        />
      </FieldRow>
      <FieldRow
        label={STRINGS.settings.bucket}
        tokens={tokens}
        error={errors?.['influx.bucket']}
      >
        <TextInput
          style={inputStyle}
          value={influx.bucket}
          onChangeText={value => onPatchInflux({ bucket: value })}
          autoCapitalize="none"
          autoCorrect={false}
          testID="advanced-step-influx-bucket"
        />
      </FieldRow>
      <FieldRow
        label={STRINGS.settings.token}
        tokens={tokens}
        error={errors?.['influx.token']}
      >
        <View style={styles.passwordRow}>
          <TextInput
            style={[inputStyle, styles.passwordInput]}
            value={influx.token}
            onChangeText={value => onPatchInflux({ token: value })}
            secureTextEntry={!showToken}
            autoCapitalize="none"
            autoCorrect={false}
            testID="advanced-step-influx-token"
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowToken(visible => !visible)}
            accessibilityRole="button"
            accessibilityLabel={
              showToken ? STRINGS.settings.hide : STRINGS.settings.show
            }
            testID="advanced-step-influx-token-reveal"
          >
            <Text style={[styles.eyeText, { color: tokens.primary }]}>
              {showToken ? STRINGS.settings.hide : STRINGS.settings.show}
            </Text>
          </TouchableOpacity>
        </View>
      </FieldRow>

      {/* Short inline probe failure (D4) — the entered data is never
          touched by a failed probe. */}
      {probeErrorText !== null ? (
        <Text
          style={[styles.probeError, { color: tokens.danger }]}
          testID="advanced-probe-error"
        >
          {probeErrorText}
        </Text>
      ) : null}

      {/* The dual probe's InfluxDB half (A3): honest inline result —
          skipped (draft insufficient) / checking / ok / failed with the
          friendly cause. Failure NEVER blocks the flow and secrets are
          never surfaced. */}
      {influxResultText !== null ? (
        <Text
          style={[
            styles.influxResult,
            {
              color:
                influxState === 'failed'
                  ? tokens.danger
                  : influxState === 'ok'
                  ? tokens.smart.colors.teal
                  : tokens.smart.colors.textSecondary,
            },
          ]}
          testID="advanced-influx-probe-result"
        >
          {influxResultText}
        </Text>
      ) : null}

      <View style={styles.buttonsRow}>
        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: tokens.primary }]}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.settings.back}
          testID="setup-back"
        >
          <Text style={[styles.secondaryButtonText, { color: tokens.primary }]}>
            {STRINGS.settings.back}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: tokens.primary },
            (probing || !hostValid) && styles.buttonDisabled,
          ]}
          onPress={onProbe}
          disabled={probing || !hostValid}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.settings.checkConnection}
          testID="advanced-probe-start"
        >
          <Text style={[styles.primaryButtonText, { color: tokens.onPrimary }]}>
            {probing
              ? STRINGS.settings.checking
              : STRINGS.settings.checkConnection}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
    gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  qrButtonText: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  eyeButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  eyeText: { fontSize: 13, fontWeight: '600' },
  noAuthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    minHeight: 44,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noAuthText: { fontSize: 14, flexShrink: 1 },
  probeError: { fontSize: 12, lineHeight: 17 },
  influxResult: { fontSize: 12, lineHeight: 17 },
  buttonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  primaryButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
});
