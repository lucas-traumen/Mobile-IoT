/**
 * Settings screen — Vietnamese, theme-token based, summary/navigation root
 * (settings-information-architecture plan).
 *
 * The root is a SUMMARY + NAVIGATION surface, never a configuration form:
 * - Giao diện: exactly two explicit theme choices (`Sáng` / `Tối`) applied
 *   immediately — the removed `Hệ thống` choice cannot appear here.
 * - Quản lý: navigation rows into the nested screens — the Dashboard
 *   & Templates management entry (the Template → Room → Widget hierarchy
 *   lives INSIDE Settings; the Dashboard tab itself stays view-only),
 *   device management, plus the dedicated `Cấu hình nâng cao` screen.
 * - Kết nối: NO permanent status cards and NO combined check button. The
 *   root shows only a concise actionable warning row when a service is in
 *   a CONFIRMED failure state (MQTT `failed`); details and per-service
 *   diagnostics live in the advanced screen.
 *
 * Room/device/capability management is rendered by its owning module under
 * this tab through the app-layer navigator — this screen only navigates to
 * it (module persistence ownership is unchanged).
 *
 * Visual language (settings-smart-home-sync): the ambient Smart Home wash
 * background (tealTint → page → amberTint), smart card rows with the soft
 * icon chip and smart text — one visual system with the other tabs. All
 * colors come from {@link useTheme} tokens; all labels from `STRINGS`.
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import type { AppErrorCode } from '@core/errors';
import type { ConnectionState } from '@core/events';
import { APP_VERSION } from '@core/constants';
import { errorLabel, STRINGS } from '@core/i18n';
import { useTheme, type ThemeTokens } from '@core/theme';
import type { UiSettings } from '@modules/settings/api';

interface SettingsScreenProps {
  /** Current draft settings (the theme buttons read `ui.theme`). */
  settings: UiSettings;
  /** Field errors keyed by dotted path (unused at the root; reserved). */
  errors?: Record<string, string>;
  /** Update UI preferences (theme mode) — applied immediately. */
  onUpdateUi?: (patch: Partial<UiSettings>) => void;
  /**
   * Open the Template → Room → Widget management hierarchy (the Settings
   * stack's management entry; the Dashboard tab stays view-only).
   */
  onOpenDashboardManager?: () => void;
  /**
   * Open the hardware-boards discovery screen (board-discovery-binding):
   * boards running on the broker + their room bindings.
   */
  onOpenBoards?: () => void;
  /** Open the devices-owned management screen (rooms/devices/catalog). */
  onOpenDeviceManagement?: () => void;
  /** Open the dedicated advanced configuration screen. */
  onOpenAdvanced?: () => void;
  /** Live MQTT connection state (failure-only summary row). */
  connectionState?: ConnectionState;
  /** Friendly cause of the last failed MQTT connection (CP5). */
  lastErrorCode?: AppErrorCode | null;
}

/** One management navigation row (icon + title + description + chevron). */
function ManageRow({
  icon,
  title,
  description,
  tokens,
  onPress,
  testID,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  tokens: ThemeTokens;
  onPress: () => void;
  testID?: string;
  tone?: 'danger';
}) {
  const accent = tone === 'danger' ? tokens.danger : tokens.primary;
  return (
    <TouchableOpacity
      style={[
        styles.manageRow,
        // Smart card recipe (settings-smart-home-sync): card surface +
        // hairline border; the danger tone keeps its semantic border.
        {
          backgroundColor: tokens.smart.colors.card,
          borderColor:
            tone === 'danger' ? tokens.danger : tokens.smart.colors.cardBorder,
          borderRadius: tokens.smart.radius.card,
        },
        tone === 'danger' ? null : tokens.smart.cardShadow,
      ]}
      testID={testID}
      onPress={onPress}
    >
      <View
        style={[
          styles.manageIcon,
          {
            backgroundColor: tokens.smart.colors.page,
            borderColor: tokens.smart.colors.cardBorder,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <View style={styles.manageText}>
        <Text
          style={[styles.rowTitle, { color: tokens.smart.colors.textPrimary }]}
        >
          {title}
        </Text>
        <Text
          style={[styles.rowMeta, { color: tokens.smart.colors.textSecondary }]}
        >
          {description}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={tokens.smart.colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

/**
 * Settings root screen — summary + navigation (CP-R2 sectioned layout).
 */
export function SettingsScreen({
  settings,
  onUpdateUi,
  onOpenDashboardManager,
  onOpenBoards,
  onOpenDeviceManagement,
  onOpenAdvanced,
  connectionState,
  lastErrorCode,
}: SettingsScreenProps) {
  const { tokens } = useTheme();

  const themeOptions: readonly {
    value: UiSettings['theme'];
    label: string;
  }[] = [
    { value: 'light', label: STRINGS.settings.light },
    { value: 'dark', label: STRINGS.settings.dark },
  ];

  // Failure-only connection summary: the root never shows permanent status
  // cards and never runs a combined check — a confirmed MQTT failure gets
  // one concise, actionable warning row linking to the advanced screen.
  const mqttFailed = connectionState === 'failed';

  return (
    // The ambient Smart Home wash — same recipe as the Dashboard tab
    // (settings-smart-home-sync).
    <LinearGradient
      colors={[
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.flex}
    >
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Text
          style={[
            styles.title,
            {
              color: tokens.smart.colors.textPrimary,
              // settings-smart-home-sync: the smart screen-title scale
              // (27) — level with the other two tab roots.
              fontSize: tokens.smart.typography.screenTitle,
            },
          ]}
        >
          {STRINGS.settings.title}
        </Text>

        {/* Giao diện (explicit light/dark only — no `system` choice) */}
        <Text
          style={[
            styles.sectionTitle,
            { color: tokens.smart.colors.textPrimary },
          ]}
        >
          {STRINGS.settings.interface}
        </Text>
        <View style={styles.themeRow}>
          {themeOptions.map(option => {
            const active = settings.theme === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.themeButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                  active && {
                    backgroundColor: tokens.primary,
                    borderColor: tokens.primary,
                  },
                ]}
                onPress={() => {
                  if (onUpdateUi) {
                    onUpdateUi({ theme: option.value });
                  }
                }}
                testID={`settings-theme-${option.value}`}
              >
                <Text
                  style={[
                    styles.themeButtonText,
                    {
                      color: active
                        ? tokens.onPrimary
                        : tokens.smart.colors.textSecondary,
                    },
                    active && styles.themeButtonTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Quản lý (nested screens owned by their modules; the Template →
          Room → Widget hierarchy is reachable ONLY through the first row) */}
        <Text
          style={[
            styles.sectionTitle,
            { color: tokens.smart.colors.textPrimary },
          ]}
        >
          {STRINGS.settings.manageSection}
        </Text>
        {onOpenDashboardManager ? (
          <ManageRow
            icon="grid-outline"
            title={STRINGS.settings.manageDashboard}
            description={STRINGS.settings.manageDashboardDesc}
            tokens={tokens}
            onPress={onOpenDashboardManager}
            testID="settings-open-dashboard-manager"
          />
        ) : null}
        {/* Board discovery (board-discovery-binding): directly below the
            Dashboard-management row, per the approved layout. */}
        {onOpenBoards ? (
          <ManageRow
            icon="hardware-chip-outline"
            title={STRINGS.settings.manageBoards}
            description={STRINGS.settings.manageBoardsDesc}
            tokens={tokens}
            onPress={onOpenBoards}
            testID="settings-open-boards"
          />
        ) : null}
        {onOpenDeviceManagement ? (
          <ManageRow
            icon="layers-outline"
            title={STRINGS.settings.manageDevices}
            description={STRINGS.settings.manageDevicesDesc}
            tokens={tokens}
            onPress={onOpenDeviceManagement}
            testID="settings-open-devices"
          />
        ) : null}
        {onOpenAdvanced ? (
          <ManageRow
            icon="settings-outline"
            title={STRINGS.settings.advancedTitle}
            description={STRINGS.settings.advancedDesc}
            tokens={tokens}
            onPress={onOpenAdvanced}
            testID="settings-open-advanced"
          />
        ) : null}

        {/* Kết nối: concise failure-only summary (never a status card grid). */}
        {mqttFailed ? (
          <ManageRow
            icon="warning-outline"
            title={STRINGS.settings.mqtt}
            description={
              lastErrorCode
                ? `${STRINGS.dashboard.mqttOffline} — ${errorLabel(
                    lastErrorCode,
                  )} · ${STRINGS.settings.connectionWarning}`
                : STRINGS.settings.connectionWarning
            }
            tokens={tokens}
            tone="danger"
            onPress={() => {
              if (onOpenAdvanced) {
                onOpenAdvanced();
              }
            }}
            testID="settings-connection-warning"
          />
        ) : null}

        {/* Version footer (branding-and-settings-version): informational
            only — small, centered, muted via the active theme's secondary
            token; plain Text, never pressable and never a management card.
            The release version comes from the `APP_VERSION` core constant
            through the `settings.versionLabel` i18n template. */}
        <Text
          style={[
            styles.versionText,
            { color: tokens.smart.colors.textSecondary },
          ]}
          testID="settings-version"
        >
          {STRINGS.settings.versionLabel.replace('{version}', APP_VERSION)}
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  // The root title's font size comes from `smart.typography.screenTitle`
  // (applied inline at the usage site — the file's static StyleSheet has no
  // token access); this rule carries the static weight/spacing only.
  title: {
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 10,
  },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeButton: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
  },
  themeButtonText: { fontSize: 14 },
  themeButtonTextActive: { fontWeight: '600' },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  // Soft icon chip (SwitchWidget/SensorValueWidget recipe): page-tinted
  // surface + hairline border; colors come inline from the smart tokens.
  manageIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowMeta: { fontSize: 12 },
  // Version footer: static sizing/alignment only — the muted color comes
  // inline from the active theme's secondary token (theme-aware), and the
  // content container's bottom padding provides the trailing spacing.
  versionText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
