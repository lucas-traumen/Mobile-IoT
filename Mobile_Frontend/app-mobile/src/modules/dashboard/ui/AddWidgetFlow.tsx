/**
 * AddWidgetFlow — full-screen modal for adding a widget (approved
 * room-sensor rework): ONE TAP on an available, not-yet-displayed choice.
 *
 * The EDITOR ROOM IS AUTHORITATIVE: the flow receives the room currently
 * being edited and never asks for it again — every assembled input carries
 * `roomId = editorRoomId`.
 *
 * The choice list is derived from the room's projected sensors (one row per
 * registration) and the room's relays (one row per relay). The flow
 * receives the current widget list (draft while a draft
 * is open, persisted otherwise) and hides every ALREADY-DISPLAYED choice —
 * duplicate prevention at the UI seam (the dashboard service remains the
 * authoritative guard).
 *
 * Selecting a row sends a complete default-size `AddWidgetInput` in one tap
 * (resize stays an editor action). There are NO category, device,
 * capability or size steps and NO history option (History is a derived tab,
 * never a widget).
 *
 * Footer/header: Hủy aborts. The flow is purely presentational: it calls
 * `onAdd` and the parent closes it. The parent owns the full-screen
 * coverage (React Native `Modal`); the flow only pads its own header for
 * the TOP inset and keeps its footer's cancel tappable above the bottom
 * system area.
 * Visual language (settings-smart-home-sync): the overlay paints the
 * ambient Smart Home wash (tealTint → page → amberTint) and the choice
 * rows use the smart card recipe with the soft icon chip.
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { overlayFooterBottomPadding, safeInset } from '@core/safeArea';
import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import type { CapabilityDef, Device } from '@modules/devices/api';
import { projectSensorRegistrations } from '@modules/devices/api';
import type { AddWidgetInput } from '@modules/dashboard/api';
import { widgetUniquenessKey } from '@modules/widgets/api';
import type { WidgetConfig } from '@modules/widgets/api';

/** One tappable add choice (a complete widget input + display copy). */
export interface WidgetAddChoice {
  /** Stable row key (also the testID suffix). */
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  /** Ionicons glyph name. */
  readonly icon: string;
  /** The complete, default-size input sent on tap. */
  readonly input: AddWidgetInput;
}

interface AddWidgetFlowProps {
  /** The room being edited — AUTHORITATIVE for the new widget. */
  readonly editorRoomId: string;
  /** Human-readable editor room name (shown for confirmation). */
  readonly editorRoomName: string;
  /** All devices (room-scoped candidates are derived inside). */
  readonly devices: readonly Device[];
  /** Capability catalog (labels/icons for sensor rows). */
  readonly capabilities?: readonly CapabilityDef[];
  /**
   * The current widget list (draft while a draft is open, persisted
   * otherwise) — already-displayed choices are hidden immediately.
   */
  readonly widgets: readonly WidgetConfig[];
  /** Add the widget (parent owns the service call + close). */
  readonly onAdd: (input: AddWidgetInput) => void;
  /** Abort + close the flow. */
  readonly onCancel: () => void;
}

/**
 * The one-tap add-widget flow (editor-room authoritative).
 *
 * @param props - see {@link AddWidgetFlowProps}.
 */
export function AddWidgetFlow({
  editorRoomId,
  editorRoomName,
  devices,
  capabilities = [],
  widgets,
  onAdd,
  onCancel,
}: AddWidgetFlowProps) {
  const { tokens } = useTheme();
  // Safe-area seam: the parent hosts the flow inside a full-screen Modal,
  // so the flow only pads its own header for the TOP inset. The footer
  // keeps the cancel tappable above the bottom system area.
  const insets = useSafeAreaInsets();
  const topInset = safeInset(insets.top);

  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  // Room-scoped candidates: projected sensor registrations (one row per
  // metric — legacy multi-capability boards contribute one row EACH)
  // and relay devices. The unbound `room-device-list` overview is RETIRED
  // (device-acceptance rework) — it is never addable again.
  const choices = useMemo<WidgetAddChoice[]>(() => {
    const roomSensors = projectSensorRegistrations(
      devices,
      capabilities,
    ).filter(registration => registration.roomId === editorRoomId);
    const roomRelays = devices.filter(
      device =>
        device.roomId === editorRoomId && device.binding.kind === 'relay',
    );
    const rows: WidgetAddChoice[] = roomSensors.map(registration => {
      const def = capabilities.find(
        candidate => candidate.type === registration.field,
      );
      return {
        key: `sensor:${registration.deviceId}:${registration.field}`,
        label: def?.label ?? registration.field,
        description: registration.deviceName,
        icon: def?.icon ?? 'pulse-outline',
        input: {
          type: 'sensor-value',
          binding: {
            deviceId: registration.deviceId,
            capability: registration.field,
          },
          roomId: editorRoomId,
        },
      };
    });
    for (const relay of roomRelays) {
      rows.push({
        key: `relay:${relay.id}`,
        label: relay.name,
        description: STRINGS.widgets.switchDesc,
        icon: 'toggle-outline',
        input: {
          type: 'switch',
          binding: { deviceId: relay.id, capability: 'switch' },
          roomId: editorRoomId,
        },
      });
    }
    return rows;
  }, [devices, capabilities, editorRoomId]);

  // Duplicate prevention at the UI seam: a choice whose uniqueness key is
  // already displayed disappears immediately (the dashboard service remains
  // the authoritative guard if the UI ever fails).
  const displayedKeys = useMemo(
    () => new Set(widgets.map(widget => widgetUniquenessKey(widget))),
    [widgets],
  );
  const available = choices.filter(
    choice =>
      !displayedKeys.has(
        widgetUniquenessKey({
          type: choice.input.type,
          roomId: choice.input.roomId,
          binding: choice.input.binding,
        }),
      ),
  );

  // Empty-state copy (reviewer fix cycle 2): a room with NO devices at
  // all guides the user to the Devices tab; a room whose sources are ALL
  // already displayed gets the truthful "everything is placed" copy
  // instead of the misleading "no devices" claim.
  const emptyStateCopy =
    choices.length === 0
      ? {
          icon: 'construct-outline' as const,
          title: STRINGS.widgets.emptyNoDevices,
          hint: STRINGS.widgets.emptyAddDeviceHint,
        }
      : {
          icon: 'checkmark-circle-outline' as const,
          title: STRINGS.widgets.emptyAllDisplayed,
          hint: STRINGS.widgets.emptyAllDisplayedHint,
        };

  return (
    // The ambient Smart Home wash fills the parent Modal (flex: 1 —
    // full-screen coverage owned by the Modal, no absolute offsets). The
    // tint stops are 5%-alpha rgba and RN-web Modals NEVER occlude what is
    // behind them (not even with transparent={false}), so the flow owns an
    // OPAQUE `page` base View under the gradient (fix cycles 3-5):
    // occlusion comes from the flow's own root surface, not the Modal.
    <View
      style={[styles.overlay, { backgroundColor: tokens.smart.colors.page }]}
    >
      <LinearGradient
        colors={[
          tokens.smart.colors.tealTint,
          tokens.smart.colors.page,
          tokens.smart.colors.amberTint,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientFill}
      >
        <View
          style={[
            styles.header,
            {
              borderBottomColor: tokens.smart.colors.cardBorder,
              paddingTop: 12 + topInset,
            },
          ]}
        >
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>
              {STRINGS.dashboard.addWidget}
            </Text>
            <Text style={styles.headerRoom} numberOfLines={1}>
              {STRINGS.dashboard.editorRoom}: {editorRoomName}
            </Text>
          </View>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancelHeader}>{STRINGS.widgets.cancel}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {available.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons
                name={emptyStateCopy.icon}
                size={48}
                color={tokens.smart.colors.textSecondary}
              />
              <Text style={styles.emptyTitle}>{emptyStateCopy.title}</Text>
              <Text style={styles.emptyHint}>{emptyStateCopy.hint}</Text>
            </View>
          ) : (
            available.map(choice => (
              <Pressable
                key={choice.key}
                style={[
                  styles.choiceRow,
                  {
                    backgroundColor: tokens.smart.colors.card,
                    borderColor: tokens.smart.colors.cardBorder,
                    borderRadius: tokens.smart.radius.card,
                  },
                ]}
                onPress={() => onAdd(choice.input)}
                testID={`add-widget-choice-${choice.key}`}
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.choiceIcon,
                    {
                      backgroundColor: tokens.smart.colors.page,
                      borderColor: tokens.smart.colors.cardBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name={choice.icon as keyof typeof Ionicons.glyphMap}
                    size={20}
                    color={tokens.primary}
                  />
                </View>
                <View style={styles.choiceText}>
                  <Text style={styles.choiceLabel}>{choice.label}</Text>
                  {choice.description ? (
                    <Text style={styles.choiceDesc}>{choice.description}</Text>
                  ) : null}
                </View>
                <Text style={[styles.choiceAdd, { color: tokens.primary }]}>
                  + {STRINGS.widgets.add}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              borderTopColor: tokens.smart.colors.cardBorder,
              paddingBottom: overlayFooterBottomPadding(12, insets.bottom),
            },
          ]}
        >
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>
              {STRINGS.widgets.cancel}
            </Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

function makeStyles(tokens: {
  smart: {
    colors: {
      card: string;
      cardBorder: string;
      textPrimary: string;
      textSecondary: string;
    };
    cardShadow: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
  primary: string;
  danger: string;
}) {
  return StyleSheet.create({
    overlay: { flex: 1 },
    // The wash fills the opaque base View (flex: 1) — the gradient paints
    // ON TOP of the solid `page` backdrop owned by the root.
    gradientFill: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
    },
    headerTextWrap: { flex: 1, minWidth: 0 },
    headerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: tokens.smart.colors.textPrimary,
    },
    headerRoom: {
      fontSize: 12,
      color: tokens.smart.colors.textSecondary,
      marginTop: 2,
    },
    cancelHeader: { fontSize: 14, color: tokens.danger, fontWeight: '600' },
    content: { padding: 16 },
    choiceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      padding: 14,
      marginBottom: 10,
      ...tokens.smart.cardShadow,
    },
    // Soft icon chip (SwitchWidget/SensorValueWidget recipe): page-tinted
    // surface + hairline border; colors come inline from the smart tokens.
    choiceIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    choiceText: { flex: 1 },
    choiceLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: tokens.smart.colors.textPrimary,
    },
    choiceDesc: {
      fontSize: 12,
      color: tokens.smart.colors.textSecondary,
      marginTop: 2,
    },
    choiceAdd: { fontWeight: '700', fontSize: 13 },
    // Empty state (no addable source for this room): centered icon +
    // title + guidance column between the header and the footer.
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingVertical: 48,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: tokens.smart.colors.textPrimary,
      textAlign: 'center',
    },
    emptyHint: {
      fontSize: 13,
      color: tokens.smart.colors.textSecondary,
      textAlign: 'center',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
    },
    cancelButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    cancelButtonText: {
      color: tokens.smart.colors.textSecondary,
      fontWeight: '600',
    },
  });
}
