/**
 * Widget uniqueness tests (approved room-sensor rework, dashboard slice E):
 * bound widgets (`sensor-value`, `switch`) are unique by room + type +
 * exact binding; unknown/custom types have NO uniqueness constraint; the
 * dedupe migration keeps the first occurrence and is idempotent.
 */

import type { WidgetConfig } from './widgetTypes';
import {
  dedupeWidgets,
  duplicateWidgetError,
  duplicateWidgetKeys,
  widgetUniquenessKey,
} from './widgetUniqueness';

function sensorWidget(
  overrides: Partial<WidgetConfig> & { id: string },
): WidgetConfig {
  return {
    type: 'sensor-value',
    roomId: 'r1',
    binding: { deviceId: 's-temp', capability: 'temperature' },
    layout: { x: 0, y: 0, width: 1, height: 1 },
    ...overrides,
  } as WidgetConfig;
}

describe('widgetUniquenessKey', () => {
  it('keys bound widgets by room + type + exact binding', () => {
    const a = sensorWidget({ id: 'a' });
    const same = sensorWidget({ id: 'b' });
    const otherCapability = sensorWidget({
      id: 'c',
      binding: { deviceId: 's-temp', capability: 'humidity' },
    });
    const otherDevice = sensorWidget({
      id: 'd',
      binding: { deviceId: 's-other', capability: 'temperature' },
    });
    const otherRoom = sensorWidget({ id: 'e', roomId: 'r2' });
    expect(widgetUniquenessKey(same)).toBe(widgetUniquenessKey(a));
    expect(widgetUniquenessKey(otherCapability)).not.toBe(
      widgetUniquenessKey(a),
    );
    expect(widgetUniquenessKey(otherDevice)).not.toBe(widgetUniquenessKey(a));
    expect(widgetUniquenessKey(otherRoom)).not.toBe(widgetUniquenessKey(a));
  });
});

describe('duplicateWidgetError / duplicateWidgetKeys', () => {
  it('reports a duplicate sensor binding', () => {
    const widgets = [sensorWidget({ id: 'a' })];
    expect(duplicateWidgetError(widgets, sensorWidget({ id: 'b' }))).toContain(
      'already exists',
    );
    expect(
      duplicateWidgetKeys([...widgets, sensorWidget({ id: 'b' })]).size,
    ).toBe(1);
  });

  it('allows the same source in another room and other types', () => {
    const widgets = [sensorWidget({ id: 'a' })];
    expect(
      duplicateWidgetError(widgets, sensorWidget({ id: 'b', roomId: 'r2' })),
    ).toBeNull();
    expect(
      duplicateWidgetError(widgets, sensorWidget({ id: 'c', type: 'switch' })),
    ).toBeNull();
  });

  it('excludes the widget being re-saved', () => {
    const widgets = [sensorWidget({ id: 'a' })];
    expect(
      duplicateWidgetError(widgets, sensorWidget({ id: 'a' }), 'a'),
    ).toBeNull();
  });
});

describe('dedupeWidgets (deterministic load migration)', () => {
  it('keeps the first occurrence and drops later exact duplicates', () => {
    const first = sensorWidget({ id: 'a' });
    const dupe = sensorWidget({ id: 'b' });
    const other = sensorWidget({
      id: 'c',
      binding: { deviceId: 's-hum', capability: 'humidity' },
    });
    const result = dedupeWidgets([first, dupe, other]);
    expect(result.map(widget => widget.id)).toEqual(['a', 'c']);
  });

  it('is idempotent and reference-stable on duplicate-free lists', () => {
    const widgets = [
      sensorWidget({ id: 'a' }),
      sensorWidget({ id: 'b', roomId: 'r2' }),
    ];
    expect(dedupeWidgets(widgets)).toBe(widgets);
    expect(dedupeWidgets(dedupeWidgets(widgets))).toEqual(widgets);
  });

  it('compacts the affected list without touching distinct rooms', () => {
    const livingTempA = sensorWidget({ id: 'a', roomId: 'living' });
    const livingTempDupe = sensorWidget({ id: 'b', roomId: 'living' });
    const bedroomTemp = sensorWidget({ id: 'c', roomId: 'bedroom' });
    const result = dedupeWidgets([livingTempA, livingTempDupe, bedroomTemp]);
    expect(result.map(widget => widget.id)).toEqual(['a', 'c']);
  });
});

describe('unknown/custom widget types (fix cycle 1 — no destructive dedupe)', () => {
  function vendorWidget(id: string): WidgetConfig {
    return {
      id,
      type: 'future-vendor-widget',
      roomId: 'r1',
      binding: { deviceId: 'd1', capability: 'vendor_metric' },
      layout: { x: 0, y: 0, width: 1, height: 1 },
    } as WidgetConfig;
  }

  it('unknown types have NO uniqueness key', () => {
    expect(widgetUniquenessKey(vendorWidget('a'))).toBeNull();
  });

  it('repeated unknown instances never duplicate', () => {
    const widgets = [vendorWidget('a'), vendorWidget('b')];
    expect(duplicateWidgetError(widgets, vendorWidget('c'))).toBeNull();
    expect(duplicateWidgetKeys(widgets).size).toBe(0);
  });

  it('dedupe keeps EVERY repeated unknown instance (reference-stable)', () => {
    const widgets = [vendorWidget('a'), vendorWidget('b'), vendorWidget('c')];
    // Reference-stable no-op: the load migration must not even rewrite.
    expect(dedupeWidgets(widgets)).toBe(widgets);
    expect(dedupeWidgets(widgets)).toHaveLength(3);
  });

  it('approved classes stay constrained alongside unknown types', () => {
    const widgets = [
      vendorWidget('a'),
      sensorWidget({ id: 's1' }),
      sensorWidget({ id: 's2' }), // duplicate approved binding
    ];
    expect(dedupeWidgets(widgets).map(w => w.id)).toEqual(['a', 's1']);
  });
});
