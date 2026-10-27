/**
 * Section-scoped placement tests (band re-pack, AD2/AD3/AD6).
 *
 * Verifies: packSectionBands normalizes the two sections into contiguous
 * bands while preserving every widget's section-local row (visual-neutral,
 * interleaved legacy layouts included); findSectionSlot scans the target
 * section's local grid row-major under the findFreeSlot rules (2 columns,
 * 2x1/2x2 spans, 1000-row cap) and shifts the FOLLOWING band when the
 * section grows; the AD6 room-scoped contract (`sameRoomWidgets` filter +
 * `spliceRoomWidgets` splice-back) keeps every other room's widgets
 * byte-identical.
 *
 * Pure + platform-independent.
 */

import type { WidgetConfig } from '@modules/widgets/api';

import {
  findSectionSlot,
  packSectionBands,
  sameRoomWidgets,
  spliceRoomWidgets,
} from './sectionPlacement';

function widget(
  id: string,
  type: string,
  x: number,
  y: number,
  width: 1 | 2 = 1,
  height: 1 | 2 = 1,
  roomId = 'r1',
): WidgetConfig {
  return {
    id,
    type,
    roomId,
    layout: { x, y, width, height },
  };
}

/** The AD6 structural entry: scope a list to room r1. */
const room = (widgets: readonly WidgetConfig[]) =>
  sameRoomWidgets('r1', widgets);

describe('packSectionBands (AD2 band re-pack)', () => {
  it('keeps an already-banded layout untouched (identity for unchanged widgets)', () => {
    const temp = widget('temp', 'sensor-value', 0, 0);
    const hum = widget('hum', 'sensor-value', 1, 0);
    const light = widget('light', 'switch', 0, 1);
    const fan = widget('fan', 'switch', 1, 1);
    const packed = packSectionBands(room([temp, hum, light, fan]));
    expect(packed.map(w => w.layout)).toEqual([
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 1, y: 0, width: 1, height: 1 },
      { x: 0, y: 1, width: 1, height: 1 },
      { x: 1, y: 1, width: 1, height: 1 },
    ]);
    // Unchanged rows keep the object identity (cheap change detection).
    expect(packed[0]).toBe(temp);
    expect(packed[1]).toBe(hum);
    expect(packed[2]).toBe(light);
    expect(packed[3]).toBe(fan);
  });

  it('preserves each section’s LOCAL rows while normalizing interleaved bands', () => {
    // Legacy interleave: the sensor sits BELOW the devices rows.
    const temp = widget('temp', 'sensor-value', 0, 3);
    const light = widget('light', 'switch', 0, 0);
    const fan = widget('fan', 'switch', 1, 1);
    const packed = packSectionBands(room([temp, light, fan]));
    // Env band first: temp local row 0 (was y 3 − base 3). Devices band
    // after (env extent 1): light local 0 → 1, fan local 1 → 2.
    expect(packed.map(w => w.layout.y)).toEqual([0, 1, 2]);
    // Section-local rows are invariant: y − sectionBase unchanged.
    expect(packed[0]!.layout.y - 0).toBe(3 - 3);
    expect(packed[1]!.layout.y - 1).toBe(0 - 0);
    expect(packed[2]!.layout.y - 1).toBe(1 - 0);
  });
});

describe('findSectionSlot (AD3 section-local scan + band shift)', () => {
  it('places a sensor at env-local row 1 in the packed example and shifts the devices band (+1 each)', () => {
    // The user's log layout: temp/hum in env; fan 2x1 + w-1/w-2 in devices.
    const temp = widget('temp', 'sensor-value', 0, 0);
    const hum = widget('hum', 'sensor-value', 1, 0);
    const fan = widget('fan', 'switch', 0, 1, 2, 1);
    const w1 = widget('w-1', 'switch', 0, 2);
    const w2 = widget('w-2', 'switch', 1, 2);
    const placement = findSectionSlot(
      room([temp, hum, fan, w1, w2]),
      'sensor-value',
      1,
      1,
    );
    expect(placement).not.toBeNull();
    // Directly under Nhiệt độ/Độ ẩm — NOT below empty rows.
    expect(placement!.slot).toEqual({ x: 0, y: 1 });
    // The devices band shifted one row down; local rows unchanged.
    expect(placement!.widgets.find(w => w.id === 'fan')!.layout.y).toBe(2);
    expect(placement!.widgets.find(w => w.id === 'w-1')!.layout.y).toBe(3);
    expect(placement!.widgets.find(w => w.id === 'w-2')!.layout.y).toBe(3);
    expect(placement!.widgets.find(w => w.id === 'fan')!.layout.y - 2).toBe(
      1 - 1,
    );
    expect(placement!.widgets.find(w => w.id === 'w-1')!.layout.y - 3).toBe(
      2 - 2,
    );
    // The env widgets did not move (identity preserved).
    expect(placement!.widgets.find(w => w.id === 'temp')).toBe(temp);
    expect(placement!.widgets.find(w => w.id === 'hum')).toBe(hum);
  });

  it('handles an EMPTY environment section: first env widget lands at (0,0), devices shift behind it', () => {
    const light = widget('light', 'switch', 0, 0);
    const fan = widget('fan', 'switch', 1, 1);
    const placement = findSectionSlot(room([light, fan]), 'sensor-value', 1, 1);
    expect(placement!.slot).toEqual({ x: 0, y: 0 });
    expect(placement!.widgets.find(w => w.id === 'light')!.layout.y).toBe(1);
    expect(placement!.widgets.find(w => w.id === 'fan')!.layout.y).toBe(2);
  });

  it('handles an EMPTY devices section: the first device lands right below the env band', () => {
    const temp = widget('temp', 'sensor-value', 0, 0);
    const hum = widget('hum', 'sensor-value', 1, 0);
    const temp2 = widget('temp-2', 'sensor-value', 0, 1);
    const placement = findSectionSlot(room([temp, hum, temp2]), 'switch', 1, 1);
    expect(placement!.slot).toEqual({ x: 0, y: 2 });
    // The env band never moves for a devices placement.
    expect(placement!.widgets.find(w => w.id === 'temp')).toBe(temp);
    expect(placement!.widgets.find(w => w.id === 'temp-2')).toBe(temp2);
  });

  it('normalizes interleaved legacy input (lazy re-pack on placement)', () => {
    const light = widget('light', 'switch', 0, 0);
    const temp = widget('temp', 'sensor-value', 0, 3);
    const placement = findSectionSlot(
      room([light, temp]),
      'sensor-value',
      1,
      1,
    );
    // Packed: temp → row 0, light → row 1. The scan finds (1,0) free in
    // row 0 — no growth, no shift needed.
    expect(placement!.slot).toEqual({ x: 1, y: 0 });
    expect(placement!.widgets.map(w => w.layout.y)).toEqual([1, 0]);
  });

  it('respects the 2-column bounds for 2x1 and 2x2 spans', () => {
    // Row 0 fully held → a 2x1 skips the wrapped x=1 cell (out of bounds).
    const full = room([
      widget('temp', 'sensor-value', 0, 0),
      widget('hum', 'sensor-value', 1, 0),
    ]);
    expect(findSectionSlot(full, 'sensor-value', 2, 1)!.slot).toEqual({
      x: 0,
      y: 1,
    });
    // A 2x2 needs two adjacent free rows.
    const stacked = room([
      widget('temp', 'sensor-value', 0, 0),
      widget('hum', 'sensor-value', 1, 0),
      widget('temp-2', 'sensor-value', 0, 1),
    ]);
    expect(findSectionSlot(stacked, 'sensor-value', 2, 2)!.slot).toEqual({
      x: 0,
      y: 2,
    });
    // Devices-target 2x2 starts its scan below the env band.
    const mixed = room([
      widget('temp', 'sensor-value', 0, 0),
      widget('light', 'switch', 0, 1),
    ]);
    const devicePlacement = findSectionSlot(mixed, 'switch', 2, 2);
    expect(devicePlacement!.slot).toEqual({ x: 0, y: 2 });
    // The env band is untouched by a devices placement.
    expect(devicePlacement!.widgets.find(w => w.id === 'temp')).toBe(mixed[0]);
  });

  it('returns null when the 1000-row local scan is exhausted', () => {
    const rows = 1000;
    const full: WidgetConfig[] = [];
    for (let row = 0; row < rows; row++) {
      full.push(widget(`l-${row}`, 'sensor-value', 0, row));
      full.push(widget(`r-${row}`, 'sensor-value', 1, row));
    }
    expect(findSectionSlot(room(full), 'sensor-value', 1, 1)).toBeNull();
  });
});

describe('room-scoped splice contract (AD6)', () => {
  it('sameRoomWidgets filters a flat multi-room list down to one room', () => {
    const a = widget('a', 'sensor-value', 0, 0);
    const other = widget('b', 'sensor-value', 0, 0, 1, 1, 'r2');
    const scoped = sameRoomWidgets('r1', [a, other]);
    expect(scoped).toEqual([a]);
  });

  it('spliceRoomWidgets replaces the room slice and keeps other rooms byte-identical', () => {
    const a = widget('a', 'sensor-value', 0, 0);
    const b = widget('b', 'sensor-value', 0, 0, 1, 1, 'r2');
    const c = widget('c', 'switch', 0, 1);
    const d = widget('d', 'switch', 0, 5, 1, 1, 'r2');
    const replacement = [
      widget('n-1', 'switch', 0, 9),
      widget('n-2', 'switch', 1, 9),
    ];
    const result = spliceRoomWidgets([a, b, c, d], 'r1', replacement);
    // The r1 slice (a, c — wherever it sits) is replaced in one piece at
    // its first position; r2's widgets keep identity and relative order.
    expect(result).toEqual([replacement[0], replacement[1], b, d]);
    expect(result[2]).toBe(b);
    expect(result[3]).toBe(d);
    // The input is never mutated.
    expect([a, b, c, d]).toHaveLength(4);
  });

  it('spliceRoomWidgets appends the replacement when the room is absent', () => {
    const b = widget('b', 'sensor-value', 0, 0, 1, 1, 'r2');
    const replacement = [widget('n-1', 'switch', 0, 9)];
    const result = spliceRoomWidgets([b], 'r1', replacement);
    expect(result).toEqual([b, replacement[0]]);
    expect(result[0]).toBe(b);
  });
});
