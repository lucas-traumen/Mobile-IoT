/**
 * Dashboard store draft edit-mode tests.
 *
 * Verifies: enterEdit copies a Template's widgets into an isolated draft
 * scoped to exactly one Template-room layout; draft move/resize/remove/
 * rename/rebind mutate the draft only (persisted Templates stay untouched);
 * cancelEdit restores everything (Hủy → layout không đổi); addDraftWidget
 * appends; enterEdit guards (already editing, unknown Template/room).
 */

import { act } from 'react-test-renderer';

import { defaultDashboardsFile } from '../domain/seeds';
import type { DashboardsFile } from '../domain/dashboardSchema';
import { createDashboardStore } from './dashboardStore';

function makeStore(file: DashboardsFile = defaultDashboardsFile()) {
  return createDashboardStore(file);
}

const SEED_ROOM = 'room-living';

describe('dashboardStore draft edit mode', () => {
  it('starts outside edit mode with no draft', () => {
    const store = makeStore();
    expect(store.getState().editMode).toBe(false);
    expect(store.getState().draftWidgets).toBeNull();
  });

  it('enterEdit copies the Template widgets into the draft', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    const state = store.getState();
    expect(state.editMode).toBe(true);
    expect(state.draftWidgets).not.toBeNull();
    // The draft holds EVERY room's widgets of the Template (the store
    // contract) — the seed now carries 15 across the three references.
    expect(state.draftWidgets!.map(w => w.id)).toEqual([
      'w-temp',
      'w-hum',
      'w-light',
      'w-fan',
      'w-pump',
      'w-bed-temp',
      'w-bed-hum',
      'w-bed-light',
      'w-bed-fan',
      'w-bed-pump',
      'w-kitchen-temp',
      'w-kitchen-hum',
      'w-kitchen-light',
      'w-kitchen-fan',
      'w-kitchen-pump',
    ]);
    expect(state.editorTemplateId).toBe('main');
    expect(state.editorRoomId).toBe(SEED_ROOM);
  });

  it('enterEdit is a no-op when already editing or for an unknown Template/room', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    const firstDraft = store.getState().draftWidgets;
    store.getState().enterEdit('main', SEED_ROOM); // already editing → keep
    expect(store.getState().draftWidgets).toBe(firstDraft);

    const store2 = makeStore();
    store2.getState().enterEdit('ghost', SEED_ROOM);
    expect(store2.getState().editMode).toBe(false);
    expect(store2.getState().draftWidgets).toBeNull();

    const store3 = makeStore();
    store3.getState().enterEdit('main', 'room-unknown');
    expect(store3.getState().editMode).toBe(false);
    expect(store3.getState().draftWidgets).toBeNull();
  });

  it('enterEdit REPLACES a stale draft from a different scope (deterministic)', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    store.getState().renameDraftWidget('w-temp', 'Bản nháp cũ');
    expect(store.getState().editorTemplateId).toBe('main');
    // A leftover stale draft from another scope is replaced — the new
    // editor never edits on top of another scope's widgets.
    store.getState().enterEdit('main', 'room-ghost-in-registry');
    // room-ghost is not a seed reference → no-op; scope unchanged.
    expect(store.getState().editorRoomId).toBe(SEED_ROOM);

    // A different VALID reference of the SAME Template replaces the draft.
    const file = defaultDashboardsFile();
    // The seed now references every room — drop the bedroom reference and
    // push it back fresh (the "different valid reference" fixture).
    file.templates[0]!.rooms = file.templates[0]!.rooms.filter(
      reference => reference.roomId !== 'room-bedroom',
    );
    file.templates[0]!.rooms.push({
      roomId: 'room-bedroom',
      order: 1,
      widgets: [],
    });
    const store2 = createDashboardStore(file);
    store2.getState().enterEdit('main', SEED_ROOM);
    store2.getState().renameDraftWidget('w-temp', 'Bản nháp cũ');
    store2.getState().enterEdit('main', 'room-bedroom');
    expect(store2.getState().editorRoomId).toBe('room-bedroom');
    expect(store2.getState().editMode).toBe(true);
    // The stale draft's mutation is gone: a FRESH copy of the whole
    // Template replaced it (the draft holds every room's widgets).
    expect(
      store2.getState().draftWidgets!.find(w => w.id === 'w-temp')!.title,
    ).toBeUndefined();
  });

  it('draft mutations do not touch the persisted Templates', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    store.getState().removeWidget('w-temp');
    const persisted = store.getState().templates.find(t => t.id === 'main')!;
    expect(persisted.rooms[0]!.widgets.map(w => w.id)).toContain('w-temp');
  });

  it('moveWidget applies a valid move to the draft only', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    // (1, 5) is below every seed row → free.
    expect(store.getState().moveWidget('w-temp', 1, 5)).toBe(true);
    const moved = store.getState().draftWidgets!.find(w => w.id === 'w-temp')!;
    expect(moved.layout).toMatchObject({ x: 1, y: 5 });
  });

  it('moveWidget rejects an overlap and leaves the draft unchanged', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    // w-hum occupies (1,0) → moving w-temp onto it is rejected.
    expect(store.getState().moveWidget('w-temp', 1, 0)).toBe(false);
    const widget = store.getState().draftWidgets!.find(w => w.id === 'w-temp')!;
    expect(widget.layout).toMatchObject({ x: 0, y: 0 });
  });

  it('resizeWidget relocates a draft widget when the spot is blocked', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    // w-temp (sensor-value, "Môi trường") 1x1 at (0,0) → 2x1 would hit
    // w-hum at (1,0) → the SECTION-SCOPED fallback relocates it to the
    // first free 2x1 cell of its OWN section (env-local row 1 = absolute
    // (0,1)); the devices band (w-light/w-fan/w-pump) shifts one row down.
    expect(store.getState().resizeWidget('w-temp', '2x1')).toBe(true);
    const draft = store.getState().draftWidgets!;
    const resized = draft.find(w => w.id === 'w-temp')!;
    expect(resized.layout).toEqual({ x: 0, y: 1, width: 2, height: 1 });
    expect(draft.find(w => w.id === 'w-light')!.layout.y).toBe(2);
    expect(draft.find(w => w.id === 'w-fan')!.layout.y).toBe(2);
    expect(draft.find(w => w.id === 'w-pump')!.layout.y).toBe(3);
    expect(draft.find(w => w.id === 'w-hum')!.layout.y).toBe(0);
  });

  it('removeWidget removes from the draft and compacts vertically', () => {
    const file: DashboardsFile = {
      templates: [
        {
          id: 'main',
          name: 'Trang chủ',
          updatedAt: 10,
          rooms: [
            {
              roomId: 'r1',
              order: 0,
              widgets: [
                {
                  id: 'w-a',
                  type: 'sensor-value',
                  roomId: 'r1',
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                  id: 'w-b',
                  type: 'vendor-camera-panel',
                  roomId: 'r1',
                  layout: { x: 0, y: 2, width: 2, height: 1 },
                },
              ],
            },
          ],
        },
      ],
      activeId: 'main',
      activeRoomId: null,
    };
    const store = makeStore(file);
    store.getState().enterEdit('main', 'r1');
    store.getState().removeWidget('w-a');
    const draft = store.getState().draftWidgets!;
    expect(draft).toHaveLength(1);
    // The gap (row 0) is filled — w-b slides up.
    expect(draft[0]!.layout).toEqual({ x: 0, y: 0, width: 2, height: 1 });
  });

  it('renameDraftWidget sets, changes and clears a draft title', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    store.getState().renameDraftWidget('w-temp', 'Nhiệt độ phòng khách');
    expect(
      store.getState().draftWidgets!.find(w => w.id === 'w-temp')!.title,
    ).toBe('Nhiệt độ phòng khách');
    // Blank title clears it.
    store.getState().renameDraftWidget('w-temp', '   ');
    expect(
      store.getState().draftWidgets!.find(w => w.id === 'w-temp')!.title,
    ).toBeUndefined();
    // Persisted Template untouched.
    const persisted = store.getState().templates.find(t => t.id === 'main')!;
    expect(
      persisted.rooms[0]!.widgets.find(w => w.id === 'w-temp')!.title,
    ).toBeUndefined();
  });

  it('addDraftWidget appends to the open draft', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    store.getState().addDraftWidget({
      id: 'w-new',
      type: 'vendor-camera-panel',
      roomId: SEED_ROOM,
      layout: { x: 0, y: 3, width: 2, height: 1 },
    });
    expect(store.getState().draftWidgets!.some(w => w.id === 'w-new')).toBe(
      true,
    );
  });

  it('draft actions are no-ops outside edit mode', () => {
    const store = makeStore();
    expect(store.getState().moveWidget('w-temp', 1, 5)).toBe(false);
    expect(store.getState().resizeWidget('w-temp', '2x1')).toBe(false);
    store.getState().removeWidget('w-temp'); // does not throw
    store.getState().renameDraftWidget('w-temp', 'X'); // does not throw
    expect(store.getState().draftWidgets).toBeNull();
  });

  it('cancelEdit discards the draft (Hủy → layout không đổi)', () => {
    const store = makeStore();
    const before = store
      .getState()
      .templates.find(t => t.id === 'main')!
      .rooms[0]!.widgets.map(w => w.id);
    store.getState().enterEdit('main', SEED_ROOM);
    store.getState().removeWidget('w-temp');
    store.getState().moveWidget('w-hum', 1, 9);
    store.getState().renameDraftWidget('w-light', 'Đèn mới');
    store.getState().cancelEdit();

    const state = store.getState();
    expect(state.editMode).toBe(false);
    expect(state.draftWidgets).toBeNull();
    expect(state.editorTemplateId).toBeNull();
    expect(state.editorRoomId).toBeNull();
    expect(
      state.templates
        .find(t => t.id === 'main')!
        .rooms[0]!.widgets.map(w => w.id),
    ).toEqual(before);
  });
});

describe('dashboardStore room-scoped draft seam', () => {
  it('the draft keeps ALL widgets of the Template (other rooms included)', () => {
    const file: DashboardsFile = {
      templates: [
        {
          id: 'main',
          name: 'Nhà',
          updatedAt: 5,
          rooms: [
            {
              roomId: 'r1',
              order: 0,
              widgets: [
                {
                  id: 'w-a',
                  type: 'sensor-value',
                  roomId: 'r1',
                  layout: { x: 0, y: 0, width: 1, height: 1 },
                },
              ],
            },
            {
              roomId: 'r2',
              order: 1,
              widgets: [
                {
                  id: 'w-b',
                  type: 'vendor-camera-panel',
                  roomId: 'r2',
                  layout: { x: 0, y: 0, width: 2, height: 1 },
                },
              ],
            },
          ],
        },
      ],
      activeId: 'main',
      activeRoomId: null,
    };
    const store = makeStore(file);
    store.getState().enterEdit('main', 'r1');
    // Draft retains every widget (other rooms included), not just the
    // edited room's — Save must preserve them.
    expect(store.getState().draftWidgets).toHaveLength(2);
    // w-b belongs to r2 — invisible while editing r1, so w-a may share (0,0).
    expect(store.getState().moveWidget('w-a', 0, 0)).toBe(true);
    const draft = store.getState().draftWidgets!;
    expect(draft.find(w => w.id === 'w-b')!.layout).toEqual({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
    });
  });

  it('rebindDraftWidget retargets the binding inside the draft only', () => {
    const store = makeStore();
    store.getState().enterEdit('main', SEED_ROOM);
    store.getState().rebindDraftWidget('w-temp', 'sensor-02', 'humidity');
    const draft = store.getState().draftWidgets!;
    expect(draft.find(w => w.id === 'w-temp')!.binding).toEqual({
      deviceId: 'sensor-02',
      capability: 'humidity',
    });
    // Persisted Template untouched until Save.
    const persisted = store.getState().templates.find(t => t.id === 'main')!
      .rooms[0]!.widgets;
    expect(persisted.find(w => w.id === 'w-temp')!.binding).toEqual({
      deviceId: 'sensor-temp-01',
      capability: 'temperature',
    });
    // No-op outside edit mode.
    store.getState().cancelEdit();
    store.getState().rebindDraftWidget('w-temp', 'x', 'y');
    expect(store.getState().draftWidgets).toBeNull();
  });

  it('setFile swaps the mirrored file (service push)', () => {
    const store = makeStore();
    const file = defaultDashboardsFile();
    file.templates.push({
      id: 'tpl-2',
      name: 'Tầng 2',
      updatedAt: 99,
      rooms: [],
    });
    store.getState().setFile(file);
    expect(store.getState().templates).toHaveLength(2);
    expect(
      store
        .getState()
        .getTemplates()
        .map(t => t.id),
    ).toEqual(['main', 'tpl-2']);
    expect(store.getState().getActiveId()).toBe('main');
  });
});

describe('rebindDraftWidget room guard', () => {
  const file: DashboardsFile = {
    activeId: 'main',
    activeRoomId: null,
    templates: [
      {
        id: 'main',
        name: 'Chính',
        updatedAt: 1,
        rooms: [
          {
            roomId: 'room-a',
            order: 0,
            widgets: [
              {
                id: 'w-a',
                type: 'switch',
                roomId: 'room-a',
                binding: { deviceId: 'relay-a1', capability: 'switch' },
                layout: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  function guard(deviceRooms: Record<string, string | undefined>): {
    canRebindToRoom: (
      roomId: string | null | undefined,
      deviceId: string,
    ) => boolean;
  } {
    return {
      canRebindToRoom: (widgetRoomId, deviceId) =>
        !widgetRoomId || deviceRooms[deviceId] === widgetRoomId,
    };
  }

  it('no-ops a CROSS-ROOM rebind (draft untouched)', () => {
    const store = createDashboardStore(file, guard({ 'relay-b1': 'room-b' }));
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    act(() => {
      store.getState().rebindDraftWidget('w-a', 'relay-b1', 'switch');
    });
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('allows a SAME-ROOM rebind with the guard wired', () => {
    const store = createDashboardStore(file, guard({ 'relay-a2': 'room-a' }));
    store.getState().enterEdit('main', 'room-a');
    store.getState().rebindDraftWidget('w-a', 'relay-a2', 'switch');
    expect(
      store.getState().draftWidgets!.find(w => w.id === 'w-a')?.binding,
    ).toEqual({ deviceId: 'relay-a2', capability: 'switch' });
  });

  it('without a guard, rebinds stay unrestricted (legacy consumers)', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    store.getState().rebindDraftWidget('w-a', 'any-device', 'switch');
    expect(
      store.getState().draftWidgets!.find(w => w.id === 'w-a')?.binding,
    ).toEqual({ deviceId: 'any-device', capability: 'switch' });
  });
});

describe('swapDraftBindings (fix cycle 7 G — same-room binding exchange)', () => {
  const file: DashboardsFile = {
    activeId: 'main',
    activeRoomId: null,
    templates: [
      {
        id: 'main',
        name: 'Chính',
        updatedAt: 1,
        rooms: [
          {
            roomId: 'room-a',
            order: 0,
            widgets: [
              {
                id: 'w-temp',
                type: 'sensor-value',
                roomId: 'room-a',
                binding: { deviceId: 'sensor-a1', capability: 'temperature' },
                title: 'Nhiệt độ',
                layout: { x: 0, y: 0, width: 1, height: 1 },
              },
              {
                id: 'w-hum',
                type: 'sensor-value',
                roomId: 'room-a',
                binding: { deviceId: 'sensor-a2', capability: 'humidity' },
                layout: { x: 1, y: 0, width: 1, height: 1 },
              },
              {
                id: 'w-light',
                type: 'switch',
                roomId: 'room-a',
                binding: { deviceId: 'relay-a1', capability: 'switch' },
                layout: { x: 0, y: 1, width: 1, height: 1 },
              },
              {
                id: 'w-unbound',
                type: 'vendor-camera-panel',
                roomId: 'room-a',
                layout: { x: 0, y: 2, width: 2, height: 1 },
              },
            ],
          },
          {
            roomId: 'room-b',
            order: 1,
            widgets: [
              {
                id: 'w-b',
                type: 'sensor-value',
                roomId: 'room-b',
                binding: { deviceId: 'sensor-b1', capability: 'temperature' },
                layout: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  /** Binding multiset of one room (uniqueness invariant probe). */
  function bindingKeys(
    store: ReturnType<typeof createDashboardStore>,
    roomId: string,
  ): string[] {
    return store
      .getState()
      .draftWidgets!.filter(w => w.roomId === roomId && w.binding)
      .map(w => `${w.roomId}|${w.binding!.deviceId}:${w.binding!.capability}`)
      .sort();
  }

  it('exchanges BOTH bindings in the draft; titles/positions untouched; no repo writes', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets!;
    const result = store.getState().swapDraftBindings('w-temp', 'w-hum');
    expect(result).toBe(true);
    const after = store.getState().draftWidgets!;
    expect(after.find(w => w.id === 'w-temp')!.binding).toEqual({
      deviceId: 'sensor-a2',
      capability: 'humidity',
    });
    expect(after.find(w => w.id === 'w-hum')!.binding).toEqual({
      deviceId: 'sensor-a1',
      capability: 'temperature',
    });
    // Titles/positions/layouts are untouched.
    expect(after.find(w => w.id === 'w-temp')!.title).toBe('Nhiệt độ');
    expect(after.find(w => w.id === 'w-hum')!.layout).toEqual(
      before.find(w => w.id === 'w-hum')!.layout,
    );
    // The room's binding MULTISET is identical → the room-level uniqueness
    // rule trivially still holds for both widgets.
    expect(bindingKeys(store, 'room-a')).toEqual(
      before
        .filter(w => w.roomId === 'room-a' && w.binding)
        .map(w => `${w.roomId}|${w.binding!.deviceId}:${w.binding!.capability}`)
        .sort(),
    );
  });

  it('rejects a CROSS-ROOM swap (draft untouched)', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    expect(store.getState().swapDraftBindings('w-temp', 'w-b')).toBe(false);
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('rejects a swap where either participant is UNBOUND', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    expect(store.getState().swapDraftBindings('w-temp', 'w-unbound')).toBe(
      false,
    );
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('rejects a kind-INCOMPATIBLE swap via the canAcceptBinding guard', () => {
    const canAcceptBinding = jest.fn((widgetType: string, capability: string) =>
      // sensor-value accepts only sensor capabilities; switch only switch.
      widgetType === 'sensor-value'
        ? ['temperature', 'humidity'].includes(capability)
        : widgetType === 'switch'
        ? capability === 'switch'
        : false,
    );
    const store = createDashboardStore(file, { canAcceptBinding });
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    // w-temp (sensor-value) ↔ w-light (switch): the sensor would receive a
    // switch source → rejected on BOTH directions' compatibility.
    expect(store.getState().swapDraftBindings('w-temp', 'w-light')).toBe(false);
    expect(store.getState().draftWidgets).toBe(before);
    expect(canAcceptBinding).toHaveBeenCalled();
    // Same-kind swap still works with the guard wired.
    expect(store.getState().swapDraftBindings('w-temp', 'w-hum')).toBe(true);
  });

  it('without the guard, the swap is unrestricted (legacy consumers)', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    // No canAcceptBinding wired → the kind check is skipped (the service
    // always wires it; plain consumers keep the legacy behavior).
    expect(store.getState().swapDraftBindings('w-temp', 'w-light')).toBe(true);
  });

  it('returns false without a draft / unknown ids / the same id', () => {
    const store = createDashboardStore(file);
    expect(store.getState().swapDraftBindings('w-temp', 'w-hum')).toBe(false);
    store.getState().enterEdit('main', 'room-a');
    expect(store.getState().swapDraftBindings('w-ghost', 'w-hum')).toBe(false);
    expect(store.getState().swapDraftBindings('w-temp', 'w-temp')).toBe(false);
  });
});

describe('swapDraftPositions (fix cycle 8 L — same-section position exchange)', () => {
  const roomA: DashboardsFile['templates'][number]['rooms'][number] = {
    roomId: 'room-a',
    order: 0,
    widgets: [
      {
        id: 'w-temp',
        type: 'sensor-value',
        roomId: 'room-a',
        binding: { deviceId: 'sensor-a1', capability: 'temperature' },
        title: 'Nhiệt độ',
        layout: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        id: 'w-hum',
        type: 'sensor-value',
        roomId: 'room-a',
        binding: { deviceId: 'sensor-a2', capability: 'humidity' },
        layout: { x: 1, y: 0, width: 1, height: 1 },
      },
      {
        id: 'w-light',
        type: 'switch',
        roomId: 'room-a',
        binding: { deviceId: 'relay-a1', capability: 'switch' },
        layout: { x: 0, y: 1, width: 1, height: 1 },
      },
      {
        id: 'w-fan',
        type: 'switch',
        roomId: 'room-a',
        binding: { deviceId: 'relay-a2', capability: 'switch' },
        layout: { x: 1, y: 1, width: 1, height: 1 },
      },
      {
        id: 'w-wide',
        type: 'vendor-camera-panel',
        roomId: 'room-a',
        layout: { x: 0, y: 2, width: 2, height: 1 },
      },
    ],
  };
  // Dedicated rooms for the span/mutual-overlap cases (each keeps a valid
  // base layout whose ONLY invalid arrangement is the rejected swap).
  const spanRoom: DashboardsFile['templates'][number]['rooms'][number] = {
    roomId: 'room-span',
    order: 1,
    widgets: [
      {
        id: 's-big',
        type: 'switch',
        roomId: 'room-span',
        layout: { x: 0, y: 0, width: 2, height: 2 },
      },
      {
        id: 's-tail',
        type: 'switch',
        roomId: 'room-span',
        layout: { x: 0, y: 2, width: 1, height: 1 },
      },
      {
        id: 's-side',
        type: 'switch',
        roomId: 'room-span',
        layout: { x: 1, y: 2, width: 1, height: 1 },
      },
      {
        id: 's-floor',
        type: 'switch',
        roomId: 'room-span',
        layout: { x: 0, y: 3, width: 1, height: 1 },
      },
    ],
  };
  const mutualRoom: DashboardsFile['templates'][number]['rooms'][number] = {
    roomId: 'room-mutual',
    order: 2,
    widgets: [
      {
        id: 'm-one',
        type: 'switch',
        roomId: 'room-mutual',
        layout: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        id: 'm-two',
        type: 'switch',
        roomId: 'room-mutual',
        layout: { x: 0, y: 1, width: 2, height: 2 },
      },
    ],
  };
  const file: DashboardsFile = {
    activeId: 'main',
    activeRoomId: null,
    templates: [
      {
        id: 'main',
        name: 'Chính',
        updatedAt: 1,
        rooms: [
          roomA,
          spanRoom,
          mutualRoom,
          {
            roomId: 'room-b',
            order: 3,
            widgets: [
              {
                id: 'w-b',
                type: 'switch',
                roomId: 'room-b',
                layout: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  it('exchanges the POSITIONS of a same-section occupied drop; everything else stays', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const result = store.getState().swapDraftPositions('w-light', 'w-fan');
    expect(result).toBe(true);
    const draft = store.getState().draftWidgets!;
    // The two switch cards exchanged origins (the user's drag-to-swap).
    expect(draft.find(w => w.id === 'w-light')!.layout).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
    expect(draft.find(w => w.id === 'w-fan')!.layout).toEqual({
      x: 0,
      y: 1,
      width: 1,
      height: 1,
    });
    // Titles, bindings, types and sizes stay on their OWN widget — only
    // the origins moved.
    expect(draft.find(w => w.id === 'w-light')!.binding).toEqual({
      deviceId: 'relay-a1',
      capability: 'switch',
    });
    expect(draft.find(w => w.id === 'w-fan')!.binding).toEqual({
      deviceId: 'relay-a2',
      capability: 'switch',
    });
    expect(draft.find(w => w.id === 'w-temp')!.title).toBe('Nhiệt độ');
  });

  it('rejects a different-span swap whose wide result fits in bounds but hits a THIRD widget', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    // w-light (1x1 @ 0,1) ↔ w-wide (2x1 @ 0,2): the wide card WOULD fit at
    // light's row in-bounds, but it spans columns 0-1 — overlapping
    // w-fan (1,1). Spans respected → rejected, draft untouched.
    expect(store.getState().swapDraftPositions('w-light', 'w-wide')).toBe(
      false,
    );
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('rejects when a resulting placement would be OUT OF BOUNDS (spans respected)', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    // w-fan (1x1 @ 1,1) ↔ w-wide (2x1 @ 0,2): the wide card would need
    // x=1 → columns 1-2 — beyond the 2-column grid.
    expect(store.getState().swapDraftPositions('w-fan', 'w-wide')).toBe(false);
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('rejects when a resulting placement overlaps a THIRD widget', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-span');
    const before = store.getState().draftWidgets;
    // s-big (2x2 @ 0,0) ↔ s-tail (1x1 @ 0,2): big's new cell (rows 2-3,
    // cols 0-1) would overlap s-side (1,2) and s-floor (0,3).
    expect(store.getState().swapDraftPositions('s-big', 's-tail')).toBe(false);
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('accepts a different-span swap when BOTH results fit around third widgets', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-span');
    // s-big (2x2 @ 0,0) ↔ s-floor (1x1 @ 0,3): big lands at (0,3) (rows
    // 3-4 — free), floor lands at (0,0); s-tail/s-side (row 2) untouched.
    const result = store.getState().swapDraftPositions('s-big', 's-floor');
    expect(result).toBe(true);
    const draft = store.getState().draftWidgets!;
    expect(draft.find(w => w.id === 's-big')!.layout).toEqual({
      x: 0,
      y: 3,
      width: 2,
      height: 2,
    });
    expect(draft.find(w => w.id === 's-floor')!.layout).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('rejects when the two resulting placements overlap EACH OTHER', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-mutual');
    const before = store.getState().draftWidgets;
    // m-one (1x1 @ 0,0) ↔ m-two (2x2 @ 0,1): one would sit at (0,1)
    // INSIDE two's new 2x2 cell at (0,0) — invalid despite no third widget.
    expect(store.getState().swapDraftPositions('m-one', 'm-two')).toBe(false);
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('rejects a CROSS-SECTION swap (sensor-value ↔ switch — the type-based sections)', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    expect(store.getState().swapDraftPositions('w-temp', 'w-light')).toBe(
      false,
    );
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('rejects a CROSS-ROOM swap (draft untouched)', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    const before = store.getState().draftWidgets;
    expect(store.getState().swapDraftPositions('w-temp', 'w-b')).toBe(false);
    expect(store.getState().draftWidgets).toBe(before);
  });

  it('returns false without a draft / unknown ids / the same id', () => {
    const store = createDashboardStore(file);
    expect(store.getState().swapDraftPositions('w-temp', 'w-hum')).toBe(false);
    store.getState().enterEdit('main', 'room-a');
    expect(store.getState().swapDraftPositions('w-ghost', 'w-hum')).toBe(false);
    expect(store.getState().swapDraftPositions('w-temp', 'w-temp')).toBe(false);
  });

  it('is DRAFT-LEVEL: Cancel discards the exchange and re-entry shows the persisted layout', () => {
    const store = createDashboardStore(file);
    store.getState().enterEdit('main', 'room-a');
    expect(store.getState().swapDraftPositions('w-light', 'w-fan')).toBe(true);
    expect(
      store.getState().draftWidgets!.find(w => w.id === 'w-light')!.layout,
    ).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
    // Hủy: the whole draft is discarded — never persisted.
    store.getState().cancelEdit();
    expect(store.getState().draftWidgets).toBeNull();
    // Re-entry drafts the PERSISTED layout (the exchange is gone).
    store.getState().enterEdit('main', 'room-a');
    expect(
      store.getState().draftWidgets!.find(w => w.id === 'w-light')!.layout,
    ).toEqual({
      x: 0,
      y: 1,
      width: 1,
      height: 1,
    });
    expect(
      store.getState().draftWidgets!.find(w => w.id === 'w-fan')!.layout,
    ).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
  });
});

describe('dashboardStore whole-draft replacement (cross-room draft ops)', () => {
  function makeFile(): DashboardsFile {
    const file = defaultDashboardsFile();
    // The seed now references every room — drop the bedroom reference and
    // push it back as the fresh (empty) cross-room destination fixture.
    file.templates[0]!.rooms = file.templates[0]!.rooms.filter(
      reference => reference.roomId !== 'room-bedroom',
    );
    file.templates[0]!.rooms.push({
      roomId: 'room-bedroom',
      order: 1,
      widgets: [],
    });
    return file;
  }

  it('setDraftWidgets replaces the whole draft in one atomic update', () => {
    const store = createDashboardStore(makeFile());
    store.getState().enterEdit('main', SEED_ROOM);
    const draft = store.getState().draftWidgets!;
    // Simulate the service's atomic cross-room move end-state.
    const moved = draft.find(w => w.id === 'w-temp')!;
    store
      .getState()
      .setDraftWidgets([
        ...draft.filter(w => w.id !== 'w-temp'),
        { ...moved, roomId: 'room-bedroom' },
      ]);
    const after = store.getState().draftWidgets!;
    expect(after.some(w => w.id === 'w-temp' && w.roomId === SEED_ROOM)).toBe(
      false,
    );
    expect(after.find(w => w.id === 'w-temp')!.roomId).toBe('room-bedroom');
    expect(after).toHaveLength(draft.length); // no torn intermediate state
  });

  it('setDraftWidgets is a no-op outside edit mode', () => {
    const store = createDashboardStore(makeFile());
    expect(store.getState().editMode).toBe(false);
    store.getState().setDraftWidgets([]);
    expect(store.getState().draftWidgets).toBeNull();
  });
});
