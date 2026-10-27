/**
 * MqttStatusCard (Amendment 2, B3 restructure) — the MQTT status area as
 * a compact ConnectionWidget + centered detail panel.
 *
 * WIDGET: leading D3 dot, the service name, a SHORT status label, and one
 * quick action — `Kiểm tra lại` (connected) / `Thử lại` (lost/failed),
 * both the REAL wired retry; `Đang kết nối…` (disabled, readable) while
 * connecting; NO quick action when unconfigured (the action lives in the
 * detail as `Cấu hình`). The widget body carries the long-lived
 * `advanced-mqtt-status` testID (visibility v2 pins) and opens the
 * detail; the quick action keeps the long-lived `advanced-mqtt-retry`.
 *
 * DETAIL (centered dialog recipe): the live state label + description
 * (host:port or the friendly failure cause), the auth mode row (the
 * username or `không xác thực` — the password is NEVER rendered), a
 * retry action, and — when the persisted MQTT side is unconfigured — a
 * `Cấu hình` action that closes the detail and returns the flow to
 * step 1 (the capability relocated from the old card row, resolving the
 * asymmetry with the InfluxDB detail).
 *
 * Truthfulness contract unchanged: the state derives from the REAL
 * telemetry lifecycle (the screen passes it in); this component renders
 * and forwards.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import { ConnectionWidget } from './ConnectionWidget';
import type { ServiceDotStatus } from './ConnectionStatusBadge';

/** The five approved widget states (the real lifecycle mapping). */
export type MqttCardState =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'lost'
  | 'failed';

/** Widget state → D3 dot status. */
const STATE_DOT: Record<MqttCardState, ServiceDotStatus> = {
  unconfigured: 'gray',
  connecting: 'progress',
  connected: 'healthy',
  lost: 'failed',
  failed: 'failed',
};

/** Widget state → Vietnamese SHORT status label. */
export function mqttStateLabel(state: MqttCardState): string {
  switch (state) {
    case 'unconfigured':
      return STRINGS.settings.statusNotConfigured;
    case 'connecting':
      return STRINGS.settings.mqttStateConnecting;
    case 'connected':
      return STRINGS.settings.mqttStateConnected;
    case 'lost':
      return STRINGS.settings.mqttStateLost;
    case 'failed':
      return STRINGS.settings.mqttStateFailed;
  }
}

export interface MqttStatusCardProps {
  readonly state: MqttCardState;
  /** Short description line (host:port / friendly failure cause). */
  readonly description: string;
  /** Auth mode of the LIVE config: the username or `không xác thực`. */
  readonly authLabel: string;
  /** `Cấu hình` (detail, unconfigured only) — closes + returns to step 1. */
  readonly onConfigure?: () => void;
  /** The REAL wired retry (stop → start of the actual telemetry service). */
  readonly onRetry?: () => void;
}

export function MqttStatusCard({
  state,
  description,
  authLabel,
  onConfigure,
  onRetry,
}: MqttStatusCardProps) {
  const { tokens } = useTheme();
  const [detailOpen, setDetailOpen] = useState(false);
  const label = mqttStateLabel(state);
  return (
    <ConnectionWidget
      testID="advanced-mqtt-status"
      name={STRINGS.settings.mqttCardTitle}
      dot={STATE_DOT[state]}
      statusLabel={label}
      detailOpen={detailOpen}
      onOpenDetail={() => setDetailOpen(true)}
      onCloseDetail={() => setDetailOpen(false)}
    >
      {/* Detail body: state + description + auth mode + actions. */}
      <Text
        style={[styles.detailState, { color: tokens.smart.colors.textPrimary }]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.detailDescription,
          { color: tokens.smart.colors.textSecondary },
        ]}
      >
        {description}
      </Text>
      <View style={styles.detailRow}>
        <Text
          style={[
            styles.detailRowLabel,
            { color: tokens.smart.colors.textSecondary },
          ]}
        >
          {STRINGS.settings.summaryAuth}
        </Text>
        {/* The auth MODE only — the password is never rendered. */}
        <Text
          style={[
            styles.detailRowValue,
            { color: tokens.smart.colors.textPrimary },
          ]}
          numberOfLines={1}
          ellipsizeMode="tail"
          testID="mqtt-detail-auth"
        >
          {authLabel}
        </Text>
      </View>
      {state !== 'unconfigured' ? (
        <TouchableOpacity
          style={[styles.detailButton, { borderColor: tokens.primary }]}
          onPress={onRetry}
          disabled={!onRetry}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.settings.retry}
          testID="advanced-mqtt-retry"
        >
          <Text style={[styles.detailButtonText, { color: tokens.primary }]}>
            {STRINGS.settings.retry}
          </Text>
        </TouchableOpacity>
      ) : null}
      {state === 'unconfigured' && onConfigure ? (
        <TouchableOpacity
          style={[
            styles.detailButton,
            styles.detailButtonPrimary,
            { backgroundColor: tokens.primary },
          ]}
          onPress={() => {
            setDetailOpen(false);
            onConfigure();
          }}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.settings.configAction}
          testID="advanced-mqtt-configure"
        >
          <Text
            style={[styles.detailButtonTextFilled, { color: tokens.onPrimary }]}
          >
            {STRINGS.settings.configAction}
          </Text>
        </TouchableOpacity>
      ) : null}
    </ConnectionWidget>
  );
}

const styles = StyleSheet.create({
  detailState: { fontSize: 14, fontWeight: '600' },
  detailDescription: { fontSize: 12, lineHeight: 17 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailRowLabel: { fontSize: 13, fontWeight: '600', width: 72 },
  detailRowValue: { fontSize: 13, flexShrink: 1 },
  detailButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  detailButtonPrimary: { borderWidth: 0 },
  detailButtonText: { fontSize: 14, fontWeight: '600' },
  detailButtonTextFilled: { fontSize: 14, fontWeight: '600' },
});
