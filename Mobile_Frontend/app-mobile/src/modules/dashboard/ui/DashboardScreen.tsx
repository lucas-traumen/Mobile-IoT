/**
 * DashboardScreen — the Dashboard tab's VIEW-ONLY surface (Smart Home
 * design language, dashboard-smart-home-redesign).
 *
 * Dumb screen: receives everything as props from the app root (App wires
 * the dashboard/device stores + services). Renders:
 * - page: the ambient Smart Home background — a diagonal `LinearGradient`
 *   wash (tealTint top-left → page base → amberTint bottom-right, 3–5%
 *   alpha tints, no shapes, no blur library),
 * - header: the menu button (☰, ≥44 touch target — opens the shared
 *   `RoomListModal`) + the selected ROOM NAME (screenTitle, may wrap to 2
 *   lines, never shrunk to fit) + the small connection chip on the right
 *   ("● Đã kết nối" / "● Mất kết nối" / "● Đang kết nối…" from the live
 *   telemetry connection state). Scope amendment 3: the header sits in the
 *   SAME centered max-width band (880) as the card content, so its edges
 *   align with the cards on wide screens. NO app title and NO Template
 *   name,
 * - room switching: the header menu button opens the room list (the shared
 *   `RoomListModal` dialog); the horizontal quick strip lives only
 *   on the History screen now. Selecting a room changes the VIEWED room
 *   only — it never navigates and never mutates persisted layout. The
 *   selection is presentation state (never written to persistence),
 * - SECTIONS: the selected room's Template widgets are split by the pure
 *   `groupWidgets` helper into "Môi trường" (sensor-value) and "Thiết bị"
 *   (switch + others); each non-empty section renders its small secondary
 *   label DIRECTLY above its OWN `DashboardGrid`. Both section grids share
 *   the same measured canvas width (one `onLayout` wrapper → one
 *   `metrics` instance) and the same narrow/wide band decision, and both
 *   OPT INTO the `'smart'` card appearance (smart card surface + hairline
 *   border + smart shadow + per-TYPE view row heights, D4),
 * - WYSIWYG TWO-COLUMN FLOW (dashboard-view-wysiwyg-two-column): the view
 *   renders the SAME persisted-derived two-column flow (`smartFlowLayout`)
 *   at EVERY canvas width — a 2x1 widget visibly spans the full flow row
 *   and dragged positions visibly reorder the view, WYSIWYG with the
 *   editor. (The former narrow `stacked` reflow — one full-width card per
 *   row, persisted `x`/`width` ignored — was retired.) No section height
 *   is reserved: cards carry their per-TYPE `minHeight` floors, grown
 *   content (long inline errors, font-scaled text) makes its flow row
 *   taller and pushes every following row/section down, so nothing can
 *   overlap and the ScrollView extent always covers the real content. The
 *   persisted cells are MAPPED to the view through the pure
 *   `computeSmartViewMetrics` layer: symmetric screen padding (16 narrow /
 *   24 wide — the `isNarrowCanvas` band, AD-3) and a 16pt card gap on BOTH
 *   axes — presentation-only, the persisted math and the editor contract
 *   are untouched.
 *
 * There are NO create/edit/add/remove/resize/rebind controls and NO
 * Template navigation on this screen — every mutation and the Template →
 * Room → Widget hierarchy live behind the Settings tab's management stack.
 * The active Template is chosen/switched in Settings only; when it
 * disappears or loses a room reference the view normalizes WITHOUT
 * writing (dangling references are simply not displayed). Relay switches
 * stay operational through the widget components; committed state
 * reconciles from MQTT feedback.
 *
 * Each section grid is wrapped in the shared `WidgetServicesProvider` with
 * the services the app root provides so widgets can read live values and
 * send commands.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme } from '@core/theme';

import {
  computeSmartViewMetrics,
  groupWidgets,
  isNarrowCanvas,
  resolveCanvasWidth,
  SMART_VIEW_MAX_CONTENT_WIDTH,
  type DashboardTemplate,
} from '@modules/dashboard/api';
import type { Room } from '@modules/devices/api';
import type {
  WidgetConfig,
  WidgetConnectionState,
  WidgetRegistry,
  WidgetServices,
} from '@modules/widgets/api';
import { WidgetServicesProvider } from '@modules/widgets/api';

import { DashboardGrid } from './DashboardGrid';
import { RoomListModal } from './RoomListModal';

/** Grid metrics shape passed down to the section grids. */
type GridMetrics = ReturnType<typeof computeSmartViewMetrics>;

/** The screen stylesheet (created once per token set; shared with sections). */
type ScreenStyles = ReturnType<typeof makeStyles>;

/**
 * Connection chip dot/text color by connection state — the SHARED
 * connection/health color contract (D3, settings-smart-home-sync):
 * teal = connected, danger = failed, AMBER (smart) = connecting AND
 * reconnecting ONLY, idle/unknown = smart textSecondary (never amber —
 * idle is not a progress state).
 */
function chipColor(
  state: WidgetConnectionState['state'],
  tokens: {
    smart: { colors: { teal: string; amber: string; textSecondary: string } };
    danger: string;
  },
): string {
  switch (state) {
    case 'connected':
      return tokens.smart.colors.teal;
    case 'failed':
      return tokens.danger;
    case 'connecting':
    case 'reconnecting':
      return tokens.smart.colors.amber;
    default:
      // `idle` (and any future state) is the neutral no-signal color.
      return tokens.smart.colors.textSecondary;
  }
}

/** User-facing connection chip label from the connection state. */
function connectionLabel(connection: WidgetConnectionState): string {
  switch (connection.state) {
    case 'connected':
      return STRINGS.dashboard.connConnected;
    case 'failed':
      return STRINGS.dashboard.connFailed;
    case 'connecting':
      return STRINGS.dashboard.connConnecting;
    case 'reconnecting':
      return STRINGS.dashboard.connReconnecting;
    default:
      return STRINGS.dashboard.connFailed;
  }
}

/**
 * One dashboard section: the small secondary label DIRECTLY above its own
 * grid. The smart view renders the WYSIWYG two-column flow at every width
 * (see {@link DashboardGrid}), so NO height is reserved: grown cards
 * extend the flow and the ScrollView extent follows.
 */
function DashboardSection({
  styles,
  label,
  widgets,
  wide,
  metrics,
  registry,
}: {
  readonly styles: ScreenStyles;
  readonly label: string;
  readonly widgets: readonly WidgetConfig[];
  /** Wide band → the 24pt label inset; narrow → 16. */
  readonly wide: boolean;
  readonly metrics: GridMetrics;
  readonly registry: WidgetRegistry;
}) {
  return (
    <>
      <Text
        style={[styles.sectionLabel, wide ? styles.padWide : styles.padNarrow]}
      >
        {label}
      </Text>
      <DashboardGrid
        widgets={widgets}
        registry={registry}
        editMode={false}
        metrics={metrics}
        cardAppearance="smart"
        onMoveWidget={() => false}
        onResizeWidget={() => false}
        onRemoveWidget={() => undefined}
      />
    </>
  );
}

interface DashboardScreenProps {
  /**
   * The ACTIVE Template (deterministically resolved by the app root). The
   * room menu lists ITS ordered room references RESOLVED to physical room
   * names; the widget content is ITS layout for the selected room.
   */
  readonly template: DashboardTemplate | undefined;
  /** Connection snapshot (state + label) for the header chip. */
  readonly connection: WidgetConnectionState;
  /**
   * All physical rooms (devices module): the menu resolves the active
   * Template's room-reference ids to these display names.
   */
  readonly rooms: readonly Room[];
  /** The widget registry (resolves components). */
  readonly registry: WidgetRegistry;
  /** Runtime widget services (live state, commands). */
  readonly services: WidgetServices;
}

/**
 * The dashboard screen (view-only).
 *
 * @param props - see {@link DashboardScreenProps}.
 */
export function DashboardScreen({
  template,
  connection,
  rooms,
  registry,
  services,
}: DashboardScreenProps) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  // Measured canvas: the grid shell's actual `onLayout` width is
  // authoritative once available; the window width is only the documented
  // fallback until the first positive layout event.
  const [canvasWidth, setCanvasWidth] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // ONE measured width source drives BOTH the metrics and the narrow/wide
  // band decision, so the two section grids can never disagree.
  const canvas = useMemo(
    () => resolveCanvasWidth(canvasWidth, width),
    [canvasWidth, width],
  );
  // The narrow/wide band decision (single threshold): the view renders the
  // SAME two-column flow at every width — the band only picks the inset
  // (16 narrow / 24 wide, AD-3) for the metrics AND the screen's own
  // padding styles.
  const narrow = useMemo(() => isNarrowCanvas(canvas), [canvas]);
  // Smart-view metrics (presentation-only mapping layer): the persisted
  // cells are re-projected onto the MEASURED canvas with the symmetric
  // smart screen padding (16 narrow / 24 wide), the 16pt card gap and the
  // amendment-2 content cap (~880 — the wrapper clamps the layout, the
  // metrics clamp keeps the math total). The same metrics instance feeds
  // the rendered flow cards, so the two can never disagree.
  const metrics = useMemo(
    () => computeSmartViewMetrics(canvas, narrow),
    [canvas, narrow],
  );
  // Smart screen padding: 16 (narrow phone) / 24 (wide canvas).
  const wide = !narrow;

  // The ACTIVE Template's ordered room references resolved to physical
  // rooms (Template `order` is authoritative for the menu; display names
  // come from the devices module). Dangling references (physical room
  // deleted) are not displayed — the view normalizes without writing.
  const referencedRooms = useMemo(() => {
    if (!template) {
      return [];
    }
    const byId = new Map(rooms.map(room => [room.id, room]));
    return template.rooms
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(reference => byId.get(reference.roomId))
      .filter((room): room is Room => room !== undefined);
  }, [template, rooms]);

  // Viewed-room selection: presentation-only state. When the selection is
  // not part of the active Template's references (Template switched,
  // reference removed, first mount) it normalizes to the first referenced
  // room — deterministically, and WITHOUT any persistence write.
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const activeRoomId = useMemo(() => {
    if (referencedRooms.length === 0) {
      return null;
    }
    return referencedRooms.some(room => room.id === selectedRoomId)
      ? selectedRoomId!
      : referencedRooms[0]!.id;
  }, [referencedRooms, selectedRoomId]);
  const activeRoom = referencedRooms.find(room => room.id === activeRoomId);

  // The selected room's Template layout (exactly ONE Template-room
  // reference — nothing from other Templates/rooms is co-rendered).
  const visibleWidgets = useMemo(() => {
    const reference = template?.rooms.find(
      candidate => candidate.roomId === activeRoomId,
    );
    return reference ? reference.widgets : [];
  }, [template, activeRoomId]);

  // Section split: "Môi trường" (sensor-value) and "Thiết bị"
  // (switch + others) — each non-empty group becomes its own labeled section
  // (label directly above its own grid).
  const sections = useMemo(
    () => groupWidgets(visibleWidgets),
    [visibleWidgets],
  );

  const dotColor = chipColor(connection.state, tokens);

  return (
    // The ambient Smart Home wash: diagonal teal tint → page → amber tint.
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
        testID="dashboard-scroll"
        contentContainerStyle={styles.content}
      >
        <View style={[styles.header, wide ? styles.padWide : styles.padNarrow]}>
          {referencedRooms.length > 0 ? (
            <Pressable
              testID="dashboard-room-menu"
              style={styles.menuButton}
              accessibilityLabel={STRINGS.dashboard.roomList}
              onPress={() => setMenuOpen(true)}
            >
              <Ionicons
                name="menu"
                size={24}
                color={tokens.smart.colors.textPrimary}
              />
            </Pressable>
          ) : null}
          {activeRoom ? (
            <Text style={styles.roomTitle} numberOfLines={2}>
              {activeRoom.name}
            </Text>
          ) : (
            <View style={styles.titleSpacer} />
          )}
          <View
            style={[
              styles.chip,
              {
                borderColor: tokens.smart.colors.cardBorder,
                backgroundColor: tokens.smart.colors.card,
              },
            ]}
          >
            <View style={[styles.chipDot, { backgroundColor: dotColor }]} />
            <Text style={[styles.chipText, { color: dotColor }]}>
              {connectionLabel(connection)}
            </Text>
          </View>
        </View>

        {referencedRooms.length === 0 ? (
          // The active Template references no (existing) rooms → point the
          // user at the Settings management hierarchy (the only place rooms
          // are added to a Template).
          <Text
            style={[styles.emptyHint, wide ? styles.padWide : styles.padNarrow]}
          >
            {STRINGS.dashboard.noTemplateRooms}
          </Text>
        ) : (
          <WidgetServicesProvider services={services}>
            {visibleWidgets.length === 0 ? (
              <Text
                style={[
                  styles.emptyHint,
                  wide ? styles.padWide : styles.padNarrow,
                ]}
              >
                {STRINGS.dashboard.noWidgets}
              </Text>
            ) : (
              // Shared canvas wrapper: ONE `onLayout` measures the CONTENT
              // width BOTH section grids use — one `metrics` instance and
              // one narrow/wide band decision. The wrapper carries NO
              // horizontal padding of its own: the smart-view metrics own
              // the screen inset (24 wide / 16 narrow), so the measured
              // width and the projected card rects stay consistent
              // (symmetric screen padding on both edges).
              <View
                testID="dashboard-canvas"
                style={styles.canvas}
                onLayout={event => {
                  setCanvasWidth(event.nativeEvent.layout.width);
                }}
              >
                {sections.environment.length > 0 ? (
                  <DashboardSection
                    styles={styles}
                    label={STRINGS.dashboard.environment}
                    widgets={sections.environment}
                    wide={wide}
                    metrics={metrics}
                    registry={registry}
                  />
                ) : null}
                {sections.devices.length > 0 ? (
                  <DashboardSection
                    styles={styles}
                    label={STRINGS.dashboard.devices}
                    widgets={sections.devices}
                    wide={wide}
                    metrics={metrics}
                    registry={registry}
                  />
                ) : null}
              </View>
            )}
          </WidgetServicesProvider>
        )}
      </ScrollView>

      <RoomListModal
        visible={menuOpen}
        rooms={referencedRooms}
        activeRoomId={activeRoomId}
        onSelectRoom={id => {
          setSelectedRoomId(id);
          setMenuOpen(false);
        }}
        onClose={() => setMenuOpen(false)}
      />
    </LinearGradient>
  );
}

function makeStyles(tokens: {
  smart: {
    colors: {
      page: string;
      card: string;
      textPrimary: string;
      textSecondary: string;
      cardBorder: string;
    };
    spacing: { screenH: number; screenHWide: number };
    typography: {
      screenTitle: number;
      secondary: number;
    };
  };
  danger: string;
}) {
  return StyleSheet.create({
    flex: { flex: 1 },
    // Content sits directly on the ambient wash (no inset panel wrapper);
    // each piece owns its horizontal padding.
    content: { paddingBottom: 80 },
    padNarrow: { paddingHorizontal: tokens.smart.spacing.screenH },
    padWide: { paddingHorizontal: tokens.smart.spacing.screenHWide },
    // The canvas wrapper is FULL width and unpadded: the smart-view metrics
    // own the screen inset (24 wide / 16 narrow), so the measured width and
    // the projected card geometry stay consistent (symmetric padding).
    // Scope amendment 2 (content cap): on canvases wider than ~880 the
    // content is CAPPED and CENTERED — the ambient wash fills the rest.
    canvas: {
      width: '100%',
      maxWidth: SMART_VIEW_MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    // Scope amendment 3 (header alignment): the header lives in the SAME
    // centered max-width band (880) as the card content, so menu + room
    // name + connection chip align with the card edges on wide screens
    // (the header keeps its own smart screen padding inside the band).
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
      marginBottom: 14,
      width: '100%',
      maxWidth: SMART_VIEW_MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    // Menu button: ≥44 touch target (approved header anatomy).
    menuButton: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Selected room name: screenTitle semibold, wraps to two lines, never
    // shrunk to fit (no adjustFontSizeToFit).
    roomTitle: {
      flex: 1,
      fontSize: tokens.smart.typography.screenTitle,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
    },
    titleSpacer: { flex: 1 },
    // Connection badge (dot + short label from the live state). Scope
    // amendment 3 (badge presence): slightly larger text (13) + a bit more
    // padding — still compact next to the room name (the header band also
    // relieves width pressure on wide screens).
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    chipText: { fontSize: 13, fontWeight: '600' },
    // Section labels: small secondary text (no gel pill). The horizontal
    // inset comes from the shared pad styles (16 narrow / 24 wide) so the
    // label aligns EXACTLY with the smart card edges below it. Scope
    // amendment 2 (label spacing): the grid container's top padding is
    // absorbed by the smart view, so this margin IS the label→card gap
    // (16pt, consistent on all three smart screens).
    sectionLabel: {
      fontSize: tokens.smart.typography.secondary,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textSecondary,
      marginBottom: 16,
    },
    emptyHint: {
      color: tokens.smart.colors.textSecondary,
      textAlign: 'center',
      marginTop: 40,
      fontSize: 14,
    },
  });
}
