/**
 * BoardsScreen — the hardware-boards discovery surface
 * (board-discovery-binding plan items 10 + 12; descriptor-driven body per
 * boards-topic-contract-v2; card layout + search + footer action sheet per
 * boards-card-layout-search AD-1..AD-7).
 *
 * Display convention (boards-display-by-type, user-approved 2026-09-18 —
 * DURABLE): the card TITLE is the descriptor `boardType` (e.g.
 * `IoT_ESP32-S2R3`) — every board of the same type displays identically
 * ("cùng loại dùng 1 cái"); a hardware revision is a new boardType string
 * (`IoT_ESP32-S2R3-V2`) and gets a new title + image naturally. The
 * `displayName` is metadata and is NEVER displayed, even when present.
 * The wire code shows as a labeled mono `Id: {code}` line — on descriptor
 * boards only (a descriptor-less board falls back to the `Board {code}`
 * title, which already contains the code, so no second copy). There is NO
 * separate boardType badge (it duplicated the title). ONE image per TYPE.
 *
 * One gel card per board discovered on the broker (from the RETAINED
 * `<prefix>/boards/<code>/descriptor` + `<prefix>/boards/<code>/status`
 * topics — the inventory itself lives in
 * `BoardInventoryService`/`boardStore`):
 *
 * - header: a 56×56 board thumbnail (the bundled photo keyed by the
 *   board TYPE — the descriptor `boardType`, one image per type, see
 *   `boardImages.ts` — or the Ionicons `hardware-chip-outline`
 *   placeholder centered on a light neutral fill while no photo is
 *   bundled), the title column (the `boardType` as the title — one line
 *   with a tail ellipsis; `Board {code}` fallback for a board without a
 *   descriptor — plus the labeled `Id: {code}` mono line on descriptor
 *   boards) + the status chip (online = the smart teal accent, offline =
 *   neutral gray, seen = secondary caption — "descriptor seen, no status
 *   message yet");
 * - body: the DESCRIPTOR data — one chip per declared sensor channel
 *   (`S1 · Nhiệt độ`, capability-catalog label with raw-field fallback),
 *   the declared relay channels compressed to K-ranges as a badge
 *   (`K1–K3`), and — for an OFFLINE board with a descriptor — the muted
 *   stale-data note (the values shown are the board's last publish). A
 *   board without a descriptor yet shows the honest hint;
 * - footer: TWO stacked regions (boards-reassign-layout-remove-sharing,
 *   user-approved 2026-09-26 — the old `flexWrap` row let a long room name
 *   push the controls onto an unintended wrap line). Region 1 is the room
 *   status on its OWN constrained line: `Phòng: {tên}` one-line ellipsized,
 *   or the tappable `Chưa gán phòng — nhấn để gán` hint for a free board.
 *   Region 2 is a stable action row: the PRIMARY ≥44pt assign button
 *   (`Gán vào phòng` unbound / `Đổi phòng` bound — it opens the SAME
 *   confirm dialog; the unassigned hint opens it DIRECTLY too, no dead-end
 *   sheet detour) + a ≥44×44 `⋯` button opening the action sheet (third
 *   Modal, same centered recipe as the confirm dialogs): WiFi setup for a
 *   KNOWN board (native only) and deletion for every board with its
 *   consequence described. Deletion requires confirmation. The
 *   former `Chia sẻ mã` / `Chia sẻ cấu hình` share rows are REMOVED
 *   entirely (no `Share.share` anywhere in the screen); the QR label
 *   scanner stays — it identifies boards, it never carried credentials.
 *
 * Search (AD-4): a text input above the list filters boards realtime,
 * case-insensitively, over the code / displayName / boardType / bound
 * room name (pure `filterBoardsByQuery`, applied BEFORE the online-first
 * sort so the rank order survives inside the result). No match shows the
 * `searchNoResults` hint; the `boards-empty` state still covers "no
 * boards at all" — WITH the scan affordance (fix cycle 1): a
 * zero-inventory user has no search row, so the scan pill is rendered
 * above the empty hint (scanning is exactly their path, and the
 * not-found sheet then explains what they scanned).
 *
 * QR scanner (boards-qr-scan, AD-2/AD-3/AD-6): a `Quét mã board` button
 * next to the search bar opens the `BoardsScannerModal` camera shell.
 * The screen owns ALL matching: the raw scan is zod-validated
 * (`parseBoardQrLabel`) → invalid keeps the camera open with the inline
 * error (and — live-debugging diagnostic — the truncated RAW payload
 * under it, so a rejected scan shows what the camera actually delivered
 * and a wrong QR is instantly distinguishable from a camera-path
 * misread); a valid label for a DISCOVERED board closes the scanner,
 * clears a hiding search query first, scrolls the card into view and
 * lights the 2s teal highlight ring; a valid label for an UNSEEN board
 * opens the not-found sheet (the QR's own boardType/boardId + the honest
 * broker hint; the thumb keys off the QR's OWN boardType — the bundled
 * type photo when the map has it, the placeholder otherwise — AD-5).
 *
 * BLE onboarding (boards-ble-wifi-provisioning, AD-1): the not-found sheet
 * is no longer a dead-end — for a brand-new board (no WiFi yet) it gains
 * a `Cấu hình WiFi qua Bluetooth` handoff (hidden on web, AD-7) that
 * closes the sheet and opens `BleProvisioningModal` with the QR label's
 * boardId. The screen owns only the state + wiring; ALL BLE logic lives
 * in the service seam (injected fake in tests, the real lazy singleton
 * in production) and the modal never imports the BLE stack (AD-6).
 *
 * BLE prefill v2 (`ble-provisioning-v2-broker-push`, AD-v2-6): the screen
 * also reads the persisted settings ONCE through the settings module's
 * api facade (read-only AsyncStorage load) and derives the modal's
 * Broker + MQTT prefill — the broker HOST from the settings' MQTT host
 * by a TOLERANT REGEX (`deriveBrokerAddress`; never the `URL`
 * constructor, which Hermes lacks) + the firmware default port 1883, the
 * MQTT user/pass taken verbatim. A derivation or load failure leaves the
 * fields empty — the user types manually, the flow is never blocked.
 * The MQTT credentials live only as prefill + the one BLE send: the app
 * never persists them.
 *
 * Visual language: the shared Smart Home wash + `tokens.smart` — no new
 * palette. All labels come from `STRINGS.boards`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { STRINGS } from '@core/i18n';
import { createLogger } from '@core/logger';
import { useTheme, type ThemeTokens } from '@core/theme';
import { AsyncStorageSettingsRepository } from '@modules/settings/api';
import type {
  BoardInventoryEntry,
  CapabilityDef,
  Room,
} from '@modules/devices/api';
import { boardAssignment } from '../internal/domain/devices';
import {
  BLE_BROKER_DEFAULT_PORT,
  validateBrokerAddress,
} from '../internal/domain/bleProvisioningContract';
import {
  getBleWifiProvisioningService,
  type BleWifiProvisioningServiceLike,
} from '../internal/services/bleWifiProvisioningService';

import {
  BleProvisioningModal,
  type BleProvisionPrefill,
} from './BleProvisioningModal';
import { BoardsScannerModal } from './BoardsScannerModal';
import { boardImageFor } from './boardImages';
import { parseBoardQrLabel, type BoardQrLabel } from './boardQrLabel';

/** Generic action outcome surfaced through the confirm dialog. */
export interface BoardActionOutcome {
  readonly ok: boolean;
  readonly message: string;
}

interface BoardsScreenProps {
  /** Navigate back to the Settings root (explicit, always available). */
  readonly onBack: () => void;
  /** Discovered boards (board store snapshot). */
  readonly boards: readonly BoardInventoryEntry[];
  /** All rooms (binding targets + `Phòng:` footer). */
  readonly rooms: readonly Room[];
  /** Capability catalog (field labels). */
  readonly capabilities: readonly CapabilityDef[];
  /** Bind the board to a room (registry-validated unique code). */
  readonly onAssignBoard: (
    code: string,
    roomId: string,
  ) => Promise<BoardActionOutcome>;
  /** Hide the board from this app without changing its room binding. */
  readonly onDeleteBoard: (code: string) => Promise<BoardActionOutcome>;
  /** Restore a board hidden by local deletion without changing room data. */
  readonly onRestoreBoard: (
    code: string,
    boardType?: string,
  ) => Promise<BoardActionOutcome>;
  /** Board codes hidden locally by a previous delete action. */
  readonly deletedBoardCodes: readonly string[];
  /**
   * Injectable BLE provisioning service (boards-ble-wifi-provisioning):
   * tests pass a fake; production resolves the real lazy singleton. The
   * QR not-found sheet hands the QR boardId to the BLE modal through the
   * service seam — neither the screen nor the modal touches the BLE stack
   * directly, and on web the whole flow is hidden (AD-7).
   */
  readonly bleProvisioningService?: BleWifiProvisioningServiceLike;
}

/** Pick-list order: online boards first, then seen, offline last. */
export function sortBoardsOnlineFirst(
  boards: readonly BoardInventoryEntry[],
): readonly BoardInventoryEntry[] {
  const rank = (status: BoardInventoryEntry['status']): number =>
    status === 'online' ? 0 : status === 'seen' ? 1 : 2;
  return [...boards].sort(
    (a, b) => rank(a.status) - rank(b.status) || a.code.localeCompare(b.code),
  );
}

/**
 * Case-insensitive search filter (AD-4, pure): a board matches when the
 * query appears in its code, its descriptor displayName, its descriptor
 * boardType or the name of the room it is bound to (`roomNameOf` resolves
 * the code → bound-room name, `null` when unassigned). An empty or
 * whitespace-only query is a PASSTHROUGH — the same array reference comes
 * back, keeping the unfiltered path allocation-free. Callers sort AFTER
 * filtering so the online-first rank order is preserved within the
 * filtered result (R3).
 */
export function filterBoardsByQuery(
  boards: readonly BoardInventoryEntry[],
  roomNameOf: (code: string) => string | null,
  query: string,
): readonly BoardInventoryEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return boards;
  }
  return boards.filter(board => {
    const haystacks: readonly (string | null | undefined)[] = [
      board.code,
      board.descriptor?.displayName,
      board.descriptor?.boardType,
      roomNameOf(board.code),
    ];
    return haystacks.some(
      haystack =>
        haystack !== null &&
        haystack !== undefined &&
        haystack.toLowerCase().includes(needle),
    );
  });
}

const BROKER_SCHEME_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const BROKER_PORT_SUFFIX_REGEX = /:\d+$/;

/**
 * Derive the board's broker address `host:1883` from the persisted
 * settings' MQTT host (pure, exported for tests). The settings store the
 * app's WebSocket endpoint — a plain host, or a URL-ish string the user
 * typed (the settings schema only requires a non-empty trimmed string) —
 * so the derivation is a TOLERANT REGEX pass, deliberately NOT the `URL`
 * constructor (Hermes does not provide one): strip an optional scheme
 * (`ws://`, `wss://`, `mqtt://`, `tcp://`, …), drop any `user:pass@`
 * userinfo and any path/query, then drop a trailing `:port` — the app's
 * WebSocket port must NEVER leak into the board's MQTT-TCP address
 * (AD-v2-2); the firmware gets the default
 * {@link BLE_BROKER_DEFAULT_PORT} unless the user types an explicit port.
 * The result must satisfy the contract's broker validation — any
 * derivation failure (empty, whitespace, IPv6-ish multi-colon host)
 * returns '' so the user types the address manually: the flow is never
 * blocked (plan R1).
 */
export function deriveBrokerAddress(mqttHost: string): string {
  let value = mqttHost.trim();
  if (value === '') {
    return '';
  }
  const scheme = BROKER_SCHEME_REGEX.exec(value);
  if (scheme !== null) {
    value = value.slice(scheme[0].length);
  }
  const at = value.lastIndexOf('@');
  if (at !== -1) {
    value = value.slice(at + 1);
  }
  const pathStart = value.search(/[/?#]/);
  if (pathStart !== -1) {
    value = value.slice(0, pathStart);
  }
  const port = BROKER_PORT_SUFFIX_REGEX.exec(value);
  if (port !== null) {
    value = value.slice(0, port.index);
  }
  if (value === '') {
    return '';
  }
  const candidate = `${value}:${BLE_BROKER_DEFAULT_PORT}`;
  return validateBrokerAddress(candidate).ok ? candidate : '';
}

/** Mono-ish font for the board code (the wire identity). */
const monoFontFamily = Platform.select({
  ios: 'Menlo',
  default: 'monospace',
});

/** Teal highlight ring auto-clear duration (boards-qr-scan AD-6). */
const HIGHLIGHT_MS = 2000;

/** Gap kept above the highlighted card after the scroll-into-view. */
const SCROLL_PAD = 24;

/**
 * Compress declared relay channels into `K`-range labels (pure):
 * `['K1','K2','K3']` → `K1–K3`, `['K1','K3']` → `K1, K3`,
 * `['K2']` → `K2`. Numeric adjacency (not array adjacency) decides a run,
 * and the input order does not matter.
 */
export function compressRelayChannels(channels: readonly string[]): string {
  const slots = channels
    .map(channel => Number(channel.replace(/^K/, '')))
    .filter(slot => Number.isInteger(slot) && slot >= 1 && slot <= 10)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  let index = 0;
  while (index < slots.length) {
    const start = slots[index]!;
    let end = start;
    while (index + 1 < slots.length && slots[index + 1] === end + 1) {
      end = slots[index + 1]!;
      index += 1;
    }
    parts.push(start === end ? `K${start}` : `K${start}–K${end}`);
    index += 1;
  }
  return parts.join(', ');
}

function statusColor(
  status: BoardInventoryEntry['status'],
  tokens: ThemeTokens,
): string {
  switch (status) {
    case 'online':
      return tokens.smart.colors.teal;
    case 'offline':
      return tokens.smart.colors.neutral;
    case 'seen':
      return tokens.smart.colors.textSecondary;
  }
}

/**
 * Card title (boards-display-by-type AD-1/AD-3): the descriptor
 * `boardType` — every board of the same type displays identically — or
 * the `Board {code}` fallback for a board that has not published a
 * descriptor yet. `displayName` is deliberately NOT used for display
 * (pure metadata; the firmware does not need to set it).
 */
function boardTitleOf(board: BoardInventoryEntry): string {
  return (
    board.descriptor?.boardType ??
    STRINGS.boards.boardFallback.replace('{code}', board.code)
  );
}

/**
 * The hardware-boards screen: one gel card per discovered board.
 */
export function BoardsScreen({
  onBack,
  boards,
  rooms,
  capabilities,
  onAssignBoard,
  onDeleteBoard,
  onRestoreBoard,
  deletedBoardCodes,
  bleProvisioningService,
}: BoardsScreenProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  // The BLE provisioning service (boards-ble-wifi-provisioning): injected
  // (tests) or the real lazy singleton — resolved once per screen so the
  // modal receives a stable seam.
  const provisioningService = useMemo(
    () => bleProvisioningService ?? getBleWifiProvisioningService(),
    [bleProvisioningService],
  );

  // BLE prefill v2 (AD-v2-6): the settings read ONCE at screen mount,
  // through the settings module's api facade (read-only AsyncStorage
  // load — zod-validated, defaults when nothing was saved). Any failure
  // keeps the prefill null → the modal's Broker/MQTT fields start empty
  // and the user types manually (the flow is never blocked). Loaded at
  // mount — not at modal open — so the values are ready before the modal
  // can even appear.
  const settingsRepository = useMemo(
    () => new AsyncStorageSettingsRepository(createLogger('BoardsScreen')),
    [],
  );
  const [blePrefill, setBlePrefill] = useState<BleProvisionPrefill | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    void settingsRepository.load().then(result => {
      if (cancelled || !result.ok) {
        return;
      }
      setBlePrefill({
        broker: deriveBrokerAddress(result.value.mqtt.host),
        mqttUsername: result.value.mqtt.username ?? '',
        mqttPassword: result.value.mqtt.password ?? '',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [settingsRepository]);

  // Board↔room mapping: the pure selector over the rooms snapshot decides
  // which room (if any) each board is bound to.
  const assignment = useMemo(() => boardAssignment(rooms), [rooms]);

  // Search query (AD-4): filters the list BEFORE the online-first sort.
  const [query, setQuery] = useState('');

  // Confirm-dialog state: one open dialog at a time (assign or delete).
  const [assigning, setAssigning] = useState<BoardInventoryEntry | null>(null);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [deletingBoard, setDeletingBoard] =
    useState<BoardInventoryEntry | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Action-sheet state (AD-2): which board's actions are open. The sheet
  // only ROUTES — selecting an action closes it and opens the SAME
  // confirm dialog the inline footer links used to open.
  const [sheetBoard, setSheetBoard] = useState<BoardInventoryEntry | null>(
    null,
  );

  const openSheet = (board: BoardInventoryEntry) => {
    setSheetBoard(board);
  };

  // The sheet board's live binding (recomputed from the rooms snapshot):
  // decides which actions the sheet lists.
  const sheetBoundRoom = sheetBoard
    ? assignment.get(sheetBoard.code) ?? null
    : null;

  const startAssign = (board: BoardInventoryEntry) => {
    setAssigning(board);
    setAssignTarget(null);
    setDialogError(null);
  };

  const confirmAssign = async () => {
    if (!assigning || !assignTarget || busy) {
      return;
    }
    setBusy(true);
    const result = await onAssignBoard(assigning.code, assignTarget);
    setBusy(false);
    if (!result.ok) {
      // Keep the dialog open so the user can pick a different room.
      setDialogError(result.message);
      return;
    }
    setAssigning(null);
  };

  const confirmDelete = async () => {
    if (!deletingBoard || busy) {
      return;
    }
    setBusy(true);
    setDialogError(null);
    const result = await onDeleteBoard(deletingBoard.code);
    setBusy(false);
    if (!result.ok) {
      setDialogError(result.message);
      return;
    }
    setDeletingBoard(null);
  };

  // Sheet routing (AD-2): close the sheet, then run the SAME confirm
  // dialog flow the inline footer links used to open. The assign entry
  // lives on the footer's PRIMARY button (dashboard-history-board-touch-
  // share); boards-reassign-layout-remove-sharing removed the share rows —
  // the sheet keeps the WiFi and delete routes.
  const sheetDelete = () => {
    if (!sheetBoard) {
      return;
    }
    const board = sheetBoard;
    setSheetBoard(null);
    setDeletingBoard(board);
    setDialogError(null);
  };

  const cancelDelete = () => {
    if (!busy) {
      setDeletingBoard(null);
      setDialogError(null);
    }
  };

  // WiFi setup from a KNOWN board (dashboard-history-board-touch-share,
  // AD-4): the sheet row opens the EXISTING BLE provisioning modal for
  // the board's code — a board that is already on the broker may still
  // need re-provisioning. Hidden on web (the BLE stack is unavailable);
  // opening it closes the sheet first (one provisioning surface at a
  // time).
  const sheetWifi = () => {
    if (!sheetBoard) {
      return;
    }
    const boardId = sheetBoard.code;
    setSheetBoard(null);
    setBleBoardId(boardId);
  };

  const targetRoom = assigning
    ? rooms.find(room => room.id === assignTarget) ?? null
    : null;
  // Assignment targets: every room EXCEPT the one currently bound to this
  // board (re-picking it would be a no-op). A room bound to ANOTHER board
  // is a valid target — assigning replaces its code (the "replace a broken
  // board" flow; the registry guarantees the code is never shared).
  const assignedRoomId = assigning
    ? assignment.get(assigning.code)?.id
    : undefined;
  const assignCandidates = rooms.filter(room => room.id !== assignedRoomId);

  // Filter FIRST, then sort (R3): the online-first rank applies within the
  // filtered result, never resurrecting hidden boards.
  const visibleBoards = useMemo(() => {
    const roomNameOf = (code: string): string | null =>
      assignment.get(code)?.name ?? null;
    return sortBoardsOnlineFirst(
      filterBoardsByQuery(boards, roomNameOf, query),
    );
  }, [boards, assignment, query]);

  // QR scanner state (boards-qr-scan): modal visibility, the inline
  // invalid-label error (AD-3), the teal highlight ring (AD-6) and the
  // not-found sheet board (AD-2 case B — the QR's own boardType/boardId).
  // Declared AFTER the visibleBoards memo: handleScanned reads it, and a
  // closure over a not-yet-declared memo breaks the React Compiler's
  // memoization preservation.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // Diagnostic (live-debugging fix): the RAW payload that produced the
  // last rejection — displayed (truncated) under the error so a mis-scan
  // is self-diagnosing: the user sees whether the camera delivered
  // something different from the QR content. Same lifecycle as the
  // error: set together, cleared on fresh open + on accepted scans.
  const [lastRawScanned, setLastRawScanned] = useState<string | null>(null);
  const [highlightCode, setHighlightCode] = useState<string | null>(null);
  const [unknownBoard, setUnknownBoard] = useState<BoardQrLabel | null>(null);

  // Not-found sheet thumb (boards-display-by-type AD-5): the QR payload's
  // OWN boardType keys the image — an undiscovered board still has a TYPE,
  // so a bundled type photo renders; a map miss keeps the chip placeholder.
  const unknownBoardImage = unknownBoard
    ? boardImageFor(unknownBoard.boardType)
    : null;

  // BLE onboarding (boards-ble-wifi-provisioning, AD-1): the not-found
  // sheet's handoff. `bleBoardId` doubles as the modal's open flag AND its
  // initial boardId — the QR label's own id auto-selects the advertising
  // board inside the modal (one-shot). Mounted only on native (the button
  // is hidden on web, AD-7); the service is the injected/lazy seam.
  const [bleBoardId, setBleBoardId] = useState<string | null>(null);
  const [bleBoardType, setBleBoardType] = useState<string | null>(null);
  const [pendingScrollCode, setPendingScrollCode] = useState<string | null>(
    null,
  );
  const openBleProvisioning = () => {
    if (!unknownBoard) {
      return;
    }
    const boardId = unknownBoard.boardId;
    // Close the sheet first — one provisioning surface at a time.
    setUnknownBoard(null);
    setBleBoardId(boardId);
    setBleBoardType(unknownBoard.boardType);
  };

  const handleBleProvisioned = useCallback(
    (boardId: string): void => {
      // BLE identifies the physical board from its advertised name. Remove
      // the local hide marker at this boundary too, because provisioning can
      // be the user's recovery path even when the QR label was treated as a
      // not-found board before the broker publishes retained messages.
      // The selected BLE board may differ from the QR label after the user
      // chooses another board. Provisioning a board that was never hidden
      // must still seed its card. Reflashing the same MAC preserves its id.
      // `onRestoreBoard` is idempotent: it clears the marker and seeds the
      // inventory entry either way.
      void onRestoreBoard(boardId, bleBoardType ?? undefined)
        .then(result => {
          if (result.ok) {
            if (query.trim() !== '') {
              setQuery('');
              setPendingScrollCode(boardId);
            }
            setHighlightCode(boardId);
            return;
          }
          setBleBoardId(null);
          setBleBoardType(null);
          setScanError(result.message || STRINGS.boards.scanRestoreFailed);
          setScannerOpen(true);
        })
        .catch(() => {
          setBleBoardId(null);
          setBleBoardType(null);
          setScanError(STRINGS.boards.scanRestoreFailed);
          setScannerOpen(true);
        });
    },
    [bleBoardType, onRestoreBoard, query],
  );

  // Scroll-into-view plumbing (AD-6): y-offsets per card code measured via
  // onLayout; a pending target defers the scroll to the next layout pass
  // (right after a query clear the offset map is stale until RN
  // re-measures the reflowed list).
  const scrollRef = useRef<ScrollView | null>(null);
  const cardOffsetsRef = useRef<Map<string, number>>(new Map());

  const openScanner = () => {
    // A fresh open never shows the previous session's inline error (or
    // its diagnostic raw payload).
    setScanError(null);
    setLastRawScanned(null);
    setScannerOpen(true);
  };

  // The scan result router (AD-2/AD-3): parse → invalid keeps the camera
  // open with the inline error and returns `false` — the REJECTION signal
  // that makes the modal re-arm its scan lock, so the camera stays live
  // for the immediate re-scan; valid + absent → restore + optional BLE
  // onboarding sheet; valid + found → close + (clear a hiding search
  // filter first) highlight + scroll. Returns whether the scan was
  // accepted (consumed) by the screen.
  const handleScanned = (raw: string): boolean => {
    const label = parseBoardQrLabel(raw);
    if (!label) {
      // Rejected: the inline error PLUS the raw payload that produced it
      // (diagnostic — the camera may have delivered something different
      // from the QR content; seeing it settles that instantly).
      setScanError(STRINGS.boards.scanInvalid);
      setLastRawScanned(raw);
      return false;
    }
    setScannerOpen(false);
    setScanError(null);
    setLastRawScanned(null);
    if (!boards.some(board => board.code === label.boardId)) {
      // Every valid absent board can be restored, including cold inventories
      // and legacy deletions without a marker. Seed only after persistence
      // succeeds; MQTT remains authoritative for status and channels.
      void onRestoreBoard(label.boardId, label.boardType)
        .then(result => {
          if (result.ok) {
            if (query.trim() !== '') {
              setQuery('');
              setPendingScrollCode(label.boardId);
            }
            setHighlightCode(label.boardId);
            // Keep the existing BLE onboarding entry for a board that has
            // not been hidden locally, while its new card waits for MQTT.
            if (!deletedBoardCodes.includes(label.boardId)) {
              setUnknownBoard(label);
            }
            return;
          }
          // Persistence failure keeps the scanner available for a retry.
          setScanError(result.message || STRINGS.boards.scanRestoreFailed);
          setScannerOpen(true);
        })
        .catch(() => {
          setScanError(STRINGS.boards.scanRestoreFailed);
          setScannerOpen(true);
        });
      return true;
    }

    // Case A: discovered. If the current search filter hides the card,
    // clear the query FIRST so the card re-enters the list (AD-2).
    if (
      query.trim() !== '' &&
      !visibleBoards.some(board => board.code === label.boardId)
    ) {
      setQuery('');
      // The list reflows this commit — scroll after the re-measure.
      setPendingScrollCode(label.boardId);
    }
    setHighlightCode(label.boardId);
    return true;
  };

  // Card layout: store the y-offset for the scroll-into-view (and correct
  // the pending scroll target now that the fresh offset exists).
  const measureCard = (code: string) => (event: LayoutChangeEvent) => {
    cardOffsetsRef.current.set(code, event.nativeEvent.layout.y);
    if (pendingScrollCode === code) {
      setPendingScrollCode(null);
      scrollRef.current?.scrollTo({
        y: Math.max(0, event.nativeEvent.layout.y - SCROLL_PAD),
        animated: true,
      });
    }
  };

  // Highlight ring (AD-6): auto-clears after 2s; a re-scan replaces the
  // code (the state change re-runs this effect, cancelling the previous
  // timer). The immediate scroll uses the LAST measured offset — a card
  // already in view needs no re-measure; the query-clear path corrects
  // itself through measureCard. In the test renderer onLayout never fires
  // → offset 0 → scroll to top; AD-6 pins STATE, not pixel scroll.
  useEffect(() => {
    if (!highlightCode) {
      return;
    }
    const offset = cardOffsetsRef.current.get(highlightCode) ?? 0;
    scrollRef.current?.scrollTo({
      y: Math.max(0, offset - SCROLL_PAD),
      animated: true,
    });
    const timer = setTimeout(() => setHighlightCode(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightCode]);

  return (
    // The ambient Smart Home wash — same recipe as the management screens.
    <LinearGradient
      colors={[
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.flex}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
      >
        <TouchableOpacity
          style={styles.backRow}
          accessibilityLabel={STRINGS.settings.back}
          testID="boards-back"
          onPress={onBack}
        >
          <Ionicons name="arrow-back" size={18} color={tokens.primary} />
          <Text style={[styles.backText, { color: tokens.primary }]}>
            {STRINGS.settings.back}
          </Text>
        </TouchableOpacity>
        <Text
          style={[
            styles.screenTitle,
            { color: tokens.smart.colors.textPrimary },
          ]}
        >
          {STRINGS.boards.title}
        </Text>

        {boards.length === 0 ? (
          <>
            {/* Empty-state scan affordance (boards-qr-scan fix cycle 1):
                a zero-inventory user (fresh install / boards off / broker
                misconfigured) has NO search row to carry the scan action —
                yet scanning is exactly what they need, and the not-found
                sheet then tells them WHAT they scanned + the setup hint.
                Same action + testID as the search-row button; a full-width
                bordered pill in the smart card language. */}
            <TouchableOpacity
              style={[
                styles.emptyScanButton,
                {
                  borderColor: tokens.smart.colors.cardBorder,
                  backgroundColor: tokens.smart.colors.card,
                },
              ]}
              onPress={openScanner}
              accessibilityLabel={STRINGS.boards.scanAction}
              testID="boards-scan-button"
            >
              <Ionicons
                name="qr-code-outline"
                size={18}
                color={tokens.smart.colors.textSecondary}
              />
              <Text
                style={[
                  styles.emptyScanText,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.boards.scanAction}
              </Text>
            </TouchableOpacity>
            <Text
              style={[
                styles.emptyHint,
                { color: tokens.smart.colors.textSecondary },
              ]}
              testID="boards-empty"
            >
              {STRINGS.boards.empty}
            </Text>
          </>
        ) : (
          <>
            {/* Search bar (AD-4): realtime case-insensitive filter over
                code / displayName / boardType / bound room name — with the
                QR scan action (boards-qr-scan) beside it: the filter input
                flexes, the scan button opens the camera modal. */}
            <View style={styles.scanRow}>
              <View
                style={[
                  styles.searchRow,
                  {
                    borderColor: tokens.smart.colors.cardBorder,
                    backgroundColor: tokens.smart.colors.card,
                  },
                ]}
              >
                <Ionicons
                  name="search"
                  size={16}
                  color={tokens.smart.colors.textSecondary}
                />
                <TextInput
                  style={[
                    styles.searchInput,
                    { color: tokens.smart.colors.textPrimary },
                  ]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={STRINGS.boards.searchPlaceholder}
                  placeholderTextColor={tokens.smart.colors.textSecondary}
                  testID="boards-search-input"
                />
                {query.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => setQuery('')}
                    accessibilityLabel={STRINGS.devices.cancel}
                    testID="boards-search-clear"
                  >
                    <Ionicons
                      name="close-circle"
                      size={16}
                      color={tokens.smart.colors.textSecondary}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity
                style={[
                  styles.scanButton,
                  {
                    borderColor: tokens.smart.colors.cardBorder,
                    backgroundColor: tokens.smart.colors.card,
                  },
                ]}
                onPress={openScanner}
                accessibilityLabel={STRINGS.boards.scanAction}
                testID="boards-scan-button"
              >
                <Ionicons
                  name="qr-code-outline"
                  size={18}
                  color={tokens.smart.colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {visibleBoards.length === 0 ? (
              <Text
                style={[
                  styles.emptyHint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
                testID="boards-no-results"
              >
                {STRINGS.boards.searchNoResults}
              </Text>
            ) : (
              visibleBoards.map(board => {
                const boundRoom = assignment.get(board.code) ?? null;
                // Thumbnail keying (boards-display-by-type AD-1): ONE image
                // per hardware TYPE — the descriptor boardType slugifies to
                // the map key (see `boardImages.ts`). A board without a
                // descriptor has no type yet — `''` never matches a key, so
                // the placeholder renders.
                const boardImage = boardImageFor(
                  board.descriptor?.boardType ?? '',
                );
                return (
                  <View
                    key={board.code}
                    style={[
                      styles.boardCard,
                      {
                        backgroundColor: tokens.smart.colors.card,
                        // Highlight ring (boards-qr-scan AD-6): the scanned
                        // board's card wears the teal 2px ring for ~2s.
                        borderColor:
                          highlightCode === board.code
                            ? tokens.smart.colors.teal
                            : tokens.smart.colors.cardBorder,
                        borderWidth: highlightCode === board.code ? 2 : 1,
                      },
                    ]}
                    onLayout={measureCard(board.code)}
                    testID={`boards-card-${board.code}`}
                  >
                    {/* Header: board thumbnail left, then the title
                        column (boardType title / labeled `Id: {code}`
                        mono line), then the status chip (unchanged
                        position). */}
                    <View style={styles.boardHeader}>
                      {boardImage ? (
                        <Image
                          source={boardImage}
                          style={styles.boardThumb}
                          testID={`boards-thumb-${board.code}`}
                        />
                      ) : (
                        <View
                          style={[
                            styles.boardThumb,
                            styles.boardThumbPlaceholder,
                            { borderColor: tokens.smart.colors.cardBorder },
                          ]}
                          testID={`boards-thumb-${board.code}`}
                        >
                          <Ionicons
                            name="hardware-chip-outline"
                            size={28}
                            color={tokens.smart.colors.textSecondary}
                          />
                        </View>
                      )}
                      <View style={styles.boardTitleColumn}>
                        {/* Display convention (boards-display-by-type
                            AD-1/AD-3/AD-4): the boardType IS the title —
                            every board of the same type displays
                            identically; `displayName` is never shown. A
                            board without a descriptor falls back to
                            `Board {code}` (AD-6). The type testID lives on
                            the title node (the badge was removed as a
                            duplicate) — only for descriptor boards, since
                            the fallback title is not a type. L3: long
                            types clip to one line with a tail ellipsis
                            instead of wrapping the card. */}
                        <Text
                          style={[
                            styles.boardTitle,
                            { color: tokens.smart.colors.textPrimary },
                          ]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          testID={
                            board.descriptor
                              ? `boards-type-${board.code}`
                              : undefined
                          }
                        >
                          {boardTitleOf(board)}
                        </Text>
                        {/* AD-2/AD-6: the wire code as a LABELED mono line
                            — `Id: {code}` — on descriptor boards only. A
                            descriptor-less board hides the line: its
                            fallback title already contains the code, and
                            the code must appear exactly once. */}
                        {board.descriptor ? (
                          <Text
                            style={[
                              styles.boardCodeSecondary,
                              { color: tokens.smart.colors.textSecondary },
                            ]}
                          >
                            {STRINGS.boards.idLabel.replace(
                              '{code}',
                              board.code,
                            )}
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={[
                          styles.statusChip,
                          { borderColor: statusColor(board.status, tokens) },
                        ]}
                        testID={`boards-status-${board.code}`}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            {
                              backgroundColor: statusColor(
                                board.status,
                                tokens,
                              ),
                            },
                          ]}
                        />
                        <Text
                          style={[
                            styles.statusText,
                            { color: statusColor(board.status, tokens) },
                          ]}
                        >
                          {board.status === 'online'
                            ? STRINGS.boards.online
                            : board.status === 'offline'
                            ? STRINGS.boards.offline
                            : STRINGS.boards.seen}
                        </Text>
                      </View>
                    </View>

                    {/* Body: DESCRIPTOR data (boards contract v2) — one
                        chip per declared sensor channel (catalog label,
                        raw-field fallback), the declared relay channels
                        compressed to a K-range badge, and the offline
                        stale note. A board without a descriptor yet shows
                        the honest hint. */}
                    {board.descriptor ? (
                      <>
                        {board.descriptor.sensors.length > 0 ? (
                          <View
                            style={styles.sensorChipRow}
                            testID={`boards-sensors-${board.code}`}
                          >
                            {board.descriptor.sensors.map(sensor => {
                              const label =
                                capabilities.find(
                                  def => def.type === sensor.field,
                                )?.label ?? sensor.field;
                              return (
                                <View
                                  key={sensor.channel}
                                  style={[
                                    styles.sensorChip,
                                    {
                                      borderColor:
                                        tokens.smart.colors.cardBorder,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.sensorChipText,
                                      {
                                        color:
                                          tokens.smart.colors.textSecondary,
                                      },
                                    ]}
                                  >
                                    {`${sensor.channel} · ${label}`}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        ) : (
                          <Text
                            style={[
                              styles.boardMeta,
                              { color: tokens.smart.colors.textSecondary },
                            ]}
                          >
                            {STRINGS.boards.noFields}
                          </Text>
                        )}
                        {board.descriptor.relays.length > 0 ? (
                          <View
                            style={[
                              styles.relayBadge,
                              { borderColor: tokens.smart.colors.cardBorder },
                            ]}
                            testID={`boards-relays-${board.code}`}
                          >
                            <Text
                              style={[
                                styles.relayBadgeText,
                                { color: tokens.smart.colors.textSecondary },
                              ]}
                            >
                              {compressRelayChannels(board.descriptor.relays)}
                            </Text>
                          </View>
                        ) : null}
                        {/* Offline + descriptor: the values on screen are
                            the board's LAST PUBLISHED state — say so.
                            Online/seen boards and descriptor-less boards
                            stay note-free. */}
                        {board.status === 'offline' ? (
                          <Text
                            style={[
                              styles.staleNote,
                              { color: tokens.smart.colors.textSecondary },
                            ]}
                            testID={`boards-stale-${board.code}`}
                          >
                            {STRINGS.boards.offlineStaleNote}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <Text
                        style={[
                          styles.boardMeta,
                          { color: tokens.smart.colors.textSecondary },
                        ]}
                        testID={`boards-nodescriptor-${board.code}`}
                      >
                        {STRINGS.boards.noDescriptor}
                      </Text>
                    )}

                    {/* Footer (boards-reassign-layout-remove-sharing):
                        TWO stacked regions — the room status line in its
                        own constrained region (a long room name clips to
                        one line and can never displace the controls),
                        then a stable action row: the PRIMARY ≥44pt assign
                        button ("Gán vào phòng" / "Đổi phòng" — opens the
                        SAME confirm dialog; the unassigned hint opens it
                        DIRECTLY too) + a ≥44×44 ⋯ button opening the
                        sheet. The cardBorder hairline above (L4)
                        separates the footer from the descriptor body. */}
                    <View
                      style={styles.boardFooter}
                      testID={`boards-footer-${board.code}`}
                    >
                      {boundRoom ? (
                        <Text
                          style={[
                            styles.roomLabel,
                            { color: tokens.smart.colors.textSecondary },
                          ]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          testID={`boards-room-${board.code}`}
                        >
                          {STRINGS.boards.roomLabel.replace(
                            '{name}',
                            boundRoom.name,
                          )}
                        </Text>
                      ) : (
                        <TouchableOpacity
                          style={styles.roomHintButton}
                          onPress={() => startAssign(board)}
                          accessibilityRole="button"
                          accessibilityLabel={STRINGS.boards.assignAction}
                          testID={`boards-room-${board.code}`}
                        >
                          <Text
                            style={[
                              styles.unassignedHint,
                              { color: tokens.primary },
                            ]}
                          >
                            {STRINGS.boards.unassignedHint}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <View
                        style={styles.footerActions}
                        testID={`boards-footer-actions-${board.code}`}
                      >
                        <TouchableOpacity
                          style={[
                            styles.footerAssignButton,
                            { backgroundColor: tokens.primary },
                          ]}
                          onPress={() => startAssign(board)}
                          accessibilityRole="button"
                          accessibilityLabel={
                            boundRoom
                              ? STRINGS.boards.reassignFooter
                              : STRINGS.boards.assignAction
                          }
                          testID={`boards-footer-assign-${board.code}`}
                        >
                          <Text style={{ color: tokens.onPrimary }}>
                            {boundRoom
                              ? STRINGS.boards.reassignFooter
                              : STRINGS.boards.assignAction}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.menuButton}
                          onPress={() => openSheet(board)}
                          accessibilityLabel={STRINGS.boards.actionsTitle}
                          testID={`boards-card-menu-${board.code}`}
                        >
                          <Ionicons
                            name="ellipsis-horizontal"
                            size={18}
                            color={tokens.smart.colors.textSecondary}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* Action sheet (AD-2): the footer menu's surface — same centered
          Modal recipe as the confirm dialogs. It only ROUTES: selecting an
          action closes the sheet and opens the SAME confirm dialog flow
          (same callbacks, same error handling, same busy state). */}
      <Modal
        visible={sheetBoard !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetBoard(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSheetBoard(null)}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.devices.cancel}
            testID="boards-sheet-scrim"
          />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.modalTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.boards.actionsTitle}
            </Text>
            <Text
              style={[
                styles.hint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {sheetBoard
                ? `${boardTitleOf(sheetBoard)} · ${sheetBoard.code} · ${
                    sheetBoundRoom
                      ? STRINGS.boards.roomLabel.replace(
                          '{name}',
                          sheetBoundRoom.name,
                        )
                      : STRINGS.boards.roomUnassigned
                  }`
                : ''}
            </Text>
            {sheetBoard ? (
              <>
                {/* WiFi setup (dashboard-history-board-touch-share, AD-4):
                    reachable from a KNOWN board — a board that is already
                    on the broker may still need (re-)provisioning. Hidden
                    on web (the BLE stack is unavailable there, AD-7). */}
                {Platform.OS !== 'web' ? (
                  <Pressable
                    style={[
                      styles.sheetAction,
                      { borderColor: tokens.smart.colors.cardBorder },
                    ]}
                    onPress={sheetWifi}
                    testID={`boards-sheet-wifi-${sheetBoard.code}`}
                  >
                    <Text
                      style={[
                        styles.sheetActionTitle,
                        { color: tokens.smart.colors.textPrimary },
                      ]}
                    >
                      {STRINGS.boards.wifiAction}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[
                    styles.sheetAction,
                    { borderColor: tokens.smart.colors.cardBorder },
                  ]}
                  onPress={sheetDelete}
                  testID={`boards-sheet-delete-${sheetBoard.code}`}
                >
                  <Text
                    style={[styles.sheetActionTitle, { color: tokens.danger }]}
                  >
                    {STRINGS.boards.deleteAction}
                  </Text>
                  <Text
                    style={[
                      styles.sheetActionDesc,
                      { color: tokens.smart.colors.textSecondary },
                    ]}
                  >
                    {STRINGS.boards.deleteActionDesc}
                  </Text>
                </Pressable>
              </>
            ) : null}
            <TouchableOpacity
              style={[
                styles.modalButton,
                styles.sheetCancelButton,
                { borderColor: tokens.smart.colors.cardBorder },
              ]}
              onPress={() => setSheetBoard(null)}
              testID="boards-sheet-cancel"
            >
              <Text style={{ color: tokens.smart.colors.textSecondary }}>
                {STRINGS.devices.cancel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Assign confirm dialog (the devices module's centered-dialog
          recipe): pick the target room from the scrollable candidate
          list, confirm, service validates. */}
      <Modal
        visible={assigning !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAssigning(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setAssigning(null)}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.devices.cancel}
            testID="boards-assign-scrim"
          />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.modalTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.boards.assignTitle}
            </Text>
            <Text
              style={[
                styles.hint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.boards.assignConfirm
                .replace('{code}', assigning?.code ?? '')
                .replace('{room}', targetRoom?.name ?? '…')}
            </Text>
            {/* boards-reassign-layout-remove-sharing: the candidates are
                full-width selectable ROWS (≥44pt, selected ring + check +
                accessibilityState.selected) inside a BOUNDED scroll
                region — many rooms scroll, the Hủy/Xác nhận row below
                stays fixed OUTSIDE the ScrollView. */}
            {assignCandidates.length > 0 ? (
              <ScrollView
                style={styles.roomOptionList}
                nestedScrollEnabled
                testID="boards-assign-room-list"
              >
                {assignCandidates.map(candidate => {
                  const selected = assignTarget === candidate.id;
                  return (
                    <Pressable
                      key={candidate.id}
                      style={[
                        styles.roomOption,
                        {
                          borderColor: selected
                            ? tokens.primary
                            : tokens.smart.colors.cardBorder,
                          backgroundColor: selected
                            ? tokens.smart.colors.tealTint
                            : 'transparent',
                        },
                      ]}
                      onPress={() => setAssignTarget(candidate.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      testID={`boards-assign-target-${candidate.id}`}
                    >
                      <Text
                        style={[
                          styles.roomOptionText,
                          { color: tokens.smart.colors.textPrimary },
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {candidate.name}
                      </Text>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={tokens.primary}
                          testID={`boards-assign-check-${candidate.id}`}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Text
                style={[
                  styles.hint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.boards.noRoomAvailable}
              </Text>
            )}
            {dialogError ? (
              <Text style={[styles.errorText, { color: tokens.danger }]}>
                {dialogError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={() => setAssigning(null)}
                testID="boards-assign-cancel"
              >
                <Text style={{ color: tokens.smart.colors.textSecondary }}>
                  {STRINGS.devices.cancel}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: tokens.primary,
                    borderColor: tokens.primary,
                  },
                  !assignTarget && { opacity: 0.5 },
                ]}
                disabled={!assignTarget || busy}
                onPress={() => {
                  void confirmAssign();
                }}
                testID="boards-assign-confirm"
              >
                <Text style={{ color: tokens.onPrimary }}>
                  {STRINGS.settings.confirm}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete-board confirm dialog (destructive tone). */}
      <Modal
        visible={deletingBoard !== null}
        transparent
        animationType="fade"
        onRequestClose={cancelDelete}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={cancelDelete}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.devices.cancel}
            testID="boards-delete-scrim"
          />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.modalTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.boards.deleteTitle}
            </Text>
            <Text
              style={[
                styles.hint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.boards.deleteConfirm.replace(
                '{code}',
                deletingBoard?.code ?? '',
              )}
            </Text>
            <Text
              style={[
                styles.hint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.boards.deleteActionDesc}
            </Text>
            {dialogError ? (
              <Text style={[styles.errorText, { color: tokens.danger }]}>
                {dialogError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={cancelDelete}
                disabled={busy}
                testID="boards-delete-cancel"
              >
                <Text style={{ color: tokens.smart.colors.textSecondary }}>
                  {STRINGS.devices.cancel}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: tokens.danger,
                    borderColor: tokens.danger,
                  },
                ]}
                disabled={busy}
                onPress={() => {
                  void confirmDelete();
                }}
                testID="boards-delete-confirm"
              >
                <Text style={{ color: tokens.onPrimary }}>
                  {STRINGS.boards.deleteAction}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR scanner (boards-qr-scan AD-5): conditionally mounted so a
          closed scanner leaves nothing in the tree (and the single-scan
          lock resets with the unmount). The modal never parses — all
          matching lives in handleScanned; an invalid label comes back as
          the display-only `lastError` (AD-3). */}
      {scannerOpen ? (
        <BoardsScannerModal
          visible
          onClose={() => setScannerOpen(false)}
          onScanned={handleScanned}
          lastError={scanError}
          lastRawScanned={lastRawScanned}
        />
      ) : null}

      {/* BLE provisioning modal (boards-ble-wifi-provisioning): mounted
          only while a QR boardId is handed over — the modal is a display
          shell over `provisioningService` (injected fake in tests, the
          real lazy singleton in production); it never imports the BLE
          stack and is unreachable on web (the sheet button is hidden).
          v2: the Broker/MQTT groups arrive prefilled from the settings
          read (AD-v2-6) — the screen owns the data, the modal displays. */}
      {bleBoardId !== null ? (
        <BleProvisioningModal
          visible
          onClose={() => {
            setBleBoardId(null);
            setBleBoardType(null);
          }}
          initialBoardId={bleBoardId}
          prefill={blePrefill ?? undefined}
          onProvisioned={handleBleProvisioned}
          service={provisioningService}
        />
      ) : null}

      {/* Not-found sheet (boards-qr-scan AD-2 case B): the scanned board
          never published on this broker — show the QR's own boardType +
          boardId (the user can see WHAT they scanned) with the honest
          hint. Same centered Modal recipe as the action sheet. */}
      <Modal
        visible={unknownBoard !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setUnknownBoard(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setUnknownBoard(null)}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.devices.cancel}
            testID="boards-scan-unknown-scrim"
          />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
              tokens.smart.cardShadow,
            ]}
            testID="boards-scan-unknown-sheet"
          >
            <Text
              style={[
                styles.modalTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.boards.scanUnknownTitle}
            </Text>
            {unknownBoard ? (
              <>
                {/* AD-5 (boards-display-by-type): the thumb keys off the
                    QR's OWN boardType — one image per type, so a board the
                    broker has never seen can still show its type's photo
                    when the map bundles it; a map miss keeps the
                    placeholder (same testID on both branches). */}
                {unknownBoardImage ? (
                  <Image
                    source={unknownBoardImage}
                    style={styles.boardThumb}
                    testID="boards-scan-unknown-thumb"
                  />
                ) : (
                  <View
                    style={[
                      styles.boardThumb,
                      styles.boardThumbPlaceholder,
                      { borderColor: tokens.smart.colors.cardBorder },
                    ]}
                    testID="boards-scan-unknown-thumb"
                  >
                    <Ionicons
                      name="hardware-chip-outline"
                      size={28}
                      color={tokens.smart.colors.textSecondary}
                    />
                  </View>
                )}
                <Text
                  style={[
                    styles.scanUnknownMeta,
                    { color: tokens.smart.colors.textPrimary },
                  ]}
                  testID="boards-scan-unknown-type"
                >
                  {unknownBoard.boardType}
                </Text>
                <Text
                  style={[
                    styles.scanUnknownMeta,
                    styles.scanUnknownId,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                  testID="boards-scan-unknown-id"
                >
                  {unknownBoard.boardId}
                </Text>
                <Text
                  style={[
                    styles.hint,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                  testID="boards-scan-unknown-hint"
                >
                  {STRINGS.boards.scanUnknownHint.replace(
                    '{code}',
                    unknownBoard.boardId,
                  )}
                </Text>
              </>
            ) : null}
            {/* BLE onboarding handoff (boards-ble-wifi-provisioning):
                a brand-new board has no WiFi yet — the honest dead-end
                becomes the onboarding entry. Hidden on web (AD-7: BLE is
                unavailable there); pressing it closes the sheet and opens
                the BLE modal with THIS QR label's boardId. */}
            {Platform.OS !== 'web' && unknownBoard ? (
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.sheetCancelButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={openBleProvisioning}
                accessibilityLabel={STRINGS.boards.bleAction}
                testID={`boards-sheet-ble-${unknownBoard.boardId}`}
              >
                <Text style={{ color: tokens.smart.colors.textPrimary }}>
                  {STRINGS.boards.bleAction}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.modalButton,
                styles.sheetCancelButton,
                { borderColor: tokens.smart.colors.cardBorder },
              ]}
              onPress={() => setUnknownBoard(null)}
              testID="boards-scan-unknown-close"
            >
              <Text style={{ color: tokens.smart.colors.textSecondary }}>
                {STRINGS.boards.scanClose}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: 16, paddingBottom: 48 },
    screenTitle: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 8,
      paddingRight: 12,
    },
    backText: { fontSize: 14, fontWeight: '500' },
    // Search bar (AD-4): icon + input + ✕ clear — with the QR scan button
    // (boards-qr-scan) beside it; the row owns the bottom margin.
    scanRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    searchRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    // Search-row QR scan button (dashboard-history-board-touch-share):
    // explicit ≥44×44 hit bounds around the glyph (was padding 10 only).
    scanButton: {
      borderWidth: 1,
      borderRadius: 12,
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 10,
    },
    // Empty-state scan affordance (boards-qr-scan fix cycle 1): the scan
    // action as a full-width bordered pill above the empty hint.
    emptyScanButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      marginBottom: 12,
    },
    emptyScanText: { fontSize: 14, fontWeight: '600' },
    searchInput: { flex: 1, fontSize: 14, padding: 0 },
    // One gel card per board (smart card recipe).
    boardCard: {
      borderWidth: 1,
      borderRadius: tokens.smart.radius.card,
      padding: tokens.smart.spacing.cardPadding,
      marginBottom: tokens.smart.spacing.cardGap,
      gap: 6,
      ...tokens.smart.cardShadow,
    },
    boardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    // Board thumbnail (boards-image-by-name-layout): bundled photo or the
    // chip placeholder. The placeholder frame stays 56×56 rounded (L1)
    // with a light neutral fill so the small icon reads as an inset
    // avatar, not a blown-up glyph.
    boardThumb: {
      width: 56,
      height: 56,
      borderRadius: 12,
    },
    boardThumbPlaceholder: {
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      // L1: the light neutral page token — a subtle inset on both the
      // white (light) and dark cards, no new palette.
      backgroundColor: tokens.smart.colors.page,
    },
    // Header column: the boardType title over the labeled `Id: {code}`
    // mono line (descriptor boards). `flexShrink: 1` + `minWidth: 0` let
    // the one-line/ellipsized title actually engage inside the row.
    // `flex: 1` anchors the title right next to the thumbnail on BOTH
    // platforms: with 3 children under `space-between`, react-native-web
    // otherwise floats the middle column to the visual card center (web
    // distributes the free space around it) where native Yoga hugs it —
    // growing the column to fill the gap removes that divergence, and the
    // left-aligned content renders identically on native.
    boardTitleColumn: { flex: 1, flexShrink: 1, minWidth: 0 },
    // Card title (boards-display-by-type AD-1): the descriptor boardType —
    // every board of the same type displays identically — or the
    // `Board {code}` fallback for a board without a descriptor. One line
    // with a tail ellipsis (L3, moved from the removed badge).
    boardTitle: {
      fontSize: tokens.smart.typography.cardTitle,
      fontWeight: '700',
    },
    // Secondary mono line (AD-2): the LABELED wire code — `Id: {code}` —
    // on descriptor boards only; hidden for descriptor-less boards (their
    // fallback title already contains the code).
    boardCodeSecondary: {
      fontSize: tokens.smart.typography.secondary,
      fontFamily: monoFontFamily,
    },
    statusChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: 12, fontWeight: '600' },
    boardMeta: { fontSize: tokens.smart.typography.secondary },
    // Sensor channels (AD-2): one chip per channel, wrapping on narrow
    // screens. L2 (boards-image-by-name-layout): `alignItems:
    // 'flex-start'` is REQUIRED next to the wrap — with the default
    // `stretch`, Yoga measures children of a wrap container at the full
    // container width, so every chip consumed its own line and the row
    // collapsed into a vertical "bulleted list" on device. The
    // flex-start anchor keeps chips hugging their text and flowing
    // horizontally until the line runs out of room.
    sensorChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: 6,
    },
    sensorChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    sensorChipText: { fontSize: tokens.smart.typography.secondary },
    relayBadge: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    relayBadgeText: { fontSize: tokens.smart.typography.secondary },
    // Offline + descriptor: the data shown is the board's last publish.
    staleNote: {
      fontSize: tokens.smart.typography.secondary,
      fontStyle: 'italic',
    },
    // Footer (boards-reassign-layout-remove-sharing): TWO stacked regions
    // — the room status line, then the action row — so a long room name
    // can never wrap/push the `Đổi phòng` + `⋯` controls (the old
    // `flexWrap` row did exactly that on narrow screens). A cardBorder
    // hairline (L4, boards-image-by-name-layout) + top margin separate the
    // footer from the descriptor body.
    boardFooter: {
      flexDirection: 'column',
      gap: 4,
      marginTop: 8,
      borderTopWidth: 1,
      borderTopColor: tokens.smart.colors.cardBorder,
    },
    // Region 1 — the room status line. The text clips to one line
    // (numberOfLines 1 in the JSX); `flexShrink` keeps the node itself
    // inside the card on both platforms.
    roomLabel: {
      fontSize: tokens.smart.typography.secondary,
      flexShrink: 1,
    },
    // The tappable unassigned hint: a ≥44pt row that opens the assign
    // dialog DIRECTLY (no dead-end sheet detour).
    roomHintButton: {
      minHeight: 44,
      justifyContent: 'center',
    },
    unassignedHint: {
      fontSize: tokens.smart.typography.secondary,
      fontWeight: '600',
    },
    // Region 2 — the stable action row: the assign button fills the width
    // beside the fixed ⋯ button; no wrap, no displacement.
    footerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    // Footer PRIMARY assign button (dashboard-history-board-touch-share):
    // ≥44pt tall, teal filled — the always-visible assign entry.
    footerAssignButton: {
      flex: 1,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      borderRadius: 12,
    },
    // The card's action button (dashboard-history-board-touch-share):
    // explicit ≥44×44 hit bounds (not hitSlop) around the ⋯ glyph.
    menuButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Action sheet rows (AD-2): ≥44pt tall — action title + consequence
    // description (title-only for the WiFi row).
    sheetAction: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      gap: 4,
      minHeight: 44,
      justifyContent: 'center',
    },
    sheetActionTitle: { fontSize: 14, fontWeight: '600' },
    sheetActionDesc: { fontSize: 12, lineHeight: 16 },
    sheetCancelButton: { alignSelf: 'flex-end', marginTop: 4 },
    // Not-found sheet (boards-qr-scan): the QR's boardType over the mono
    // boardId, then the hint.
    scanUnknownMeta: { fontSize: 14, fontWeight: '600' },
    scanUnknownId: { fontFamily: monoFontFamily, fontWeight: '400' },
    emptyHint: {
      fontSize: tokens.smart.typography.secondary,
      marginTop: 24,
      textAlign: 'center',
      lineHeight: 20,
    },
    // Centered dialogs + action sheet (the devices module recipe).
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 420,
      borderWidth: 1,
      borderRadius: tokens.smart.radius.card,
      padding: 16,
      gap: 8,
    },
    modalTitle: { fontSize: 16, fontWeight: '700' },
    hint: { fontSize: 12, lineHeight: 16 },
    // Assign-dialog candidate list (boards-reassign-layout-remove-
    // sharing): the ScrollView's height is bounded so a long room list
    // scrolls INSIDE this region while the Hủy/Xác nhận row below stays
    // fixed and reachable.
    roomOptionList: { maxHeight: 240, flexGrow: 0 },
    // One full-width room row: ≥44pt, selected = teal ring + tint + check
    // (accessibilityState.selected is set in the JSX).
    roomOption: {
      borderWidth: 1,
      borderRadius: 12,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 8,
    },
    // Room names clip to one line inside the row — a long name can never
    // overlap the check indicator or the dialog actions.
    roomOptionText: { fontSize: 14, flexShrink: 1 },
    errorText: { fontSize: 12, marginTop: 4 },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
      marginTop: 8,
    },
    modalButton: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
  });
}
