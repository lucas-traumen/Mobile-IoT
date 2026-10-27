/**
 * FilterDropdown tests (history-smart-home-redesign).
 *
 * Verifies through the public props + rendered tree:
 * - the trigger is a white smart surface (card bg, hairline border, 12pt
 *   radius) with the chevron affordance and a ≥44pt touch target;
 * - the trigger shows the placeholder when nothing is selected and the
 *   selected option's label otherwise;
 * - tapping the trigger opens the centered option sheet, picking an option
 *   emits onChange and CLOSES the sheet, and the close action dismisses
 *   without a selection;
 * - accessibility: trigger role/label + expanded state; the active option
 *   row carries the selected state.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { LIGHT_TOKENS, ThemeProvider } from '@core/theme';

import { FilterDropdown } from './FilterDropdown';

const OPTIONS = [
  { value: '1h', label: '1 giờ' },
  { value: '24h', label: '24 giờ' },
  { value: '7d', label: '7 ngày' },
] as const;

async function create(overrides: Record<string, unknown> = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <FilterDropdown
          testID="range"
          placeholder="Chọn khoảng thời gian"
          value={'1h'}
          options={OPTIONS}
          onChange={jest.fn()}
          {...overrides}
        />
      </ThemeProvider>,
    );
  });
  return renderer;
}

describe('FilterDropdown', () => {
  it('renders a white smart trigger with ≥44pt touch and the selected label', async () => {
    const root = (await create()).root;
    const trigger = root.findByProps({ testID: 'range-trigger' });
    const style = StyleSheet.flatten(trigger.props.style);
    expect(style.backgroundColor).toBe(LIGHT_TOKENS.smart.colors.card);
    expect(style.borderColor).toBe(LIGHT_TOKENS.smart.colors.cardBorder);
    expect(style.borderRadius).toBe(12);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    // The selected option's label is shown (not the placeholder).
    expect(trigger.findAllByType(Text)[0].props.children).toBe('1 giờ');
    expect(trigger.props.accessibilityRole).toBe('button');
    expect(trigger.props.accessibilityLabel).toBe('Chọn khoảng thời gian');
    expect(trigger.props.accessibilityState).toEqual({ expanded: false });
  });

  it('shows the placeholder when no option matches the value', async () => {
    const root = (await create({ value: null })).root;
    const trigger = root.findByProps({ testID: 'range-trigger' });
    expect(trigger.findAllByType(Text)[0].props.children).toBe(
      'Chọn khoảng thời gian',
    );
  });

  it('opens on press, selects an option, and closes (onChange emitted)', async () => {
    const onChange = jest.fn();
    const root = (await create({ onChange })).root;

    // Sheet starts closed.
    expect(root.findByProps({ testID: 'range-modal' }).props.visible).toBe(
      false,
    );

    act(() => {
      root.findByProps({ testID: 'range-trigger' }).props.onPress();
    });
    expect(root.findByProps({ testID: 'range-modal' }).props.visible).toBe(
      true,
    );
    expect(
      root.findByProps({ testID: 'range-trigger' }).props.accessibilityState,
    ).toEqual({ expanded: true });

    act(() => {
      root.findByProps({ testID: 'range-option-7d' }).props.onPress();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('7d');
    expect(root.findByProps({ testID: 'range-modal' }).props.visible).toBe(
      false,
    );
  });

  it('marks the active option row selected and closes via the close action', async () => {
    const onChange = jest.fn();
    const root = (await create({ onChange, value: '24h' })).root;

    act(() => {
      root.findByProps({ testID: 'range-trigger' }).props.onPress();
    });
    const activeRow = root.findByProps({ testID: 'range-option-24h' });
    expect(activeRow.props.accessibilityState).toEqual({ selected: true });
    expect(
      root.findByProps({ testID: 'range-option-1h' }).props.accessibilityState,
    ).toEqual({ selected: false });

    act(() => {
      root.findByProps({ testID: 'range-close' }).props.onPress();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(root.findByProps({ testID: 'range-modal' }).props.visible).toBe(
      false,
    );
  });

  it('renders one option row per option inside the sheet', async () => {
    const root = (await create()).root;
    act(() => {
      root.findByProps({ testID: 'range-trigger' }).props.onPress();
    });
    root.findByProps({ testID: 'range-sheet' });
    // RN Modal children are opaque to findAllByType — assert the rows by
    // their stable testIDs instead (interaction is covered above).
    root.findByProps({ testID: 'range-option-1h' });
    root.findByProps({ testID: 'range-option-24h' });
    root.findByProps({ testID: 'range-option-7d' });
    expect(() => root.findByProps({ testID: 'range-option-30d' })).toThrow();
  });
});
