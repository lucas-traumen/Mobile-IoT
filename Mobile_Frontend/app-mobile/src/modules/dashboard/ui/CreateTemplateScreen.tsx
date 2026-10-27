/**
 * CreateTemplateScreen — the dedicated create-Template form (one level per
 * screen). A successful create persists the Template (the service generates
 * the id and stamps `updatedAt`) and the navigator opens its (empty) room
 * list. Empty names and persistence failures do NOT navigate and do NOT
 * mutate state — the form stays open and shows the actual service error.
 */

import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme } from '@core/theme';

import { type ActionOutcome } from './ConfirmDialog';

interface CreateTemplateScreenProps {
  /** Create the Template; the navigator navigates on success. */
  readonly onSubmit: (name: string) => Promise<ActionOutcome>;
  /** Abort and go back (no state change). */
  readonly onCancel: () => void;
}

/**
 * The create-Template screen.
 *
 * @param props - see {@link CreateTemplateScreenProps}.
 */
export function CreateTemplateScreen({
  onSubmit,
  onCancel,
}: CreateTemplateScreenProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(STRINGS.devices.requiredField);
      return;
    }
    setSubmitting(true);
    try {
      const result = await onSubmit(trimmed);
      if (!result.ok) {
        // Keep the form open and truthful about the failure.
        setError(result.message || 'Lỗi');
        return;
      }
      // Success: the navigator opens the new Template's room list.
      setName('');
      setError(null);
    } finally {
      setSubmitting(false);
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
          hitSlop={8}
          testID="create-template-back"
        >
          <Ionicons name="arrow-back" size={20} color={tokens.primary} />
        </Pressable>
        <Text style={styles.title}>{STRINGS.templates.createTemplate}</Text>
      </View>
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <Text style={styles.hint}>{STRINGS.templates.newTemplateHint}</Text>
        <Text style={styles.label}>{STRINGS.templates.templateName}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={value => {
            setName(value);
            setError(null);
          }}
          placeholder={STRINGS.templates.newTemplateName}
          placeholderTextColor={tokens.smart.colors.textSecondary}
          autoFocus
          testID="create-template-name"
          onSubmitEditing={() => {
            void submit();
          }}
        />
        {error ? (
          <Text style={[styles.error, { color: tokens.danger }]}>{error}</Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            style={[styles.button, styles.secondaryButton]}
            onPress={onCancel}
          >
            <Text style={styles.secondaryButtonText}>
              {STRINGS.templates.cancel}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primaryButton]}
            onPress={() => {
              void submit();
            }}
            disabled={submitting}
            testID="create-template-submit"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>
              {STRINGS.templates.createTemplateAction.replace('+ ', '')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
    title: {
      fontSize: 20,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
      flex: 1,
    },
    body: { padding: 16 },
    hint: {
      fontSize: 13,
      color: tokens.smart.colors.textSecondary,
      marginBottom: 16,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: tokens.smart.colors.textPrimary,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      borderRadius: 10,
      backgroundColor: tokens.smart.colors.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: tokens.smart.colors.textPrimary,
    },
    error: { fontSize: 13, marginTop: 8 },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 18,
    },
    button: {
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    secondaryButton: { borderColor: tokens.smart.colors.cardBorder },
    secondaryButtonText: {
      color: tokens.smart.colors.textSecondary,
      fontWeight: '600',
      fontSize: 14,
    },
    primaryButton: {
      backgroundColor: tokens.primary,
      borderColor: tokens.primary,
    },
    primaryButtonText: {
      color: tokens.onPrimary,
      fontWeight: '700',
      fontSize: 14,
    },
  });
