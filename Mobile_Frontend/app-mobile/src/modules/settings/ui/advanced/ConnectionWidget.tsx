/**
 * ConnectionWidget (Amendment 3, C3 restructure) — the shared compact
 * status widget of the status area: leading D3 status dot, service name,
 * SHORT status label, and a `›` chevron hint. NO action button — the
 * user's final wireframe removed it; the ENTIRE widget body is the tap
 * target (≥ 44 px) and opens the centered detail panel (the existing
 * centered-dialog recipe: fade `Modal` over a scrim Pressable, centered
 * smart card with a title + ✕ header, explicit `onRequestClose` for
 * Android back, compact maxWidth ~420).
 *
 * The check actions live INSIDE the panels (caller-supplied `children`),
 * so the MQTT and InfluxDB details stay asymmetric where they must
 * (auth row + retry/Cấu hình vs 4-field form + Kiểm tra) while sharing
 * the identical open/close choreography.
 *
 * The widget body carries the CALLER's container testID
 * (`advanced-mqtt-status` / `advanced-influx-status`) so the visibility
 * pins carry over; the panel buttons reuse the long-lived action IDs
 * (`advanced-mqtt-retry` / `advanced-influx-check` — relocated here from
 * the old widget quick action).
 *
 * Disabled states do not exist on the widget anymore (no button); the
 * panels own their action gating.
 */

import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import {
  ConnectionStatusBadge,
  type ServiceDotStatus,
} from './ConnectionStatusBadge';

export interface ConnectionWidgetProps {
  /** Container testID — the widget body carries the caller's ID. */
  readonly testID: string;
  /** Service name (the row title AND the detail panel title). */
  readonly name: string;
  /** D3 status color. */
  readonly dot: ServiceDotStatus;
  /** SHORT status label (state word, never a sentence). */
  readonly statusLabel: string;
  /** Detail visibility (screen/card-owned state). */
  readonly detailOpen: boolean;
  readonly onOpenDetail: () => void;
  readonly onCloseDetail: () => void;
  /** The detail panel body (caller-supplied). */
  readonly children: React.ReactNode;
}

export function ConnectionWidget({
  testID,
  name,
  dot,
  statusLabel,
  detailOpen,
  onOpenDetail,
  onCloseDetail,
  children,
}: ConnectionWidgetProps) {
  const { tokens } = useTheme();
  return (
    <>
      {/* The whole widget row is the tap target (C3): dot + name + short
          status + the `›` chevron hint → opens the detail. */}
      <Pressable
        style={[
          styles.widget,
          {
            backgroundColor: tokens.smart.colors.card,
            borderColor: tokens.smart.colors.cardBorder,
            borderRadius: tokens.smart.radius.card,
          },
          tokens.smart.cardShadow,
        ]}
        onPress={onOpenDetail}
        accessibilityRole="button"
        accessibilityLabel={`${name} — ${statusLabel}`}
        testID={`${testID}-body`}
      >
        <View testID={testID} style={styles.inner}>
          <ConnectionStatusBadge status={dot} />
          <View style={styles.textWrap}>
            <Text
              style={[styles.name, { color: tokens.smart.colors.textPrimary }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {name}
            </Text>
            <Text
              style={[
                styles.statusLabel,
                { color: tokens.smart.colors.textSecondary },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {statusLabel}
            </Text>
          </View>
          {/* The `›` chevron hint (kept per the user's wireframe). */}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={tokens.smart.colors.textSecondary}
          />
        </View>
      </Pressable>

      {/* The centered detail panel — the AddDeviceDialog recipe: fade
          Modal over a scrim, centered compact card, ✕ + Android back.
          Mounted only while open. */}
      {detailOpen ? (
        <Modal
          transparent
          animationType="fade"
          onRequestClose={onCloseDetail}
          testID={`${testID}-detail`}
        >
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.backdrop}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={onCloseDetail}
                accessibilityRole="button"
                accessibilityLabel={STRINGS.settings.findServerClose}
                testID={`${testID}-detail-scrim`}
              />
              <View
                style={[
                  styles.detailCard,
                  {
                    backgroundColor: tokens.smart.colors.card,
                    borderColor: tokens.smart.colors.cardBorder,
                    borderRadius: tokens.smart.radius.card,
                  },
                  tokens.smart.cardShadow,
                ]}
                testID={`${testID}-detail-card`}
              >
                <View style={styles.detailHeader}>
                  <Text
                    style={[
                      styles.detailTitle,
                      { color: tokens.smart.colors.textPrimary },
                    ]}
                  >
                    {name}
                  </Text>
                  <TouchableOpacity
                    onPress={onCloseDetail}
                    accessibilityRole="button"
                    accessibilityLabel={STRINGS.settings.findServerClose}
                    hitSlop={10}
                    testID={`${testID}-detail-close`}
                  >
                    <Ionicons
                      name="close"
                      size={22}
                      color={tokens.smart.colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
                {children}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  widget: {
    borderWidth: 1,
    marginTop: 12,
    marginBottom: 6,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textWrap: { flex: 1, flexShrink: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  statusLabel: { fontSize: 12, marginTop: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  detailCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailTitle: { fontSize: 16, fontWeight: '700' },
});
