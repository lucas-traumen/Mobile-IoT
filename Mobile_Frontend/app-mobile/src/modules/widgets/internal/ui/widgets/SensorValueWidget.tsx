/**
 * SensorValueWidget — biggest single reading for a sensor capability
 * (Smart Home anatomy, dashboard-smart-home-redesign).
 *
 * Card anatomy (approved + scope amendment 2): a line-style Ionicons glyph
 * (22) inside a soft icon chip, the MUTED capability name (cardTitle), the
 * big reading (sensorValue) + small unit in the capability SEMANTIC ACCENT,
 * and a secondary STATUS LINE — "Đã cập nhật HH:MM" from the live state
 * entry's wall-clock time, or the truthful "Chưa có dữ liệu" when no
 * observation exists. The sparkline and the 1h-delta caption are REMOVED
 * (user-approved decision 2026-09-05): full charts belong to the History
 * tab.
 *
 * NO-VALUE rendering (scope amendments 2–3): without an observation the
 * `—` placeholder renders as NORMAL secondary text at the
 * `smart.typography.sensorNoDataValue` size (28–32 — amendment 3), with the
 * SMALLER unit baseline-aligned beside it (`— °C`) — never in the big
 * accent style, which read as a progress bar. The GLYPH resolves per device
 * first (the optional per-device `icon`), then from the capability
 * definition, then the widget default (`resolveWidgetIcon`), rendered with
 * the glyph's OWN icon family (`WidgetGlyphIcon`).
 *
 * Display values use the Vietnamese decimal comma (`28,5`) through the pure
 * {@link formatVietnameseValue} helper — the numeric state, subscriptions
 * and history/query contracts stay numeric and untouched.
 *
 * Accents come from the theme tokens (`temperature`/`humidity` — teal/amber
 * per the approved D2 value change) or the capability catalog color for
 * custom capabilities (existing resolver precedence).
 *
 * NO one-line clamps: every text (title, reading, unit, status line)
 * reflows at font scale — the smart view cards grow with their content
 * (per-type `minHeight` floors) so nothing is ever truncated or clipped.
 * Truncating a reading or status line would HIDE live data, which the
 * truthfulness rule forbids.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme } from '@core/theme';

import type { WidgetConfig } from '../../domain/widgetTypes';
import { resolveCapabilityAccent } from '../../domain/capabilityColor';
import { resolveWidgetIcon } from '../../domain/widgetIcon';
import { WidgetGlyphIcon } from './WidgetGlyphIcon';
import { useWidgetServices, useCapabilityState } from '../widgetContext';

/**
 * Pure display formatting: Vietnamese one-decimal value with a comma
 * decimal separator (`28.5` → `'28,5'`).
 *
 * Display-only: never feed the result back into numeric state or queries.
 * Non-finite input renders the em-dash placeholder (the widget uses the
 * same placeholder when no observation exists).
 *
 * @param value - the numeric reading.
 * @param digits - decimal digits (default 1, the widget's documented form).
 */
export function formatVietnameseValue(value: number, digits = 1): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(digits).replace('.', ',');
}

/** `HH:MM` wall-clock label for an observation timestamp (status line). */
function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Sensor value widget: icon chip + muted name + big accent reading +
 * live update-time status line.
 *
 * @param props.config - widget config (binding + layout decide the display).
 */
export function SensorValueWidget({ config }: { config: WidgetConfig }) {
  const { tokens } = useTheme();
  const services = useWidgetServices();

  const capability = config.binding?.capability ?? 'temperature';
  const deviceId = config.binding?.deviceId ?? '';
  const enabled = !!config.binding && !!deviceId;

  // CP-R1: reactive subscription via useSyncExternalStore hook.
  const state = useCapabilityState(deviceId, capability, enabled);

  const def = services
    .getCapabilities()
    .find(candidate => candidate.type === capability);

  // Per-device glyph (amendment 2): device icon → capability icon → default.
  const device = services.getDevices().find(item => item.id === deviceId);

  // Accent: built-in temperature/humidity resolve from the active theme
  // tokens (teal/blue after the approved D2 + amendment-2 value changes);
  // custom capabilities use the catalog color (CP-R6 resolver precedence).
  const accent = resolveCapabilityAccent(capability, def, tokens);
  const title =
    config.title ??
    def?.label ??
    (capability === 'temperature'
      ? STRINGS.dashboard.temperature
      : STRINGS.dashboard.humidity);
  const unit = def?.unit ?? (capability === 'temperature' ? '°C' : '%');

  // Truthful value detection (amendment 2): an observation with a finite
  // number renders the big accent reading; everything else (no entry,
  // non-finite) renders the muted dash placeholder.
  const numeric =
    state && typeof state.value === 'number' ? state.value : undefined;
  const hasValue = numeric !== undefined && Number.isFinite(numeric);

  const valueText = hasValue ? formatVietnameseValue(numeric) : '—';

  // Status line: the newest observation's wall-clock time from the LIVE
  // state entry — never an invented time, never a mock number.
  const statusLine = state
    ? STRINGS.dashboard.sensorUpdated.replace(
        '{time}',
        formatClock(state.updatedAt),
      )
    : STRINGS.dashboard.sensorNoData;

  return (
    <View style={[styles.card, { padding: tokens.smart.spacing.cardPadding }]}>
      <View style={styles.header}>
        <View
          style={[
            styles.iconChip,
            {
              backgroundColor: tokens.smart.colors.page,
              borderColor: tokens.smart.colors.cardBorder,
            },
          ]}
        >
          <WidgetGlyphIcon
            icon={resolveWidgetIcon(device?.icon, def?.icon, {
              family: 'ionicons',
              name: 'pulse-outline',
            })}
            size={22}
            color={accent}
          />
        </View>
        <Text
          style={[
            styles.title,
            {
              color: tokens.smart.colors.textSecondary,
              fontSize: tokens.smart.typography.cardTitle,
            },
          ]}
        >
          {title}
        </Text>
      </View>
      <View style={styles.valueRow}>
        {hasValue ? (
          <Text
            style={[
              styles.value,
              {
                color: accent,
                fontSize: tokens.smart.typography.sensorValue,
              },
            ]}
          >
            {valueText}
          </Text>
        ) : (
          // No observation (scope amendments 2–3): the dash renders as
          // NORMAL secondary text at the 28–32 `sensorNoDataValue` token —
          // never in the big accent style that read as a progress bar.
          <Text
            style={[
              styles.valuePlaceholder,
              {
                color: tokens.smart.colors.textSecondary,
                fontSize: tokens.smart.typography.sensorNoDataValue,
              },
            ]}
          >
            {valueText}
          </Text>
        )}
        <Text
          style={[
            styles.unit,
            {
              color: hasValue ? accent : tokens.smart.colors.textSecondary,
              fontSize: tokens.smart.typography.unit,
            },
          ]}
        >
          {unit}
        </Text>
      </View>
      <Text
        style={[
          styles.status,
          {
            color: tokens.smart.colors.textSecondary,
            fontSize: tokens.smart.typography.secondary,
          },
        ]}
      >
        {statusLine}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  // Soft icon chip (approved anatomy): page-tinted surface + hairline
  // border, the capability accent colors the line-style glyph inside.
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontWeight: '600' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  value: { fontFamily: INTER_SEMIBOLD },
  // Amendment-2/3 no-value placeholder: NORMAL secondary text; the size
  // comes from the `sensorNoDataValue` token (28–32, amendment 3) at render
  // time — baseline-aligned with the smaller unit via valueRow.
  valuePlaceholder: { fontWeight: '500' },
  unit: { fontWeight: '600' },
  // Secondary status line: muted (the accent is reserved for value/unit).
  status: { fontWeight: '500', marginTop: 6 },
});
