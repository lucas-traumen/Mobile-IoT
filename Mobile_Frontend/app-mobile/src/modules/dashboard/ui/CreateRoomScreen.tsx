/**
 * CreateRoomScreen — "+ Thêm phòng" for one Template. Selects an existing
 * physical room not yet referenced by the Template; physical-room creation
 * belongs to Settings → Phòng & thiết bị.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme } from '@core/theme';

import type { Room } from '@modules/devices/api';
import { type ActionOutcome } from './ConfirmDialog';

interface CreateRoomScreenProps {
  /** Physical rooms NOT yet referenced by the Template (derived upstream). */
  readonly availableRooms: readonly Room[];
  /** Add an existing physical room's reference. */
  readonly onAddExisting: (roomId: string) => Promise<ActionOutcome>;
  /** Abort + go back. */
  readonly onCancel: () => void;
}

/**
 * The add-room screen.
 *
 * @param props - see {@link CreateRoomScreenProps}.
 */
export function CreateRoomScreen({
  availableRooms,
  onAddExisting,
  onCancel,
}: CreateRoomScreenProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addingRef = useRef(false);

  const addExisting = async (roomId: string) => {
    if (addingRef.current) {
      return;
    }
    addingRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const result = await onAddExisting(roomId);
      if (!result.ok) {
        setError(result.message || 'Lỗi');
      }
    } finally {
      addingRef.current = false;
      setBusy(false);
    }
  };

  return (
    // The ambient Smart Home wash (settings-smart-home-sync).
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
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={onCancel}
          testID="create-room-back"
        >
          <Ionicons name="arrow-back" size={20} color={tokens.primary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{STRINGS.templates.createRoomTitle}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>
          {STRINGS.templates.createRoomExisting}
        </Text>
        <Text style={styles.hint}>
          {STRINGS.templates.createRoomExistingHint}
        </Text>
        {availableRooms.length === 0 ? (
          <Text style={styles.emptyHint}>
            {STRINGS.templates.noRoomAvailable}
          </Text>
        ) : (
          availableRooms.map(room => (
            <Pressable
              key={room.id}
              style={[
                styles.roomRow,
                {
                  backgroundColor: tokens.smart.colors.card,
                  borderColor: tokens.smart.colors.cardBorder,
                  borderRadius: tokens.smart.radius.card,
                },
              ]}
              disabled={busy}
              onPress={() => {
                void addExisting(room.id);
              }}
              testID={`create-room-existing-${room.id}`}
              accessibilityRole="button"
            >
              <Ionicons name="bed-outline" size={18} color={tokens.primary} />
              <Text style={styles.roomRowText}>{room.name}</Text>
              <Text style={[styles.roomRowAction, { color: tokens.primary }]}>
                + {STRINGS.templates.add}
              </Text>
            </Pressable>
          ))
        )}

        {error ? (
          <Text style={[styles.error, { color: tokens.danger }]}>{error}</Text>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
}

const makeStyles = (tokens: {
  smart: {
    colors: {
      card: string;
      cardBorder: string;
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
  textPrimary: string;
  textSecondary: string;
  border: string;
  primary: string;
  onPrimary: string;
}) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    // 44pt hit target (dashboard-history-board-touch-share): explicit bounds
    // around the arrow.
    backButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { flex: 1, minWidth: 0 },
    title: {
      fontSize: 20,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
    },
    content: { padding: 16, paddingBottom: 40 },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: tokens.smart.colors.textPrimary,
      marginTop: 8,
      marginBottom: 4,
    },
    hint: {
      fontSize: 12,
      color: tokens.smart.colors.textSecondary,
      marginBottom: 10,
    },
    roomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      padding: 12,
      marginBottom: 8,
      ...tokens.smart.cardShadow,
    },
    roomRowText: {
      flex: 1,
      fontSize: 14,
      color: tokens.smart.colors.textPrimary,
      fontWeight: '500',
    },
    roomRowAction: { fontSize: 13, fontWeight: '700' },
    error: { fontSize: 13, marginTop: 8 },
    emptyHint: {
      fontSize: 13,
      color: tokens.smart.colors.textSecondary,
      marginBottom: 8,
    },
  });
