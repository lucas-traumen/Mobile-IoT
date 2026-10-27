/**
 * roomFilter tests — the pure room-filter + room-ordering helpers.
 *
 * - `filterWidgetsForRoom`: null → all widgets; a room id → widgets of
 *   that room + widgets without a roomId (global widgets). Order is
 *   preserved.
 * - `orderWidgetsByTemplateRooms` / `widgetsMatchAfterRoomOrdering`: the
 *   editor's save/exit semantic equality (amendment-2 item 9) — the same
 *   regrouping the atomic Save applies, so a cross-room duplicate/move
 *   (flat-draft append vs persisted regroup) compares EQUAL while any
 *   real edit stays dirty.
 */

import type { WidgetConfig } from '@modules/widgets/api';

import {
  filterWidgetsForRoom,
  orderWidgetsByTemplateRooms,
  widgetsMatchAfterRoomOrdering,
} from './roomFilter';

// roomFilter imports WidgetConfig from @modules/widgets/api → devices api,
// which pulls AsyncStorage transitively — pin the native module.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

function widget(id: string, roomId?: string): WidgetConfig {
  return {
    id,
    type: 'vendor-camera-panel',
    roomId,
    layout: { x: 0, y: 0, width: 2, height: 1 },
  };
}

const widgets = [
  widget('w-living', 'room-living'),
  widget('w-global'),
  widget('w-kitchen', 'room-kitchen'),
];

describe('filterWidgetsForRoom', () => {
  it('returns every widget when roomId is null (Tất cả)', () => {
    expect(filterWidgetsForRoom(widgets, null)).toHaveLength(3);
    expect(filterWidgetsForRoom(widgets, null).map(w => w.id)).toEqual([
      'w-living',
      'w-global',
      'w-kitchen',
    ]);
  });

  it('returns the room widgets + global widgets for a room id', () => {
    const result = filterWidgetsForRoom(widgets, 'room-living');
    expect(result.map(w => w.id)).toEqual(['w-living', 'w-global']);
  });

  it('returns only global widgets for a room with no widgets', () => {
    const result = filterWidgetsForRoom(widgets, 'room-bedroom');
    expect(result.map(w => w.id)).toEqual(['w-global']);
  });

  it('preserves the original order', () => {
    const result = filterWidgetsForRoom(
      [widget('b'), widget('a', 'room-living'), widget('c')],
      'room-living',
    );
    expect(result.map(w => w.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns an empty array when there are no widgets', () => {
    expect(filterWidgetsForRoom([], 'room-living')).toEqual([]);
    expect(filterWidgetsForRoom([], null)).toEqual([]);
  });
});

describe('orderWidgetsByTemplateRooms (the regrouping the Save applies)', () => {
  const rooms = [{ roomId: 'room-a' }, { roomId: 'room-b' }];

  it('regroups a flat list into the template room order, per-room order preserved', () => {
    const flat = [
      widget('b1', 'room-b'),
      widget('a2', 'room-a'),
      widget('a1', 'room-a'),
      widget('b2', 'room-b'),
    ];
    expect(orderWidgetsByTemplateRooms(flat, rooms).map(w => w.id)).toEqual([
      'a2',
      'a1',
      'b1',
      'b2',
    ]);
  });

  it('drops widgets whose room is not referenced (totality is up to the caller)', () => {
    const flat = [widget('a1', 'room-a'), widget('z1', 'room-z')];
    expect(orderWidgetsByTemplateRooms(flat, rooms).map(w => w.id)).toEqual([
      'a1',
    ]);
  });

  it('handles empty inputs', () => {
    expect(orderWidgetsByTemplateRooms([], rooms)).toEqual([]);
    expect(orderWidgetsByTemplateRooms([widget('a1', 'room-a')], [])).toEqual(
      [],
    );
  });
});

describe('widgetsMatchAfterRoomOrdering (editor save/exit semantic equality)', () => {
  const rooms = [{ roomId: 'room-a' }, { roomId: 'room-b' }];

  it('matches a cross-room duplicate whose flat append order differs from the persisted regroup', () => {
    // The reviewer-4 M1 wrinkle: a duplicate into an EARLIER room is
    // appended at the END of the flat draft, while the Save regroups it
    // into that room's slice — the flat orders differ, the semantic
    // content does not.
    const draft = [
      widget('a1', 'room-a'),
      widget('b1', 'room-b'),
      widget('a1-copy', 'room-a'),
    ];
    const persisted = [
      widget('a1', 'room-a'),
      widget('a1-copy', 'room-a'),
      widget('b1', 'room-b'),
    ];
    // The flat JSON comparison genuinely disagrees (the wrinkle exists)…
    expect(JSON.stringify(draft)).not.toBe(JSON.stringify(persisted));
    // …while the regrouped comparison is the saved revision.
    expect(widgetsMatchAfterRoomOrdering(draft, persisted, rooms)).toBe(true);
  });

  it('matches identical lists trivially', () => {
    const list = [widget('a1', 'room-a'), widget('b1', 'room-b')];
    expect(widgetsMatchAfterRoomOrdering(list, list, rooms)).toBe(true);
    expect(widgetsMatchAfterRoomOrdering([], [], rooms)).toBe(true);
  });

  it('stays dirty when the WITHIN-ROOM order differs', () => {
    const draft = [
      widget('a2', 'room-a'),
      widget('a1', 'room-a'),
      widget('b1', 'room-b'),
    ];
    const persisted = [
      widget('a1', 'room-a'),
      widget('a2', 'room-a'),
      widget('b1', 'room-b'),
    ];
    expect(widgetsMatchAfterRoomOrdering(draft, persisted, rooms)).toBe(false);
  });

  it('stays dirty when the content differs (any real edit)', () => {
    const draft = [widget('a1', 'room-a'), widget('b1', 'room-b')];
    const edited = [widget('a1', 'room-a'), widget('b2', 'room-b')];
    expect(widgetsMatchAfterRoomOrdering(draft, edited, rooms)).toBe(false);
  });

  it('stays dirty when a widget references a room outside the template (totality guard)', () => {
    const draft = [
      widget('a1', 'room-a'),
      widget('b1', 'room-b'),
      widget('z1', 'room-z'),
    ];
    const persisted = [widget('a1', 'room-a'), widget('b1', 'room-b')];
    expect(widgetsMatchAfterRoomOrdering(draft, persisted, rooms)).toBe(false);
    // Symmetric: an orphan on the persisted side is equally unmatched.
    expect(widgetsMatchAfterRoomOrdering(persisted, draft, rooms)).toBe(false);
  });
});
