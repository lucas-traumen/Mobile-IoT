/**
 * ConfirmDialog — the shared destructive-action confirmation for the
 * Dashboard screens (Template deletion, room-reference removal, widget
 * deletion). Failures keep the dialog open and show the actual service
 * error truthfully; success closes it. Visual language: the Smart Home
 * card recipe (settings-smart-home-sync) — smart card surface + hairline
 * border + token radius + card shadow; the confirm button keeps the
 * semantic danger for destructive actions and follows `tokens.primary`
 * (the smart teal) otherwise.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

/** The outcome shape every screen-level service call resolves with. */
export interface ActionOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export const OK_OUTCOME: ActionOutcome = { ok: true, message: '' };

interface ConfirmDialogProps {
  /** `null` closes the dialog. */
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  /** Show a destructive (danger) confirm button. */
  readonly destructive?: boolean;
  readonly error?: string | null;
  readonly visible: boolean;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
  /** Optional stable test ids for the two buttons (test seam). */
  readonly confirmTestID?: string;
  readonly dismissTestID?: string;
}

/**
 * The confirmation dialog.
 *
 * @param props - see {@link ConfirmDialogProps}.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = true,
  error,
  visible,
  onConfirm,
  onDismiss,
  confirmTestID,
  dismissTestID,
}: ConfirmDialogProps) {
  const { tokens } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
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
        >
          <Text
            style={[styles.title, { color: tokens.smart.colors.textPrimary }]}
          >
            {title}
          </Text>
          <Text
            style={[
              styles.message,
              { color: tokens.smart.colors.textSecondary },
            ]}
          >
            {message}
          </Text>
          {error ? (
            <Text style={[styles.error, { color: tokens.danger }]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              style={[
                styles.button,
                { borderColor: tokens.smart.colors.cardBorder },
              ]}
              onPress={onDismiss}
              testID={dismissTestID}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.templates.cancel}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                {
                  backgroundColor: destructive ? tokens.danger : tokens.primary,
                  borderColor: destructive ? tokens.danger : tokens.primary,
                },
              ]}
              onPress={onConfirm}
              testID={confirmTestID}
            >
              <Text style={[styles.buttonText, { color: tokens.onPrimary }]}>
                {confirmLabel ?? STRINGS.settings.confirm}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    fontSize: 13,
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
