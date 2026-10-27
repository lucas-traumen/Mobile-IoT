/**
 * HistoryChartCard — one Smart Home chart card on the History tab
 * (history-smart-home-redesign): white card surface (`smart.colors.card`),
 * hairline `cardBorder`, `smart.radius.card` corners, the subtle smart
 * card shadow, and the approved anatomy — sensor icon + title + stats
 * (Thấp nhất / Cao nhất / Trung bình WITH units) + the victory-native
 * line/area chart with a touch tooltip.
 *
 * Strictly presentational: receives the field identity, label, unit,
 * points, accent color, layout metrics and the SHARED time axis (domain +
 * tick formatter from `timeAxis.ts`, so every card aligns). Stats are
 * computed from the SAME points the chart renders (`computeSeriesStats`) —
 * no mockup numbers; a registered sensor without points renders the
 * truthful `Chưa có dữ liệu` state (NEVER a 0).
 *
 * Chart recipe (approved spec): line strokeWidth 2 + area fill in the same
 * accent at ~5% opacity, light-gray grid, the shared 24h tick format
 * (date added when the range crosses midnight, reduced tick count on
 * narrow widths), height 160–200 phone / 200–240 tablet. Tooltip:
 * `VictoryVoronoiContainer` + `VictoryTooltip` — hidden on mount, shown on
 * touch, and de-activated on touch end (`activateData={false}` keeps the
 * label lifecycle label-only, so the release/cancel event clears it).
 *
 * Y axis (history-adaptive-y-axis): each card passes an explicit adaptive
 * `domain.y` computed from ITS OWN points (`computeValueDomain` in
 * `valueAxis.ts`) — WITHOUT it, VictoryArea's `getDomainWithZero` forces
 * the scale to include 0, so a near-constant series (25–26.4 °C) renders
 * flat with 0-based ticks. User-approved decision: always adaptive (no
 * zero-based toggle); a flat series falls back to ±1; the x-domain stays
 * SHARED across cards (`domain` prop).
 *
 * Reveal animation (history-chart-reveal-downsample): when the card
 * MOUNTS (first load, room change, range change — the remount is driven
 * by `HistoryScreen`'s card key; a points refresh does NOT replay), the
 * chart presents in two phases of the SAME fetch (AD-2): a COARSE
 * 10-point sample spread across the full window sweeping left→right
 * (victory's built-in `onLoad` clip reveal — the `VictoryTransition`
 * animates the group's clip width 0 → full x-range; no datum transform
 * needed, verified against victory-core's transition source), then
 * `SETTLE_DELAY_MS` after mount it settles onto the FULL aggregated
 * series (the Flux query aggregates server-side —
 * dashboard-history-board-touch-share AD-2 — so the settle phase is the
 * whole delivered series, never a strided subset of it). Render budget
 * (AD-4/AD-5): ONLY the line/area `data` passes through the coarse
 * sampler (`downsampleSeries`, `seriesSampling.ts`); stats, the y-domain
 * and the x-domain stay computed from the FULL points — the coarse phase
 * is a subset of the full series, so no phase can exceed the (static)
 * axes.
 * Reduce motion (AD-6): `useChartReduceMotion` starts animate-ON
 * (`false`) — deliberately diverging from the banner's disabled-until-
 * confirmed default, because the reveal is decorative (≤450ms window)
 * while the banner is operational feedback — and renders the fine chart
 * instantly with NO `animate` prop once the OS confirms the preference.
 *
 * victory-native@36 on React 19 REQUIRES explicit native SVG primitives
 * (the `NATIVE_CHART_*` pattern — function-component `defaultProps` no
 * longer exist, so without explicit props the inner web components crash
 * on device). This applies to the chart, both axes, the line, the area,
 * the voronoi container AND the tooltip (its label/flyout/group).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ClipPath, Defs, G, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import {
  Background,
  Curve,
  Flyout,
  LineSegment,
  Path,
  VictoryArea,
  VictoryAxis,
  VictoryChart,
  VictoryClipContainer,
  VictoryContainer,
  VictoryLabel,
  VictoryLine,
  VictoryTooltip,
  VictoryVoronoiContainer,
} from 'victory-native';

import { STRINGS } from '@core/i18n';
import type { ThemeTokens } from '@core/theme';

import { computeSeriesStats } from '@modules/history/api';

import {
  MAX_RENDER_POINTS,
  REVEAL_COARSE_POINTS,
  REVEAL_SWEEP_MS,
  SETTLE_DELAY_MS,
  useChartReduceMotion,
} from './chartMotion';
import { downsampleSeries } from './seriesSampling';
import { formatTooltipTime, type TimeDomain } from './timeAxis';
import { computeValueDomain } from './valueAxis';

/** Explicit native SVG primitives (React 19 `defaultProps` workaround). */
const NATIVE_CHART_GROUP = <G />;
const NATIVE_CHART_CONTAINER = <VictoryContainer />;
const NATIVE_CHART_BACKGROUND = <Background />;
const NATIVE_AXIS_SEGMENT = <LineSegment />;
const NATIVE_LABEL = <VictoryLabel />;

/**
 * WEB-SAFE line/area curve (user-acceptance fix: axes painted but the
 * VictoryLine/VictoryArea shapes did NOT on the web build).
 *
 * Root cause: victory's `Curve` (victory-line/es/curve.js) ALWAYS passes
 * `pathComponent` down to its inner `Path` — it is in `defaultProps` and
 * Curve never strips it before `cloneElement(props.pathComponent, props)`.
 * With the React-19 native-primitive workaround `dataComponent={<Curve/>}`,
 * that inner path component is victory-native's `VPath`, which spreads ALL
 * of its props onto react-native-svg's `Path`. On web, react-native-svg's
 * `WebShape.render` forwards every prop through `unstable_createElement`
 * onto the DOM `<path>`, so the RN-only `pathComponent` prop (a React
 * element object) reaches the DOM and react-dom REJECTS the render with
 * `warnUnknownProperties` — the shape never paints.
 *
 * Why the axes survived: `LineSegment` (victory-core/es) clones its
 * `lineComponent` with an EXPLICIT prop whitelist (x1/x2/y1/y2/style/…) and
 * drops `lineComponent`/`pathComponent`, so nothing RN-only leaks.
 *
 * Fix: a small module-local wrapper around victory's own `Curve` that
 * passes `<Path/>` as the `pathComponent` AND strips that same prop from
 * the spread. Curve's explicit `cloneElement` payload (`d`, evaluated
 * style, transform, role, shapeRendering, className, clipPath, tabIndex,
 * aria-label) is already SVG-safe, and victory-native's `VPath` converts
 * the style object into native props. Result: the computed victory `d`
 * string + stroke/fill reach the `<path>` identically on web AND native,
 * and no RN-only `pathComponent` element ever reaches the DOM. The wrapper
 * keeps the `Curve` component identity in the tree (regression-guardable)
 * and keeps the explicit native-primitive pattern intact.
 *
 * @param props - the full victory `Curve` props (from VictoryLine/Area).
 */
type CurveProps = React.ComponentProps<typeof Curve>;
const SafeCurve = (props: CurveProps) => {
  const { pathComponent: _discarded, ...rest } = props;
  return <Curve pathComponent={<Path />} {...rest} />;
};
const NATIVE_LINE_CURVE = <SafeCurve />;
const NATIVE_AREA_CURVE = <SafeCurve />;

/**
 * WEB-SAFE + ID-CORRECT clip path (history-clip-path-web-fix: on the web
 * build the reveal sweep spammed react-dom validation errors every frame
 * AND never actually clipped — the line rendered full-width from the first
 * frame). Explicit native primitive for `VictoryClipContainer`'s
 * `clipPathComponent` slot (same React-19 `defaultProps` workaround
 * pattern as every `NATIVE_*` above), with two correctness jobs the raw
 * `<ClipPath />` it replaces could not do:
 *
 * 1. DROP the junk props. victory-core's `renderClipComponent` clones the
 *    slot element with ALL of the container's props (clipWidth, clipHeight,
 *    translateX/Y, clipPadding, style, events, groupComponent,
 *    rectComponent, circleComponent, victory's own parent `id`, …) plus the
 *    generated clip id under the prop name `clipId`. On web,
 *    react-native-svg's `WebShape.render` forwards nearly everything to the
 *    DOM, so every unknown prop became a react-dom DEV error — and
 *    victory-native regenerates the clip id in `componentDidUpdate` on
 *    EVERY animation frame, so the reveal sweep remounted the clip path
 *    (and re-logged the errors) each frame.
 * 2. MAP the id. victory passes the id as `clipId`, but react-native-svg's
 *    `ClipPath` reads prop `id` — a raw slot element never carried the
 *    RIGHT id (its junk-spread `id` is victory's parent/series id, not the
 *    clip id), so the clipped group's `clipPath="url(#victory-clip-N)"`
 *    referenced a non-existent element: NO clipping was applied. Harmless
 *    while clipWidth was static full-width; the reveal's 0→full sweep is
 *    exactly when the clip must exist.
 *
 * Fix: mirror victory-native's own internal `VClipPath`
 * (victory-native/src/components/victory-primitives/clip-path.js) —
 * whitelist `{children, clipId}`, map `clipId → id`, and render
 * `<G><Defs><ClipPath id={clipId}>{children}</ClipPath></Defs></G>`. The
 * `<G>` wrapper is deliberate (old react-native-svg exception workaround,
 * victory-native issue #432). This also corrects the comment this block
 * replaces: victory-core renders NO `<Defs>` of its own — the Defs wrapper
 * belongs HERE (victory-native ships it inside VClipPath for exactly this
 * slot). The whitelist keeps the reveal sweep clipping for real on web AND
 * native, via the same in-app mirror pattern as `SafeCurve` above.
 *
 * @param props - the full props victory-core's clip container clones onto
 *   the slot; everything except `clipId`/`children` is deliberately
 *   dropped (`key` from cloneElement is React-managed, never a prop).
 */
type SafeClipPathProps = {
  readonly clipId?: number | string;
  readonly children?: React.ReactNode;
};
const SafeClipPath = ({ clipId, children }: SafeClipPathProps) => (
  <G>
    <Defs>
      <ClipPath id={clipId?.toString()}>{children}</ClipPath>
    </Defs>
  </G>
);
const NATIVE_CLIP_PATH = <SafeClipPath />;
const NATIVE_LINE_GROUP = (
  <VictoryClipContainer clipPathComponent={NATIVE_CLIP_PATH} />
);
const NATIVE_VORONOI_CONTAINER = (
  // activateData=false: activation/deactivation is LABEL-only, so the
  // touch-release/cancel events genuinely clear the tooltip (the approved
  // "hidden after interaction ends" contract).
  <VictoryVoronoiContainer activateData={false} />
);
const NATIVE_TOOLTIP_LABEL = (
  <VictoryLabel textComponent={<SvgText />} backgroundComponent={<G />} />
);
const NATIVE_TOOLTIP_FLYOUT = <Flyout pathComponent={<Path />} />;
const NATIVE_TOOLTIP_GROUP = <G />;
const NATIVE_TOOLTIP = (
  <VictoryTooltip
    renderInPortal={false}
    labelComponent={NATIVE_TOOLTIP_LABEL}
    flyoutComponent={NATIVE_TOOLTIP_FLYOUT}
    groupComponent={NATIVE_TOOLTIP_GROUP}
  />
);

export interface HistoryChartCardProps {
  /** Base testID (`<testID>-icon`, `-no-data`, …). */
  readonly testID: string;
  /** The Ionicons glyph for the card header (22–24pt). */
  readonly icon: keyof typeof Ionicons.glyphMap;
  /** Card title WITHOUT the unit (e.g. `Nhiệt độ`). */
  readonly label: string;
  /** Display unit (appended to the title + every stat value; may be ''). */
  readonly unit: string;
  /** The series points the chart AND the stats are computed from. */
  readonly points: readonly { t: number; value: number }[];
  /** Series accent (temperature teal / humidity blue / catalog color). */
  readonly color: string;
  /** Active theme tokens (theme-aware via the smart block only). */
  readonly tokens: ThemeTokens;
  /** Card content width in px (the chart fills it minus padding/border). */
  readonly chartWidth: number;
  /** Chart height: 160–200 phone / 200–240 tablet (responsive). */
  readonly chartHeight: number;
  /** Wide canvas → stats sit RIGHT of the title row; else below it. */
  readonly wide: boolean;
  /** The SHARED x-domain (same for every card on the screen). */
  readonly domain: TimeDomain;
  /** The SHARED x-axis tick values (same for every card). */
  readonly tickValues: readonly number[];
  /** The SHARED x-axis tick formatter (same for every card). */
  readonly tickFormat: (t: number) => string;
}

/**
 * One Smart Home history chart card.
 *
 * @param props - see {@link HistoryChartCardProps}.
 */
export function HistoryChartCard({
  testID,
  icon,
  label,
  unit,
  points,
  color,
  tokens,
  chartWidth,
  chartHeight,
  wide,
  domain,
  tickValues,
  tickFormat,
}: HistoryChartCardProps) {
  const stats = computeSeriesStats(
    points.map(point => ({ t: point.t, value: point.value })),
  );
  const title = unit ? `${label} (${unit})` : label;
  const statsRow = (
    <View
      style={[styles.statsRow, wide ? styles.statsRowWide : null]}
      testID={`${testID}-stats`}
    >
      <StatCell
        label={STRINGS.history.statMin}
        value={stats?.min ?? null}
        unit={unit}
        tokens={tokens}
      />
      <StatCell
        label={STRINGS.history.statMax}
        value={stats?.max ?? null}
        unit={unit}
        tokens={tokens}
      />
      <StatCell
        label={STRINGS.history.statAvg}
        value={stats?.avg ?? null}
        unit={unit}
        tokens={tokens}
      />
    </View>
  );

  // The chart fills the card's inner width exactly: the screen passes the
  // band content width and we subtract this card's own padding (2×16) and
  // hairline border (2×1) — the axis gutter is INTERNAL to VictoryChart
  // (padding.left) and must not be subtracted again.
  const innerWidth = Math.max(
    200,
    chartWidth - tokens.smart.spacing.cardPadding * 2 - 2,
  );

  // Adaptive per-card y-domain (see valueAxis.ts): an explicit `domain.y`
  // overrides VictoryArea's `getDomainWithZero` (which would force the
  // scale to include 0). `computeValueDomain` returns null ONLY for an
  // empty series — the branch below renders the no-data state instead of
  // a chart — so the ternary guard (never a non-null assertion, ISSUE-012
  // item 10 precedent) is enough to satisfy the type.
  const yDomain = computeValueDomain(points);

  // Reveal phase machine (history-chart-reveal-downsample): `settled`
  // flips ONCE after mount (mount-only timer, cleaned up on unmount;
  // under reduce motion a 0ms timer — the fine data is already on the
  // first frame because displayData reads reduceMotion directly) — the
  // coarse→fine presentation is keyed to the card's LIFETIME, not to the
  // data: a points refresh keeps the current phase and only a REMOUNT
  // (room/range change, from HistoryScreen's key) replays the reveal.
  const reduceMotion = useChartReduceMotion();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setSettled(true),
      reduceMotion ? 0 : SETTLE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  // ONLY the rendered series passes the coarse sampler (AD-5): 10 points
  // during the reveal, then the FULL aggregated series after the settle
  // (the render cap is above every expected window); stats + domains
  // above stay on the FULL points, and the coarse phase is a subset of
  // them so the axes never move.
  const displayData = useMemo(
    () =>
      downsampleSeries(
        points,
        reduceMotion || settled ? MAX_RENDER_POINTS : REVEAL_COARSE_POINTS,
      ),
    [points, settled, reduceMotion],
  );

  // The sweep/morph ride victory's own transition machinery (spike-pinned
  // shape, see the module doc): `onLoad.duration` drives the left→right
  // clip reveal, `duration` the coarse→fine data morph. Absent entirely
  // under reduce motion — the fine chart renders on the first frame.
  const revealAnimation = reduceMotion
    ? undefined
    : { duration: REVEAL_SWEEP_MS, onLoad: { duration: REVEAL_SWEEP_MS } };

  // The tooltip text function is resolved EAGERLY by victory even while a
  // point is inactive (its `text` prop is evaluated against a placeholder
  // datum without values) — so the formatter must tolerate a value-less
  // datum and only produce text for real points.
  const tooltipText = ({
    datum,
  }: {
    datum: { x?: number; y?: number };
  }): string =>
    typeof datum.x === 'number' && typeof datum.y === 'number'
      ? `${formatTooltipTime(datum.x)} · ${datum.y.toFixed(1)}${
          unit ? ` ${unit}` : ''
        }`
      : '';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
          borderRadius: tokens.smart.radius.card,
          padding: tokens.smart.spacing.cardPadding,
          marginBottom: tokens.smart.spacing.cardGap,
        },
        tokens.smart.cardShadow,
      ]}
    >
      <View style={wide ? styles.headerWide : styles.headerStacked}>
        <View style={styles.titleRow}>
          <Ionicons
            testID={`${testID}-icon`}
            name={icon}
            size={22}
            color={color}
          />
          <Text
            style={[
              styles.cardTitle,
              {
                color: tokens.smart.colors.textPrimary,
                fontSize: tokens.smart.typography.cardTitle,
              },
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
        {wide ? statsRow : null}
      </View>
      {wide ? null : statsRow}

      {points.length === 0 ? (
        // Registered but no points yet — the card stays visible with the
        // truthful no-data state (NEVER rendered as 0).
        <View style={styles.noDataWrap} testID={`${testID}-no-data`}>
          <Text
            style={[
              styles.noDataText,
              { color: tokens.smart.colors.textSecondary },
            ]}
          >
            {STRINGS.history.noData}
          </Text>
        </View>
      ) : (
        <VictoryChart
          width={innerWidth}
          height={chartHeight}
          padding={{ top: 12, bottom: 28, left: 44, right: 12 }}
          domain={{
            x: [domain.start, domain.end],
            y: yDomain ? [yDomain.min, yDomain.max] : undefined,
          }}
          containerComponent={NATIVE_VORONOI_CONTAINER}
          groupComponent={NATIVE_CHART_GROUP}
          backgroundComponent={NATIVE_CHART_BACKGROUND}
        >
          <VictoryAxis
            tickValues={[...tickValues]}
            tickFormat={tickFormat}
            style={{
              axis: { stroke: tokens.smart.colors.cardBorder },
              grid: { stroke: 'transparent' },
              tickLabels: {
                fill: tokens.smart.colors.textSecondary,
                fontSize: 11,
              },
            }}
            axisComponent={NATIVE_AXIS_SEGMENT}
            tickComponent={NATIVE_AXIS_SEGMENT}
            gridComponent={NATIVE_AXIS_SEGMENT}
            tickLabelComponent={NATIVE_LABEL}
            axisLabelComponent={NATIVE_LABEL}
            groupComponent={NATIVE_CHART_GROUP}
          />
          <VictoryAxis
            dependentAxis
            tickCount={4}
            style={{
              axis: { stroke: 'transparent' },
              grid: { stroke: tokens.smart.colors.cardBorder },
              tickLabels: {
                fill: tokens.smart.colors.textSecondary,
                fontSize: 11,
              },
            }}
            axisComponent={NATIVE_AXIS_SEGMENT}
            tickComponent={NATIVE_AXIS_SEGMENT}
            gridComponent={NATIVE_AXIS_SEGMENT}
            tickLabelComponent={NATIVE_LABEL}
            axisLabelComponent={NATIVE_LABEL}
            groupComponent={NATIVE_CHART_GROUP}
          />
          {/* Area fill: the SAME accent at ~5% opacity under the line. */}
          <VictoryArea
            data={[...displayData]}
            x="t"
            y="value"
            interpolation="monotoneX"
            style={{ data: { fill: color, fillOpacity: 0.05 } }}
            dataComponent={NATIVE_AREA_CURVE}
            groupComponent={NATIVE_LINE_GROUP}
            containerComponent={NATIVE_CHART_CONTAINER}
            labelComponent={NATIVE_LABEL}
            animate={revealAnimation}
          />
          <VictoryLine
            data={[...displayData]}
            x="t"
            y="value"
            interpolation="monotoneX"
            style={{ data: { stroke: color, strokeWidth: 2 } }}
            labels={tooltipText}
            labelComponent={NATIVE_TOOLTIP}
            dataComponent={NATIVE_LINE_CURVE}
            groupComponent={NATIVE_LINE_GROUP}
            containerComponent={NATIVE_CHART_CONTAINER}
            animate={revealAnimation}
          />
        </VictoryChart>
      )}
    </View>
  );
}

/** One stat cell: secondary label above the `statsValue` number + unit. */
function StatCell({
  label,
  value,
  unit,
  tokens,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly tokens: ThemeTokens;
}) {
  return (
    <View style={styles.statCell}>
      <Text
        style={[
          styles.statLabel,
          {
            color: tokens.smart.colors.textSecondary,
            fontSize: tokens.smart.typography.secondary,
          },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.statValue,
          {
            color: tokens.smart.colors.textPrimary,
            fontSize: tokens.smart.typography.statsValue,
          },
        ]}
      >
        {value === null ? '—' : `${value.toFixed(1)}${unit ? ` ${unit}` : ''}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
  },
  // Phone: title row, then the stats row BELOW it.
  headerStacked: {},
  // Tablet/wide: title row on the left, stats on the RIGHT of the row.
  headerWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  cardTitle: {
    fontWeight: '600',
    flexShrink: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  statsRowWide: {
    marginTop: 0,
    marginBottom: 0,
    flexShrink: 0,
  },
  statCell: {},
  statLabel: {
    marginBottom: 2,
  },
  statValue: {
    fontWeight: '600',
  },
  noDataWrap: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDataText: { fontSize: 14 },
});
