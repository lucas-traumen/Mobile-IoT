/**
 * RoomListScreen — the second level of the Template → Room → Widget
 * management hierarchy (inside the Settings tab): the SELECTED Template's
 * room-card grid. Header shows back navigation, the Template name and the
 * room count; each room card shows the physical room name and ONE meta
 * line, `X cảm biến · Y thiết bị` (measurement-only vs switch/relay device
 * counts — user decision 2026-09-05; zero categories are omitted, zero of
 * both keeps the neutral "Chưa có dữ liệu đo" copy). Live values are
 * intentionally NOT on the cards — they live inside the room dashboard
 * after tapping.
 *
 * Room actions (overflow menu + long-press drag-to-swap reorder): rename
 * (the PHYSICAL room — every Template referencing it sees the new name),
 * duplicate-to-another-Template (layout copied, fresh widget ids, the
 * physical room/device identities referenced — never cloned), reorder and
 * remove from this Template (reference + layout only; physical
 * rooms/devices/history are untouched and destructive physical-room
 * management stays in Settings).
 *
 * Reorder (device-acceptance rework): browser-tab-style press-and-hold
 * drag-to-swap REPLACED the arrow-button reorder. Press-and-hold lifts the
 * card; while dragging the OTHER cards render as droppable slots (the
 * hovered slot gets the translucent primary highlight — the editor's
 * drag-highlight recipe); dropping on another card SWAPS the two
 * positions (permutation, not insert) through the existing
 * `onReorder(orderedRoomIds)` seam (failure → the error banner shows and
 * the visual order is untouched — cards render from the Template state);
 * releasing outside a card snaps back without persisting. The "+ Thêm
 * phòng" card is not a droppable slot. A plain tap still opens the room.
 * A11Y TRADE-OFF (accepted by the orchestrator with the user): the removed
 * arrow buttons were reachable without gestures; screen-reader users
 * reorder through the accessible drag alternative planned separately.
 *
 * One flow column on narrow phones, two columns on wide canvases
 * (presentation-only — persisted widget coordinates are never touched by
 * list reflow). No horizontal room tabs anywhere.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme } from '@core/theme';
import {
  OperationBanner,
  useOperationFeedback,
} from '@core/ui/OperationBanner';

import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import type { CapabilityDef, Device, Room } from '@modules/devices/api';
import type { StyleProp, ViewStyle } from 'react-native';
import { ConfirmDialog, type ActionOutcome } from './ConfirmDialog';
import { measurePageOrigin, type PagePoint } from './roomDragMeasure';

/**
 * Room-card meta line (user decision 2026-09-05) — ONE composable line
 * `X cảm biến · Y thiết bị`:
 * - X (cảm biến): devices whose capabilities are measurement-only (no
 *   switch/relay capability),
 * - Y (thiết bị): devices WITH a switch/relay capability — a device with
 *   both counts exactly once, as control.
 * A zero category is omitted (`3 thiết bị`); zero of both keeps the neutral
 * truthful hint. LIVE VALUES ARE INTENTIONALLY ABSENT from the cards —
 * live state lives inside the room dashboard after tapping (this decision
 * supersedes the v2 plan's live room-summary requirement for cards).
 */
export function roomCardMeta(
  roomId: string,
  devices: readonly Device[],
  capabilities: readonly CapabilityDef[],
): string {
  const roomDevices = devices.filter(device => device.roomId === roomId);
  let sensors = 0;
  let controls = 0;
  for (const device of roomDevices) {
    const isControl = device.capabilities.some(
      capability =>
        capability === 'switch' ||
        capabilities.find(candidate => candidate.type === capability)?.kind ===
          'switch',
    );
    if (isControl) {
      // A control device counts once — even when it also measures.
      controls += 1;
    } else if (device.capabilities.length > 0) {
      sensors += 1;
    }
    // A device with NO capabilities is counted truthfully as neither.
  }
  const parts: string[] = [];
  if (sensors > 0) {
    parts.push(STRINGS.templates.metaSensors.replace('{n}', String(sensors)));
  }
  if (controls > 0) {
    parts.push(STRINGS.templates.metaDevices.replace('{n}', String(controls)));
  }
  if (parts.length === 0) {
    return STRINGS.templates.summaryUnknown;
  }
  return parts.join(' · ');
}

/** Two-column card grid from a canvas width (same breakpoint family). */
function columnCount(width: number): 1 | 2 {
  return width >= 560 ? 2 : 1;
}

/** One droppable slot rect (GRID-RELATIVE layout coordinates). */
export interface DropRect {
  readonly roomId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A finger point in the same grid-relative space as {@link DropRect}. */
export interface FingerPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Resolve the drop slot under `finger` (pure): the FIRST rect containing
 * the point (half-open interval — cards never overlap, so first match is
 * deterministic). `null` when the finger is outside every slot — the
 * "+ Thêm phòng" card is not a slot, so hovering it resolves to `null`
 * and a release there snaps back without persisting.
 */
export function resolveDropTarget(
  finger: FingerPoint,
  rects: readonly DropRect[],
): string | null {
  for (const rect of rects) {
    if (
      finger.x >= rect.x &&
      finger.x < rect.x + rect.width &&
      finger.y >= rect.y &&
      finger.y < rect.y + rect.height
    ) {
      return rect.roomId;
    }
  }
  return null;
}

/**
 * The drag-to-swap permutation (pure): swap the POSITIONS of `a` and `b`
 * (browser-tab style — B takes B's new slot, the other takes A's old one;
 * NOT an insert/shift). Returns the ORIGINAL reference when the swap is
 * impossible (unknown ids or the same id) — cheap change detection for
 * the caller.
 */
export function swapRoomPositions(
  ids: readonly string[],
  a: string,
  b: string,
): readonly string[] {
  const aIndex = ids.indexOf(a);
  const bIndex = ids.indexOf(b);
  if (aIndex === -1 || bIndex === -1 || aIndex === bIndex) {
    return ids;
  }
  const next = [...ids];
  next[aIndex] = b;
  next[bIndex] = a;
  return next;
}

/** Layout of one card as reported by `onLayout` (parent-relative). */
interface CardLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface RoomCardShellProps {
  readonly roomId: string;
  /** This card is LIFTED (it is the drag source). */
  readonly dragging: boolean;
  /** ANOTHER card's drag hovers THIS card (drop-slot highlight). */
  readonly hovered: boolean;
  /** A drag is in progress (droppable affordance on the other cards). */
  readonly dragEngaged: boolean;
  /** Plain tap → open the room (never fires after the long-press lift). */
  readonly onPress: () => void;
  /** Press-and-hold → lift the card and start the drag. */
  readonly onLongPress: () => void;
  /** The touch ended while unclaimed (no-move release / pre-capture
   * termination) → the parent cancels the drag session. */
  readonly onPressOut: () => void;
  /** The shell's capture decision decided to claim the move stream — the
   * touch now belongs to the drag (marks the session claimed). */
  readonly onClaimDrag: () => void;
  /** Finger moved while dragging (window-space `pageX`/`pageY`). */
  readonly onDragMove: (roomId: string, pageX: number, pageY: number) => void;
  /** Finger released over a card (or anywhere — the parent decides). */
  readonly onDragEnd: (roomId: string) => void;
  /** The system terminated the gesture (snap back, never persist). */
  readonly onDragCancel: (roomId: string) => void;
  /** Register the shell node (drag-start anchor measurement). */
  readonly registerNode: (roomId: string, node: View | null) => void;
  /** Report the card's layout rect (parent-relative, from onLayout). */
  readonly onCardLayout: (roomId: string, layout: CardLayout) => void;
  readonly accessibilityLabel: string;
  readonly cardStyle: StyleProp<ViewStyle>;
  readonly bodyStyle: StyleProp<ViewStyle>;
  /** Theme style of the hovered drop-slot highlight (tint + border). */
  readonly hoverStyle: StyleProp<ViewStyle>;
  /** Theme style of the droppable affordance on the other cards. */
  readonly readyStyle: StyleProp<ViewStyle>;
  readonly children: React.ReactNode;
}

/**
 * One draggable room card: a shell View owning the drag `PanResponder`
 * around the tappable card body. Touches start on the inner Pressable
 * (tap → open, hold → long-press lifts). Once lifted, the shell STEALS
 * the move stream (capture phase) and drives the drag; the system
 * terminating the gesture snaps back without persisting. The responder is
 * rebuilt whenever a captured handler changes, so the gesture handlers
 * close over the CURRENT props (no refs, no stale closures).
 *
 * Touch-end ownership: the outer responder only receives
 * release/terminate AFTER it claims the move stream (>2px move). EVERY
 * other touch end — a release without ever claiming, or a system
 * termination before the claim — surfaces as the inner Pressable's
 * `onPressOut` (RN dispatches pressOut on termination and after a
 * long-press, with onPress suppressed), which the parent routes to
 * cancel-when-unclaimed. The claim is marked inside the capture DECISION
 * (before the plugin grants/terminates anything), so the ordering between
 * the outer grant and the inner pressOut can never strand the session.
 */
function RoomCardShell(props: RoomCardShellProps) {
  const {
    roomId,
    dragging,
    hovered,
    dragEngaged,
    onPress,
    onLongPress,
    onPressOut,
    onClaimDrag,
    onDragMove,
    onDragEnd,
    onDragCancel,
    registerNode,
    onCardLayout,
    accessibilityLabel,
    cardStyle,
    bodyStyle,
    hoverStyle,
    readyStyle,
    children,
  } = props;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Touches belong to the inner Pressable until the long-press lifts.
        onStartShouldSetPanResponderCapture: () => false,
        // Lifted card → claim the move stream from the Pressable. The
        // claim is bookkept in the DECISION (ordering-immune — see the
        // component doc).
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          const active =
            dragging && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2);
          if (active) {
            onClaimDrag();
          }
          return active;
        },
        onPanResponderGrant: () => onClaimDrag(),
        onPanResponderMove: event => {
          onDragMove(roomId, event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderRelease: () => onDragEnd(roomId),
        onPanResponderTerminate: () => onDragCancel(roomId),
      }),
    [dragging, roomId, onClaimDrag, onDragMove, onDragEnd, onDragCancel],
  );
  return (
    <View
      ref={node => registerNode(roomId, node)}
      onLayout={event => onCardLayout(roomId, event.nativeEvent.layout)}
      testID={`room-drag-${roomId}`}
      style={cardStyle}
      {...panResponder.panHandlers}
    >
      <Pressable
        style={bodyStyle}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressOut={onPressOut}
        testID={`room-card-${roomId}`}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </Pressable>
      {/* Drop-slot highlight on the hovered card: the editor's translucent
          primary tint + border recipe (pointerEvents none, above content). */}
      {hovered ? (
        <View
          pointerEvents="none"
          testID={`room-drop-hover-${roomId}`}
          style={[StyleSheet.absoluteFill, hoverStyle]}
          collapsable={false}
        />
      ) : null}
      {/* Droppable affordance on the OTHER cards while a drag is live. */}
      {dragEngaged && !dragging && !hovered ? (
        <View
          pointerEvents="none"
          testID={`room-drop-ready-${roomId}`}
          style={[StyleSheet.absoluteFill, readyStyle]}
          collapsable={false}
        />
      ) : null}
    </View>
  );
}

interface RoomListScreenProps {
  /** The Template whose rooms are shown. */
  readonly template: DashboardTemplate | undefined;
  /** ALL persisted Templates (duplicate-to-Template targets). */
  readonly allTemplates: readonly DashboardTemplate[];
  /** All physical rooms (devices module — names for referenced rooms). */
  readonly rooms: readonly Room[];
  /** All devices (room-card meta line counting). */
  readonly devices: readonly Device[];
  /** Capability catalog (switch-kind detection for the meta line). */
  readonly capabilities: readonly CapabilityDef[];
  /** Navigate back to the Template list. */
  readonly onBack: () => void;
  /** Open one room's widget dashboard. */
  readonly onOpenRoom: (roomId: string) => void;
  /** Open the add-room screen. */
  readonly onAddRoom: () => void;
  /** Rename the PHYSICAL room (devices facade; shared across Templates). */
  readonly onRenameRoom: (
    roomId: string,
    name: string,
  ) => Promise<ActionOutcome>;
  /** Duplicate the room reference into another Template. */
  readonly onDuplicateRoom: (
    roomId: string,
    targetTemplateId: string,
  ) => Promise<ActionOutcome>;
  /** Reorder this Template's room references (permutation). */
  readonly onReorder: (
    orderedRoomIds: readonly string[],
  ) => Promise<ActionOutcome>;
  /** Remove the room REFERENCE from this Template. */
  readonly onRemoveRoom: (roomId: string) => Promise<ActionOutcome>;
}

/**
 * The Template room list screen.
 *
 * @param props - see {@link RoomListScreenProps}.
 */
export function RoomListScreen({
  template,
  allTemplates,
  rooms,
  devices,
  capabilities,
  onBack,
  onOpenRoom,
  onAddRoom,
  onRenameRoom,
  onDuplicateRoom,
  onReorder,
  onRemoveRoom,
}: RoomListScreenProps) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const { feedback, exiting, show, clear } = useOperationFeedback();
  const columns = columnCount(width);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [duplicatingError, setDuplicatingError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Drag-to-swap state: the lifted (dragged) card and the hovered slot.
  const [draggingRoom, setDraggingRoom] = useState<string | null>(null);
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);
  // Drag bookkeeping (refs — the PanResponder callbacks must read the
  // CURRENT values, never a stale render's snapshot).
  const dragStateRef = useRef<{
    readonly roomId: string;
    readonly origin: PagePoint;
    readonly rects: readonly DropRect[];
    hovered: string | null;
  } | null>(null);
  // Touch-SESSION lifecycle: opened synchronously at the long-press lift,
  // closed by ANY exit path (outer release/terminate, unclaimed pressOut,
  // failed measurement). `generation` invalidates a lift whose anchor
  // measurement is still pending when the touch ends; `claimed` records
  // that the outer responder took over the gesture (its end handlers own
  // the session from then on).
  const dragSessionRef = useRef<{
    readonly roomId: string;
    readonly generation: number;
    claimed: boolean;
  } | null>(null);
  const dragGenerationRef = useRef(0);
  const cardNodes = useRef(new Map<string, View>());
  const cardLayouts = useRef(new Map<string, CardLayout>());

  const registerCardNode = useCallback((roomId: string, node: View | null) => {
    if (node) {
      cardNodes.current.set(roomId, node);
    } else {
      cardNodes.current.delete(roomId);
    }
  }, []);
  const handleCardLayout = useCallback((roomId: string, layout: CardLayout) => {
    cardLayouts.current.set(roomId, layout);
  }, []);

  const roomName = (roomId: string): string =>
    rooms.find(room => room.id === roomId)?.name ?? roomId;

  if (!template) {
    // Unknown template id (deleted concurrently) — truthful empty state.
    return (
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
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={onBack}
            testID="room-list-back"
          >
            <Ionicons name="arrow-back" size={20} color={tokens.primary} />
          </Pressable>
          <Text style={styles.title}>{STRINGS.templates.backToTemplates}</Text>
        </View>
        <Text style={styles.emptyHint}>
          {STRINGS.templates.backToTemplates}
        </Text>
      </LinearGradient>
    );
  }

  const referencedRooms = template.rooms;

  /** Clear all rendered drag state (lifted card + drop affordances). */
  const clearDragState = () => {
    dragStateRef.current = null;
    setDraggingRoom(null);
    setHoveredRoom(null);
  };

  /**
   * Long-press lift → drag start: anchor the grid-relative card layouts
   * into window space with ONE measurement of the dragged card
   * (`measurePageOrigin`), then record the drag state. Fewer than two
   * cards means nothing to swap — the lift is a no-op.
   *
   * The session opens SYNCHRONOUSLY (before the await) so every exit path
   * during the pending measurement can cancel it; the generation check
   * after the await makes a late resolution a no-op — a stale lift can
   * never start a drag after the touch has ended.
   */
  const beginRoomDrag = async (roomId: string) => {
    if (referencedRooms.length < 2) {
      return;
    }
    const rects: DropRect[] = [];
    for (const reference of referencedRooms) {
      const layout = cardLayouts.current.get(reference.roomId);
      if (layout) {
        rects.push({ roomId: reference.roomId, ...layout });
      }
    }
    if (rects.length < 2) {
      return;
    }
    const generation = ++dragGenerationRef.current;
    dragSessionRef.current = { roomId, generation, claimed: false };
    const cardPage = await measurePageOrigin(
      cardNodes.current.get(roomId) ?? null,
    );
    const layout = cardLayouts.current.get(roomId);
    if (!cardPage || !layout) {
      // Measurement unavailable — close OUR session only (a newer lift's
      // session must survive).
      if (dragSessionRef.current?.generation === generation) {
        dragSessionRef.current = null;
      }
      return;
    }
    if (dragSessionRef.current?.generation !== generation) {
      // The touch ended while the measurement was pending (or a newer
      // lift superseded this one) — NEVER start a stale drag.
      return;
    }
    dragStateRef.current = {
      roomId,
      origin: { x: cardPage.x - layout.x, y: cardPage.y - layout.y },
      rects,
      hovered: null,
    };
    setHoveredRoom(null);
    setDraggingRoom(roomId);
  };

  /**
   * The shell's capture decision decided to claim the move stream: from
   * this instant the touch belongs to the drag and the OUTER responder's
   * end handlers own the session — the inner pressOut (which fires at the
   * claim, since the Pressable is terminated) must not cancel.
   */
  const claimDrag = () => {
    if (dragSessionRef.current) {
      dragSessionRef.current.claimed = true;
    }
  };

  /**
   * The touch ended while the outer responder NEVER claimed the move
   * stream: a release without movement past the threshold, or a system
   * termination before the claim. Snap back deterministically — bump the
   * generation (invalidating any pending measurement) and clear
   * everything, never persisting.
   */
  const handleCardPressOut = () => {
    const session = dragSessionRef.current;
    if (session && !session.claimed) {
      dragGenerationRef.current += 1;
      dragSessionRef.current = null;
      clearDragState();
    }
  };

  /** Finger moved: resolve (pure) and highlight the hovered slot. */
  const moveRoomDrag = (roomId: string, pageX: number, pageY: number) => {
    const state = dragStateRef.current;
    if (!state || state.roomId !== roomId) {
      return;
    }
    const hovered = resolveDropTarget(
      { x: pageX - state.origin.x, y: pageY - state.origin.y },
      state.rects,
    );
    if (hovered !== state.hovered) {
      state.hovered = hovered;
      setHoveredRoom(hovered);
    }
  };

  /**
   * Release (claimed drag): a drop on ANOTHER card swaps the two positions
   * (permutation) through the existing `onReorder` seam — one call;
   * failure shows the error banner and the visual order never moved (cards
   * render from the Template). Any other release snaps back without
   * persisting. Always closes the session.
   */
  const endRoomDrag = (roomId: string) => {
    const session = dragSessionRef.current;
    const state = dragStateRef.current;
    dragGenerationRef.current += 1;
    dragSessionRef.current = null;
    clearDragState();
    const hovered = state && session?.roomId === roomId ? state.hovered : null;
    if (!hovered || hovered === roomId) {
      return;
    }
    const ids = referencedRooms.map(reference => reference.roomId);
    const swapped = swapRoomPositions(ids, roomId, hovered);
    if (swapped === ids) {
      return;
    }
    void onReorder(swapped).then(result => {
      if (!result.ok) {
        show({ severity: 'error', message: result.message });
      }
    });
  };

  /** System-terminated claimed gesture: snap back, never persist. */
  const cancelRoomDrag = () => {
    dragGenerationRef.current += 1;
    dragSessionRef.current = null;
    clearDragState();
  };

  const submitRename = async () => {
    if (!renaming) {
      return;
    }
    const name = renameValue.trim();
    if (name.length === 0) {
      setRenameError(STRINGS.devices.requiredField);
      return;
    }
    const result = await onRenameRoom(renaming, name);
    if (!result.ok) {
      setRenameError(result.message || 'Lỗi');
      return;
    }
    setRenaming(null);
    setRenameError(null);
  };

  const confirmRemove = async () => {
    if (!removing) {
      return;
    }
    setRemoveError(null);
    const result = await onRemoveRoom(removing);
    if (!result.ok) {
      setRemoveError(result.message || 'Lỗi');
      return;
    }
    setRemoving(null);
  };

  /** Duplicate targets for a room: OTHER Templates without that reference. */
  const duplicateTargetsFor = (roomId: string): readonly DashboardTemplate[] =>
    allTemplates.filter(
      candidate =>
        candidate.id !== template?.id &&
        !candidate.rooms.some(room => room.roomId === roomId),
    );

  return (
    // The ambient Smart Home wash (settings-smart-home-sync) — the drag
    // affordances below keep the `tokens.primary` seam (teal via D2).
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
      <OperationBanner
        feedback={feedback}
        exiting={exiting}
        onDismiss={clear}
      />
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={onBack}
          testID="room-list-back"
        >
          <Ionicons name="arrow-back" size={20} color={tokens.primary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {template.name}
          </Text>
          <Text style={styles.subtitle}>
            {STRINGS.templates.roomCount.replace(
              '{n}',
              String(referencedRooms.length),
            )}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {referencedRooms.length === 0 ? (
          <Text style={styles.emptyHint}>{STRINGS.templates.noRoomsYet}</Text>
        ) : (
          <View style={styles.grid}>
            {referencedRooms.map(reference => {
              const meta = roomCardMeta(
                reference.roomId,
                devices,
                capabilities,
              );
              return (
                <RoomCardShell
                  key={reference.roomId}
                  roomId={reference.roomId}
                  dragging={draggingRoom === reference.roomId}
                  hovered={hoveredRoom === reference.roomId}
                  dragEngaged={draggingRoom !== null}
                  onPress={() => onOpenRoom(reference.roomId)}
                  onLongPress={() => {
                    void beginRoomDrag(reference.roomId);
                  }}
                  onPressOut={handleCardPressOut}
                  onClaimDrag={claimDrag}
                  onDragMove={moveRoomDrag}
                  onDragEnd={endRoomDrag}
                  onDragCancel={cancelRoomDrag}
                  registerNode={registerCardNode}
                  onCardLayout={handleCardLayout}
                  accessibilityLabel={roomName(reference.roomId)}
                  cardStyle={[
                    styles.card,
                    columns === 1 ? { width: '100%' } : styles.cardWide,
                    draggingRoom === reference.roomId
                      ? styles.cardLifted
                      : null,
                    draggingRoom !== null && draggingRoom !== reference.roomId
                      ? styles.cardDropReady
                      : null,
                  ]}
                  bodyStyle={styles.cardBody}
                  hoverStyle={styles.dropHover}
                  readyStyle={styles.dropReady}
                >
                  <View style={styles.cardTop}>
                    <Ionicons
                      name="bed-outline"
                      size={18}
                      color={tokens.primary}
                    />
                    <Text style={styles.cardName} numberOfLines={1}>
                      {roomName(reference.roomId)}
                    </Text>
                    <Pressable
                      style={styles.cardMenuButton}
                      testID={`room-menu-${reference.roomId}`}
                      accessibilityLabel={`${
                        STRINGS.templates.roomMenu
                      }: ${roomName(reference.roomId)}`}
                      onPress={() => setMenuFor(reference.roomId)}
                    >
                      <Ionicons
                        name="ellipsis-vertical"
                        size={18}
                        color={tokens.smart.colors.textSecondary}
                      />
                    </Pressable>
                  </View>
                  <Text style={styles.cardMetaText} numberOfLines={1}>
                    {meta}
                  </Text>
                </RoomCardShell>
              );
            })}
          </View>
        )}

        <Pressable
          style={styles.addRoomCard}
          onPress={onAddRoom}
          testID="room-add-card"
          accessibilityRole="button"
          accessibilityLabel={STRINGS.templates.addRoomAction}
        >
          <Ionicons
            name="add-circle-outline"
            size={22}
            color={tokens.primary}
          />
          <Text style={styles.addRoomText}>
            {STRINGS.templates.addRoomAction}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Room overflow menu. */}
      <Modal
        visible={menuFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View
            style={[
              styles.menuCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
                borderRadius: tokens.smart.radius.card,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.menuTitle,
                { color: tokens.smart.colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {menuFor ? roomName(menuFor) : ''}
            </Text>
            <Pressable
              style={styles.menuRow}
              testID="room-menu-rename"
              onPress={() => {
                setRenameValue(menuFor ? roomName(menuFor) : '');
                setRenameError(null);
                setRenaming(menuFor);
                setMenuFor(null);
              }}
            >
              <Ionicons
                name="pencil-outline"
                size={16}
                color={tokens.smart.colors.textPrimary}
              />
              <Text
                style={[
                  styles.menuRowText,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.templates.renameRoom}
              </Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              testID="room-menu-duplicate"
              onPress={() => {
                setDuplicatingError(null);
                setDuplicating(menuFor);
                setMenuFor(null);
              }}
            >
              <Ionicons
                name="copy-outline"
                size={16}
                color={tokens.smart.colors.textPrimary}
              />
              <Text
                style={[
                  styles.menuRowText,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.templates.duplicateRoom}
              </Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              testID="room-menu-remove"
              onPress={() => {
                setRemoveError(null);
                setRemoving(menuFor);
                setMenuFor(null);
              }}
            >
              <Ionicons name="trash-outline" size={16} color={tokens.danger} />
              <Text style={[styles.menuRowText, { color: tokens.danger }]}>
                {STRINGS.templates.removeRoom}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Rename the PHYSICAL room (shared across Templates). */}
      <Modal
        visible={renaming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <View style={styles.menuBackdrop}>
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
                borderRadius: tokens.smart.radius.card,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.dialogTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.templates.renameRoom}
            </Text>
            <Text
              style={[
                styles.dialogHint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.templates.renameRoomHint}
            </Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={STRINGS.devices.roomName}
              placeholderTextColor={tokens.smart.colors.textSecondary}
              autoFocus
              testID="room-rename-input"
            />
            {renameError ? (
              <Text style={[styles.errorText, { color: tokens.danger }]}>
                {renameError}
              </Text>
            ) : null}
            <View style={styles.dialogActions}>
              <Pressable
                style={[
                  styles.dialogButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={() => setRenaming(null)}
              >
                <Text
                  style={[
                    styles.dialogButtonText,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.templates.cancel}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.dialogButton,
                  {
                    backgroundColor: tokens.primary,
                    borderColor: tokens.primary,
                  },
                ]}
                testID="room-rename-submit"
                onPress={() => {
                  void submitRename();
                }}
              >
                <Text
                  style={[styles.dialogButtonText, { color: tokens.onPrimary }]}
                >
                  {STRINGS.templates.save}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Duplicate-to-Template picker (layout copied; identity referenced). */}
      <Modal
        visible={duplicating !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDuplicating(null)}
      >
        <View style={styles.menuBackdrop}>
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
                borderRadius: tokens.smart.radius.card,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.dialogTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.templates.chooseTargetTemplate}
            </Text>
            {duplicatingError ? (
              <Text style={[styles.errorText, { color: tokens.danger }]}>
                {duplicatingError}
              </Text>
            ) : null}
            <ScrollView style={styles.pickerList}>
              {duplicating !== null &&
              duplicateTargetsFor(duplicating).length === 0 ? (
                <Text
                  style={{
                    color: tokens.smart.colors.textSecondary,
                    fontSize: 13,
                  }}
                >
                  {STRINGS.templates.noCompatibleRoom}
                </Text>
              ) : null}
              {duplicating !== null
                ? duplicateTargetsFor(duplicating).map(target => (
                    <Pressable
                      key={target.id}
                      style={[
                        styles.menuRow,
                        { borderWidth: 1, borderRadius: 10, marginBottom: 6 },
                        { borderColor: tokens.smart.colors.cardBorder },
                      ]}
                      testID={`room-duplicate-target-${target.id}`}
                      onPress={() => {
                        const roomId = duplicating;
                        setDuplicating(null);
                        if (!roomId) {
                          return;
                        }
                        void onDuplicateRoom(roomId, target.id).then(result => {
                          show({
                            severity: result.ok ? 'success' : 'error',
                            message: result.ok
                              ? 'Đã nhân bản phòng vào Template'
                              : result.message,
                          });
                        });
                      }}
                    >
                      <Ionicons
                        name="copy-outline"
                        size={16}
                        color={tokens.primary}
                      />
                      <Text
                        style={[
                          styles.menuRowText,
                          { color: tokens.smart.colors.textPrimary },
                        ]}
                      >
                        {STRINGS.templates.duplicateIntoTemplate.replace(
                          '{name}',
                          target.name,
                        )}
                      </Text>
                    </Pressable>
                  ))
                : null}
            </ScrollView>
            <View style={styles.dialogActions}>
              <Pressable
                style={[
                  styles.dialogButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={() => setDuplicating(null)}
              >
                <Text
                  style={[
                    styles.dialogButtonText,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.templates.close}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Remove-reference confirmation (physical room untouched). */}
      <ConfirmDialog
        visible={removing !== null}
        title={STRINGS.templates.removeRoom}
        message={STRINGS.templates.removeRoomConfirm.replace(
          '{name}',
          removing ? roomName(removing) : '',
        )}
        error={removeError}
        onConfirm={() => {
          void confirmRemove();
        }}
        onDismiss={() => setRemoving(null)}
      />
    </LinearGradient>
  );
}

/** The list of OTHER templates a room reference can be duplicated into. */

const makeStyles = (tokens: {
  smart: {
    colors: {
      card: string;
      cardBorder: string;
      tealTint: string;
      textPrimary: string;
      textSecondary: string;
    };
    radius: { card: number };
    cardShadow: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
  textPrimary: string;
  textSecondary: string;
  border: string;
  primary: string;
}) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    // 44pt hit target (dashboard-history-board-touch-share): explicit bounds
    // around the arrow.
    backButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The room-card ⋯ menu: explicit ≥44×44 hit bounds (was hitSlop 8).
    cardMenuButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { flex: 1, minWidth: 0 },
    title: {
      fontSize: 20,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
    },
    subtitle: {
      fontSize: 12,
      color: tokens.smart.colors.textSecondary,
      marginTop: 2,
    },
    content: { padding: 16, paddingBottom: 40 },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    // Wide-canvas card width (two columns); resolved inline per card.
    // Smart card recipe (settings-smart-home-sync): card surface + hairline
    // border + card shadow (drop overlays keep their own rounded styles).
    card: {
      flexGrow: 1,
      borderRadius: tokens.smart.radius.card,
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      backgroundColor: tokens.smart.colors.card,
      overflow: 'hidden',
      ...tokens.smart.cardShadow,
    },
    cardWide: { flexGrow: 0, flexBasis: '47%' },
    cardBody: { padding: 14, gap: 6 },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cardName: {
      flex: 1,
      fontSize: 15,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
    },
    cardMetaText: { fontSize: 12, color: tokens.smart.colors.textSecondary },
    // The room-card meta line renders via `cardMetaText`; the live-summary
    // style was retired with the live summary (user decision 2026-09-05).
    // Lifted drag source: elevated scale + shadow + primary border (gel
    // aesthetic, same tint family as the editor's drag highlight).
    cardLifted: {
      borderWidth: 2,
      borderColor: tokens.primary,
      transform: [{ scale: 1.02 }],
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    // Droppable affordance on the OTHER cards while a drag is live.
    cardDropReady: { borderColor: tokens.primary },
    // Hovered drop slot: the editor's translucent primary tint + border
    // recipe (DashboardGrid `dragHighlight`), covering the whole card.
    dropHover: {
      borderRadius: 12,
      borderWidth: 2,
      borderColor: tokens.primary,
      backgroundColor: tokens.primary,
      opacity: 0.18,
    },
    // Subtle droppable tint on the not-hovered cards during a drag.
    dropReady: {
      borderRadius: 12,
      backgroundColor: tokens.primary,
      opacity: 0.06,
    },
    addRoomCard: {
      marginTop: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: tokens.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      flexDirection: 'row',
      gap: 8,
    },
    addRoomText: { color: tokens.primary, fontWeight: '600', fontSize: 13 },
    emptyHint: {
      color: tokens.smart.colors.textSecondary,
      textAlign: 'center',
      marginTop: 40,
      fontSize: 14,
      paddingHorizontal: 32,
    },
    menuBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    menuCard: {
      width: '100%',
      maxWidth: 320,
      borderWidth: 1,
      paddingVertical: 8,
    },
    menuTitle: {
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    menuRowText: { fontSize: 14, fontWeight: '500' },
    dialogCard: {
      width: '100%',
      borderWidth: 1,
      padding: 16,
    },
    dialogTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
    dialogHint: { fontSize: 12, marginBottom: 10 },
    input: {
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: tokens.smart.colors.textPrimary,
      fontSize: 14,
    },
    errorText: { fontSize: 13, marginTop: 8 },
    dialogActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 14,
    },
    dialogButton: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    dialogButtonText: { fontSize: 14, fontWeight: '600' },
    pickerList: { maxHeight: 220 },
  });
