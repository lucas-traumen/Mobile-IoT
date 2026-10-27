/**
 * RoomListScreen tests — the room-card meta line (user decision
 * 2026-09-05) and the long-press drag-to-swap reorder (device-acceptance
 * rework, item E).
 *
 * `roomCardMeta` replaces the previous device-count + live-summary pair
 * with ONE line: `X cảm biến · Y thiết bị` —
 * - X: devices whose capabilities are measurement-only (no switch),
 * - Y: devices WITH a switch/relay capability (a device with both counts
 *   exactly once, as control),
 * - a zero category is omitted; zero of both keeps the neutral hint.
 * Live values are intentionally absent from the cards (they live inside
 * the room dashboard after tapping).
 *
 * Drag-to-swap tests: the pure hovered-slot resolver + swap permutation
 * are unit-tested without gestures; the component-level tests drive the
 * shell's PanResponder props directly (deterministic — no gesture
 * simulation) with the native anchor measurement mocked in
 * `./roomDragMeasure`.
 */

import React from 'react';
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestInstance,
} from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeProvider } from '@core/theme';
import { DARK_TOKENS, LIGHT_TOKENS } from '@core/theme';

import { STRINGS } from '@core/i18n';

import type { CapabilityDef, Device, Room } from '@modules/devices/api';
import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import {
  RoomListScreen,
  resolveDropTarget,
  roomCardMeta,
  swapRoomPositions,
  type DropRect,
} from './RoomListScreen';
import { OK_OUTCOME } from './ConfirmDialog';
import { measurePageOrigin } from './roomDragMeasure';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

// Deterministic anchor: the dragged card's window origin (production does
// ONE measureInWindow per drag start; tests fix the value).
jest.mock('./roomDragMeasure', () => ({
  __esModule: true,
  measurePageOrigin: jest.fn(async () => ({ x: 100, y: 200 })),
}));

const CATALOG: readonly CapabilityDef[] = [
  { type: 'temperature', label: 'Nhiệt độ', kind: 'sensor', unit: '°C' },
  { type: 'switch', label: 'Công tắc', kind: 'switch' },
];

function device(id: string, roomId: string, capabilities: string[]): Device {
  return {
    id,
    name: id,
    roomId,
    type: capabilities.includes('switch') ? 'relay' : 'sensor',
    capabilities,
    binding: capabilities.includes('switch')
      ? { kind: 'relay', index: 1 }
      : { kind: 'telemetry-sensor' },
  };
}

describe('roomCardMeta (room-card meta line)', () => {
  const devices: readonly Device[] = [
    device('s1', 'room-a', ['temperature']),
    device('s2', 'room-a', ['temperature', 'humidity']),
    device('r1', 'room-a', ['switch']),
    // A device that BOTH measures and switches counts ONCE, as control.
    device('combo', 'room-b', ['temperature', 'switch']),
    device('s3', 'room-b', ['temperature']),
  ];

  it('splits measurement-only vs switch devices: `2 cảm biến · 1 thiết bị`', () => {
    expect(roomCardMeta('room-a', devices, CATALOG)).toBe(
      `2 cảm biến · 1 thiết bị`,
    );
  });

  it('a both-capability device counts exactly once, as control', () => {
    expect(roomCardMeta('room-b', devices, CATALOG)).toBe(
      `1 cảm biến · 1 thiết bị`,
    );
  });

  it('omits a zero category (`1 thiết bị` / `3 cảm biến`)', () => {
    const onlyControl: readonly Device[] = [
      device('r1', 'room-c', ['switch']),
      device('r2', 'room-c', ['switch']),
    ];
    expect(roomCardMeta('room-c', onlyControl, CATALOG)).toBe('2 thiết bị');
    const onlySensors: readonly Device[] = [
      device('s1', 'room-d', ['temperature']),
      device('s2', 'room-d', ['humidity']),
      device('s3', 'room-d', ['temperature']),
    ];
    expect(roomCardMeta('room-d', onlySensors, CATALOG)).toBe('3 cảm biến');
  });

  it('zero of both → the neutral truthful hint', () => {
    expect(roomCardMeta('room-empty', devices, CATALOG)).toBe(
      STRINGS.templates.summaryUnknown,
    );
    // A capability-less device counts truthfully as neither.
    const capabilityLess: readonly Device[] = [device('x', 'room-e', [])];
    expect(roomCardMeta('room-e', capabilityLess, CATALOG)).toBe(
      STRINGS.templates.summaryUnknown,
    );
  });

  it('custom catalog kinds are honored (switch-kind → control)', () => {
    const custom: readonly CapabilityDef[] = [
      { type: 'temperature', label: 'Nhiệt độ', kind: 'sensor', unit: '°C' },
      { type: 'toggle', label: 'Rơ le', kind: 'switch' },
    ];
    const room: readonly Device[] = [
      device('t1', 'room-f', ['toggle']),
      device('s1', 'room-f', ['temperature']),
    ];
    expect(roomCardMeta('room-f', room, custom)).toBe(
      '1 cảm biến · 1 thiết bị',
    );
  });
});

describe('resolveDropTarget (pure hovered-slot resolution)', () => {
  // 1-column stack: two cards 300x80 with a 12 gap.
  const rects: readonly DropRect[] = [
    { roomId: 'room-a', x: 0, y: 0, width: 300, height: 80 },
    { roomId: 'room-b', x: 0, y: 92, width: 300, height: 80 },
  ];
  // 2-column row: two cards side by side.
  const wide: readonly DropRect[] = [
    { roomId: 'room-a', x: 0, y: 0, width: 160, height: 80 },
    { roomId: 'room-b', x: 172, y: 0, width: 160, height: 80 },
  ];

  it('resolves the card containing the finger (1 column)', () => {
    expect(resolveDropTarget({ x: 150, y: 40 }, rects)).toBe('room-a');
    expect(resolveDropTarget({ x: 150, y: 130 }, rects)).toBe('room-b');
  });

  it('resolves the card containing the finger (2 columns)', () => {
    expect(resolveDropTarget({ x: 80, y: 10 }, wide)).toBe('room-a');
    expect(resolveDropTarget({ x: 250, y: 60 }, wide)).toBe('room-b');
  });

  it('half-open bounds: a rect ends at x+width / y+height (exclusive)', () => {
    expect(resolveDropTarget({ x: 300, y: 40 }, rects)).toBeNull();
    expect(resolveDropTarget({ x: 150, y: 80 }, rects)).toBeNull();
    // The lower edge is exclusive, the upper inclusive.
    expect(resolveDropTarget({ x: 150, y: 92 }, rects)).toBe('room-b');
  });

  it('finger outside every slot → null (gap, past the list, add-card area)', () => {
    expect(resolveDropTarget({ x: 150, y: 86 }, rects)).toBeNull();
    expect(resolveDropTarget({ x: 150, y: 300 }, rects)).toBeNull();
    expect(resolveDropTarget({ x: -1, y: 40 }, rects)).toBeNull();
  });
});

describe('swapRoomPositions (pure swap permutation)', () => {
  it('swaps the two positions (permutation, not insert)', () => {
    expect(swapRoomPositions(['a', 'b', 'c'], 'a', 'c')).toEqual([
      'c',
      'b',
      'a',
    ]);
    // Symmetric: dragging b onto a gives the same permutation as a onto b.
    expect(swapRoomPositions(['a', 'b'], 'b', 'a')).toEqual(['b', 'a']);
  });

  it('returns the ORIGINAL reference for impossible swaps (cheap change detection)', () => {
    const ids = ['a', 'b'];
    expect(swapRoomPositions(ids, 'a', 'a')).toBe(ids);
    expect(swapRoomPositions(ids, 'a', 'ghost')).toBe(ids);
    expect(swapRoomPositions(ids, 'ghost', 'b')).toBe(ids);
  });
});

describe('RoomListScreen drag-to-swap (component level)', () => {
  const rooms: readonly Room[] = [
    { id: 'room-a', name: 'Phòng A', order: 0 },
    { id: 'room-b', name: 'Phòng B', order: 1 },
  ];
  const template: DashboardTemplate = {
    id: 'tpl-1',
    name: 'Nhà tôi',
    updatedAt: 55,
    rooms: [
      { roomId: 'room-a', order: 0, widgets: [] },
      { roomId: 'room-b', order: 1, widgets: [] },
    ],
  };

  interface Harness {
    readonly renderer: ReactTestRenderer;
    readonly onOpenRoom: jest.Mock;
    readonly onReorder: jest.Mock;
  }

  const renderScreen = async (
    templateOverride?: DashboardTemplate,
    onReorderOverride?: jest.Mock,
  ): Promise<Harness> => {
    const onOpenRoom = jest.fn();
    const onReorder = onReorderOverride ?? jest.fn(async () => OK_OUTCOME);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ThemeProvider mode="light">
          <RoomListScreen
            template={templateOverride ?? template}
            allTemplates={[template]}
            rooms={rooms}
            devices={[]}
            capabilities={[]}
            onBack={jest.fn()}
            onOpenRoom={onOpenRoom}
            onAddRoom={jest.fn()}
            onRenameRoom={jest.fn(async () => OK_OUTCOME)}
            onDuplicateRoom={jest.fn(async () => OK_OUTCOME)}
            onReorder={onReorder}
            onRemoveRoom={jest.fn(async () => OK_OUTCOME)}
          />
        </ThemeProvider>,
      );
    });
    // Report the fabricated 1-column layout rects (onLayout, grid-relative)
    // for every room the rendered Template actually references.
    const active = templateOverride ?? template;
    const layouts: Readonly<Record<string, { x: number; y: number }>> = {
      'room-a': { x: 0, y: 0 },
      'room-b': { x: 0, y: 92 },
    };
    for (const reference of active.rooms) {
      const position = layouts[reference.roomId];
      const shell = renderer.root.findByProps({
        testID: `room-drag-${reference.roomId}`,
      });
      await act(async () => {
        shell.props.onLayout({
          nativeEvent: { layout: { ...position, width: 300, height: 80 } },
        });
      });
    }
    return { renderer, onOpenRoom, onReorder };
  };

  /**
   * A minimal PanResponder-compatible event (same recipe as the
   * DashboardGrid drag tests): `touchHistory` for the gestureState
   * extraction plus the `nativeEvent` page position our handlers read.
   */
  function panEvent(pageX: number, pageY: number, timestamp: number) {
    return {
      nativeEvent: { pageX, pageY },
      touchHistory: {
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: timestamp,
        touchBank: [
          {
            touchActive: true,
            startPageX: 0,
            startPageY: 0,
            // The PREVIOUS position — PanResponder accumulates dx as
            // (current − previous) centroid of touches changed after the
            // last accounted timestamp.
            previousPageX: 0,
            previousPageY: 0,
            currentPageX: pageX,
            currentPageY: pageY,
            currentTimeStamp: timestamp,
          },
        ],
      },
    };
  }

  const dragTo = async (
    harness: Harness,
    sourceRoomId: string,
    targetPage: { readonly x: number; readonly y: number } | null,
    endWith: 'release' | 'cancel',
  ): Promise<void> => {
    // Long-press lifts the card (anchor measurement mocked to (100, 200)).
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: `room-card-${sourceRoomId}` })
        .props.onLongPress();
    });
    if (targetPage !== null) {
      // origin = cardPage(100,200) − cardLayout(0,92 for room-b) etc.; the
      // finger arrives in window space via the captured move stream.
      await act(async () => {
        harness.renderer.root
          .findByProps({ testID: `room-drag-${sourceRoomId}` })
          .props.onResponderMove(panEvent(targetPage.x, targetPage.y, 2));
      });
    }
    await act(async () => {
      const shell = harness.renderer.root.findByProps({
        testID: `room-drag-${sourceRoomId}`,
      });
      if (endWith === 'release') {
        shell.props.onResponderRelease(panEvent(0, 0, 3));
      } else {
        shell.props.onResponderTerminate();
      }
    });
  };

  afterEach(() => {
    (measurePageOrigin as jest.Mock).mockClear();
    (measurePageOrigin as jest.Mock).mockImplementation?.(async () => ({
      x: 100,
      y: 200,
    }));
  });

  it('long-press + release WITHOUT movement clears the drag state (no stranding, no persist)', async () => {
    const harness = await renderScreen();
    // Long-press lifts the card (measurement resolves immediately).
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onLongPress();
    });
    // Lifted: the other card shows the droppable affordance.
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-ready-room-a',
      }).length,
    ).toBeGreaterThan(0);
    // The touch ends WITHOUT the outer responder ever claiming the move
    // stream (no >2px move) → the inner Pressable's pressOut is the only
    // touch-end signal → the session must cancel deterministically.
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onPressOut();
    });
    // Exact pre-lift state: no droppable affordances, no hover highlights…
    expect(
      harness.renderer.root.findAllByProps({ testID: 'room-drop-ready-room-a' })
        .length,
    ).toBe(0);
    expect(
      harness.renderer.root.findAllByProps({ testID: 'room-drop-ready-room-b' })
        .length,
    ).toBe(0);
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-hover-room-a',
      }),
    ).toHaveLength(0);
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-hover-room-b',
      }),
    ).toHaveLength(0);
    // …and NOTHING persisted.
    expect(harness.onReorder).not.toHaveBeenCalled();
    // The screen still works: a plain tap opens the room.
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-a' })
        .props.onPress();
    });
    expect(harness.onOpenRoom).toHaveBeenCalledWith('room-a');
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('system termination BEFORE the outer responder claims → snap back, no persistence', async () => {
    const harness = await renderScreen();
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onLongPress();
    });
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-ready-room-a',
      }).length,
    ).toBeGreaterThan(0);
    // A pre-capture termination surfaces as the inner Pressable's pressOut
    // (RN dispatches pressOut on responder termination) — the same
    // unclaimed-exit path; the outer's terminate handler cannot run
    // because it never became the responder.
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onPressOut();
    });
    expect(
      harness.renderer.root.findAllByProps({ testID: 'room-drop-ready-room-a' })
        .length,
    ).toBe(0);
    expect(harness.onReorder).not.toHaveBeenCalled();
    expect(harness.onOpenRoom).not.toHaveBeenCalled();
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('a DEFERRED anchor measurement cannot start a stale drag after the touch ended', async () => {
    let resolveMeasure:
      | ((point: { readonly x: number; readonly y: number }) => void)
      | null = null;
    (measurePageOrigin as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveMeasure = point => resolve(point);
        }),
    );
    const harness = await renderScreen();
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onLongPress();
    });
    // The measurement is still pending: NO drag state was rendered yet.
    expect(
      harness.renderer.root.findAllByProps({ testID: 'room-drop-ready-room-a' })
        .length,
    ).toBe(0);
    // The touch ends while pending (no-move release) → the pending lift
    // is invalidated (generation bumped).
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onPressOut();
    });
    // The LATE resolution must be a no-op: no drag may start after the
    // touch has ended.
    await act(async () => {
      resolveMeasure?.({ x: 100, y: 200 });
    });
    expect(
      harness.renderer.root.findAllByProps({ testID: 'room-drop-ready-room-a' })
        .length,
    ).toBe(0);
    expect(
      harness.renderer.root.findAllByProps({ testID: 'room-drop-ready-room-b' })
        .length,
    ).toBe(0);
    expect(harness.onReorder).not.toHaveBeenCalled();
    // The system is not wedged: a fresh long-press drag still works.
    await dragTo(harness, 'room-b', { x: 150, y: 180 }, 'release');
    expect(harness.onReorder).toHaveBeenCalledWith(['room-b', 'room-a']);
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('onReorder FAILURE shows the error banner and applies no visual reorder', async () => {
    const failing = jest.fn(async () => ({
      ok: false as const,
      message: 'Không lưu được thứ tự phòng',
    }));
    const harness = await renderScreen(undefined, failing);
    // Drag room-b onto room-a (the swap persists only on success).
    await dragTo(harness, 'room-b', { x: 150, y: 180 }, 'release');
    expect(failing).toHaveBeenCalledWith(['room-b', 'room-a']);
    // The error banner renders the service message (top-of-screen banner).
    const allText = harness.renderer.root
      .findAll(
        node =>
          typeof node.props?.children === 'string' &&
          node.props.children.length > 0,
      )
      .map(node => node.props.children as string)
      .join('\n');
    expect(allText).toContain('Không lưu được thứ tự phòng');
    // The visual order is untouched (renders from the Template): room-a
    // card is still the FIRST room card in the tree.
    const cards = harness.renderer.root.findAll(
      node =>
        typeof node.props?.testID === 'string' &&
        node.props.testID.startsWith('room-card-room-'),
    );
    expect(cards[0]!.props.testID).toBe('room-card-room-a');
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('drop on another card calls onReorder with the SWAPPED permutation', async () => {
    const harness = await renderScreen();
    // Drag room-b onto room-a: page (150,180) → grid (50,72) = room-a.
    await dragTo(harness, 'room-b', { x: 150, y: 180 }, 'release');
    expect(harness.onReorder).toHaveBeenCalledTimes(1);
    expect(harness.onReorder).toHaveBeenCalledWith(['room-b', 'room-a']);
    // The lift/drag never triggered a plain open.
    expect(harness.onOpenRoom).not.toHaveBeenCalled();
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('the hovered slot shows the drop highlight, the other card shows the droppable affordance', async () => {
    const harness = await renderScreen();
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onLongPress();
    });
    // Move over room-a: page (150,180) → grid (50,72) → hovered room-a.
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-drag-room-b' })
        .props.onResponderMove(panEvent(150, 180, 2));
    });
    // The hovered slot carries the drop highlight; the dragged card and
    // the hovered card itself show no extra droppable affordance.
    expect(
      harness.renderer.root.findByProps({
        testID: 'room-drop-hover-room-a',
      }),
    ).toBeTruthy();
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-ready-room-a',
      }),
    ).toHaveLength(0);
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-ready-room-b',
      }),
    ).toHaveLength(0);
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('release NOT on a card (outside) does NOT call onReorder', async () => {
    const harness = await renderScreen();
    // Page (2000, 2000) → grid (1900, 1892) — outside every slot.
    await dragTo(harness, 'room-b', { x: 2000, y: 2000 }, 'release');
    expect(harness.onReorder).not.toHaveBeenCalled();
    expect(harness.onOpenRoom).not.toHaveBeenCalled();
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('a terminated gesture (system cancel) never persists', async () => {
    const harness = await renderScreen();
    await dragTo(harness, 'room-b', { x: 150, y: 180 }, 'cancel');
    expect(harness.onReorder).not.toHaveBeenCalled();
    expect(harness.onOpenRoom).not.toHaveBeenCalled();
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('the "+ Thêm phòng" card is not a droppable slot', async () => {
    const harness = await renderScreen();
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-b' })
        .props.onLongPress();
    });
    // Finger over the add-card area (below the two slots): grid y = 200.
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-drag-room-b' })
        .props.onResponderMove(panEvent(150, 308, 2));
    });
    // No slot is hovered over the add-card area — and the add card carries
    // no drag machinery at all.
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-hover-room-a',
      }),
    ).toHaveLength(0);
    expect(
      harness.renderer.root.findAllByProps({
        testID: 'room-drop-hover-room-b',
      }),
    ).toHaveLength(0);
    // The add card carries no drag machinery at all.
    expect(
      harness.renderer.root.findAllByProps({ testID: 'room-drag-room-add' })
        .length,
    ).toBe(0);
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('a long-press does NOT open the room; a plain tap still does', async () => {
    const harness = await renderScreen();
    // Long-press + move over the other card + release → no open.
    await dragTo(harness, 'room-b', { x: 150, y: 180 }, 'release');
    expect(harness.onOpenRoom).not.toHaveBeenCalled();
    // Plain tap → open.
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-a' })
        .props.onPress();
    });
    expect(harness.onOpenRoom).toHaveBeenCalledWith('room-a');
    await act(async () => {
      harness.renderer.unmount();
    });
  });

  it('a single-room Template has nothing to swap: the lift is a no-op', async () => {
    const single: DashboardTemplate = {
      id: 'tpl-1',
      name: 'Nhà tôi',
      updatedAt: 55,
      rooms: [{ roomId: 'room-a', order: 0, widgets: [] }],
    };
    const harness = await renderScreen(single);
    await act(async () => {
      harness.renderer.root
        .findByProps({ testID: 'room-card-room-a' })
        .props.onLongPress();
    });
    expect(measurePageOrigin).not.toHaveBeenCalled();
    await act(async () => {
      harness.renderer.unmount();
    });
  });
});

describe('RoomListScreen smart visual language (settings-smart-home-sync)', () => {
  const rooms: readonly Room[] = [
    { id: 'room-a', name: 'Phòng A', order: 0 },
    { id: 'room-b', name: 'Phòng B', order: 1 },
  ];
  const template: DashboardTemplate = {
    id: 'tpl-1',
    name: 'Nhà tôi',
    updatedAt: 55,
    rooms: [
      { roomId: 'room-a', order: 0, widgets: [] },
      { roomId: 'room-b', order: 1, widgets: [] },
    ],
  };

  /** Views whose flattened style carries ALL the given style entries. */
  function viewsWithStyle(
    root: ReactTestRenderer['root'],
    match: Record<string, unknown>,
  ): ReactTestInstance[] {
    return root.findAllByType(View).filter(view => {
      if (!view.props.style) {
        return false;
      }
      const flat = StyleSheet.flatten(view.props.style as never) as Record<
        string,
        unknown
      >;
      if (!flat) {
        return false;
      }
      return Object.entries(match).every(([key, value]) => flat[key] === value);
    });
  }

  it('renders the ambient wash in light AND dark (tealTint → page → amberTint)', async () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider mode={mode}>
            <RoomListScreen
              template={template}
              allTemplates={[template]}
              rooms={rooms}
              devices={[]}
              capabilities={[]}
              onBack={jest.fn()}
              onOpenRoom={jest.fn()}
              onAddRoom={jest.fn()}
              onRenameRoom={jest.fn(async () => OK_OUTCOME)}
              onDuplicateRoom={jest.fn(async () => OK_OUTCOME)}
              onReorder={jest.fn(async () => OK_OUTCOME)}
              onRemoveRoom={jest.fn(async () => OK_OUTCOME)}
            />
          </ThemeProvider>,
        );
      });
      const gradient = renderer.root.findByType(LinearGradient);
      expect(gradient.props.colors).toEqual([
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]);
      expect(gradient.props.start).toEqual({ x: 0, y: 0 });
      expect(gradient.props.end).toEqual({ x: 1, y: 1 });
      // Smart room cards: card surface + hairline border + token radius.
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
          borderRadius: tokens.smart.radius.card,
        }).length,
      ).toBeGreaterThanOrEqual(2);
      await act(async () => {
        renderer.unmount();
      });
    }
  });
});

describe('RoomListScreen 44pt touch targets (dashboard-history-board-touch-share)', () => {
  it('the back button and the room-card ⋯ menu carry explicit ≥44×44 hit bounds', async () => {
    // Self-contained render (same shape as the drag-to-swap harness): one
    // template with two room references, 1-column layout rects reported.
    const template: DashboardTemplate = {
      id: 'tpl-main',
      name: 'Nhà',
      updatedAt: 0,
      rooms: [
        { roomId: 'room-a', order: 0, widgets: [] },
        { roomId: 'room-b', order: 1, widgets: [] },
      ],
    };
    const rooms: readonly Room[] = [
      { id: 'room-a', name: 'Phòng A', order: 0 },
      { id: 'room-b', name: 'Phòng B', order: 1 },
    ];
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ThemeProvider mode="light">
          <RoomListScreen
            template={template}
            allTemplates={[template]}
            rooms={rooms}
            devices={[]}
            capabilities={[]}
            onBack={jest.fn()}
            onOpenRoom={jest.fn()}
            onAddRoom={jest.fn()}
            onRenameRoom={jest.fn(async () => OK_OUTCOME)}
            onDuplicateRoom={jest.fn(async () => OK_OUTCOME)}
            onReorder={jest.fn(async () => OK_OUTCOME)}
            onRemoveRoom={jest.fn(async () => OK_OUTCOME)}
          />
        </ThemeProvider>,
      );
    });
    for (const reference of template.rooms) {
      const shell = renderer.root.findByProps({
        testID: `room-drag-${reference.roomId}`,
      });
      await act(async () => {
        shell.props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 80 } },
        });
      });
    }
    const back = renderer.root.findByProps({ testID: 'room-list-back' });
    const backFlat = StyleSheet.flatten(back.props.style as never) as Record<
      string,
      unknown
    >;
    expect(typeof backFlat.minWidth).toBe('number');
    expect(backFlat.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof backFlat.minHeight).toBe('number');
    expect(backFlat.minHeight as number).toBeGreaterThanOrEqual(44);

    const menu = renderer.root.findByProps({ testID: 'room-menu-room-a' });
    const menuFlat = StyleSheet.flatten(menu.props.style as never) as Record<
      string,
      unknown
    >;
    expect(typeof menuFlat.minWidth).toBe('number');
    expect(menuFlat.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof menuFlat.minHeight).toBe('number');
    expect(menuFlat.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});
