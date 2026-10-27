/**
 * DashboardGrid — the widget card grid.
 *
 * DEFAULT (the editor contract): absolute-positioned 2-column grid driven
 * by the persisted coordinates. Pure rendering + gesture handling; grid
 * math comes from the pure `gridMetrics` module (`computeGridMetrics` /
 * `pixelRect` / `snapToGrid`).
 *
 * Edit mode per card (absolute mode only):
 * - drag (PanResponder): the card translates by (dx, dy); on release the
 *   target grid cell is `orig + snapToGrid(...)` and `onMoveWidget` is
 *   called. On an error result the translation is dropped (the card snaps
 *   back to its persisted position — the store did not change). Dropping
 *   onto a cell OCCUPIED by another widget of the same grid swaps the two
 *   positions via the opt-in `onSwapWidgets` seam (fix cycle 8 L, the room
 *   editor) instead of the doomed move. Targets that would render the card
 *   above its section (negative section-local row, fix cycle 8 H) are
 *   rejected before any callback, AND the in-flight translation is clamped
 *   to the section so the dragged card can never be seen above its section
 *   container DURING the gesture either ({@link clampedDragTranslation},
 *   fix cycle 8 H completion).
 * - remove: `×` top-right → `onRemoveWidget`.
 * - resize: bottom-right button cycles the definition's `supportedSizes` in
 *   order → `onResizeWidget`.
 *
 * Card appearance seam (opt-in): `'default'` (the editor contract) renders
 * neutral theme surfaces (surface + border, no tint); `'smart'` — the Smart
 * Home view recipe (dashboard-smart-home-redesign) — paints each card with
 * the `smart` card surface + hairline `smart` border + smart shadow + the
 * `smart.radius.card` token radius. The former `'gel'` branch (pastel
 * History card recipe) was REMOVED with the Settings smart sync (scope
 * amendment 1): its last consumer (`RoomDashboardScreen`) moved to
 * `'smart'`, and the gel tokens were retired — every surface (Dashboard,
 * History, Settings + the shared overlays) now consumes the `smart` block.
 *
 * GROWTH-SAFE SMART VIEW (fix cycle 2 + dashboard-view-wysiwyg-two-column):
 * the smart card heights are per-TYPE `minHeight` FLOORS (D4 + scope
 * amendment 2: sensor rows floor at the compact ~136 policy, switch rows
 * render compact ~92) and the smart inner layer never clips
 * (`overflow: 'visible'`), so longer inline errors or font-scaled text
 * GROW the card instead of being cut off. Because a grown card must never
 * overlap its siblings nor escape the scrollable extent, the smart view
 * (never edit mode) renders in NORMAL FLOW at EVERY canvas width: TWO
 * persisted-derived columns per row — the pure `smartFlowLayout` maps the
 * persisted coordinates to row/column/span (presentation-only; the caller's
 * metrics decide the column width — narrow phones get ~156pt columns); a
 * grown card makes its flow row taller, the row's sibling stretches, and
 * every following row/section is pushed down (Yoga flow), so the ScrollView
 * extent always covers the real content. No absolute positioning exists in
 * the smart view at all. (The former opt-in `'stacked'` one-card-per-row
 * reflow was RETIRED with dashboard-view-wysiwyg-two-column — persisted
 * position/size must stay visible outside the editor at every width.)
 * The editor (edit mode) and `'default'` callers keep the exact persisted
 * slot grid byte-identical — the editor's uniform-row contract is
 * untouched.
 */

import React, { useMemo, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { useTheme, type ThemeTokens } from '@core/theme';
import { STRINGS } from '@core/i18n';

import type { CapabilityType } from '@modules/devices/api';
import type {
  WidgetConfig,
  WidgetRegistry,
  WidgetSize,
} from '@modules/widgets/api';

import { collides, inBounds, type GridCell } from '../internal/domain/layout';
import {
  pixelRect,
  smartFlowLayout,
  snapToGrid,
  viewCardHeight,
} from '../internal/domain/gridMetrics';
import { WidgetRenderer } from './WidgetRenderer';

/** Drag threshold (points) before the PanResponder claims the gesture. */
const DRAG_THRESHOLD = 8;

/**
 * Card surface appearance:
 * - `'default'` — neutral theme surface + hairline border (the Settings
 *   editor contract; also the default for every existing caller),
 * - `'smart'` — the Smart Home view recipe: smart card surface + hairline
 *   smart border + smart shadow + token radius, plus the view-mode
 *   per-TYPE row heights (D4) as `minHeight` floors and a non-clipping
 *   inner layer, rendered in the growth-safe FLOW presentations (see the
 *   module docblock). The editor may pass it for WYSIWYG surfaces (scope
 *   amendment 1) — edit mode keeps the exact persisted slots + clipping.
 *   The former `'gel'` value was removed with its last consumer (the room
 *   preview moved to `'smart'`; History owns the gel recipe itself).
 */
export type DashboardCardAppearance = 'default' | 'smart';

/**
 * Pure drag-release target for one widget card (section-aware).
 *
 * The card visually lives at row `layout.y - layoutYOffset` (section-local),
 * so the release target is computed in section-local rows and then REBASED
 * to the absolute persisted row (`+ layoutYOffset`) before handing it to
 * `onMoveWidget` — the store keeps dashboard-absolute coords. With the
 * default offset 0 this is exactly the legacy math (`y + snap`).
 *
 * Section-local containment (fix cycle 8 H): the rebase can keep the
 * PERSISTED row valid (≥ 0) while the SECTION-LOCAL row went negative —
 * the card would render above its section container, overlapping the
 * previous section. Such targets are REJECTED (`null` → no move, no
 * highlight, the card snaps back) at this validation level — the target is
 * never clamped to a different row and nothing is hidden by clipping, so
 * the invalid release cannot happen instead of merely not being drawn.
 * (The in-flight VISUAL containment is a separate, active constraint — see
 * {@link clampedDragTranslation}.)
 *
 * @returns the move target, or `null` when the gesture snapped back to the
 *   card's current cell (nothing changed → no callback) or the target
 *   escapes the section (negative section-local row).
 */
export function moveTarget(
  widget: WidgetConfig,
  dx: number,
  dy: number,
  metrics: {
    readonly padding: number;
    readonly gap: number;
    readonly rowHeight: number;
    readonly cellWidth: number;
  },
  layoutYOffset: number,
): {
  readonly widgetId: string;
  readonly x: number;
  readonly y: number;
} | null {
  const x = widget.layout.x + snapToGrid(dx, metrics.cellWidth + metrics.gap);
  const localY =
    widget.layout.y -
    layoutYOffset +
    snapToGrid(dy, metrics.rowHeight + metrics.gap);
  if (x === widget.layout.x && localY === widget.layout.y - layoutYOffset) {
    return null;
  }
  if (localY < 0) {
    return null;
  }
  return { widgetId: widget.id, x, y: localY + layoutYOffset };
}

/**
 * The dragged card's IN-FLIGHT translation, clamped to its section (fix
 * cycle 8 H completion — reviewer major): while the finger moves, the card
 * follows the gesture, and the raw `dy` stored during a drag previously
 * let a section's base-row card visibly rise ABOVE its own grid. The
 * card's visual top inside the grid
 * is `rect.top` — the SAME section-local pixel rect the card renders with
 * (`pixelRect(x, y - layoutYOffset, …)`, derived from the widget's own
 * layout) — so an upward `dy` is clamped to `-rect.top`: the translated
 * top stops at the section container's top edge and can never rise above
 * it. Downward and horizontal deltas pass through untouched, and a drag
 * that stays inside the section feels exactly as before.
 *
 * This is an ACTIVE transform constraint on the gesture translation — not
 * a clipping/overflow workaround — so the invalid position never exists
 * on screen at all. It completes (does not replace) the validation-level
 * rejection in {@link moveTarget}: the raw gesture still feeds the
 * highlight/release math, a section-escaping release still yields `null`
 * → no highlight, no move callback, snap back.
 */
export function clampedDragTranslation(
  widget: WidgetConfig,
  dx: number,
  dy: number,
  metrics: {
    readonly padding: number;
    readonly gap: number;
    readonly rowHeight: number;
    readonly cellWidth: number;
  },
  layoutYOffset: number,
): { readonly dx: number; readonly dy: number } {
  const top = pixelRect(
    widget.layout.x,
    widget.layout.y - layoutYOffset,
    widget.layout.width,
    widget.layout.height,
    metrics,
  ).top;
  return { dx, dy: Math.max(dy, -top) };
}

/**
 * Pure drag-HIGHLIGHT target for one widget card (user-requested drag
 * feedback): the prospective destination cell (with the widget's span)
 * while the card is held — or `null` when there is NO highlight:
 * - the gesture has not left the card's current cell (snap-back, no move),
 * - or the computed target is OUT OF BOUNDS (the release would be rejected
 *   by the store — no false promise),
 * - or the target would escape the section (negative section-local row —
 *   fix cycle 8 H, via the same rejection as {@link moveTarget}).
 * Section-aware: the same rebase as {@link moveTarget} (the highlight
 * renders section-locally, like the cards). Presentation-only — nothing
 * here reads or writes persisted coordinates.
 */
export function dragTargetCell(
  widget: WidgetConfig,
  dx: number,
  dy: number,
  metrics: {
    readonly padding: number;
    readonly gap: number;
    readonly rowHeight: number;
    readonly cellWidth: number;
  },
  layoutYOffset: number,
): GridCell | null {
  const target = moveTarget(widget, dx, dy, metrics, layoutYOffset);
  if (!target) {
    return null;
  }
  const cell: GridCell = {
    x: target.x,
    y: target.y,
    width: widget.layout.width,
    height: widget.layout.height,
  };
  return inBounds(cell) ? cell : null;
}

/**
 * Pure drop OCCUPANT for one widget card (fix cycle 8 L — drag-to-swap):
 * the FIRST other widget of the grid whose layout overlaps the drop target
 * cell — the swap partner (array order = section order, deterministic).
 * `null` when the drop lands on free space (a plain `onMoveWidget` move).
 *
 * Section-scope note: this grid receives exactly ONE section group, so an
 * occupant of the OTHER section is invisible here — such a drop keeps the
 * plain-move path and is rejected by the store's overlap rule exactly as
 * today (the store's swap guard re-checks the section authority anyway).
 *
 * @param target - the rebased (persisted-coordinates) drop cell, with the
 *   dragged widget's span.
 * @param widgets - the grid's own widgets (one section group).
 * @param draggedId - the dragged widget (never its own occupant).
 */
export function dropOccupant(
  target: GridCell,
  widgets: readonly WidgetConfig[],
  draggedId: string,
): WidgetConfig | null {
  return (
    widgets.find(
      widget => widget.id !== draggedId && collides(widget.layout, target),
    ) ?? null
  );
}

interface DashboardGridProps {
  /** Widgets of the active dashboard. */
  readonly widgets: readonly WidgetConfig[];
  /** Registry used to resolve widget components. */
  readonly registry: WidgetRegistry;
  /** True while the user is rearranging widgets (absolute mode only). */
  readonly editMode: boolean;
  /**
   * Grid pixel metrics — computed from the MEASURED canvas width upstream
   * (`onLayout` on the grid shell → `resolveCanvasWidth`): the editor
   * feeds `computeGridMetrics`, the smart view feeds
   * `computeSmartViewMetrics`. The same metrics instance drives the
   * rendered cards and the drag snapping; the metrics' band (narrow/wide
   * inset) decides the view column width — the flow itself is the same
   * two-column mapping at every width.
   */
  readonly metrics: {
    readonly padding: number;
    readonly gap: number;
    readonly rowHeight: number;
    readonly cellWidth: number;
  };
  /**
   * Move a widget to a grid cell. Returns `false` when rejected (the card
   * snaps back to its last position because the source list did not change).
   */
  readonly onMoveWidget: (widgetId: string, x: number, y: number) => boolean;
  /**
   * Swap TWO widgets' positions (fix cycle 8 L — editor drag-to-swap):
   * called INSTEAD of `onMoveWidget` when the release target cell is
   * occupied by ANOTHER widget of this grid. `false` → the swap was
   * rejected (both cards snap back — the source list did not change).
   * Omitted on view surfaces (no edit mode there): an occupied-cell drop
   * then issues no callback and snaps back — the same visible outcome as
   * the legacy rejected move.
   */
  readonly onSwapWidgets?: (widgetIdA: string, widgetIdB: string) => boolean;
  /** Cycle a widget to a new size (`false` → keep the current size). */
  readonly onResizeWidget: (widgetId: string, size: WidgetSize) => boolean;
  /** Remove a widget. */
  readonly onRemoveWidget: (widgetId: string) => void;
  /** Repair a lost binding (device + capability picker result). */
  readonly onRebindWidget?: (
    widgetId: string,
    deviceId: string,
    capability: CapabilityType,
  ) => void;
  /**
   * Row offset for SECTION rendering (M2 label fix): when the screen renders
   * one section group (e.g. the devices group seeded at persisted rows 1..2)
   * in its own grid, it passes the group's minimum persisted row here so the
   * group renders compactly at the top of its own grid — cards draw at
   * `y - layoutYOffset` — while move gestures re-base the section-local
   * target back to the absolute persisted row (`y + layoutYOffset`).
   * Default 0: the full-layout editor passes nothing and behaves unchanged.
   * Ignored in the FLOW smart view (cards render in flow, no pixel
   * offsets to rebase).
   */
  readonly layoutYOffset?: number;
  /**
   * Card surface appearance (opt-in seam). `'default'` (omitted) keeps the
   * neutral editor-safe surface; `'smart'` applies the Smart Home view
   * recipe (card surface/border/shadow/radius + per-TYPE view row heights
   * as floors) and — in VIEW mode — the growth-safe flow presentations.
   * The editor may pass it for WYSIWYG surfaces; edit mode keeps the
   * exact-slot contract unchanged.
   */
  readonly cardAppearance?: DashboardCardAppearance;
  /**
   * Non-overlapping editor chrome (opt-in seam, approved layout repair).
   * When `editMode` is true AND this is set, the move/delete/resize
   * controls render in a dedicated chrome BAR at the top of each card and
   * the widget content shifts down — controls can never cover widget
   * icons, titles, values or switches. Without it (default), edit mode
   * keeps the legacy overlay controls (unchanged behavior for any caller
   * that does not opt in). View mode is unaffected either way.
   */
  readonly editorChrome?: boolean;
  /**
   * Per-card overflow menu (opt-in seam, Template-room editor): when set,
   * the chrome bar renders a "⋯" button calling `onWidgetMenu(widget.id)`
   * (rename/configure/duplicate/move/delete live in the editor's menu).
   * Ignored in view mode.
   */
  readonly onWidgetMenu?: (widgetId: string) => void;
}

/**
 * The widget grid container.
 *
 * @param props - see {@link DashboardGridProps}.
 */
export function DashboardGrid({
  widgets,
  registry,
  editMode,
  metrics,
  onMoveWidget,
  onSwapWidgets,
  onResizeWidget,
  onRemoveWidget,
  onRebindWidget,
  layoutYOffset = 0,
  cardAppearance = 'default',
  editorChrome = false,
  onWidgetMenu,
}: DashboardGridProps) {
  const { tokens } = useTheme();
  // Smart view recipe: the per-TYPE row heights and the growth-safe flow
  // apply in VIEW mode only — edit mode keeps the exact persisted slot
  // grid (the editor contract).
  const smartView = cardAppearance === 'smart' && !editMode;
  // Smart two-column flow rows (smart view, EVERY canvas width): the
  // persisted coordinates map to flow rows/columns through the PURE
  // `smartFlowLayout` (presentation-only — persisted cells are read,
  // never rewritten). The caller's metrics decide the column width (the
  // narrow band keeps ~156pt columns); grown cards make their flow row
  // taller and push everything below down, so nothing can overlap and
  // nothing escapes the scroll extent.
  const smartFlowRows = useMemo(
    () => (smartView ? smartFlowLayout(widgets, metrics).rows : null),
    [smartView, widgets, metrics],
  );

  /**
   * The grid is the highlight's owner (one highlight per grid): while a
   * card drag is active, the card reports its prospective destination cell
   * (or `null` to clear) through this stable setter — see
   * {@link dragTargetCell}. Declared before any early return so the hook
   * order is unconditional.
   */
  const [dragHighlight, setDragHighlight] = useState<GridCell | null>(null);
  // Section-local pixel rect (same rebase the cards use: `y - offsetY`).
  const highlightRect = dragHighlight
    ? pixelRect(
        dragHighlight.x,
        dragHighlight.y - layoutYOffset,
        dragHighlight.width,
        dragHighlight.height,
        metrics,
      )
    : null;

  if (smartFlowRows) {
    // GROWTH-SAFE smart view (fix cycle 2, every width): normal FLOW rows
    // of up to
    // two columns mapped from the persisted coordinates by the pure
    // `smartFlowLayout`. The container owns the smart inset (`padding`) and
    // inter-row gap (`rowGap`); each row owns the inter-column gap. Cards
    // carry their per-TYPE `minHeight` floor — a grown card stretches its
    // row (the sibling stretches with it) and pushes every following
    // row/section down, so the ScrollView extent always covers the real
    // content and overlap is structurally impossible. An empty column
    // renders an invisible spacer so the persisted columns stay aligned.
    const byId = new Map(widgets.map(widget => [widget.id, widget]));
    const renderSlot = (id: string | null, slot: string) => {
      const widget = id ? byId.get(id) : undefined;
      if (!widget) {
        return <View key={slot} style={{ width: metrics.cellWidth }} />;
      }
      return (
        <SmartFlowCard
          key={widget.id}
          widget={widget}
          width={metrics.cellWidth}
          floor={viewCardHeight(widget.type, widget.layout.height, metrics)}
          registry={registry}
        />
      );
    };
    return (
      <View
        style={[
          styles.gridSmartFlow,
          {
            padding: metrics.padding,
            // Scope amendment 2 (label spacing): the TOP padding is
            // absorbed — the section label above owns the 12–16pt
            // label→card gap (consistent on all three smart screens).
            paddingTop: 0,
            rowGap: metrics.gap,
          },
        ]}
      >
        {smartFlowRows.map((row, index) => (
          <View
            key={`smart-flow-row-${index}`}
            style={[styles.smartFlowRow, { gap: metrics.gap }]}
          >
            {row.full !== null ? (
              (() => {
                const widget = byId.get(row.full);
                return widget ? (
                  <SmartFlowCard
                    widget={widget}
                    width={metrics.cellWidth * 2 + metrics.gap}
                    floor={viewCardHeight(
                      widget.type,
                      widget.layout.height,
                      metrics,
                    )}
                    registry={registry}
                  />
                ) : null;
              })()
            ) : (
              <>
                {renderSlot(row.left, 'left')}
                {renderSlot(row.right, 'right')}
              </>
            )}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {highlightRect ? (
        <View
          pointerEvents="none"
          testID="drag-highlight"
          style={[
            styles.dragHighlight,
            {
              left: highlightRect.left,
              top: highlightRect.top,
              width: highlightRect.width,
              height: highlightRect.height,
              // Translucent teal tint + border (the drag affordance —
              // primary is the smart teal via D2).
              backgroundColor: tokens.primary,
              borderColor: tokens.primary,
              opacity: 0.18,
            },
          ]}
        />
      ) : null}
      {widgets.map(widget => (
        <WidgetCard
          key={widget.id}
          widget={widget}
          sectionWidgets={widgets}
          registry={registry}
          editMode={editMode}
          metrics={metrics}
          onMoveWidget={onMoveWidget}
          onSwapWidgets={onSwapWidgets}
          onResizeWidget={onResizeWidget}
          onRemoveWidget={onRemoveWidget}
          onRebindWidget={onRebindWidget}
          layoutYOffset={layoutYOffset}
          cardAppearance={cardAppearance}
          editorChrome={editorChrome}
          onWidgetMenu={onWidgetMenu}
          onDragTarget={setDragHighlight}
        />
      ))}
    </View>
  );
}

/**
 * Pure card-surface layers for the opt-in appearance seam (see
 * {@link DashboardCardAppearance}): `'smart'` paints the smart card
 * surface + smart shadow with the hairline smart border; `'default'` keeps
 * the neutral theme surface + border and adds nothing. (The former `'gel'`
 * branch was removed with its last consumer — no gel recipe remains; every
 * surface consumes the `smart` block.)
 *
 * @param allowGrowth - whether the inner layer may grow with its content:
 *   the smart VIEW never clips (`overflow: 'visible'` — longer inline
 *   command errors and font-scaled text grow the card via the per-type
 *   `minHeight` floor); the editor's exact-slot contract (and the default
 *   surface) keeps the clipping inner.
 */
function cardSurfaceLayers(
  tokens: ThemeTokens,
  cardAppearance: DashboardCardAppearance,
  allowGrowth: boolean,
): { outer: ViewStyle[]; inner: ViewStyle[] } {
  if (cardAppearance === 'smart') {
    // Smart Home card recipe: card surface, hairline border, smart shadow
    // (dark theme: zeroed shadow — border-borne depth). The radius comes
    // from the `smart.radius.card` token (the source of truth — same
    // rendered value as the legacy hard-coded 14).
    return {
      outer: [
        { backgroundColor: tokens.smart.colors.card },
        tokens.smart.cardShadow,
        { borderRadius: tokens.smart.radius.card },
      ],
      inner: [
        {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
          borderRadius: tokens.smart.radius.card,
          overflow: allowGrowth ? 'visible' : 'hidden',
        },
      ],
    };
  }
  return {
    outer: [],
    inner: [{ backgroundColor: tokens.surface, borderColor: tokens.border }],
  };
}

/**
 * One card of the growth-safe smart view (fix cycle 2): a normal-flow
 * card at its column width with the per-TYPE `minHeight` floor. Spacing is
 * owned by the flow containers (container padding/rowGap + row gap), so
 * the card carries only its size — nothing double-counts. The smart inner
 * never clips: grown content extends the card, its flow row, and every
 * following row (no overlap possible, extent always covers the content).
 */
function SmartFlowCard({
  widget,
  width,
  floor,
  registry,
}: {
  widget: WidgetConfig;
  /** The column (or full-row) width from the smart-view metrics. */
  width: number;
  /** The per-TYPE view height floor ({@link viewCardHeight}). */
  floor: number;
  registry: WidgetRegistry;
}) {
  const { tokens } = useTheme();
  const { outer, inner } = cardSurfaceLayers(tokens, 'smart', true);
  return (
    <View
      testID={`dashboard-flow-card-${widget.id}`}
      style={[styles.cardSurface, { width, minHeight: floor }, ...outer]}
    >
      <View style={[styles.cardInner, ...inner]}>
        <View style={styles.widgetContent}>
          <WidgetRenderer registry={registry} config={widget} />
        </View>
      </View>
    </View>
  );
}

/** The next size in the definition's supportedSizes order (wrapping). */
function nextCycledSize(
  widget: WidgetConfig,
  supportedSizes: readonly WidgetSize[],
): WidgetSize | null {
  if (supportedSizes.length === 0) {
    return null;
  }
  if (supportedSizes.length === 1) {
    return supportedSizes[0] ===
      `${widget.layout.width}x${widget.layout.height}`
      ? null
      : supportedSizes[0];
  }
  const current =
    `${widget.layout.width}x${widget.layout.height}` as WidgetSize;
  const index = supportedSizes.indexOf(current);
  if (index === -1) {
    return supportedSizes[0];
  }
  return supportedSizes[(index + 1) % supportedSizes.length];
}

function WidgetCard({
  widget,
  sectionWidgets,
  registry,
  editMode,
  metrics,
  onMoveWidget,
  onSwapWidgets,
  onResizeWidget,
  onRemoveWidget,
  onRebindWidget,
  layoutYOffset,
  cardAppearance,
  editorChrome,
  onWidgetMenu,
  onDragTarget,
}: {
  widget: WidgetConfig;
  /** The grid's own widget list (one section group — the swap search space). */
  sectionWidgets: readonly WidgetConfig[];
  registry: WidgetRegistry;
  editMode: boolean;
  metrics: DashboardGridProps['metrics'];
  onMoveWidget: DashboardGridProps['onMoveWidget'];
  onSwapWidgets?: DashboardGridProps['onSwapWidgets'];
  onResizeWidget: DashboardGridProps['onResizeWidget'];
  onRemoveWidget: DashboardGridProps['onRemoveWidget'];
  onRebindWidget: DashboardGridProps['onRebindWidget'];
  layoutYOffset: number;
  cardAppearance: DashboardCardAppearance;
  editorChrome: boolean;
  onWidgetMenu?: DashboardGridProps['onWidgetMenu'];
  /** Report the prospective destination cell while dragging (null clears). */
  onDragTarget?: (cell: GridCell | null) => void;
}) {
  const { tokens } = useTheme();
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  // Card surface: the neutral editor default or the smart recipe (scope
  // amendment 1). This absolute branch serves the EDITOR and the default
  // callers only — the smart VIEW renders in the growth-safe flow branches
  // above — so the exact-slot contract keeps the clipping inner.
  const { outer, inner } = cardSurfaceLayers(tokens, cardAppearance, false);

  // Non-overlapping chrome layout (opt-in): a dedicated bar owns the
  // move/delete/resize controls and the widget content shifts below it.
  const chromeBar = editMode && editorChrome;

  // Section rebase: draw the card at its section-local row (`y -
  // layoutYOffset`) — persisted coords stay dashboard-absolute.
  const rect = useMemo(
    () =>
      pixelRect(
        widget.layout.x,
        widget.layout.y - layoutYOffset,
        widget.layout.width,
        widget.layout.height,
        metrics,
      ),
    [widget.layout, layoutYOffset, metrics],
  );

  // NOTE (fix cycle 2): the smart view no longer renders here — view-mode
  // smart cards live in the growth-safe flow branch (two columns at every
  // width) so grown content can never overlap a sibling slot nor escape
  // the scroll extent. This absolute branch is the EDITOR + default
  // surface only: the exact persisted slot rect (height, clipping) is the
  // contract.

  const panResponder = useMemo(() => {
    if (!editMode) {
      return null;
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) + Math.abs(gesture.dy) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        setDrag({ dx: 0, dy: 0 });
        onDragTarget?.(dragTargetCell(widget, 0, 0, metrics, layoutYOffset));
      },
      onPanResponderMove: (_, gesture) => {
        // In-flight visual containment (fix cycle 8 H completion): the
        // STORED translation is clamped to the section, so the dragged
        // card can never render above its section container while it
        // follows the finger. The RAW gesture still feeds the destination
        // feedback below — the validation-level rejection (moveTarget
        // null → no highlight, no release callback, snap back) is
        // unchanged.
        setDrag(
          clampedDragTranslation(
            widget,
            gesture.dx,
            gesture.dy,
            metrics,
            layoutYOffset,
          ),
        );
        // Live destination feedback (null when unchanged/out of bounds).
        onDragTarget?.(
          dragTargetCell(
            widget,
            gesture.dx,
            gesture.dy,
            metrics,
            layoutYOffset,
          ),
        );
      },
      onPanResponderRelease: (_, gesture) => {
        // Reset gesture state first — when the draft store rejects the move
        // the card snaps back (the source list did not change).
        setDrag(null);
        onDragTarget?.(null);
        // Section-aware move math: re-bases the section-local drag target
        // back to the absolute persisted row before the callback (a
        // section-escaping target is already rejected inside).
        const target = moveTarget(
          widget,
          gesture.dx,
          gesture.dy,
          metrics,
          layoutYOffset,
        );
        if (!target) {
          return;
        }
        // Drag-to-swap resolution (fix cycle 8 L): an OCCUPIED drop cell
        // (another widget of this section overlaps the target) exchanges
        // the two positions via the swap seam; a free cell keeps the plain
        // move. A rejected swap (`false`) leaves the draft untouched → the
        // cards snap back, the same UX as a rejected move. A cross-section
        // occupant is invisible to this grid → the plain move runs and the
        // store rejects it exactly as today.
        const cell: GridCell = {
          x: target.x,
          y: target.y,
          width: widget.layout.width,
          height: widget.layout.height,
        };
        const occupant = dropOccupant(cell, sectionWidgets, widget.id);
        if (occupant) {
          onSwapWidgets?.(widget.id, occupant.id);
          return;
        }
        onMoveWidget(target.widgetId, target.x, target.y);
      },
      onPanResponderTerminate: () => {
        setDrag(null);
        onDragTarget?.(null);
      },
      onPanResponderTerminationRequest: () => false,
    });
    // `rect`/`metrics` only change when the layout changes (never mid-gesture);
    // the responder reads the delta from `gesture` — no refs required.
    // `onDragTarget` is the grid's stable setState. The drag/occupant math
    // is computed per-move by the PURE `dragTargetCell`/`dropOccupant`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editMode,
    rect,
    widget.id,
    widget.layout.x,
    widget.layout.y,
    metrics,
    layoutYOffset,
    sectionWidgets,
    onSwapWidgets,
  ]);

  const definition = registry.get(widget.type);
  const nextSize = definition
    ? nextCycledSize(widget, definition.supportedSizes)
    : null;

  const chromeControls = editMode ? (
    chromeBar ? (
      // Editor chrome BAR: controls live in their own row, never on top of
      // the widget content. Smart card recipe (settings-smart-home-sync):
      // card surface + hairline card border; the resize/delete buttons keep
      // the primary/danger seams (primary is now teal via D2).
      <View
        style={[
          styles.chromeBar,
          {
            backgroundColor: tokens.smart.colors.card,
            borderTopWidth: 1,
            borderTopColor: tokens.smart.colors.cardBorder,
          },
        ]}
        pointerEvents="box-none"
      >
        <View
          style={[styles.dragHandleInline, { backgroundColor: tokens.border }]}
        >
          <Text
            style={[styles.dragHandleText, { color: tokens.textSecondary }]}
          >
            {'\u22ee\u22ee'}
          </Text>
        </View>
        <View style={styles.chromeSpacer} />
        {onWidgetMenu ? (
          <Pressable
            style={[
              styles.chromeButton,
              {
                // Icon-chip recipe (SwitchWidget/SensorValueWidget): page
                // surface + cardBorder hairline; the glyph uses the smart
                // teal accent (same family as the widget chips).
                backgroundColor: tokens.smart.colors.page,
                borderWidth: 1,
                borderColor: tokens.smart.colors.cardBorder,
              },
            ]}
            onPress={() => {
              onWidgetMenu(widget.id);
            }}
            accessibilityLabel={`${STRINGS.templates.widgetMenu} ${
              widget.title ?? widget.type
            }`}
            testID={`widget-chrome-menu-${widget.id}`}
          >
            <Text
              style={[
                styles.overlayButtonText,
                { color: tokens.smart.colors.teal },
              ]}
            >
              {'\u22ef'}
            </Text>
          </Pressable>
        ) : null}
        {nextSize ? (
          <Pressable
            style={[styles.chromeButton, { backgroundColor: tokens.primary }]}
            onPress={() => {
              onResizeWidget(widget.id, nextSize);
            }}
            accessibilityLabel={`${STRINGS.dashboard.resize} ${nextSize}`}
          >
            <Text
              style={[styles.overlayButtonText, { color: tokens.onPrimary }]}
            >
              {nextSize}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.chromeButton, { backgroundColor: tokens.danger }]}
          onPress={() => {
            onRemoveWidget(widget.id);
          }}
          accessibilityLabel={STRINGS.dashboard.deleteWidget}
        >
          <Text style={[styles.overlayButtonText, { color: tokens.onPrimary }]}>
            {'−'}
          </Text>
        </Pressable>
      </View>
    ) : (
      // Legacy overlay controls (default, unchanged for existing callers).
      <>
        <View style={[styles.dragHandle, { backgroundColor: tokens.border }]}>
          <Text
            style={[styles.dragHandleText, { color: tokens.textSecondary }]}
          >
            {'\u22ee\u22ee'}
          </Text>
        </View>
        <Pressable
          style={[
            styles.overlayButton,
            styles.removeButton,
            { backgroundColor: tokens.danger },
          ]}
          onPress={() => {
            onRemoveWidget(widget.id);
          }}
        >
          <Text style={[styles.overlayButtonText, { color: tokens.onPrimary }]}>
            {'−'}
          </Text>
        </Pressable>
        {nextSize ? (
          <Pressable
            style={[
              styles.overlayButton,
              styles.resizeButton,
              { backgroundColor: tokens.primary },
            ]}
            onPress={() => {
              onResizeWidget(widget.id, nextSize);
            }}
          >
            <Text
              style={[styles.overlayButtonText, { color: tokens.onPrimary }]}
            >
              {nextSize}
            </Text>
          </Pressable>
        ) : null}
      </>
    )
  ) : null;

  return (
    <View
      {...(panResponder?.panHandlers ?? {})}
      style={[
        styles.card,
        {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          // Exact persisted slot height — the editor/default absolute
          // contract (the smart view grows in its flow branches instead).
          height: rect.height,
        },
        ...outer,
        drag
          ? {
              // The stored translation is already section-clamped
              // (clampedDragTranslation) — the card can never render above
              // its section container mid-gesture.
              transform: [{ translateX: drag.dx }, { translateY: drag.dy }],
              zIndex: 10,
              opacity: 0.92,
            }
          : null,
      ]}
    >
      <View style={[styles.cardInner, ...inner]}>
        {/* Chrome bar (opt-in): in flow ABOVE the content — no overlap. */}
        {chromeBar ? chromeControls : null}
        <View
          style={chromeBar ? styles.widgetContentChrome : styles.widgetContent}
          pointerEvents={editMode ? 'none' : 'auto'}
        >
          <WidgetRenderer
            registry={registry}
            config={widget}
            onRebind={
              onRebindWidget
                ? (deviceId, capability) =>
                    onRebindWidget(widget.id, deviceId, capability)
                : undefined
            }
          />
        </View>
        {/* Legacy overlay controls (absolute, default callers unchanged). */}
        {!chromeBar ? chromeControls : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flex: 1 },
  // Growth-safe smart view (fix cycle 2): flow rows of up to two columns
  // (no absolute positioning) at EVERY canvas width. The container's
  // `padding`/`rowGap` and each row's column `gap` come from the smart-view
  // metrics inline.
  gridSmartFlow: {},
  smartFlowRow: { flexDirection: 'row' },
  // Absolute-mode card: positioned inline per the pixel math.
  card: {
    position: 'absolute',
    borderRadius: 14,
  },
  // Drag destination feedback (editor only — view mode has no responder):
  // a translucent primary tint + border over the prospective cells, above
  // sibling cards (zIndex 5) but below the dragged card (zIndex 10).
  // Presentation-only: cleared on drop/cancel, never persisted.
  dragHighlight: {
    position: 'absolute',
    borderRadius: 14,
    borderWidth: 2,
    zIndex: 5,
  },
  // Shared card surface recipe: the colors come from the active tokens via
  // the inline layers (`cardSurfaceLayers` — neutral default or smart).
  cardSurface: { borderRadius: 14 },
  cardInner: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  widgetContent: { flex: 1 },
  // Non-overlapping editor chrome (opt-in `editorChrome`): the bar occupies
  // its own flow row above the widget content, so the content area (flex:1
  // below) can never be covered by the move/delete/resize controls.
  widgetContentChrome: { flex: 1, paddingTop: 6 },
  chromeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  dragHandleInline: {
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  chromeSpacer: { flex: 1 },
  chromeButton: {
    minWidth: 30,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandle: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  dragHandleText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  overlayButton: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: { top: 6, right: 6 },
  resizeButton: { bottom: 6, right: 6 },
  overlayButtonText: { fontWeight: '700', fontSize: 13 },
});
