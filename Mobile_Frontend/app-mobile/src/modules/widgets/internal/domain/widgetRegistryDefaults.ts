/**
 * Default widget registry — the built-in widget types.
 *
 * Registered in a fixed order so `list()` and `suggestForCapabilities()` are
 * deterministic:
 * 1. `sensor-value` — sensor metric values, sizes 1x1 + 2x1 (sensor).
 * 2. `switch`       — switch, sizes 1x1 + 2x1 (control).
 *
 * RETIRED types (can never be added again; legacy persisted instances are
 * stripped on dashboard load — see DashboardServiceImpl):
 * - `connection` (Phase 1): global MQTT status remains in the header.
 * - `history-chart` (approved room-sensor rework): History is a DERIVED
 *   tab-level view generated from registered room sensors — it is never a
 *   configurable widget/layout surface.
 * - `room-device-list` (device-acceptance rework): the per-room overview
 *   card is retired; the room's devices are reachable through the
 *   Dashboard's room selector and History instead.
 */

import { STRINGS } from '@core/i18n';

import { createWidgetRegistry, type WidgetRegistry } from './widgetRegistry';
import type { WidgetDefinition } from './widgetRegistry';
import { SensorValueWidget } from '../ui/widgets/SensorValueWidget';
import { SwitchWidget } from '../ui/widgets/SwitchWidget';

/** The built-in widget definitions (labels from {@link STRINGS}). */
export const BUILT_IN_WIDGET_DEFINITIONS: readonly WidgetDefinition[] = [
  {
    type: 'sensor-value',
    label: STRINGS.widgets.sensorValue,
    description: STRINGS.widgets.sensorValueDesc,
    icon: 'thermometer-outline',
    category: 'sensor',
    supportedCapabilities: ['temperature', 'humidity'],
    acceptsCatalogKinds: ['sensor'],
    supportedSizes: ['1x1', '2x1'],
    component: SensorValueWidget,
  },
  {
    type: 'switch',
    label: STRINGS.widgets.switch,
    description: STRINGS.widgets.switchDesc,
    icon: 'toggle-outline',
    category: 'control',
    supportedCapabilities: ['switch'],
    // 1x1 is the default (side-by-side device cards on the wide canvas);
    // 2x1 stays supported so a full-width control row remains a choice.
    supportedSizes: ['1x1', '2x1'],
    component: SwitchWidget,
  },
];

/**
 * Create the default registry with the built-in widget types.
 *
 * @returns a {@link WidgetRegistry} with `sensor-value` and `switch`
 *   registered (history-chart and room-device-list are retired — see
 *   above).
 */
export function createDefaultRegistry(): WidgetRegistry {
  const registry = createWidgetRegistry();
  for (const def of BUILT_IN_WIDGET_DEFINITIONS) {
    registry.register(def);
  }
  return registry;
}
