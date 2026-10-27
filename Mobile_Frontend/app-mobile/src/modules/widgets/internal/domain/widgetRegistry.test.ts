/**
 * Widget registry tests — register/get/suggest + binding validation rules.
 *
 * Verifies: register throws on duplicate types, get returns undefined for
 * unknown types, suggestForCapabilities intersects, and the pure
 * validateWidgetBinding rules (required binding for capability widgets,
 * forbidden binding for no-capability widgets).
 */

import { createDefaultRegistry } from './widgetRegistryDefaults';
import {
  createWidgetRegistry,
  validateWidgetBinding,
  type WidgetDefinition,
} from './widgetRegistry';
import type { WidgetConfig } from './widgetTypes';

// Registry definitions come from @modules/devices/api (capability types),
// which pulls AsyncStorage transitively — pin the native module.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

function sensorDef(
  overrides: Partial<WidgetDefinition> = {},
): WidgetDefinition {
  return {
    type: 'sensor-value',
    label: 'Giá trị cảm biến',
    description: 'Mô tả cảm biến',
    icon: 'thermometer-outline',
    category: 'sensor',
    supportedCapabilities: ['temperature', 'humidity'],
    supportedSizes: ['1x1', '2x1'],
    component: () => null,
    ...overrides,
  };
}

describe('createWidgetRegistry', () => {
  it('registers and lists definitions in registration order', () => {
    const registry = createWidgetRegistry();
    registry.register(sensorDef());
    registry.register(
      sensorDef({
        type: 'switch',
        label: 'Công tắc',
        supportedCapabilities: ['switch'],
        supportedSizes: ['2x1'],
      }),
    );
    expect(registry.list().map(d => d.type)).toEqual([
      'sensor-value',
      'switch',
    ]);
  });

  it('throws when registering a duplicate type', () => {
    const registry = createWidgetRegistry();
    registry.register(sensorDef());
    expect(() => registry.register(sensorDef())).toThrow(/already registered/);
  });

  it('get returns undefined for unknown types', () => {
    const registry = createWidgetRegistry();
    registry.register(sensorDef());
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.get('sensor-value')?.type).toBe('sensor-value');
  });

  it('suggestForCapabilities returns defs intersecting the caps', () => {
    const registry = createWidgetRegistry();
    registry.register(sensorDef()); // temperature/humidity
    registry.register(
      sensorDef({
        type: 'switch',
        label: 'Công tắc',
        supportedCapabilities: ['switch'],
      }),
    );
    registry.register(
      sensorDef({
        type: 'link-status',
        label: 'Trạng thái kết nối',
        supportedCapabilities: [],
      }),
    );

    expect(
      registry.suggestForCapabilities(['temperature']).map(d => d.type),
    ).toEqual(['sensor-value']);
    expect(
      registry.suggestForCapabilities(['switch']).map(d => d.type),
    ).toEqual(['switch']);
    // No-capability defs are never suggested from caps.
    expect(
      registry
        .suggestForCapabilities(['temperature', 'humidity', 'switch'])
        .map(d => d.type),
    ).toEqual(['sensor-value', 'switch']);
  });
});

describe('createDefaultRegistry', () => {
  it('registers the built-in widget types (retired built-ins excluded)', () => {
    const registry = createDefaultRegistry();
    expect(registry.list().map(d => d.type)).toEqual([
      'sensor-value',
      'switch',
    ]);
    // Retired types must not be registrable again (Phase 1 `connection`;
    // `history-chart` per the approved room-sensor rework — History is a
    // derived tab, never a widget; `room-device-list` per the
    // device-acceptance rework — the per-room overview card).
    expect(registry.get('connection')).toBeUndefined();
    expect(registry.get('history-chart')).toBeUndefined();
    expect(registry.get('room-device-list')).toBeUndefined();
  });

  it('every built-in definition carries an icon and a description (CP3)', () => {
    const registry = createDefaultRegistry();
    for (const def of registry.list()) {
      expect(def.icon.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});

describe('validateWidgetBinding', () => {
  const def = sensorDef();
  const config: WidgetConfig = {
    id: 'w-1',
    type: 'sensor-value',
    binding: { deviceId: 'sensor-01', capability: 'temperature' },
    layout: { x: 0, y: 0, width: 1, height: 1 },
  };

  it('accepts a binding with a supported capability', () => {
    const result = validateWidgetBinding(def, config);
    expect(result.ok).toBe(true);
  });

  it('rejects a missing binding for a capability widget', () => {
    const result = validateWidgetBinding(def, {
      ...config,
      binding: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/requires a binding/);
    }
  });

  it('rejects a binding with an unsupported capability', () => {
    const result = validateWidgetBinding(def, {
      ...config,
      binding: { ...config.binding!, capability: 'switch' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/does not support capability/);
    }
  });

  it('forbids a binding for a no-capability widget', () => {
    const noCapDef = sensorDef({
      type: 'link-status',
      label: 'Trạng thái kết nối',
      supportedCapabilities: [],
    });
    const result = validateWidgetBinding(noCapDef, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/does not support a binding/);
    }
  });

  it('accepts no binding for a no-capability widget', () => {
    const noCapDef = sensorDef({
      type: 'link-status',
      label: 'Trạng thái kết nối',
      supportedCapabilities: [],
    });
    const result = validateWidgetBinding(noCapDef, {
      ...config,
      binding: undefined,
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateWidgetBinding with the capability catalog (CP5/CP6)', () => {
  const def = sensorDef({ acceptsCatalogKinds: ['sensor'] });
  const pressureCatalog = [
    { type: 'pressure', label: 'Áp suất', kind: 'sensor' as const },
    { type: 'switch', label: 'Công tắc', kind: 'switch' as const },
  ];

  it('accepts a user-defined sensor capability when the catalog is supplied', () => {
    const result = validateWidgetBinding(
      def,
      {
        id: 'w-1',
        type: 'sensor-value',
        binding: { deviceId: 'sensor-01', capability: 'pressure' },
        layout: { x: 0, y: 0, width: 1, height: 1 },
      },
      pressureCatalog,
    );
    expect(result.ok).toBe(true);
  });

  it('still rejects a user-defined sensor capability without the catalog', () => {
    const result = validateWidgetBinding(def, {
      id: 'w-1',
      type: 'sensor-value',
      binding: { deviceId: 'sensor-01', capability: 'pressure' },
      layout: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it('does not accept switch-kind capabilities for a sensor-accepting def', () => {
    const result = validateWidgetBinding(
      def,
      {
        id: 'w-1',
        type: 'sensor-value',
        binding: { deviceId: 'relay-1', capability: 'switch' },
        layout: { x: 0, y: 0, width: 1, height: 1 },
      },
      pressureCatalog,
    );
    expect(result.ok).toBe(false);
  });
});
