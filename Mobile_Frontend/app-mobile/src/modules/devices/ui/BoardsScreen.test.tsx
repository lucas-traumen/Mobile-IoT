/**
 * BoardsScreen tests (board-discovery-binding plan, acceptance 4;
 * boards-card-layout-search rework: title fallback, chips/badges, offline
 * stale note, search filter, footer action sheet).
 *
 * Verifies the render contract through the public props + rendered tree:
 * - one gel card per discovered board with the `Board {code}` title
 *   fallback (AD-1), the status chip (online/seen/offline), one chip per
 *   sensor channel (catalog labels) and the compressed relay badge;
 * - the footer is TWO stacked regions (boards-reassign-layout-remove-
 *   sharing): the room status line (`Phòng: {tên}` for a bound board, the
 *   tappable `Chưa gán phòng — nhấn để gán` hint for a free one) lives in
 *   its own constrained region (one line, ellipsized — a long room name
 *   never displaces the controls), then a stable action row with the
 *   ≥44pt PRIMARY `Gán vào phòng` / `Đổi phòng` button (opens the SAME
 *   confirm dialog DIRECTLY — the unassigned hint does too, no dead-end
 *   sheet detour) + the ≥44×44 `⋯` menu; the action sheet routes WiFi
 *   setup and delete for every board — BOTH board
 *   share rows are REMOVED and `Share.share` is never invoked; assign
 *   failure keeps the dialog open with the error; the delete action
 *   confirms through `onDeleteBoard`;
 * - the search bar filters boards realtime (pure `filterBoardsByQuery`,
 *   filtered BEFORE the online-first sort) with a no-results hint;
 * - the empty state guides the user when no board was discovered;
 * - the QR scanner flow (boards-qr-scan): the scan button (search row AND
 *   empty state, same testID) opens the `BoardsScannerModal` (expo-camera
 *   mocked — a CameraView stub forwards `onBarcodeScanned` so tests drive
 *   the scan through the AD-5 `onScanned` seam): an invalid payload keeps
 *   the camera open with the inline error and RE-ARMS the lock (AD-3 fix
 *   cycle 1 — the camera stays live for the immediate re-scan) and shows
 *   the truncated RAW payload (diagnostic, fix: live debugging — what the
 *   camera actually delivered), a valid
 *   discovered board closes the modal and highlights the card (teal ring,
 *   ~2s auto-clear, AD-6), a hidden board clears the search query first,
 *   an unknown board opens the not-found sheet, permission denial renders
 *   the hint, and the single-scan lock still prevents double-processing
 *   within one open session (AD-4 fix cycle 1 re-pin);
 * - display-by-type convention (boards-display-by-type, Layer 4): the
 *   TITLE is the descriptor boardType (displayName is display-deprecated —
 *   pinned ignored even when present), the wire code shows as the labeled
 *   `Id: {code}` mono line on descriptor boards ONLY (absent for
 *   descriptor-less boards, whose fallback title already carries the
 *   code), no separate boardType badge remains (the `boards-type-{code}`
 *   testID re-homed onto the title Text), the thumbnail keys by the TYPE
 *   slug (one image per type; a descriptor-less board never keys an
 *   image) and the not-found sheet shows the QR boardType's bundled photo
 *   when the map has it (placeholder otherwise); the L1–L4 layout pins
 *   survive structurally (row-wrap chip container, one-line ellipsized
 *   TITLE, footer hairline, placeholder frame) — never pixels.
 */

import React from 'react';
import {
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Camera } from 'expo-camera';

import { STRINGS } from '@core/i18n';
import { LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import type {
  BoardInventoryEntry,
  CapabilityDef,
  Room,
} from '@modules/devices/api';

import {
  BoardsScreen,
  deriveBrokerAddress,
  filterBoardsByQuery,
  sortBoardsOnlineFirst,
  type BoardActionOutcome,
} from './BoardsScreen';
import * as BoardsScreenModule from './BoardsScreen';
import { BOARD_IMAGES, boardImageFor, slugifyBoardName } from './boardImages';
import type {
  BleScanProblem,
  BleScannedBoard,
  BleWifiProvisioningServiceLike,
} from '../internal/services/bleWifiProvisioningService';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Mutable Platform.OS seam (boards-ble-wifi-provisioning, AD-7): the BLE
 * sheet button is gated on `Platform.OS !== 'web'` — tests flip this seam
 * between 'ios' (native) and 'web'. The react-native module is wrapped in
 * a Proxy so only `Platform.OS` is dynamic (a spread-based mock eagerly
 * evaluates RN internals and crashes jest-expo's setup).
 */
let mockPlatformOS = 'ios';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as Record<
    PropertyKey,
    unknown
  >;
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'Platform') {
        return {
          ...(target.Platform as Record<string, unknown>),
          get OS() {
            return mockPlatformOS;
          },
        };
      }
      return target[prop];
    },
  });
});

/**
 * AsyncStorage stub: BoardsScreen's BLE wiring statically imports the
 * provisioning service (web-safe at import time), whose `lastSsid`
 * persistence would otherwise load the native AsyncStorage module. The
 * fake service injected into every render never calls it — the stub only
 * keeps the module import loadable (same mock as the repository tests).
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

/**
 * expo-camera mock (boards-qr-scan): the CameraView stub renders a
 * placeholder node that CARRIES the `onBarcodeScanned` prop — tests invoke
 * it to simulate a scan. `Camera.requestCameraPermissionsAsync` is a
 * jest.fn resolving granted by default; individual tests override it for
 * the denied variant. The factory is fully self-contained (jest.mock
 * hoisting forbids out-of-scope value references).
 */
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    CameraView: (props: {
      onBarcodeScanned?: (event: {
        readonly data: string;
        readonly type: string;
      }) => void;
    }) =>
      React.createElement('View', {
        testID: 'boards-scanner-camera',
        onBarcodeScanned: props.onBarcodeScanned,
      }),
    Camera: {
      requestCameraPermissionsAsync: jest.fn(async () => ({
        granted: true,
        status: 'granted',
        canAskAgain: true,
        expires: 'never',
      })),
    },
  };
});

describe('sortBoardsOnlineFirst (pick-list order, fix cycle 2 pin)', () => {
  it('orders online → seen → offline, stable within groups', () => {
    const input: readonly BoardInventoryEntry[] = [
      { code: 'z-off', status: 'offline' },
      { code: 'b-seen', status: 'seen' },
      { code: 'm-on', status: 'online' },
      { code: 'a-on', status: 'online' },
      { code: 'a-seen', status: 'seen' },
      { code: 'k-off', status: 'offline' },
    ];

    expect(sortBoardsOnlineFirst(input).map(board => board.code)).toEqual([
      // Online first (code order within the group).
      'a-on',
      'm-on',
      // Then seen.
      'a-seen',
      'b-seen',
      // Offline last.
      'k-off',
      'z-off',
    ]);
    // Pure: the input array is not mutated.
    expect(input.map(board => board.code)).toEqual([
      'z-off',
      'b-seen',
      'm-on',
      'a-on',
      'a-seen',
      'k-off',
    ]);
  });
});

const ROOMS: readonly Room[] = [
  { id: 'room-a', name: 'Phòng khách', order: 0, code: 'board-1' },
  { id: 'room-b', name: 'Phòng ngủ', order: 1 },
];

const CAPABILITIES: readonly CapabilityDef[] = [
  { type: 'temperature', label: 'Nhiệt độ', kind: 'sensor' },
  { type: 'humidity', label: 'Độ ẩm', kind: 'sensor' },
];

const BOARDS: readonly BoardInventoryEntry[] = [
  {
    code: 'board-1',
    status: 'online',
    descriptor: {
      boardType: 'esp32-sensor-relay',
      sensors: [
        { channel: 'S1', field: 'temperature', unit: '°C' },
        { channel: 'S2', field: 'humidity' },
      ],
      relays: ['K1', 'K2'],
    },
  },
  {
    code: 'board-2',
    status: 'seen',
    descriptor: {
      boardType: 'esp32-relay',
      sensors: [],
      relays: ['K1', 'K3'],
    },
  },
  { code: 'board-3', status: 'offline' },
];

/** Default boards fixture: a bound board with a full descriptor. */
const BOUND_BOARD: BoardInventoryEntry = {
  code: 'board-1',
  status: 'online',
  descriptor: {
    boardType: 'esp32-sensor-relay',
    sensors: [{ channel: 'S1', field: 'temperature', unit: '°C' }],
    relays: ['K1'],
  },
};

/** Renderers still mounted (unmounted in afterEach — teardown hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

/**
 * BLE provisioning service fake (boards-ble-wifi-provisioning): captures
 * the scan callbacks so tests deliver advertisements/problems directly.
 * Production constructs the real service; tests ALWAYS inject a fake —
 * the BLE stack is never constructed under Jest.
 */
function makeBleServiceFake() {
  let onFound: ((board: BleScannedBoard) => void) | null = null;
  let onProblem: ((problem: BleScanProblem) => void) | null = null;
  const service: BleWifiProvisioningServiceLike = {
    startScan: jest.fn(
      (
        found: (board: BleScannedBoard) => void,
        problem?: (scanProblem: BleScanProblem) => void,
      ) => {
        onFound = found;
        onProblem = problem ?? null;
        return { stop: () => undefined };
      },
    ),
    provision: jest.fn(async () => undefined),
    loadLastSsid: jest.fn(async () => null),
    saveLastSsid: jest.fn(async () => undefined),
  };
  return {
    service,
    deliver: (board: BleScannedBoard) => onFound?.(board),
    fail: (problem: BleScanProblem) => onProblem?.(problem),
  };
}

async function renderScreen(
  props: {
    boards?: readonly BoardInventoryEntry[];
    rooms?: readonly Room[];
    onAssignBoard?: (
      code: string,
      roomId: string,
    ) => Promise<BoardActionOutcome>;
    onDeleteBoard?: (code: string) => Promise<BoardActionOutcome>;
    onRestoreBoard?: (
      code: string,
      boardType?: string,
    ) => Promise<BoardActionOutcome>;
    deletedBoardCodes?: readonly string[];
    bleProvisioningService?: BleWifiProvisioningServiceLike;
  } = {},
  mode: 'light' | 'dark' = 'light',
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <BoardsScreen
          onBack={() => undefined}
          boards={props.boards ?? BOARDS}
          rooms={props.rooms ?? ROOMS}
          capabilities={CAPABILITIES}
          onAssignBoard={
            props.onAssignBoard ?? (async () => ({ ok: true, message: '' }))
          }
          onDeleteBoard={
            props.onDeleteBoard ?? (async () => ({ ok: true, message: '' }))
          }
          onRestoreBoard={
            props.onRestoreBoard ?? (async () => ({ ok: true, message: '' }))
          }
          deletedBoardCodes={props.deletedBoardCodes ?? []}
          bleProvisioningService={
            props.bleProvisioningService ?? makeBleServiceFake().service
          }
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return renderer;
}

afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
});

async function press(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): Promise<void> {
  const nodes = renderer.root
    .findAllByProps({ testID })
    .filter(node => typeof node.props.onPress === 'function');
  if (nodes.length === 0) {
    throw new Error(`No pressable node for testID "${testID}"`);
  }
  await act(async () => {
    nodes[0]!.props.onPress();
  });
}

async function typeInput(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
  value: string,
): Promise<void> {
  const input = renderer.root.findByProps({ testID });
  await act(async () => {
    input.props.onChangeText(value);
  });
}

function exists(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

/** All visible text of the renderer (flattening nested Text children). */
function visibleText(renderer: TestRenderer.ReactTestRenderer): string {
  const texts: string[] = [];
  const walk = (node: { props?: { children?: unknown } }) => {
    const children = node.props?.children;
    if (typeof children === 'string') {
      texts.push(children);
    } else if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child === 'string') {
          texts.push(child);
        } else if (child && typeof child === 'object') {
          walk(child as { props?: { children?: unknown } });
        }
      }
    } else if (children && typeof children === 'object') {
      walk(children as { props?: { children?: unknown } });
    }
  };
  for (const textNode of renderer.root.findAllByType(Text)) {
    walk(textNode as never);
  }
  return texts.join('\n');
}

describe('BoardsScreen (board cards)', () => {
  it('renders one card per board with the descriptor body + status chip', async () => {
    const renderer = await renderScreen();

    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    expect(exists(renderer, 'boards-card-board-2')).toBe(true);
    expect(exists(renderer, 'boards-card-board-3')).toBe(true);
    expect(exists(renderer, 'boards-status-board-1')).toBe(true);
    expect(exists(renderer, 'boards-status-board-2')).toBe(true);
    expect(exists(renderer, 'boards-status-board-3')).toBe(true);

    const text = visibleText(renderer);
    // Descriptor body (AD-2/3): the boardType TITLE, one chip per sensor
    // channel (catalog label, raw-field fallback) and the compressed
    // relay badge.
    expect(text).toContain('esp32-sensor-relay');
    expect(text).toContain('S1 · Nhiệt độ');
    expect(text).toContain('S2 · Độ ẩm');
    expect(text).toContain('K1–K2');
    // board-2 declares no sensors → the honest no-data hint; non-contiguous
    // relay channels stay a comma list.
    expect(exists(renderer, 'boards-type-board-2')).toBe(true);
    expect(visibleText(renderer)).toContain('Chưa có dữ liệu đo');
    expect(text).toContain('K1, K3');
    // Status chips use the STRINGS labels (no hardcoded text).
    expect(text).toContain('Online');
    expect(text).toContain('Đã thấy descriptor');
    expect(text).toContain('Offline');
  });

  it('renders the honest no-descriptor hint for a board without one', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'board-x', status: 'online' }],
    });

    expect(exists(renderer, 'boards-nodescriptor-board-x')).toBe(true);
    expect(exists(renderer, 'boards-type-board-x')).toBe(false);
  });

  it('uses the boardType as the title even when the descriptor HAS a displayName (display-deprecated, AD-3)', async () => {
    const renderer = await renderScreen({
      boards: [
        {
          code: 'board-9',
          status: 'online',
          descriptor: {
            boardType: 'IoT_ESP32-S2R3',
            sensors: [],
            relays: [],
            displayName: 'Tên đặt riêng',
          },
        },
      ],
    });
    const text = visibleText(renderer);
    // The boardType IS the title — every board of the same type displays
    // identically. The displayName is pure metadata and is NEVER shown,
    // even though the descriptor carries it (AD-3).
    expect(text).toContain('IoT_ESP32-S2R3');
    expect(text).not.toContain('Tên đặt riêng');
    // The code shows as the labeled mono line (boards-display-by-type
    // AD-2 — `Id: {code}` straight from STRINGS).
    expect(text).toContain(STRINGS.boards.idLabel.replace('{code}', 'board-9'));
  });

  it('shows the bound room for a bound board and Chưa gán phòng otherwise', async () => {
    const renderer = await renderScreen();
    const text = visibleText(renderer);

    expect(text).toContain('Phòng: Phòng khách');
    expect(text).toContain('Chưa gán phòng');
    // AD-2: the assign/unassign actions moved behind the footer ⋯ menu —
    // no inline links anymore (the per-state action counts are pinned in
    // the footer action sheet describe below).
    expect(exists(renderer, 'boards-assign-board-1')).toBe(false);
    expect(exists(renderer, 'boards-unassign-board-1')).toBe(false);
    expect(exists(renderer, 'boards-card-menu-board-1')).toBe(true);
  });

  it('renders the empty state when no board was discovered', async () => {
    const renderer = await renderScreen({ boards: [] });

    expect(exists(renderer, 'boards-empty')).toBe(true);
    expect(exists(renderer, 'boards-card-board-1')).toBe(false);
  });

  it('renders the smart wash in light AND dark (token discipline)', async () => {
    for (const mode of ['light', 'dark'] as const) {
      const renderer = await renderScreen({}, mode);
      expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    }
  });
});

describe('BoardsScreen (binding actions, ConfirmDialog pattern)', () => {
  it('assign flow: open the sheet, pick a room, confirm through onAssignBoard', async () => {
    const assignments: { code: string; roomId: string }[] = [];
    const renderer = await renderScreen({
      rooms: [
        { id: 'room-b', name: 'Phòng ngủ', order: 1 },
        { id: 'room-c', name: 'Nhà bếp', order: 2 },
      ],
      boards: [{ code: 'board-2', status: 'online' }],
      onAssignBoard: async (code, roomId) => {
        assignments.push({ code, roomId });
        return { ok: true, message: '' };
      },
    });

    // dashboard-history-board-touch-share: the assign flow lives on the
    // footer's PRIMARY button — it opens the confirm dialog directly.
    await press(renderer, 'boards-footer-assign-board-2');
    // The confirm dialog is open with both candidate rooms.
    expect(exists(renderer, 'boards-assign-target-room-b')).toBe(true);
    expect(exists(renderer, 'boards-assign-target-room-c')).toBe(true);
    await press(renderer, 'boards-assign-target-room-b');
    await press(renderer, 'boards-assign-confirm');

    expect(assignments).toEqual([{ code: 'board-2', roomId: 'room-b' }]);
    // Success closes the dialog.
    expect(
      renderer.root
        .findAllByType(Modal)
        .find(node => node.props.visible === true),
    ).toBeUndefined();
  });

  it('a FAILED assign keeps the dialog open and surfaces the error', async () => {
    const renderer = await renderScreen({
      rooms: [{ id: 'room-b', name: 'Phòng ngủ', order: 1 }],
      boards: [{ code: 'board-2', status: 'online' }],
      onAssignBoard: async () => ({
        ok: false,
        message: 'Mã này đã được gán cho phòng khác.',
      }),
    });

    await press(renderer, 'boards-footer-assign-board-2');
    await press(renderer, 'boards-assign-target-room-b');
    await press(renderer, 'boards-assign-confirm');

    // The dialog stays open (modal still visible) with the error inside.
    const openModal = renderer.root
      .findAllByType(Modal)
      .find(node => node.props.visible === true);
    expect(openModal).toBeDefined();
    expect(visibleText(renderer)).toContain(
      'Mã này đã được gán cho phòng khác.',
    );
  });

  it('delete flow opens through the sheet and confirms through onDeleteBoard', async () => {
    const deleted: string[] = [];
    const renderer = await renderScreen({
      onDeleteBoard: async code => {
        deleted.push(code);
        return { ok: true, message: '' };
      },
    });

    await press(renderer, 'boards-card-menu-board-1');
    await press(renderer, 'boards-sheet-delete-board-1');
    await press(renderer, 'boards-delete-confirm');

    expect(deleted).toEqual(['board-1']);
  });

  it('requires confirmation before deleting an unassigned board', async () => {
    const deleteBoard = jest.fn(async () => ({ ok: true, message: '' }));
    const renderer = await renderScreen({
      boards: [{ code: 'board-2', status: 'offline' }],
      onDeleteBoard: deleteBoard,
    });

    await press(renderer, 'boards-card-menu-board-2');
    await press(renderer, 'boards-sheet-delete-board-2');
    expect(deleteBoard).not.toHaveBeenCalled();
    expect(visibleText(renderer)).toContain(
      STRINGS.boards.deleteConfirm.replace('{code}', 'board-2'),
    );
    await press(renderer, 'boards-delete-cancel');
    expect(deleteBoard).not.toHaveBeenCalled();

    await press(renderer, 'boards-card-menu-board-2');
    await press(renderer, 'boards-sheet-delete-board-2');
    await press(renderer, 'boards-delete-confirm');
    expect(deleteBoard).toHaveBeenCalledWith('board-2');
    expect(
      renderer.root.findAllByType(Modal).some(node => node.props.visible),
    ).toBe(false);
  });

  it('keeps a failed deletion open and allows retrying', async () => {
    const deleteBoard = jest
      .fn<Promise<BoardActionOutcome>, [string]>()
      .mockResolvedValueOnce({ ok: false, message: 'Không thể lưu thay đổi.' })
      .mockResolvedValueOnce({ ok: true, message: '' });
    const renderer = await renderScreen({ onDeleteBoard: deleteBoard });

    await press(renderer, 'boards-card-menu-board-1');
    await press(renderer, 'boards-sheet-delete-board-1');
    await press(renderer, 'boards-delete-confirm');
    expect(visibleText(renderer)).toContain('Không thể lưu thay đổi.');
    expect(exists(renderer, 'boards-delete-confirm')).toBe(true);

    await press(renderer, 'boards-delete-confirm');
    expect(deleteBoard).toHaveBeenCalledTimes(2);
    expect(exists(renderer, 'boards-delete-confirm')).toBe(false);
  });

  it('assigning an ALREADY-BOUND board to another room SUCCEEDS (fix cycle 2 — atomic transfer)', async () => {
    // board-1 is bound to Phòng khách (ROOMS fixture). The transfer flow
    // previously died in the registry's uniqueness check; it must now
    // complete: the confirm dialog closes and the callback carries the
    // transfer to the registry's atomic rebind.
    const assignments: { code: string; roomId: string }[] = [];
    const renderer = await renderScreen({
      rooms: [
        { id: 'room-a', name: 'Phòng khách', order: 0, code: 'board-1' },
        { id: 'room-b', name: 'Phòng ngủ', order: 1 },
        { id: 'room-c', name: 'Nhà bếp', order: 2 },
      ],
      boards: [{ code: 'board-1', status: 'online' }],
      onAssignBoard: async (code, roomId) => {
        // The registry's rebindRoomBoard semantics (tested at the service
        // level): transfer succeeds — model it truthfully.
        assignments.push({ code, roomId });
        return { ok: true, message: '' };
      },
    });

    // dashboard-history-board-touch-share: the bound board's footer
    // primary button carries the reassign variant and opens the dialog.
    expect(visibleText(renderer)).toContain(STRINGS.boards.reassignFooter);
    await press(renderer, 'boards-footer-assign-board-1');
    // The board's CURRENT room is NOT a pick candidate (no self-transfer);
    // the other rooms are.
    expect(exists(renderer, 'boards-assign-target-room-a')).toBe(false);
    expect(exists(renderer, 'boards-assign-target-room-b')).toBe(true);
    await press(renderer, 'boards-assign-target-room-b');
    await press(renderer, 'boards-assign-confirm');

    expect(assignments).toEqual([{ code: 'board-1', roomId: 'room-b' }]);
    expect(
      renderer.root
        .findAllByType(Modal)
        .find(node => node.props.visible === true),
    ).toBeUndefined();
  });
});

describe('BoardsScreen (boards-card-layout-search rework)', () => {
  it('titles descriptor boards by boardType and descriptor-less boards by the "Board {code}" fallback (AD-1/AD-6)', async () => {
    const renderer = await renderScreen({
      boards: [
        { code: 'board-1', status: 'online' },
        {
          code: 'board-2',
          status: 'online',
          descriptor: {
            boardType: 'esp32-relay',
            sensors: [],
            relays: [],
          },
        },
      ],
    });
    const text = visibleText(renderer);
    // No descriptor → the `Board {code}` fallback (never a bare code).
    expect(text).toContain('Board board-1');
    // Descriptor → the boardType IS the title; the fallback never shows.
    expect(text).toContain('esp32-relay');
    expect(text).not.toContain('Board board-2');
    // The labeled Id line ONLY on the descriptor board: the fallback title
    // already contains the code, so the code appears exactly once (AD-6).
    expect(text).toContain(STRINGS.boards.idLabel.replace('{code}', 'board-2'));
    expect(text).not.toContain(
      STRINGS.boards.idLabel.replace('{code}', 'board-1'),
    );
    // The wire codes stay visible on both cards.
    expect(text).toContain('board-1');
    expect(text).toContain('board-2');
  });

  it('renders sensor chips (catalog label + raw-field fallback), the relay badge and the boardType title', async () => {
    const renderer = await renderScreen({
      boards: [
        {
          code: 'board-7',
          status: 'online',
          descriptor: {
            boardType: 'esp32-relay-v2',
            sensors: [
              { channel: 'S1', field: 'temperature', unit: '°C' },
              { channel: 'S2', field: 'humidity' },
              { channel: 'S3', field: 'co2_level' },
            ],
            relays: ['K1', 'K2', 'K3'],
          },
        },
      ],
    });
    expect(exists(renderer, 'boards-sensors-board-7')).toBe(true);
    expect(exists(renderer, 'boards-relays-board-7')).toBe(true);
    // The type testID lives on the TITLE node (the badge was removed).
    expect(exists(renderer, 'boards-type-board-7')).toBe(true);
    const text = visibleText(renderer);
    // One chip per sensor channel: the capability-catalog label when the
    // field is known, the raw field otherwise.
    expect(text).toContain('S1 · Nhiệt độ');
    expect(text).toContain('S2 · Độ ẩm');
    expect(text).toContain('S3 · co2_level');
    // Relay badge = the compressed K-range (not a joined meta line).
    expect(text).toContain('K1–K3');
    // The boardType shows as the raw title string.
    expect(text).toContain('esp32-relay-v2');
    // The old joined-line body formats are gone.
    expect(text).not.toContain('S1 → Nhiệt độ');
    expect(text).not.toContain('Loại board:');
  });

  it('shows the offline stale note ONLY for an offline board with a descriptor', async () => {
    const descriptor = {
      boardType: 'esp32-relay',
      sensors: [],
      relays: ['K1'],
    } as const;
    const renderer = await renderScreen({
      boards: [
        { code: 'b-off', status: 'offline', descriptor },
        { code: 'b-on', status: 'online', descriptor },
        { code: 'b-seen', status: 'seen', descriptor },
        { code: 'b-bare', status: 'offline' },
      ],
    });
    // Offline + descriptor → the stale note; online/seen and
    // descriptor-less boards stay note-free.
    expect(exists(renderer, 'boards-stale-b-off')).toBe(true);
    expect(exists(renderer, 'boards-stale-b-on')).toBe(false);
    expect(exists(renderer, 'boards-stale-b-seen')).toBe(false);
    expect(exists(renderer, 'boards-stale-b-bare')).toBe(false);
    // Exactly one note across the whole screen.
    const text = visibleText(renderer);
    expect(text.split('Dữ liệu từ lần cuối board phát').length - 1).toBe(1);
  });

  it('filters the list as you type and restores it on clear (AD-4)', async () => {
    const renderer = await renderScreen();
    const input = renderer.root.findByProps({
      testID: 'boards-search-input',
    });

    await act(async () => {
      input.props.onChangeText('board-2');
    });
    expect(exists(renderer, 'boards-card-board-2')).toBe(true);
    expect(exists(renderer, 'boards-card-board-1')).toBe(false);
    expect(exists(renderer, 'boards-card-board-3')).toBe(false);

    // No match → the no-results hint, every card hidden.
    await act(async () => {
      input.props.onChangeText('không-có-đâu');
    });
    expect(exists(renderer, 'boards-no-results')).toBe(true);
    expect(exists(renderer, 'boards-card-board-2')).toBe(false);

    // The ✕ button clears the query → the full list comes back.
    await press(renderer, 'boards-search-clear');
    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    expect(exists(renderer, 'boards-card-board-2')).toBe(true);
    expect(exists(renderer, 'boards-card-board-3')).toBe(true);
    expect(exists(renderer, 'boards-no-results')).toBe(false);
  });

  it('matches the bound room name and the board type case-insensitively', async () => {
    const renderer = await renderScreen();
    const input = renderer.root.findByProps({
      testID: 'boards-search-input',
    });

    // board-1 is bound to Phòng khách → the room name matches.
    await act(async () => {
      input.props.onChangeText('phòng khách');
    });
    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    expect(exists(renderer, 'boards-card-board-2')).toBe(false);

    // Type match, case-insensitive: only board-1's type has `-sensor-`.
    await act(async () => {
      input.props.onChangeText('ESP32-SENSOR');
    });
    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    expect(exists(renderer, 'boards-card-board-2')).toBe(false);
    expect(exists(renderer, 'boards-no-results')).toBe(false);
  });

  it('a bound board: the sheet lists the delete action with its consequence description', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });

    await press(renderer, 'boards-card-menu-board-1');
    expect(exists(renderer, 'boards-sheet-delete-board-1')).toBe(true);
    const text = visibleText(renderer);
    // Header: boardType title + code + current room (the display
    // convention's title flows into the sheet hint via the shared helper).
    expect(text).toContain('esp32-sensor-relay · board-1 · Phòng: Phòng khách');
    expect(text).toContain('Phòng: Phòng khách');
    // The assign flow moved to the footer's primary button (the "Đổi
    // phòng" label); the sheet's delete row explains which data survives.
    expect(visibleText(renderer)).toContain(STRINGS.boards.reassignFooter);
    expect(text).toContain(STRINGS.boards.deleteActionDesc);

    // Hủy closes the sheet without opening any dialog.
    await press(renderer, 'boards-sheet-cancel');
    expect(exists(renderer, 'boards-sheet-delete-board-1')).toBe(false);
    expect(exists(renderer, 'boards-assign-target-room-b')).toBe(false);
  });

  it('an unassigned board: the footer hint is tappable and opens the assign dialog DIRECTLY', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'board-2', status: 'seen' }],
    });

    expect(visibleText(renderer)).toContain('Chưa gán phòng — nhấn để gán');
    // The unassigned hint (the room line itself) is PRESSABLE — react-test-
    // renderer matches the whole TouchableOpacity wrapper chain, so assert
    // pressability, not an exact node count; the press below proves it.
    const hintNodes = renderer.root
      .findAllByProps({ testID: 'boards-room-board-2' })
      .filter(node => typeof node.props.onPress === 'function');
    expect(hintNodes.length).toBeGreaterThan(0);
    await press(renderer, 'boards-room-board-2');
    // boards-reassign-layout-remove-sharing: the hint routes STRAIGHT to
    // the assign dialog (the sheet no longer has any assign affordance —
    // a sheet detour would be a dead end).
    expect(exists(renderer, 'boards-assign-target-room-a')).toBe(true);
    expect(exists(renderer, 'boards-assign-target-room-b')).toBe(true);
    expect(exists(renderer, 'boards-sheet-delete-board-2')).toBe(false);
  });

  it('the footer button and the sheet route to the SAME confirm dialogs', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });

    // Assign route: the FOOTER primary button → the assign dialog (current
    // holder room is NOT a candidate).
    await press(renderer, 'boards-footer-assign-board-1');
    expect(exists(renderer, 'boards-assign-target-room-a')).toBe(false);
    expect(exists(renderer, 'boards-assign-target-room-b')).toBe(true);
    await press(renderer, 'boards-assign-cancel');

    // Delete route: sheet action → the delete confirm dialog.
    await press(renderer, 'boards-card-menu-board-1');
    await press(renderer, 'boards-sheet-delete-board-1');
    expect(exists(renderer, 'boards-delete-confirm')).toBe(true);
    const openModal = renderer.root
      .findAllByType(Modal)
      .find(node => node.props.visible === true);
    expect(openModal).toBeDefined();
  });
});

describe('BoardsScreen (display-by-type thumbnails + layout polish, boards-display-by-type)', () => {
  /**
   * The production map starts EMPTY; a test renders the "photo bundled"
   * branch by injecting ONE slug-keyed entry into it (the same map the
   * screen looks up by default) and removing it in `finally` — the real
   * slugify → lookup path runs end to end, no module mocking.
   */
  function withInjectedImage(
    slug: string,
    source: ImageSourcePropType,
    run: () => Promise<void>,
  ): () => Promise<void> {
    return async () => {
      BOARD_IMAGES[slug] = source;
      try {
        await run();
      } finally {
        delete BOARD_IMAGES[slug];
      }
    };
  }

  it(
    'keys the card thumbnail by the board TYPE: the injected type slug renders the photo even when a displayName is present (AD-1)',
    withInjectedImage(
      'iot-esp32-s2r3',
      { uri: 'file:///boards/iot-esp32-s2r3.png' },
      async () => {
        const renderer = await renderScreen({
          boards: [
            {
              code: 'b-a',
              status: 'online',
              descriptor: {
                boardType: 'IoT_ESP32-S2R3',
                sensors: [],
                relays: [],
                displayName: 'Type A',
              },
            },
          ],
        });
        // The boardType "IoT_ESP32-S2R3" slugifies to the injected map key
        // → the Image branch renders with the injected source. A
        // displayName is present but is NOT the key (its slug "type-a" is
        // absent from the map) — so a pass proves keying-by-type end to
        // end AND that the name is ignored for keying.
        const thumb = renderer.root.findByProps({
          testID: 'boards-thumb-b-a',
        });
        expect(thumb.props.source).toEqual({
          uri: 'file:///boards/iot-esp32-s2r3.png',
        });
      },
    ),
  );

  it(
    'never keys a descriptor-less board: even the legacy name slug stays unmatched → placeholder (AD-1/AD-6)',
    withInjectedImage(
      'board-0',
      { uri: 'file:///boards/board-0.png' },
      async () => {
        const renderer = await renderScreen({
          boards: [{ code: '0', status: 'online' }],
        });
        // No descriptor → no type → the screen passes '' which matches no
        // key. The legacy name-keyed behavior ("Board 0" → slug board-0)
        // would have rendered the injected photo; the type-keyed screen
        // keeps the placeholder.
        const thumb = renderer.root.findByProps({ testID: 'boards-thumb-0' });
        expect(thumb.props.source).toBeUndefined();
      },
    ),
  );

  it('keeps the placeholder when the map has no entry for the boardType', async () => {
    const renderer = await renderScreen({
      boards: [
        {
          code: 'b-ph',
          status: 'online',
          descriptor: {
            boardType: 'esp32-sensor-relay',
            sensors: [],
            relays: [],
          },
        },
      ],
    });
    const thumb = renderer.root.findByProps({ testID: 'boards-thumb-b-ph' });
    expect(thumb.props.source).toBeUndefined();
  });

  it('placeholder: small chip icon inside the 56×56 frame on the light neutral fill (L1, structural)', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'b-l1', status: 'online' }],
    });
    const frame = renderer.root.findByProps({
      testID: 'boards-thumb-b-l1',
    });
    const style = StyleSheet.flatten(frame.props.style);
    // The frame keeps its 56×56 rounded size and gains the light neutral
    // surface; the icon child stays an Ionicons chip (no exact size pin).
    expect(style.width).toBe(56);
    expect(style.height).toBe(56);
    expect(style.backgroundColor).toBe(LIGHT_TOKENS.smart.colors.page);
    expect(frame.findByProps({ name: 'hardware-chip-outline' })).toBeDefined();
    // Web-centering fix (structural): the title column is the DIRECT
    // sibling after the thumbnail inside the row header and carries
    // `flex: 1` — under `space-between`, react-native-web otherwise
    // floats the middle column to the visual card center.
    const headerRow = frame.parent;
    if (!headerRow) {
      throw new Error('thumbnail has no parent header row');
    }
    expect(headerRow.children.length).toBe(3);
    const titleColumn = headerRow.children[1] as TestRenderer.ReactTestInstance;
    expect(StyleSheet.flatten(titleColumn.props.style).flex).toBe(1);
  });

  it('sensor chips flow in a row-wrap container: both chips inside the row (L2, structural — no pixels)', async () => {
    const renderer = await renderScreen({
      boards: [
        {
          code: 'b-l2',
          status: 'online',
          descriptor: {
            boardType: 'esp32-sensor-relay',
            sensors: [
              { channel: 'S1', field: 'temperature', unit: '°C' },
              { channel: 'S2', field: 'humidity' },
            ],
            relays: [],
          },
        },
      ],
    });
    const row = renderer.root.findByProps({ testID: 'boards-sensors-b-l2' });
    const style = StyleSheet.flatten(row.props.style);
    expect(style.flexDirection).toBe('row');
    expect(style.flexWrap).toBe('wrap');
    expect(style.alignItems).toBe('flex-start');
    // Both chips render INSIDE that row-wrap container.
    const chips: readonly unknown[] = Array.isArray(row.props.children)
      ? row.props.children
      : [row.props.children];
    expect(chips.length).toBe(2);
  });

  it('the boardType TITLE clips to one line with a tail ellipsis (L3 — mechanism moved from the removed badge)', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });
    const title = renderer.root.findByProps({
      testID: 'boards-type-board-1',
    });
    expect(title.props.numberOfLines).toBe(1);
    expect(title.props.ellipsizeMode).toBe('tail');
  });

  it('no separate boardType badge node remains: the type testID IS the title Text (AD-4)', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });
    const nodes = renderer.root.findAllByProps({
      testID: 'boards-type-board-1',
    });
    // react-test-renderer matches the testID on the title Text (composite)
    // and its host clone — every match is a Text-level node. The removed
    // badge was a bordered View CONTAINER wrapping an inner Text: the View
    // component that owned the testID must be gone from the match list.
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.filter(node => node.type === View)).toHaveLength(0);
  });

  it('the footer wears a cardBorder hairline separator above the row (L4, style-level)', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });
    const footer = renderer.root.findByProps({
      testID: 'boards-footer-board-1',
    });
    const style = StyleSheet.flatten(footer.props.style);
    expect(style.borderTopWidth).toBe(1);
    expect(style.borderTopColor).toBe(LIGHT_TOKENS.smart.colors.cardBorder);
  });
});

describe('BoardsScreen (display-by-type convention pins, boards-display-by-type)', () => {
  it('shows the labeled mono Id line in the STRINGS format on a descriptor board (AD-2)', async () => {
    const renderer = await renderScreen({
      boards: [
        {
          code: '0',
          status: 'online',
          descriptor: {
            boardType: 'IoT_ESP32-S2R3',
            sensors: [],
            relays: [],
          },
        },
      ],
    });
    const text = visibleText(renderer);
    // The title is the raw boardType (no code inside it — dedup holds).
    expect(text).toContain('IoT_ESP32-S2R3');
    expect(text).not.toContain('Board 0');
    // The code line is the LABELED `Id: {code}` — exactly one occurrence.
    expect(text).toContain(STRINGS.boards.idLabel.replace('{code}', '0'));
    expect(text.split('Id:').length - 1).toBe(1);
  });

  it('hides the Id line for a descriptor-less board: the fallback title already carries the code (AD-6)', async () => {
    const renderer = await renderScreen({
      boards: [{ code: '0', status: 'online' }],
    });
    const text = visibleText(renderer);
    // The `Board {code}` fallback title IS the only code surface.
    expect(text).toContain('Board 0');
    expect(text).not.toContain(STRINGS.boards.idLabel.replace('{code}', '0'));
    expect(text).not.toContain('Id:');
  });
});

describe('filterBoardsByQuery (pure search filter, AD-4)', () => {
  const roomNameOf = (code: string): string | null =>
    code === 'board-1' ? 'Phòng khách' : null;
  const entries: readonly BoardInventoryEntry[] = [
    {
      code: 'board-1',
      status: 'online',
      descriptor: {
        boardType: 'esp32-sensor-relay',
        sensors: [],
        relays: [],
        displayName: 'Bộ đo phòng khách',
      },
    },
    {
      code: 'k-relay',
      status: 'seen',
      descriptor: { boardType: 'esp32-relay', sensors: [], relays: ['K1'] },
    },
    { code: 'zzz', status: 'offline' },
  ];

  const codes = (query: string): readonly string[] =>
    filterBoardsByQuery(entries, roomNameOf, query).map(board => board.code);

  it('passes the SAME reference through for an empty/whitespace query', () => {
    expect(filterBoardsByQuery(entries, roomNameOf, '')).toBe(entries);
    expect(filterBoardsByQuery(entries, roomNameOf, '   ')).toBe(entries);
  });

  it('matches code, displayName, boardType and bound room name case-insensitively', () => {
    expect(codes('BOARD-1')).toEqual(['board-1']);
    expect(codes('bộ đo')).toEqual(['board-1']);
    expect(codes('phòng khách')).toEqual(['board-1']);
    expect(codes('esp32-relay')).toEqual(['k-relay']);
    expect(codes('relay')).toEqual(['board-1', 'k-relay']);
    expect(codes('nope')).toEqual([]);
  });

  it('filters BEFORE the sort: the online-first rank survives in the result (R3)', () => {
    const ranked: readonly BoardInventoryEntry[] = [
      {
        code: 'off-esp',
        status: 'offline',
        descriptor: { boardType: 'esp32', sensors: [], relays: [] },
      },
      {
        code: 'on-esp',
        status: 'online',
        descriptor: { boardType: 'esp32', sensors: [], relays: [] },
      },
      {
        code: 'other',
        status: 'online',
        descriptor: { boardType: 'unrelated', sensors: [], relays: [] },
      },
    ];
    // The screen composes sort(filter(boards)) — the filtered subset keeps
    // the online-first rank order.
    const result = sortBoardsOnlineFirst(
      filterBoardsByQuery(ranked, () => null, 'esp32'),
    );
    expect(result.map(board => board.code)).toEqual(['on-esp', 'off-esp']);
  });
});

describe('slugifyBoardName (pure boardType → map/file key, boards-display-by-type)', () => {
  it('maps the canonical boardType strings to their slug keys', () => {
    expect(slugifyBoardName('IoT_ESP32-S2R3')).toBe('iot-esp32-s2r3');
    // A hardware revision is a NEW type string → its own image slot.
    expect(slugifyBoardName('IoT_ESP32-S2R3-V2')).toBe('iot-esp32-s2r3-v2');
    // Diacritic mechanism pin (kept from the name-keyed era): NFD +
    // combining-mark removal.
    expect(slugifyBoardName('Phòng Khách')).toBe('phong-khach');
  });

  it('is case/spacing tolerant: casing, extra spaces and underscores agree', () => {
    expect(slugifyBoardName('iot_esp32-s2r3')).toBe('iot-esp32-s2r3');
    expect(slugifyBoardName('IOT  ESP32-S2R3')).toBe('iot-esp32-s2r3');
    expect(slugifyBoardName('  IoT_ESP32-S2R3  ')).toBe('iot-esp32-s2r3');
  });

  it('is safe on empty and all-space input', () => {
    expect(slugifyBoardName('')).toBe('');
    expect(slugifyBoardName('   ')).toBe('');
  });
});

describe('boardImageFor (pure bundled-photo lookup by boardType, boards-display-by-type)', () => {
  it('returns null for a type the map does not bundle', () => {
    expect(boardImageFor('definitely-not-bundled-type')).toBeNull();
  });

  it('returns the bundled source when the map has an entry', () => {
    const source: ImageSourcePropType = {
      uri: 'file:///boards/esp32-relay.png',
    };
    const map: Record<string, ImageSourcePropType> = {
      'esp32-relay': source,
    };
    expect(boardImageFor('esp32-relay', map)).toBe(source);
    expect(boardImageFor('esp32-sensor-relay', map)).toBeNull();
  });

  it('resolves through the slug: type-string casing/underscores hit the same key', () => {
    const source: ImageSourcePropType = {
      uri: 'file:///boards/iot-esp32-s2r3.png',
    };
    const map: Record<string, ImageSourcePropType> = {
      'iot-esp32-s2r3': source,
    };
    expect(boardImageFor('IoT_ESP32-S2R3', map)).toBe(source);
    expect(boardImageFor('iot_esp32-s2r3', map)).toBe(source);
    expect(boardImageFor('IOT  ESP32-S2R3', map)).toBe(source);
    // A DIFFERENT type string is a different image slot.
    expect(boardImageFor('IoT_ESP32-S2R3-V2', map)).toBeNull();
  });
});

describe('BoardsScreen (QR scanner, boards-qr-scan)', () => {
  const requestPermissionsMock =
    Camera.requestCameraPermissionsAsync as unknown as jest.Mock;

  /** QR payloads used across the scanner tests. */
  const VALID_LABEL = JSON.stringify({
    schemaVersion: 1,
    boardId: 'board-1',
    boardType: 'esp32-sensor-relay',
  });
  // A second discovered board's label — the double-processing pin relies
  // on two DIFFERENT valid scans fighting over the highlight.
  const VALID_LABEL_BOARD_2 = JSON.stringify({
    schemaVersion: 1,
    boardId: 'board-2',
    boardType: 'esp32-relay',
  });
  const UNKNOWN_LABEL = JSON.stringify({
    schemaVersion: 1,
    boardId: 'board-99',
    boardType: 'esp32-relay',
  });
  const GARBAGE = 'not-a-board-label';

  beforeEach(() => {
    requestPermissionsMock.mockReset();
    requestPermissionsMock.mockResolvedValue({
      granted: true,
      status: 'granted',
      canAskAgain: true,
      expires: 'never',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Open the scanner (scan button) and flush the permission request. */
  async function openScanner(
    renderer: TestRenderer.ReactTestRenderer,
  ): Promise<void> {
    await press(renderer, 'boards-scan-button');
    await act(async () => {});
  }

  /** Simulate a barcode hit through the mocked CameraView stub. */
  async function scan(
    renderer: TestRenderer.ReactTestRenderer,
    raw: string,
  ): Promise<void> {
    const camera = renderer.root.findByProps({
      testID: 'boards-scanner-camera',
    });
    await act(async () => {
      camera.props.onBarcodeScanned({ data: raw, type: 'qr' });
    });
  }

  /** The card's 2px highlight layer (undefined when not highlighted). */
  function highlightStyleOf(
    renderer: TestRenderer.ReactTestRenderer,
    code: string,
  ): { borderColor?: unknown } | undefined {
    const card = renderer.root.findByProps({
      testID: `boards-card-${code}`,
    });
    const layers: readonly unknown[] = Array.isArray(card.props.style)
      ? card.props.style
      : [card.props.style];
    const highlight = layers.find(
      (layer): layer is { borderWidth?: unknown; borderColor?: unknown } =>
        typeof layer === 'object' &&
        layer !== null &&
        (layer as { borderWidth?: unknown }).borderWidth === 2,
    );
    return highlight;
  }

  it('the scan button opens the scanner modal (permission granted)', async () => {
    const renderer = await renderScreen();

    expect(exists(renderer, 'boards-scan-button')).toBe(true);
    await openScanner(renderer);

    expect(exists(renderer, 'boards-scanner-modal')).toBe(true);
    // Granted → the camera view + hint, no denied card, no inline error.
    expect(exists(renderer, 'boards-scanner-camera')).toBe(true);
    expect(exists(renderer, 'boards-scanner-hint')).toBe(true);
    expect(exists(renderer, 'boards-scanner-denied')).toBe(false);
    expect(exists(renderer, 'boards-scanner-error')).toBe(false);

    // Đóng closes it again.
    await press(renderer, 'boards-scanner-close');
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
  });

  it('an invalid payload keeps the camera open with the inline error and RE-ARMS for the next scan (AD-3, fix cycle 1)', async () => {
    const renderer = await renderScreen();
    await openScanner(renderer);

    await scan(renderer, GARBAGE);
    // Camera KEPT open + the inline error; the board list untouched.
    expect(exists(renderer, 'boards-scanner-camera')).toBe(true);
    expect(exists(renderer, 'boards-scanner-error')).toBe(true);
    expect(visibleText(renderer)).toContain('Không phải nhãn board');
    // The diagnostic raw line shows exactly what the camera delivered.
    const rawNode = renderer.root.findByProps({
      testID: 'boards-scanner-raw',
    });
    expect(rawNode.props.children).toBe(GARBAGE);
    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    expect(exists(renderer, 'boards-card-board-3')).toBe(true);

    // The rejection RE-ARMED the camera (AD-3 "tự xóa khi quét tiếp"):
    // the very next scan — a VALID label — is processed WITHOUT closing
    // and reopening the modal.
    await scan(renderer, VALID_LABEL);
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(highlightStyleOf(renderer, 'board-1')).toBeDefined();
  });

  it('repeated rejections keep the camera live — every re-scan is evaluated (AD-3, fix cycle 1)', async () => {
    const renderer = await renderScreen();
    await openScanner(renderer);

    await scan(renderer, GARBAGE);
    expect(exists(renderer, 'boards-scanner-error')).toBe(true);
    // A second garbage scan: processed again (error replaces error), the
    // camera never went dead, the board list is unchanged, and the raw
    // diagnostic still shows the delivered payload.
    await scan(renderer, GARBAGE);
    expect(exists(renderer, 'boards-scanner-camera')).toBe(true);
    expect(exists(renderer, 'boards-scanner-error')).toBe(true);
    expect(
      renderer.root.findByProps({ testID: 'boards-scanner-raw' }).props
        .children,
    ).toBe(GARBAGE);
    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    // And a VALID label right after is still processed immediately.
    await scan(renderer, VALID_LABEL);
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(highlightStyleOf(renderer, 'board-1')).toBeDefined();
  });

  it('the diagnostic raw line clears on an accepted scan and never leaks into a fresh open (fix: live debugging)', async () => {
    const renderer = await renderScreen();
    await openScanner(renderer);

    await scan(renderer, GARBAGE);
    expect(exists(renderer, 'boards-scanner-raw')).toBe(true);

    // An ACCEPTED scan closes the modal and clears the diagnostic state…
    await scan(renderer, VALID_LABEL);
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(exists(renderer, 'boards-scanner-raw')).toBe(false);

    // …so a FRESH open never shows the previous session's raw payload
    // (or its error).
    await openScanner(renderer);
    expect(exists(renderer, 'boards-scanner-camera')).toBe(true);
    expect(exists(renderer, 'boards-scanner-error')).toBe(false);
    expect(exists(renderer, 'boards-scanner-raw')).toBe(false);
  });

  it('the diagnostic raw line truncates an over-long payload to 80 chars + ellipsis (fix: live debugging)', async () => {
    const renderer = await renderScreen();
    await openScanner(renderer);

    const longGarbage = `https://example.com/${'x'.repeat(120)}`;
    await scan(renderer, longGarbage);

    const rawNode = renderer.root.findByProps({
      testID: 'boards-scanner-raw',
    });
    const shown = rawNode.props.children as string;
    // 80 kept characters + the ellipsis, and the tail is cut.
    expect(shown.length).toBe(81);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown.startsWith('https://example.com/')).toBe(true);
    expect(shown).not.toBe(longGarbage);
  });

  it('a valid label for a discovered board closes the modal and highlights the card, auto-clearing at ~2s (AD-6)', async () => {
    jest.useFakeTimers();
    const renderer = await renderScreen();
    await openScanner(renderer);

    await scan(renderer, VALID_LABEL);

    // Modal closed, teal ring on the RIGHT card (board-1).
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    const highlight = highlightStyleOf(renderer, 'board-1');
    expect(highlight).toBeDefined();
    expect(highlight?.borderColor).toBe(LIGHT_TOKENS.smart.colors.teal);
    // No ring on other cards.
    expect(highlightStyleOf(renderer, 'board-2')).toBeUndefined();

    // The ring auto-clears after the 2s window (probed past it at 2.1s).
    act(() => {
      jest.advanceTimersByTime(2100);
    });
    expect(highlightStyleOf(renderer, 'board-1')).toBeUndefined();
  });

  it('a scanned board hidden by the search filter clears the query first (AD-2)', async () => {
    const renderer = await renderScreen();
    const input = renderer.root.findByProps({
      testID: 'boards-search-input',
    });
    await act(async () => {
      input.props.onChangeText('zzz-hides-everything');
    });
    expect(exists(renderer, 'boards-card-board-1')).toBe(false);
    expect(exists(renderer, 'boards-no-results')).toBe(true);

    await openScanner(renderer);
    await scan(renderer, VALID_LABEL);

    // The query was cleared → the card is visible again + highlighted.
    const inputAfter = renderer.root.findByProps({
      testID: 'boards-search-input',
    });
    expect(inputAfter.props.value).toBe('');
    expect(exists(renderer, 'boards-no-results')).toBe(false);
    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    expect(highlightStyleOf(renderer, 'board-1')).toBeDefined();
  });

  it('a valid label for a deleted board restores it without opening the unknown sheet', async () => {
    const restoreBoard = jest.fn(async (_code: string) => ({
      ok: true,
      message: '',
    }));
    const renderer = await renderScreen({
      deletedBoardCodes: ['board-99'],
      onRestoreBoard: restoreBoard,
    });
    await openScanner(renderer);

    await scan(renderer, UNKNOWN_LABEL);

    expect(restoreBoard).toHaveBeenCalledWith('board-99', 'esp32-relay');
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(false);
    expect(exists(renderer, 'boards-card-board-99')).toBe(false);

    // The registry event makes the MQTT inventory publish the restored card.
    const props = renderer.root.findByType(BoardsScreen).props;
    await act(async () => {
      renderer.update(
        <ThemeProvider mode="light">
          <BoardsScreen
            onBack={props.onBack}
            boards={[...BOARDS, { code: 'board-99', status: 'online' }]}
            rooms={props.rooms}
            capabilities={props.capabilities}
            onAssignBoard={props.onAssignBoard}
            onDeleteBoard={props.onDeleteBoard}
            onRestoreBoard={props.onRestoreBoard}
            deletedBoardCodes={[]}
            bleProvisioningService={props.bleProvisioningService}
          />
        </ThemeProvider>,
      );
    });
    expect(highlightStyleOf(renderer, 'board-99')).toBeDefined();
  });

  it('a valid absent label restores without a deletion marker and keeps the BLE onboarding sheet', async () => {
    const restoreBoard = jest.fn(async () => ({ ok: true, message: '' }));
    const renderer = await renderScreen({ onRestoreBoard: restoreBoard });
    await openScanner(renderer);

    await scan(renderer, UNKNOWN_LABEL);

    expect(restoreBoard).toHaveBeenCalledWith('board-99', 'esp32-relay');
    // Modal closed, sheet open with the QR's own type/id + placeholder
    // thumb + the honest hint with {code} filled.
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(true);
    expect(exists(renderer, 'boards-scan-unknown-thumb')).toBe(true);
    expect(visibleText(renderer)).toContain('Board chưa thấy trên broker');
    expect(visibleText(renderer)).toContain('esp32-relay');
    expect(visibleText(renderer)).toContain('board-99');
    expect(visibleText(renderer)).toContain(
      'Board "board-99" chưa từng phát trên broker',
    );

    // Đóng dismisses the sheet.
    await press(renderer, 'boards-scan-unknown-close');
    expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(false);
  });

  it("the not-found sheet shows the QR boardType's image when the map bundles it (AD-5, boards-display-by-type)", async () => {
    const source: ImageSourcePropType = {
      uri: 'file:///boards/esp32-relay.png',
    };
    BOARD_IMAGES['esp32-relay'] = source; // the QR's own boardType slug
    try {
      const renderer = await renderScreen();
      await openScanner(renderer);
      await scan(renderer, UNKNOWN_LABEL);

      expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(true);
      const thumb = renderer.root.findByProps({
        testID: 'boards-scan-unknown-thumb',
      });
      // The QR carries the boardType even for an undiscovered board — one
      // image per TYPE — so the bundled type photo renders in the sheet.
      expect(thumb.props.source).toEqual({
        uri: 'file:///boards/esp32-relay.png',
      });
    } finally {
      delete BOARD_IMAGES['esp32-relay'];
    }
  });

  it('the not-found sheet keeps the placeholder when the map lacks the QR boardType (AD-5)', async () => {
    BOARD_IMAGES['iot-esp32-s2r3'] = {
      uri: 'file:///boards/iot-esp32-s2r3.png',
    }; // an UNRELATED type
    try {
      const renderer = await renderScreen();
      await openScanner(renderer);
      await scan(renderer, UNKNOWN_LABEL); // boardType 'esp32-relay'

      expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(true);
      const thumb = renderer.root.findByProps({
        testID: 'boards-scan-unknown-thumb',
      });
      // A different type is bundled, the scanned type is not → the map
      // miss keeps the placeholder (an unrelated entry cannot leak in).
      expect(thumb.props.source).toBeUndefined();
    } finally {
      delete BOARD_IMAGES['iot-esp32-s2r3'];
    }
  });

  it('permission denied renders the camera hint instead of the camera view', async () => {
    requestPermissionsMock.mockResolvedValue({
      granted: false,
      status: 'denied',
      canAskAgain: false,
      expires: 'never',
    });
    const renderer = await renderScreen();
    await openScanner(renderer);

    expect(exists(renderer, 'boards-scanner-denied')).toBe(true);
    expect(visibleText(renderer)).toContain('Cần cấp quyền camera để quét mã.');
    expect(exists(renderer, 'boards-scanner-camera')).toBe(false);
    expect(exists(renderer, 'boards-scanner-error')).toBe(false);

    // Đóng still works from the denied state.
    await press(renderer, 'boards-scanner-close');
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
  });

  it('the single-scan lock prevents double-processing within one open session (AD-4, fix cycle 1 re-pin)', async () => {
    const renderer = await renderScreen();
    await openScanner(renderer);

    // The camera fires MULTIPLE callbacks for one physical scan: two
    // barcode callbacks in the SAME open session (one act, before any
    // re-render) — only the FIRST is processed. Without the lock the
    // second (board-2) would steal the highlight from board-1.
    const camera = renderer.root.findByProps({
      testID: 'boards-scanner-camera',
    });
    await act(async () => {
      camera.props.onBarcodeScanned({ data: VALID_LABEL, type: 'qr' });
      camera.props.onBarcodeScanned({
        data: VALID_LABEL_BOARD_2,
        type: 'qr',
      });
    });

    // The first scan was accepted: the modal closed and board-1 owns the
    // highlight; the duplicate callback never reached the screen.
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(highlightStyleOf(renderer, 'board-1')).toBeDefined();
    expect(highlightStyleOf(renderer, 'board-2')).toBeUndefined();

    // The lock resets with the modal: a fresh open scans normally.
    await openScanner(renderer);
    await scan(renderer, VALID_LABEL_BOARD_2);
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(highlightStyleOf(renderer, 'board-2')).toBeDefined();
  });

  it('the empty state offers the scan path: scanning an unknown label opens the not-found sheet (fix cycle 1)', async () => {
    const renderer = await renderScreen({ boards: [] });
    expect(exists(renderer, 'boards-empty')).toBe(true);
    // The same `boards-scan-button` testID is findable in the empty state.
    expect(exists(renderer, 'boards-scan-button')).toBe(true);

    await openScanner(renderer);
    await scan(renderer, UNKNOWN_LABEL);

    // End-to-end from the zero-inventory state: modal closes, the
    // not-found sheet shows the QR's own boardType + boardId.
    expect(exists(renderer, 'boards-scanner-modal')).toBe(false);
    expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(true);
    expect(visibleText(renderer)).toContain('esp32-relay');
    expect(visibleText(renderer)).toContain('board-99');
    expect(visibleText(renderer)).toContain(
      'Board "board-99" chưa từng phát trên broker',
    );
  });
});

describe('BoardsScreen (BLE onboarding handoff, boards-ble-wifi-provisioning)', () => {
  /** A scanned board the broker never saw (the not-found sheet's input). */
  const UNKNOWN_LABEL_99 = JSON.stringify({
    schemaVersion: 1,
    boardId: 'board-99',
    boardType: 'esp32-relay',
  });

  beforeEach(() => {
    mockPlatformOS = 'ios';
  });

  afterEach(() => {
    mockPlatformOS = 'ios';
  });

  async function openNotFoundSheet(
    renderer: TestRenderer.ReactTestRenderer,
  ): Promise<void> {
    await press(renderer, 'boards-scan-button');
    await act(async () => {});
    const camera = renderer.root.findByProps({
      testID: 'boards-scanner-camera',
    });
    await act(async () => {
      camera.props.onBarcodeScanned({ data: UNKNOWN_LABEL_99, type: 'qr' });
    });
  }

  it('on native the not-found sheet offers the BLE handoff: pressing it opens the modal with the QR boardId', async () => {
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      bleProvisioningService: ble.service,
    });
    await openNotFoundSheet(renderer);

    // The sheet gains the handoff button, addressed by the QR's boardId.
    expect(exists(renderer, 'boards-sheet-ble-board-99')).toBe(true);
    expect(visibleText(renderer)).toContain('Cấu hình WiFi qua Bluetooth');

    await press(renderer, 'boards-sheet-ble-board-99');

    // The sheet closed; the BLE modal opened for the SAME boardId.
    expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(false);
    expect(exists(renderer, 'boards-ble-modal')).toBe(true);
    // The QR boardId flows into the modal: when the board advertises, it
    // is auto-selected (the modal's own contract, driven here end-to-end).
    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:99',
        boardId: 'board-99',
        rssi: -58,
        localName: 'IoTBoard-board-99',
      });
    });
    await act(async () => {});
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-selected-board' }).props
        .children,
    ).toBe('board-99');
  });

  it('on web the BLE handoff button is hidden (AD-7) and the modal is unreachable', async () => {
    mockPlatformOS = 'web';
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      bleProvisioningService: ble.service,
    });
    await openNotFoundSheet(renderer);

    // The sheet still explains the unknown board — without the BLE entry
    // (neither the button testID nor its label anywhere on screen).
    expect(exists(renderer, 'boards-scan-unknown-sheet')).toBe(true);
    expect(exists(renderer, 'boards-sheet-ble-board-99')).toBe(false);
    expect(exists(renderer, 'boards-ble-modal')).toBe(false);
    expect(visibleText(renderer)).not.toContain('Cấu hình WiFi qua Bluetooth');
  });

  it('closing the BLE modal keeps the board list intact (no lost state)', async () => {
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      bleProvisioningService: ble.service,
    });
    await openNotFoundSheet(renderer);
    await press(renderer, 'boards-sheet-ble-board-99');
    expect(exists(renderer, 'boards-ble-modal')).toBe(true);

    await press(renderer, 'boards-ble-close');

    expect(exists(renderer, 'boards-ble-modal')).toBe(false);
    // The screen underneath is untouched: the discovered cards still render.
    expect(exists(renderer, 'boards-card-board-1')).toBe(true);
    expect(exists(renderer, 'boards-card-board-3')).toBe(true);
  });

  it('restores a deleted board with the QR boardType after successful BLE provisioning when inventory is empty', async () => {
    const ble = makeBleServiceFake();
    const restoreBoard = jest.fn(
      async (_code: string, _boardType?: string) => ({
        ok: true,
        message: '',
      }),
    );
    const renderer = await renderScreen({
      boards: [],
      onRestoreBoard: restoreBoard,
      bleProvisioningService: ble.service,
    });

    await openNotFoundSheet(renderer);
    await press(renderer, 'boards-sheet-ble-board-99');

    // Model the board being locally deleted while the BLE flow is in progress.
    // The inventory remains empty, so restoration must carry the QR type.
    const props = renderer.root.findByType(BoardsScreen).props;
    await act(async () => {
      renderer.update(
        <ThemeProvider mode="light">
          <BoardsScreen
            onBack={props.onBack}
            boards={props.boards}
            rooms={props.rooms}
            capabilities={props.capabilities}
            onAssignBoard={props.onAssignBoard}
            onDeleteBoard={props.onDeleteBoard}
            bleProvisioningService={props.bleProvisioningService}
            deletedBoardCodes={['board-99']}
            onRestoreBoard={restoreBoard}
          />
        </ThemeProvider>,
      );
    });

    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:99',
        boardId: 'board-99',
        rssi: -58,
        localName: 'IoTBoard-board-99',
      });
    });
    await typeInput(renderer, 'boards-ble-ssid-input', 'home-wifi');
    await typeInput(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');
    await press(renderer, 'boards-ble-send');
    await act(async () => {});

    expect(
      renderer.root.findByProps({ testID: 'boards-ble-success' }),
    ).toBeDefined();
    expect(restoreBoard).toHaveBeenCalledWith('board-99', 'esp32-relay');
  });

  it('restores only the board selected in BLE after using Đổi board', async () => {
    const ble = makeBleServiceFake();
    const restoreBoard = jest.fn(
      async (_code: string, _boardType?: string) => ({
        ok: true,
        message: '',
      }),
    );
    const renderer = await renderScreen({
      boards: [],
      onRestoreBoard: restoreBoard,
      bleProvisioningService: ble.service,
    });

    await openNotFoundSheet(renderer);
    // QR restoration already ran. Isolate the subsequent BLE selection.
    restoreBoard.mockClear();
    await press(renderer, 'boards-sheet-ble-board-99');
    const props = renderer.root.findByType(BoardsScreen).props;
    await act(async () => {
      renderer.update(
        <ThemeProvider mode="light">
          <BoardsScreen
            onBack={props.onBack}
            boards={props.boards}
            rooms={props.rooms}
            capabilities={props.capabilities}
            onAssignBoard={props.onAssignBoard}
            onDeleteBoard={props.onDeleteBoard}
            onRestoreBoard={restoreBoard}
            deletedBoardCodes={['board-99', 'board-100']}
            bleProvisioningService={props.bleProvisioningService}
          />
        </ThemeProvider>,
      );
    });
    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:99',
        boardId: 'board-99',
        rssi: -58,
        localName: 'IoTBoard-board-99',
      });
    });
    await press(renderer, 'boards-ble-change-board');
    await act(async () => {});
    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:100',
        boardId: 'board-100',
        rssi: -55,
        localName: 'IoTBoard-board-100',
      });
    });
    await press(renderer, 'boards-ble-board-board-100');
    await typeInput(renderer, 'boards-ble-ssid-input', 'home-wifi');
    await typeInput(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');
    await press(renderer, 'boards-ble-send');
    await act(async () => {});

    expect(restoreBoard).toHaveBeenCalledTimes(1);
    expect(restoreBoard).toHaveBeenCalledWith('board-100', 'esp32-relay');
    expect(restoreBoard).not.toHaveBeenCalledWith('board-99', 'esp32-relay');
  });

  it('shows a retryable scanner error when BLE restore persistence fails', async () => {
    const ble = makeBleServiceFake();
    const restoreBoard = jest
      .fn(async () => ({
        ok: false,
        message: 'Không thể lưu trạng thái board.',
      }))
      .mockResolvedValueOnce({ ok: true, message: '' });
    const renderer = await renderScreen({
      boards: [],
      onRestoreBoard: restoreBoard,
      bleProvisioningService: ble.service,
    });

    await openNotFoundSheet(renderer);
    await press(renderer, 'boards-sheet-ble-board-99');
    const props = renderer.root.findByType(BoardsScreen).props;
    await act(async () => {
      renderer.update(
        <ThemeProvider mode="light">
          <BoardsScreen
            onBack={props.onBack}
            boards={props.boards}
            rooms={props.rooms}
            capabilities={props.capabilities}
            onAssignBoard={props.onAssignBoard}
            onDeleteBoard={props.onDeleteBoard}
            onRestoreBoard={restoreBoard}
            deletedBoardCodes={['board-99']}
            bleProvisioningService={props.bleProvisioningService}
          />
        </ThemeProvider>,
      );
    });
    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:99',
        boardId: 'board-99',
        rssi: -58,
        localName: 'IoTBoard-board-99',
      });
    });
    await typeInput(renderer, 'boards-ble-ssid-input', 'home-wifi');
    await typeInput(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');
    await press(renderer, 'boards-ble-send');
    await act(async () => {});
    await act(async () => {});

    expect(exists(renderer, 'boards-ble-modal')).toBe(false);
    expect(exists(renderer, 'boards-scanner-modal')).toBe(true);
    expect(visibleText(renderer)).toContain('Không thể lưu trạng thái board.');
  });

  it('restores a board that was never hidden, so BLE recovery always seeds the card', async () => {
    const ble = makeBleServiceFake();
    const restoreBoard = jest.fn(async () => ({ ok: true, message: '' }));
    const renderer = await renderScreen({
      boards: [],
      onRestoreBoard: restoreBoard,
      bleProvisioningService: ble.service,
    });

    await openNotFoundSheet(renderer);
    await press(renderer, 'boards-sheet-ble-board-99');
    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:99',
        boardId: 'board-99',
        rssi: -58,
        localName: 'IoTBoard-board-99',
      });
    });
    // The advertised board id matches the QR label id, so the modal
    // auto-selects it and the row list is replaced by the credentials form.
    await typeInput(renderer, 'boards-ble-ssid-input', 'home-wifi');
    await typeInput(renderer, 'boards-ble-broker-input', '192.168.100.3:1883');
    await press(renderer, 'boards-ble-send');
    await act(async () => {});

    // BLE recovery seeds the selected board even without a hide marker.
    // Reflashing the same MAC preserves the board id.
    expect(restoreBoard).toHaveBeenCalledWith('board-99', 'esp32-relay');
  });
});

describe('deriveBrokerAddress (v2 prefill derivation, tolerant regex — no URL constructor)', () => {
  it('derives host:1883 from a plain host', () => {
    expect(deriveBrokerAddress('192.168.100.3')).toBe('192.168.100.3:1883');
    expect(deriveBrokerAddress('broker.local')).toBe('broker.local:1883');
  });

  it('strips scheme, userinfo, path AND the WS port (never leaks :9001)', () => {
    expect(deriveBrokerAddress('wss://192.168.100.3:9001/mqtt')).toBe(
      '192.168.100.3:1883',
    );
    expect(deriveBrokerAddress('ws://192.168.100.3:9001')).toBe(
      '192.168.100.3:1883',
    );
    expect(deriveBrokerAddress('mqtt://user:pass@10.0.0.2:1884')).toBe(
      '10.0.0.2:1883',
    );
    expect(deriveBrokerAddress('192.168.100.3:9001')).toBe(
      '192.168.100.3:1883',
    );
  });

  it('returns empty for anything unusable (derive failure → user types manually)', () => {
    expect(deriveBrokerAddress('')).toBe('');
    expect(deriveBrokerAddress('   ')).toBe('');
    // Inner whitespace cannot form a valid broker address.
    expect(deriveBrokerAddress('my host')).toBe('');
    // IPv6-style multi-colon hosts fail the host[:port] grammar (the
    // documented validator limitation).
    expect(deriveBrokerAddress('fe80::1')).toBe('');
  });
});

describe('BoardsScreen (BLE prefill from settings, ble-provisioning-v2-broker-push)', () => {
  /** A persisted settings snapshot the settings facade can zod-validate. */
  const SETTINGS_JSON = JSON.stringify({
    mqtt: {
      host: '192.168.100.3',
      port: 9001,
      username: 'admin',
      password: 'mqtt-pw',
      prefix: 'home',
    },
    influx: {
      url: 'http://192.168.100.3:8086',
      org: 'home',
      bucket: 'sensors',
      token: 'token',
    },
    ui: { theme: 'light' },
  });

  const mockGetItem = AsyncStorage.getItem as jest.Mock;

  /** A scanned board the broker never saw (the not-found sheet's input). */
  const UNKNOWN_LABEL = JSON.stringify({
    schemaVersion: 1,
    boardId: 'board-77',
    boardType: 'esp32-relay',
  });

  beforeEach(() => {
    mockPlatformOS = 'ios';
    mockGetItem.mockReset();
  });

  afterEach(() => {
    mockPlatformOS = 'ios';
  });

  async function openBleForm(
    renderer: TestRenderer.ReactTestRenderer,
    ble: ReturnType<typeof makeBleServiceFake>,
  ): Promise<void> {
    await press(renderer, 'boards-scan-button');
    await act(async () => {});
    const camera = renderer.root.findByProps({
      testID: 'boards-scanner-camera',
    });
    await act(async () => {
      camera.props.onBarcodeScanned({ data: UNKNOWN_LABEL, type: 'qr' });
    });
    await press(renderer, 'boards-sheet-ble-board-77');
    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:77',
        boardId: 'board-77',
        rssi: -58,
        localName: 'IoTBoard-board-77',
      });
    });
    await act(async () => {});
  }

  function inputValueOf(
    renderer: TestRenderer.ReactTestRenderer,
    testID: string,
  ): string {
    return (
      renderer.root.findByProps({ testID }) as unknown as {
        props: { value: string };
      }
    ).props.value;
  }

  it('prefills Broker (host derived from the settings host + :1883) and MQTT creds verbatim', async () => {
    mockGetItem.mockResolvedValue(SETTINGS_JSON);
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      bleProvisioningService: ble.service,
    });
    await openBleForm(renderer, ble);

    expect(inputValueOf(renderer, 'boards-ble-broker-input')).toBe(
      '192.168.100.3:1883',
    );
    expect(inputValueOf(renderer, 'boards-ble-mqtt-username-input')).toBe(
      'admin',
    );
    expect(inputValueOf(renderer, 'boards-ble-mqtt-password-input')).toBe(
      'mqtt-pw',
    );
  });

  it('derives the host from a URL-shaped settings host WITHOUT leaking the WS port', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        ...JSON.parse(SETTINGS_JSON),
        mqtt: {
          host: 'wss://192.168.100.9:9001/mqtt',
          port: 9001,
          prefix: 'home',
        },
      }),
    );
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      bleProvisioningService: ble.service,
    });
    await openBleForm(renderer, ble);

    expect(inputValueOf(renderer, 'boards-ble-broker-input')).toBe(
      '192.168.100.9:1883',
    );
  });

  it('leaves the prefill fields empty (no crash) when the settings have no broker host', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        ...JSON.parse(SETTINGS_JSON),
        mqtt: {
          host: '',
          port: 9001,
          prefix: 'home',
        },
      }),
    );
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      bleProvisioningService: ble.service,
    });
    await openBleForm(renderer, ble);

    expect(inputValueOf(renderer, 'boards-ble-broker-input')).toBe('');
    expect(inputValueOf(renderer, 'boards-ble-mqtt-username-input')).toBe('');
    expect(inputValueOf(renderer, 'boards-ble-mqtt-password-input')).toBe('');
    // The form still renders (the modal opened; Send is gated, not broken).
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-selected-board' }).props
        .children,
    ).toBe('board-77');
  });

  it('still opens the form when the settings load fails (never blocks onboarding)', async () => {
    mockGetItem.mockRejectedValue(new Error('storage error'));
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      bleProvisioningService: ble.service,
    });
    await openBleForm(renderer, ble);

    expect(inputValueOf(renderer, 'boards-ble-broker-input')).toBe('');
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-selected-board' }).props
        .children,
    ).toBe('board-77');
  });
});

/** Flatten an RN style (object or array) into one plain object. */
function flatStyle(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  return Object.assign(
    {},
    ...(layers.filter(
      layer => layer !== null && typeof layer === 'object',
    ) as Record<string, unknown>[]),
  );
}

/** The minHeight (or ≥44 absence check) of a pressable by its testID. */
function pressableStyle(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): Record<string, unknown> {
  const node = renderer.root
    .findAllByProps({ testID })
    .find(candidate => typeof candidate.props.onPress === 'function');
  if (!node) {
    throw new Error(`No pressable node for testID "${testID}"`);
  }
  return flatStyle(node.props.style);
}

/** Whether the node carrying `testID` sits INSIDE a ScrollView subtree. */
function isInsideScrollView(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean {
  let current = (
    renderer.root.findByProps({ testID }) as unknown as {
      parent: {
        type: unknown;
        parent: unknown;
      } | null;
    }
  ).parent;
  while (current !== null && current !== undefined) {
    if (current.type === ScrollView) {
      return true;
    }
    current = current.parent as typeof current;
  }
  return false;
}

describe('BoardsScreen (footer two-row layout, boards-reassign-layout-remove-sharing)', () => {
  it('the room status line and the action row are SEPARATE regions (column footer, no wrap)', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });

    const footer = flatStyle(
      renderer.root.findByProps({ testID: 'boards-footer-board-1' }).props
        .style,
    );
    expect(footer.flexDirection).toBe('column');
    expect(footer.flexWrap).toBeUndefined();

    // The action row is its own region: assign button + ⋯ button, aligned.
    const actions = flatStyle(
      renderer.root.findByProps({ testID: 'boards-footer-actions-board-1' })
        .props.style,
    );
    expect(actions.flexDirection).toBe('row');
    expect(
      flatStyle(
        renderer.root.findByProps({ testID: 'boards-footer-assign-board-1' })
          .props.style,
      ).minHeight,
    ).toBeGreaterThanOrEqual(44);
    expect(
      flatStyle(
        renderer.root.findByProps({ testID: 'boards-card-menu-board-1' }).props
          .style,
      ).minWidth,
    ).toBeGreaterThanOrEqual(44);
  });

  it('a LONG room name is constrained to its own line (numberOfLines 1) and never displaces the action row', async () => {
    const renderer = await renderScreen({
      boards: [BOUND_BOARD],
      rooms: [
        {
          id: 'room-a',
          name: 'Phòng sinh hoạt cộng đồng tầng thượng với tên cực dài',
          order: 0,
          code: 'board-1',
        },
        { id: 'room-b', name: 'Phòng ngủ', order: 1 },
      ],
    });

    // The room line clips (structural pin — Jest cannot measure pixels),
    // so a long name cannot push `Đổi phòng` / `⋯` onto an unintended row.
    const roomText = renderer.root.findByProps({
      testID: 'boards-room-board-1',
    });
    expect(roomText.props.numberOfLines).toBe(1);
    expect(exists(renderer, 'boards-footer-assign-board-1')).toBe(true);
    expect(exists(renderer, 'boards-card-menu-board-1')).toBe(true);
    expect(visibleText(renderer)).toContain(STRINGS.boards.reassignFooter);
  });

  it('the assign button fills the action row (flex 1) beside the ⋯ button', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });
    const style = flatStyle(
      renderer.root.findByProps({ testID: 'boards-footer-assign-board-1' })
        .props.style,
    );
    expect(style.flex).toBe(1);
  });
});

describe('BoardsScreen (assign dialog room list, boards-reassign-layout-remove-sharing)', () => {
  /** 12 rooms — enough to prove a large candidate list is bounded. */
  const MANY_ROOMS: readonly Room[] = Array.from({ length: 12 }, (_, i) => ({
    id: `room-${i}`,
    name: `Phòng số ${i}`,
    order: i,
  }));

  async function openDialog(
    renderer: TestRenderer.ReactTestRenderer,
    code = 'board-2',
  ): Promise<void> {
    await press(renderer, `boards-footer-assign-${code}`);
  }

  it('room rows are full-width selectable rows with a selected state + accessibilityState.selected', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'board-2', status: 'seen' }],
    });
    await openDialog(renderer);

    const before = renderer.root.findByProps({
      testID: 'boards-assign-target-room-a',
    });
    expect(before.props.accessibilityRole).toBe('button');
    expect(before.props.accessibilityState).toEqual({ selected: false });
    const rowStyle = flatStyle(before.props.style);
    expect(rowStyle.minHeight).toBeGreaterThanOrEqual(44);
    // Unselected rows carry no check indicator.
    expect(exists(renderer, 'boards-assign-check-room-a')).toBe(false);

    await press(renderer, 'boards-assign-target-room-a');
    const after = renderer.root.findByProps({
      testID: 'boards-assign-target-room-a',
    });
    expect(after.props.accessibilityState).toEqual({ selected: true });
    expect(exists(renderer, 'boards-assign-check-room-a')).toBe(true);
  });

  it('a large room list renders fully inside a BOUNDED scroll region with Hủy/Xác nhận OUTSIDE it', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'board-2', status: 'seen' }],
      rooms: MANY_ROOMS,
    });
    await openDialog(renderer);

    // Every candidate renders (inside the list).
    for (const room of MANY_ROOMS) {
      expect(exists(renderer, `boards-assign-target-${room.id}`)).toBe(true);
    }
    // The list itself is height-bounded (scrolls on small screens).
    const listStyle = flatStyle(
      renderer.root.findByProps({ testID: 'boards-assign-room-list' }).props
        .style,
    );
    expect(typeof listStyle.maxHeight).toBe('number');
    expect(listStyle.maxHeight as number).toBeGreaterThan(0);
    expect(listStyle.maxHeight as number).toBeLessThanOrEqual(320);

    // The dialog actions are siblings of the list — never trapped inside
    // the scroll region.
    expect(isInsideScrollView(renderer, 'boards-assign-cancel')).toBe(false);
    expect(isInsideScrollView(renderer, 'boards-assign-confirm')).toBe(false);
  });

  it('no remaining room candidates → the truthful message and a DISABLED confirm', async () => {
    const renderer = await renderScreen({
      boards: [BOUND_BOARD],
      rooms: [{ id: 'room-a', name: 'Phòng khách', order: 0, code: 'board-1' }],
    });
    await press(renderer, 'boards-footer-assign-board-1');

    expect(exists(renderer, 'boards-assign-room-list')).toBe(false);
    expect(visibleText(renderer)).toContain(STRINGS.boards.noRoomAvailable);
    expect(
      renderer.root.findByProps({ testID: 'boards-assign-confirm' }).props
        .disabled,
    ).toBe(true);
  });

  it('the scrim cancels the assign dialog (no visible modal remains)', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'board-2', status: 'seen' }],
    });
    await openDialog(renderer);
    expect(exists(renderer, 'boards-assign-target-room-a')).toBe(true);

    await press(renderer, 'boards-assign-scrim');
    expect(
      renderer.root
        .findAllByType(Modal)
        .find(node => node.props.visible === true),
    ).toBeUndefined();
  });
});

describe('board share builders removed (boards-reassign-layout-remove-sharing)', () => {
  it('BoardsScreen no longer exports the share payload builders', () => {
    const mod = BoardsScreenModule as unknown as Record<string, unknown>;
    expect(mod.buildBoardShareCodeText).toBeUndefined();
    expect(mod.buildBoardConfigShareText).toBeUndefined();
  });
});

describe('BoardsScreen 44pt search-row scan button (dashboard-history-board-touch-share)', () => {
  it('the search-row QR button carries explicit ≥44×44 hit bounds (not padding-only)', async () => {
    const renderer = await renderScreen();
    const style = pressableStyle(renderer, 'boards-scan-button');
    expect(typeof style.minWidth).toBe('number');
    expect(style.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof style.minHeight).toBe('number');
    expect(style.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});

describe('BoardsScreen (footer primary assign button, dashboard-history-board-touch-share)', () => {
  afterEach(() => {
    mockPlatformOS = 'ios';
  });

  it('an unbound board shows the ≥44pt "Gán vào phòng" footer button that opens the assign dialog DIRECTLY', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'board-2', status: 'seen' }],
    });
    const style = pressableStyle(renderer, 'boards-footer-assign-board-2');
    expect(typeof style.minHeight).toBe('number');
    expect(style.minHeight as number).toBeGreaterThanOrEqual(44);
    expect(visibleText(renderer)).toContain(STRINGS.boards.assignAction);

    // Press → the EXISTING assign confirm dialog (not the sheet).
    await press(renderer, 'boards-footer-assign-board-2');
    expect(exists(renderer, 'boards-assign-target-room-a')).toBe(true);
    expect(exists(renderer, 'boards-assign-target-room-b')).toBe(true);
    expect(exists(renderer, 'boards-sheet-assign-board-2')).toBe(false);
  });

  it('a bound board shows the ≥44pt "Đổi phòng" footer button (current room NOT a candidate)', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });
    const style = pressableStyle(renderer, 'boards-footer-assign-board-1');
    expect(style.minHeight as number).toBeGreaterThanOrEqual(44);
    expect(visibleText(renderer)).toContain(STRINGS.boards.reassignFooter);

    await press(renderer, 'boards-footer-assign-board-1');
    expect(exists(renderer, 'boards-assign-target-room-a')).toBe(false);
    expect(exists(renderer, 'boards-assign-target-room-b')).toBe(true);
  });

  it('the card action button carries explicit ≥44×44 bounds (not hitSlop)', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });
    const style = pressableStyle(renderer, 'boards-card-menu-board-1');
    expect(typeof style.minWidth).toBe('number');
    expect(style.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof style.minHeight).toBe('number');
    expect(style.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});

describe('BoardsScreen (board action sheet — sharing removed, boards-reassign-layout-remove-sharing)', () => {
  const shareSpy = jest.spyOn(Share, 'share');

  beforeEach(() => {
    mockPlatformOS = 'ios';
    shareSpy.mockReset();
    shareSpy.mockResolvedValue({ action: 'sharedAction' });
  });

  afterEach(() => {
    mockPlatformOS = 'ios';
  });

  it('a bound board sheet lists WiFi + delete ONLY — both share rows are gone', async () => {
    const renderer = await renderScreen({ boards: [BOUND_BOARD] });
    await press(renderer, 'boards-card-menu-board-1');

    expect(exists(renderer, 'boards-sheet-wifi-board-1')).toBe(true);
    expect(exists(renderer, 'boards-sheet-delete-board-1')).toBe(true);
    expect(exists(renderer, 'boards-sheet-assign-board-1')).toBe(false);
    expect(exists(renderer, 'boards-sheet-share-code-board-1')).toBe(false);
    expect(exists(renderer, 'boards-sheet-share-config-board-1')).toBe(false);
    expect(visibleText(renderer)).toContain(STRINGS.boards.wifiAction);
    // No share wording anywhere in the sheet.
    expect(visibleText(renderer)).not.toContain('Chia sẻ');

    // Every remaining sheet row is at least 44pt tall.
    for (const rowID of [
      'boards-sheet-wifi-board-1',
      'boards-sheet-delete-board-1',
    ]) {
      expect(
        pressableStyle(renderer, rowID).minHeight as number,
      ).toBeGreaterThanOrEqual(44);
    }
  });

  it('an unbound board sheet lists WiFi and delete (no share rows)', async () => {
    const renderer = await renderScreen({
      boards: [{ code: 'board-2', status: 'seen' }],
    });
    await press(renderer, 'boards-card-menu-board-2');

    expect(exists(renderer, 'boards-sheet-wifi-board-2')).toBe(true);
    expect(exists(renderer, 'boards-sheet-delete-board-2')).toBe(true);
    expect(exists(renderer, 'boards-sheet-share-code-board-2')).toBe(false);
    expect(exists(renderer, 'boards-sheet-share-config-board-2')).toBe(false);
  });

  it('no sheet/dialog interaction ever triggers Share.share (side-effect-free removal)', async () => {
    const assignBoard = jest.fn(async () => ({ ok: true, message: '' }));
    const deleteBoard = jest.fn(async () => ({ ok: true, message: '' }));
    const renderer = await renderScreen({
      boards: [BOUND_BOARD, { code: 'board-2', status: 'seen' }],
      onAssignBoard: assignBoard,
      onDeleteBoard: deleteBoard,
    });

    // Walk every surviving route: sheet cancel, WiFi (BLE modal), delete
    // confirm, footer assign dialog — none may touch the platform share.
    await press(renderer, 'boards-card-menu-board-1');
    await press(renderer, 'boards-sheet-cancel');
    await press(renderer, 'boards-footer-assign-board-1');
    await press(renderer, 'boards-assign-target-room-b');
    await press(renderer, 'boards-assign-confirm');
    await press(renderer, 'boards-card-menu-board-1');
    await press(renderer, 'boards-sheet-delete-board-1');
    await press(renderer, 'boards-delete-cancel');

    expect(assignBoard).toHaveBeenCalledTimes(1);
    expect(deleteBoard).not.toHaveBeenCalled();
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('the WiFi row opens the EXISTING BLE modal for a KNOWN board (and is hidden on web)', async () => {
    const ble = makeBleServiceFake();
    const renderer = await renderScreen({
      boards: [BOUND_BOARD],
      bleProvisioningService: ble.service,
    });
    await press(renderer, 'boards-card-menu-board-1');
    await press(renderer, 'boards-sheet-wifi-board-1');
    await act(async () => {});

    // The modal opened for THIS board's code — the scan runs and the
    // board's advertisement selects it (the modal's real flow).
    expect(ble.service.startScan).toHaveBeenCalled();
    await act(async () => {
      ble.deliver({
        deviceId: 'AA:BB:CC:DD:EE:01',
        boardId: 'board-1',
        rssi: -58,
        localName: 'IoTBoard-board-1',
      });
    });
    await act(async () => {});
    expect(
      renderer.root.findByProps({ testID: 'boards-ble-selected-board' }).props
        .children,
    ).toBe('board-1');

    // Hidden on web (same gate as the not-found sheet handoff).
    const webRenderer = await renderScreen({
      boards: [BOUND_BOARD],
      bleProvisioningService: ble.service,
    });
    mockPlatformOS = 'web';
    await press(webRenderer, 'boards-card-menu-board-1');
    expect(exists(webRenderer, 'boards-sheet-wifi-board-1')).toBe(false);
  });
});
