/**
 * FilterDropdown — the History tab's Smart Home filter control
 * (history-smart-home-redesign): a white dropdown trigger (hairline
 * `cardBorder`, 12pt radius, chevron-down affordance, ≥44pt touch target)
 * that opens a centered modal list of options — the same dialog discipline
 * as the shared `RoomListModal` (centered sheet, active row in the teal
 * accent, scrim/close dismissal).
 *
 * Strictly presentational/controlled: the host owns the `value` and every
 * side effect; picking an option emits `onChange` and closes the sheet.
 * Module-local to History for now (orchestrator decision 1): promote to
 * core if another module ever needs the same control. Theme-aware through
 * `useTheme` — zero hard-coded colors (dark mode rides the smart tokens).
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { STRINGS } from '@core/i18n';
import { useTheme, type ThemeTokens } from '@core/theme';

/** One selectable dropdown option (generic value + display label). */
export interface FilterDropdownOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface FilterDropdownProps<T extends string> {
  /** Base testID (`<testID>-trigger`, `-modal`, `-option-<value>`, `-close`). */
  readonly testID: string;
  /** Accessible label + the label shown when nothing is selected. */
  readonly placeholder: string;
  /** Dialog title (defaults to `placeholder`). */
  readonly title?: string;
  /** The current value (drives the trigger label + the active row). */
  readonly value: T | null;
  /** The options to list. */
  readonly options: readonly FilterDropdownOption<T>[];
  /** Selection callback (the sheet closes itself after emitting). */
  readonly onChange: (value: T) => void;
  /** Grow to fill the parent's flex slot (side-by-side filter rows). */
  readonly flex?: boolean;
}

/**
 * A controlled Smart Home dropdown (trigger + centered option sheet).
 *
 * @param props - see {@link FilterDropdownProps}.
 */
export function FilterDropdown<T extends string>({
  testID,
  placeholder,
  title,
  value,
  options,
  onChange,
  flex = false,
}: FilterDropdownProps<T>) {
  const { tokens } = useTheme();
  const styles = makeStyles(tokens);
  const [open, setOpen] = React.useState(false);

  const selected = options.find(option => option.value === value);
  const label = selected?.label ?? placeholder;

  return (
    <>
      <Pressable
        testID={`${testID}-trigger`}
        accessibilityRole="button"
        accessibilityLabel={placeholder}
        accessibilityState={{ expanded: open }}
        style={[styles.trigger, flex ? styles.triggerFlex : null]}
        onPress={() => setOpen(true)}
      >
        <Text
          style={[
            styles.triggerText,
            {
              color: selected
                ? tokens.smart.colors.textPrimary
                : tokens.smart.colors.textSecondary,
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Ionicons
          name="chevron-down"
          size={18}
          color={tokens.smart.colors.textSecondary}
        />
      </Pressable>

      <Modal
        testID={`${testID}-modal`}
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.scrim} testID={`${testID}-scrim`}>
          <View style={styles.sheet} testID={`${testID}-sheet`}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title ?? placeholder}</Text>
              <Pressable
                testID={`${testID}-close`}
                accessibilityLabel={STRINGS.dashboard.close}
                onPress={() => setOpen(false)}
              >
                <Text style={styles.sheetClose}>{STRINGS.dashboard.close}</Text>
              </Pressable>
            </View>
            {options.map(option => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  testID={`${testID}-option-${option.value}`}
                  style={[styles.row, active ? styles.rowActive : null]}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Text style={active ? styles.rowTextActive : styles.rowText}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    // Trigger: white card surface, hairline border, 12pt radius, chevron
    // affordance. minHeight 44 keeps the touch target ≥44×44.
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: tokens.smart.colors.card,
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      borderRadius: 12,
    },
    triggerFlex: { flex: 1 },
    triggerText: {
      flex: 1,
      fontSize: 14,
      fontWeight: '500',
    },
    // CENTERED option sheet (RoomListModal discipline): the scrim centers
    // the sheet so no row slides under the Android navigation bar.
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    sheet: {
      width: '100%',
      backgroundColor: tokens.smart.colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      paddingBottom: 8,
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
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    rowActive: { backgroundColor: tokens.smart.colors.tealTint },
    // The active row keeps the teal accent — never `onPrimary`, which would
    // be invisible on the light sheet.
    rowText: {
      fontSize: 14,
      fontWeight: '500',
      color: tokens.smart.colors.textPrimary,
    },
    rowTextActive: {
      fontSize: 14,
      fontWeight: '600',
      color: tokens.smart.colors.teal,
    },
  });
}
