/**
 * ConfigurationStepper — the guided MQTT flow's progress header
 * (advanced-config-stepper-redesign).
 *
 * Pure presentation: the SCREEN derives each step's state from the flow
 * (scan-select/manual continue → step 2; probe success → step 3; a
 * successful `Lưu cấu hình` completes step 3) and passes the labels +
 * states in. Visual contract (approved wireframes):
 * - thin connector lines between consecutive dots (teal once the step
 *   before is completed, otherwise gray);
 * - current step = smart amber, completed = smart teal with a ✓ icon,
 *   not reached = smart textSecondary;
 * - the label sits BELOW the dot and shrinks/ellipsizes so the row never
 *   overflows small screens.
 *
 * NOT freely-switchable tabs: nothing here is pressable — navigation is
 * driven by the flow, never by tapping a step.
 */

import React from 'react';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@core/theme';

import {
  serviceDotColor,
  type ServiceDotStatus,
} from './ConnectionStatusBadge';

/** One stepper step's state (the D3 colors via {@link serviceDotColor}). */
export type StepperStepState = 'current' | 'completed' | 'upcoming';

/** The ServiceDotStatus each stepper state maps to. */
const STEP_DOT_STATUS: Record<StepperStepState, ServiceDotStatus> = {
  current: 'progress',
  completed: 'healthy',
  upcoming: 'gray',
};

export interface StepperStep {
  /** Step label (Máy chủ / Xác thực / Hoàn tất). */
  readonly label: string;
  /** Flow-derived state. */
  readonly state: StepperStepState;
}

/**
 * The 3-step progress header. Steps are NOT pressable — the flow decides
 * where the user is (scan-select → Xác thực; probe success → Hoàn tất;
 * Chỉnh sửa → back to Máy chủ).
 */
export function ConfigurationStepper({
  steps,
}: {
  readonly steps: readonly StepperStep[];
}) {
  const { tokens } = useTheme();
  return (
    <View style={styles.row} testID="config-stepper">
      {steps.map((step, index) => (
        <Fragment key={`${step.label}-${index}`}>
          {index > 0 ? (
            <View
              testID={`stepper-connector-${index}`}
              style={[
                styles.connector,
                {
                  backgroundColor:
                    steps[index - 1].state === 'completed'
                      ? tokens.smart.colors.teal
                      : tokens.smart.colors.textSecondary,
                },
              ]}
            />
          ) : null}
          <View style={styles.step} testID={`stepper-step-${index + 1}`}>
            <View
              testID={`stepper-dot-${index + 1}`}
              style={[
                styles.dot,
                {
                  backgroundColor: serviceDotColor(
                    STEP_DOT_STATUS[step.state],
                    tokens,
                  ),
                },
              ]}
            >
              {step.state === 'completed' ? (
                <Ionicons
                  testID={`stepper-check-${index + 1}`}
                  name="checkmark"
                  size={14}
                  // `primary === smart.colors.teal` is test-pinned, so
                  // `onPrimary` is the readable-on-teal token (CP6).
                  color={tokens.onPrimary}
                />
              ) : null}
            </View>
            <Text
              testID={`stepper-label-${index + 1}`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.label,
                {
                  color:
                    step.state === 'upcoming'
                      ? tokens.smart.colors.textSecondary
                      : tokens.smart.colors.textPrimary,
                },
              ]}
            >
              {step.label}
            </Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
  },
  step: {
    alignItems: 'center',
    flexShrink: 1,
    gap: 4,
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginTop: 11,
    marginHorizontal: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    maxWidth: 96,
    flexShrink: 1,
  },
});
