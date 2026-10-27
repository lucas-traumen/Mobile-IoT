/**
 * RoomDashboardScreen — the third level of the official hierarchy: ONE
 * Template-room layout's widget dashboard. The header shows back, the
 * physical room name, the Template name and `Chỉnh sửa` — those affordances
 * and behaviors are UNCHANGED. The body renders ONLY that room reference's
 * widgets with the SAME Smart Home visual language as the Dashboard tab
 * (scope amendment 1, user-approved): the ambient diagonal wash, the small
 * secondary section labels and the `'smart'` card surfaces — WYSIWYG with
 * `DashboardScreen`, through the exact same seams:
 *
 * - the ambient background is the diagonal `LinearGradient` wash
 *   (tealTint top-left → page base → amberTint bottom-right),
 * - the persisted cells are mapped through the pure
 *   `computeSmartViewMetrics` layer (symmetric screen padding 16 narrow /
 *   24 wide, 16pt card gap) measured on the UNPADDED canvas wrapper,
 * - the smart view renders the SAME WYSIWYG two-column flow at EVERY
 *   canvas width (`smartFlowLayout` — a 2x1 widget spans the full row,
 *   dragged rows reorder the view; the former narrow `stacked` reflow was
 *   retired with dashboard-view-wysiwyg-two-column) — grown content pushes
 *   the following rows/sections down instead of overlapping or escaping
 *   the scroll extent, so NO section height is reserved here,
 * - the grid sections split exactly like the view screen (`groupWidgets`).
 *
 * No Template chooser, no room chips and no Settings editor link appear
 * here — templates/other rooms are never co-rendered with this room's
 * widgets. Widgets stay live and commandable (relay truth reconciles from
 * MQTT feedback); a lost binding renders the repair picker only in the
 * EDIT screen, not here (the view screen is one level, not an editor).
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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme, type ThemeTokens } from '@core/theme';

import {
  computeSmartViewMetrics,
  isNarrowCanvas,
  resolveCanvasWidth,
  SMART_VIEW_MAX_CONTENT_WIDTH,
} from '../internal/domain/gridMetrics';
import { groupWidgets } from '../internal/domain/sectionGroups';
import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import type { Room } from '@modules/devices/api';
import type {
  WidgetConfig,
  WidgetRegistry,
  WidgetServices,
} from '@modules/widgets/api';
import { WidgetServicesProvider } from '@modules/widgets/api';

import { DashboardGrid } from './DashboardGrid';

/** Grid metrics shape passed down to the section grids. */
type GridMetrics = ReturnType<typeof computeSmartViewMetrics>;
type ScreenStyles = ReturnType<typeof makeStyles>;

/**
 * One section: the small secondary smart label directly above its own
 * grid (WYSIWYG with the Dashboard view). The smart view renders the
 * two-column flow at every width — no reserved height, persisted coords
 * untouched.
 */
function RoomSection({
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

interface RoomDashboardScreenProps {
  /** The Template owning the room reference (undefined → truthful empty). */
  readonly template: DashboardTemplate | undefined;
  /** The referenced physical room id. */
  readonly roomId: string;
  /** All physical rooms (header name lookup). */
  readonly rooms: readonly Room[];
  /** The widget registry (resolves components). */
  readonly registry: WidgetRegistry;
  /** Runtime widget services (live state, commands). */
  readonly services: WidgetServices;
  /** Navigate back to the room list. */
  readonly onBack: () => void;
  /** Open the room-scoped edit screen. */
  readonly onEdit: () => void;
}

/**
 * The room widget dashboard screen (view-only, one level).
 *
 * @param props - see {@link RoomDashboardScreenProps}.
 */
export function RoomDashboardScreen({
  template,
  roomId,
  rooms,
  registry,
  services,
  onBack,
  onEdit,
}: RoomDashboardScreenProps) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // Measured canvas: the grid shell's actual `onLayout` width is
  // authoritative once available; the window width is only the documented
  // fallback until the first positive layout event (one width source for
  // BOTH section grids — they can never disagree).
  const [canvasWidth, setCanvasWidth] = useState<number | null>(null);

  const roomName = rooms.find(room => room.id === roomId)?.name ?? roomId;
  const roomReference = template?.rooms.find(room => room.roomId === roomId);
  const widgets = roomReference?.widgets ?? [];

  // The widgets live inside their room reference; filter defensively by
  // roomId too (mirror-field invariant) so a stray placement never renders.
  const visibleWidgets = useMemo(
    () => widgets.filter(widget => widget.roomId === roomId),
    [widgets, roomId],
  );

  const canvas = useMemo(
    () => resolveCanvasWidth(canvasWidth, width),
    [canvasWidth, width],
  );
  // The narrow/wide band decision (single threshold, WYSIWYG with the
  // Dashboard view): the flow is the SAME two-column mapping at every
  // width — the band only picks the inset (16 narrow / 24 wide, AD-3).
  const narrow = useMemo(() => isNarrowCanvas(canvas), [canvas]);
  // Smart-view metrics (WYSIWYG with the Dashboard view): symmetric screen
  // padding (16 narrow / 24 wide) + the 16pt card gap; the same instance
  // feeds the rendered flow and the per-TYPE card floors.
  const metrics = useMemo(
    () => computeSmartViewMetrics(canvas, narrow),
    [canvas, narrow],
  );
  const wide = !narrow;

  const sections = useMemo(
    () => groupWidgets(visibleWidgets),
    [visibleWidgets],
  );

  return (
    // The ambient Smart Home wash — same recipe as the Dashboard tab.
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
          hitSlop={8}
          testID="room-dashboard-back"
          accessibilityRole="button"
          accessibilityLabel={STRINGS.settings.back}
        >
          <Ionicons name="arrow-back" size={20} color={tokens.primary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {roomName}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {template?.name ?? ''}
          </Text>
        </View>
        <Pressable
          style={[styles.editButton, { backgroundColor: tokens.primary }]}
          onPress={onEdit}
          testID="room-dashboard-edit"
          accessibilityRole="button"
          accessibilityLabel={STRINGS.templates.editRoom}
        >
          <Ionicons name="create-outline" size={15} color={tokens.onPrimary} />
          <Text style={[styles.editButtonText, { color: tokens.onPrimary }]}>
            {STRINGS.templates.editRoom}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <WidgetServicesProvider services={services}>
          {visibleWidgets.length === 0 ? (
            <Text style={styles.emptyHint}>{STRINGS.dashboard.noWidgets}</Text>
          ) : (
            // Unpadded canvas wrapper: the smart-view metrics own the
            // screen inset (24 wide / 16 narrow), so the measured width and
            // the projected flow geometry stay consistent.
            <View
              testID="room-dashboard-canvas"
              style={styles.canvas}
              onLayout={event => {
                setCanvasWidth(event.nativeEvent.layout.width);
              }}
            >
              {sections.environment.length > 0 ? (
                <RoomSection
                  styles={styles}
                  label={STRINGS.dashboard.environment}
                  widgets={sections.environment}
                  wide={wide}
                  metrics={metrics}
                  registry={registry}
                />
              ) : null}
              {sections.devices.length > 0 ? (
                <RoomSection
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
      </ScrollView>
    </LinearGradient>
  );
}

const makeStyles = (tokens: ThemeTokens) =>
  StyleSheet.create({
    flex: { flex: 1 },
    // Scope amendment 3 (header alignment): the header is constrained to
    // the SAME centered max-width band (880) as the card content, so the
    // back/name/edit edges follow the Dashboard tab's wide-screen
    // alignment (coherence). The header keeps its own 16pt padding inside
    // the band (disclosed: this screen's grid inset is the editor-era 16,
    // so the header still aligns with its own content edges).
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
      width: '100%',
      maxWidth: SMART_VIEW_MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    // 44pt hit target (dashboard-history-board-touch-share): explicit bounds
    // around the arrow — the control IS the thing the user aims at.
    backButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { flex: 1, minWidth: 0 },
    // settings-smart-home-sync: header text reads the smart text tokens
    // (was the base textPrimary/textSecondary pair).
    title: {
      fontSize: 20,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
    },
    subtitle: {
      fontSize: 12,
      color: tokens.smart.colors.textSecondary,
      marginTop: 1,
    },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    editButtonText: { fontSize: 13, fontWeight: '700' },
    // Content sits directly on the ambient wash; the canvas wrapper is
    // FULL width and unpadded (the smart-view metrics own the inset).
    // Scope amendment 2 (content cap): wider than ~880 the content is
    // CAPPED and CENTERED — the wash fills the rest (WYSIWYG with the
    // Dashboard view).
    content: { paddingBottom: 40 },
    canvas: {
      width: '100%',
      maxWidth: SMART_VIEW_MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    padNarrow: { paddingHorizontal: tokens.smart.spacing.screenH },
    padWide: { paddingHorizontal: tokens.smart.spacing.screenHWide },
    // Small secondary smart label (no pill) — WYSIWYG with the Dashboard
    // view's section labels; the inset aligns with the card edges below.
    // Scope amendment 2 (label spacing): the grid container's top padding
    // is absorbed by the smart view, so this margin IS the label→card gap
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
      paddingHorizontal: 32,
    },
  });
