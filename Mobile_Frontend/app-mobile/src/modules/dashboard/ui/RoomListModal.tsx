/**
 * RoomListModal — the reusable full room-list dialog (D3 extraction).
 *
 * TWO hosts open the same list: the History screen's header (☰ expand
 * action + quick chip strip, contract unchanged) and the Dashboard tab's
 * Smart Home header (menu button — the quick strip disappeared from the
 * Dashboard view only).
 *
 * Strictly presentational/controlled: the host owns `visible`, the active
 * id and every side effect. Selecting a row emits `onSelectRoom(id)` — the
 * HOST closes the modal (both hosts close after a selection). Rows are
 * text-only (room name, no icon). The dialog is CENTERED (scrim centers
 * the sheet) so no row can slide under the Android navigation bar. The
 * visual language is the Smart Home card recipe (settings-smart-home-sync):
 * smart card sheet + hairline border + shadow, tealTint active row, teal
 * close/active text — the active row's name keeps the accent color, never
 * `onPrimary`, which is invisible on the light sheet.
 */

import React from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import type { Room } from '@modules/devices/api';

interface RoomListModalProps {
  /** Whether the dialog is shown (host-owned visibility state). */
  readonly visible: boolean;
  /** The rooms to list, in the HOST's chosen order (never re-sorted). */
  readonly rooms: readonly Room[];
  /** Id of the currently active room (`null` before a room is chosen). */
  readonly activeRoomId: string | null;
  /**
   * Switch the active room — the host owns the selection and every side
   * effect; the host also closes the dialog after a selection.
   */
  readonly onSelectRoom: (id: string) => void;
  /** Dismiss the dialog without selecting (scrim/backdrop/close action). */
  readonly onClose: () => void;
  /**
   * Optional per-room indicator seam (Phase 2): render a custom node inside
   * each row. When omitted, only the room name is rendered.
   */
  readonly renderRoomIndicator?: (
    room: Room,
    active: boolean,
  ) => React.ReactNode;
}

/**
 * The centered full room-list dialog.
 *
 * @param props - see {@link RoomListModalProps}.
 */
export function RoomListModal({
  visible,
  rooms,
  activeRoomId,
  onSelectRoom,
  onClose,
  renderRoomIndicator,
}: RoomListModalProps) {
  const { tokens } = useTheme();
  const styles = makeStyles(tokens);

  return (
    <Modal
      testID="dashboard-room-modal"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.scrim} testID="dashboard-room-modal-scrim">
        <View style={styles.sheet} testID="dashboard-room-modal-sheet">
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{STRINGS.dashboard.roomList}</Text>
            <Pressable
              testID="dashboard-room-close"
              accessibilityLabel={STRINGS.dashboard.close}
              onPress={onClose}
            >
              <Text style={styles.sheetClose}>{STRINGS.dashboard.close}</Text>
            </Pressable>
          </View>
          <FlatList
            data={rooms}
            keyExtractor={room => room.id}
            renderItem={({ item }) => {
              const active = item.id === activeRoomId;
              return (
                <Pressable
                  testID={`dashboard-room-row-${item.id}`}
                  style={[styles.row, active && styles.rowActive]}
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelectRoom(item.id)}
                >
                  <Text style={active ? styles.rowTextActive : styles.rowText}>
                    {item.name}
                  </Text>
                  {renderRoomIndicator?.(item, active)}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

type Tokens = {
  smart: {
    colors: {
      card: string;
      cardBorder: string;
      teal: string;
      tealTint: string;
      textPrimary: string;
      textSecondary: string;
    };
    radius: { card: number };
    cardShadow: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
};

function makeStyles(tokens: Tokens) {
  return StyleSheet.create({
    // CENTERED dialog: the scrim centers the sheet (with side padding), so
    // no row can slide under the Android navigation bar (bottom-anchoring
    // made the last row look faded/cut). The raw RGBA scrim is the known
    // inherited seam (non-blocking note) — no new tokens invented.
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    // Smart card sheet (settings-smart-home-sync): card surface + hairline
    // border + token radius + the theme's card shadow.
    sheet: {
      width: '100%',
      maxHeight: '70%',
      backgroundColor: tokens.smart.colors.card,
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      borderRadius: tokens.smart.radius.card,
      paddingBottom: 16,
      ...tokens.smart.cardShadow,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: tokens.smart.colors.cardBorder,
    },
    sheetTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: tokens.smart.colors.textPrimary,
    },
    sheetClose: {
      fontSize: 14,
      fontWeight: '600',
      color: tokens.smart.colors.teal,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    rowActive: { backgroundColor: tokens.smart.colors.tealTint },
    // Modal row text: always readable on the sheet (rowActive paints the
    // teal tint) — the active row gets the smart teal, never `onPrimary`,
    // which is invisible on the light sheet.
    rowText: {
      fontSize: 13,
      color: tokens.smart.colors.textPrimary,
      fontWeight: '500',
    },
    rowTextActive: { color: tokens.smart.colors.teal, fontWeight: '600' },
  });
}
