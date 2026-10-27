/**
 * Dashboard section grouping tests (M2 label fix).
 *
 * Verifies the pure split of visible widgets into the two dashboard
 * sections — "Môi trường" (sensor-value + history-chart) and "Thiết bị"
 * (switch + every other type) — plus each section's rebase row (baseY) and
 * compact content height, which together let the screen render a label pill
 * DIRECTLY above its own grid.
 */

import type { WidgetConfig } from '@modules/widgets/api';

import {
  groupWidgets,
  sectionBaseY,
  sectionContentHeight,
  sectionKeyOf,
} from './sectionGroups';
import { GRID_GAP, GRID_PADDING, GRID_ROW_HEIGHT } from './gridMetrics';

const METRICS = {
  padding: GRID_PADDING,
  gap: GRID_GAP,
  rowHeight: GRID_ROW_HEIGHT,
  cellWidth: 138,
};

/** Minimal widget config builder (only the fields grouping reads). */
function widget(
  id: string,
  type: string,
  y: number,
  height: 1 | 2 = 1,
): WidgetConfig {
  return {
    id,
    type,
    binding: { deviceId: 'd1', capability: 'switch' },
    layout: { x: 0, y, width: 1, height },
  };
}

describe('sectionKeyOf (the shared type→section authority, fix cycle 8 L)', () => {
  it('routes sensor-value to "Môi trường" and EVERY other type to "Thiết bị"', () => {
    expect(sectionKeyOf('sensor-value')).toBe('environment');
    expect(sectionKeyOf('switch')).toBe('devices');
    // Unknown custom types live in the devices section (groupWidgets
    // behavior preserved exactly — one authority for both consumers).
    expect(sectionKeyOf('vendor-camera-panel')).toBe('devices');
  });
});

describe('groupWidgets', () => {
  it('splits sensor widgets into "Môi trường" and the rest into "Thiết bị"', () => {
    const { environment, devices } = groupWidgets([
      widget('w-temp', 'sensor-value', 0),
      widget('w-light', 'switch', 1),
      widget('w-vendor', 'vendor-camera-panel', 4, 1),
    ]);

    // The retired `history-chart` type (approved room-sensor rework) is no
    // longer part of the split — it can never be added or seeded again.
    expect(environment.map(w => w.id)).toEqual(['w-temp']);
    expect(devices.map(w => w.id)).toEqual(['w-light', 'w-vendor']);
  });

  it('preserves the original order inside each group', () => {
    const { environment, devices } = groupWidgets([
      widget('w-b', 'switch', 0),
      widget('w-a', 'sensor-value', 1),
      widget('w-c', 'switch', 2),
    ]);

    expect(environment.map(w => w.id)).toEqual(['w-a']);
    expect(devices.map(w => w.id)).toEqual(['w-b', 'w-c']);
  });

  it('returns two empty groups for no widgets', () => {
    const { environment, devices } = groupWidgets([]);
    expect(environment).toEqual([]);
    expect(devices).toEqual([]);
  });
});

describe('sectionBaseY', () => {
  it('is the minimum persisted row of the group (rebase row)', () => {
    expect(
      sectionBaseY([widget('a', 'switch', 1), widget('b', 'switch', 3)]),
    ).toBe(1);
  });

  it('is 0 for a group already at the top and for an empty group', () => {
    expect(sectionBaseY([widget('a', 'switch', 0)])).toBe(0);
    expect(sectionBaseY([])).toBe(0);
  });
});

describe('sectionContentHeight', () => {
  it('measures the REBASED group (no dead row from the persisted offset)', () => {
    // Seeded devices group: rows 1..2 persisted → rebased rows 0..1.
    const group = [
      widget('w-light', 'switch', 1),
      widget('w-fan', 'switch', 2),
    ];
    const height = sectionContentHeight(group, METRICS);

    // 2 rebased rows: 2 * rowHeight + 1 * gap + 2 * padding.
    expect(height).toBe(2 * GRID_ROW_HEIGHT + GRID_GAP + 2 * GRID_PADDING);
  });

  it('matches gridContentHeight for a group already at row 0', () => {
    const group = [widget('w-temp', 'sensor-value', 0)];
    expect(sectionContentHeight(group, METRICS)).toBe(
      GRID_ROW_HEIGHT + 2 * GRID_PADDING,
    );
  });
});
