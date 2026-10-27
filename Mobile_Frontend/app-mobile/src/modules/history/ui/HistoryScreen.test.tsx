/**
 * HistoryScreen Smart Home layout tests (history-smart-home-redesign).
 *
 * Verifies through the public props + rendered tree:
 * - the screen is wrapped in the smart ambient wash (tealTint → page →
 *   amberTint diagonal LinearGradient — NOT the legacy gel gradient);
 * - the header = ☰ menu button (opens the shared RoomListModal, wired to
 *   onRoomChange) + the `Lịch sử` title at `smart.typography.screenTitle`;
 * - TWO white dropdowns replace the chip strip / range chips: the room
 *   dropdown (current room name) and the range dropdown (Vietnamese labels
 *   `1 giờ`/`24 giờ`/`7 ngày`; the HistoryRange values are unchanged), and
 *   the visible date-range line renders below them;
 * - one smart chart card per REGISTERED sensor field, in registration
 *   order, labelled `Label (unit)` with the sensor icon, the Thấp nhất /
 *   Cao nhất / Trung bình stats WITH units (`smart.typography.statsValue`),
 *   and a registered field WITHOUT points renders `Chưa có dữ liệu`
 *   (never a 0);
 * - charts share one x-domain + tick formatting, use line strokeWidth 2 +
 *   a ~5% area fill, render a voronoi+tooltip that is HIDDEN on mount,
 *   and use explicit native SVG primitives (React 19 removed
 *   function-component `defaultProps` — web SVG defaults crash on device);
 * - loading / error / no-rooms / no-sensors branches are preserved and
 *   smart-styled.
 */

import React from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet, Text } from 'react-native';
import { ClipPath, Path as SvgPath } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import TestRenderer, { act } from 'react-test-renderer';
// `VictoryTransition` (the wrapper victory mounts around an animated
// series) only exists in victory-core — everything else in this file
// tests the NATIVE components from victory-native.
import { VictoryTransition } from 'victory-core';
import {
  Curve,
  VictoryArea,
  VictoryChart,
  VictoryLine,
  VictoryTooltip,
  VictoryVoronoiContainer,
} from 'victory-native';

import { STRINGS } from '@core/i18n';
import { LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import type { CapabilityDef, Room } from '@modules/devices/api';
import type { HistorySeries } from '@modules/history/api';

import {
  MAX_RENDER_POINTS,
  REVEAL_SWEEP_MS,
  SETTLE_DELAY_MS,
} from './chartMotion';
import { HistoryScreen } from './HistoryScreen';

// Same mock as the other render tests: the widgets facade transitively
// imports the devices repository (async-storage) — storage is not under
// test here.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const rooms: readonly Room[] = [
  { id: 'room-1', name: 'Phòng khách', order: 0 },
];

const capabilities: readonly CapabilityDef[] = [
  {
    type: 'temperature',
    label: 'Nhiệt độ',
    kind: 'sensor',
    unit: '°C',
    builtin: true,
  },
  { type: 'co2', label: 'CO2', kind: 'sensor' }, // no unit → still its own card
];

/**
 * The active room's registered sensor fields (derived in the app wiring
 * from the sensor projection): two temperature-class fields + one with no
 * returned points.
 */
const registeredFields: readonly string[] = [
  'temperature',
  'co2',
  'illuminance',
];

/** One room-scoped series per queried field; `illuminance` has no points. */
const series: HistorySeries[] = [
  {
    roomId: 'room-1',
    field: 'temperature',
    points: [
      { t: 1, value: 20 },
      { t: 2, value: 22 },
    ],
  },
  { roomId: 'room-1', field: 'co2', points: [{ t: 1, value: 400 }] },
];

/**
 * All rendered Text elements whose (single-string) content equals `value`.
 * Type-scoped because props searches in react-test-renderer match both the
 * composite element and its host fiber (double counting).
 */
function texts(
  root: TestRenderer.ReactTestInstance,
  value: string,
): TestRenderer.ReactTestInstance[] {
  return root.findAllByType(Text).filter(node => node.props.children === value);
}

/**
 * Lowercase (web) SVG host element types that must never appear in a
 * rendered chart tree. react-test-renderer does not consult RN view
 * configs, so web SVG primitives render "fine" in tests while crashing on
 * device ("View config getter callback for component 'line' must be a
 * function"). React 19 removed function-component `defaultProps`, so any
 * victory component rendered without EXPLICIT native primitives falls back
 * to victory-core's WEB defaults — this walk catches that regression. The
 * walk is scoped to the SCROLL CONTENT (the RoomListModal renders plain
 * lowercase host text nodes that are not SVG).
 */
const FORBIDDEN_SVG_HOST_ELEMENTS: readonly string[] = [
  'line',
  'path',
  'g',
  'svg',
  'text',
  'tspan',
  'rect',
  'circle',
  'clipPath',
];

function forbiddenHostElements(root: TestRenderer.ReactTestInstance): string[] {
  const found: string[] = [];
  const walk = (node: TestRenderer.ReactTestInstance): void => {
    if (
      typeof node.type === 'string' &&
      FORBIDDEN_SVG_HOST_ELEMENTS.includes(node.type)
    ) {
      found.push(node.type);
    }
    for (const child of node.children) {
      if (typeof child !== 'object') {
        continue;
      }
      walk(child as TestRenderer.ReactTestInstance);
    }
  };
  walk(root.findByProps({ testID: 'history-scroll' }));
  return found;
}

/**
 * Clip-path contract helpers (history-clip-path-web-fix): victory-core's
 * `VictoryClipContainer.renderClipComponent` clones the `clipPathComponent`
 * slot with ALL of the container's props plus the generated id under the
 * prop name `clipId` — while react-native-svg's `ClipPath` only reads `id`.
 * A raw `<ClipPath />` in that slot therefore carried every container prop
 * onto the web DOM (react-dom DEV error per animation frame) AND never got
 * an id, so the group's `clipPath="url(#…)"` referenced a non-existent
 * clip path and the reveal sweep never clipped anything.
 */

/** Props that must never survive onto the rendered clip path element. */
const VICTORY_JUNK_PROPS: readonly string[] = [
  'clipWidth',
  'clipHeight',
  'translateX',
  'translateY',
  'clipPadding',
  'groupComponent',
  'rectComponent',
  'circleComponent',
];

const CLIP_URL_PREFIX = 'url(#';

/**
 * Every `url(#id)` clip reference found on ANY node in the tree (the
 * clipped groups victory renders). Mirrors the instance walk of
 * {@link forbiddenHostElements}.
 */
function clipPathReferences(root: TestRenderer.ReactTestInstance): string[] {
  const references: string[] = [];
  const walk = (node: TestRenderer.ReactTestInstance): void => {
    const clipPath = node.props.clipPath;
    if (typeof clipPath === 'string' && clipPath.startsWith(CLIP_URL_PREFIX)) {
      // `url(#id)` → `id`; a malformed tail simply fails the id match below.
      references.push(clipPath.slice(CLIP_URL_PREFIX.length, -1));
    }
    for (const child of node.children) {
      if (typeof child !== 'object') {
        continue;
      }
      walk(child as TestRenderer.ReactTestInstance);
    }
  };
  walk(root);
  return references;
}

describe('HistoryScreen Smart Home layout', () => {
  const baseProps = {
    range: '1h' as const,
    series,
    loading: false,
    error: null,
    rooms,
    registeredFields,
    capabilities,
    roomId: 'room-1',
    noSensors: false,
    onRangeChange: jest.fn(),
    onRoomChange: jest.fn(),
  };

  async function create(
    overrides: Partial<Parameters<typeof HistoryScreen>[0]> = {},
  ) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <HistoryScreen {...baseProps} {...overrides} />
        </ThemeProvider>,
      );
    });
    return renderer;
  }

  it('wraps the screen in the smart ambient wash (NOT the gel gradient)', async () => {
    const root = (await create()).root;
    const gradient = root.findByProps({ testID: 'history-ambient' });
    expect(gradient.type).toBe(LinearGradient);
    expect(gradient.props.colors).toEqual([
      LIGHT_TOKENS.smart.colors.tealTint,
      LIGHT_TOKENS.smart.colors.page,
      LIGHT_TOKENS.smart.colors.amberTint,
    ]);
    expect(gradient.props.start).toEqual({ x: 0, y: 0 });
    expect(gradient.props.end).toEqual({ x: 1, y: 1 });
  });

  it('is prop-driven on mount: no fetch/callback side effects (the initial fetch moved to the shell focus wrapper)', async () => {
    // history-tab-focus-refresh retirement pin: the screen never triggers
    // anything on mount — the first fetch belongs to the shell's
    // TabFocusRefresh wrapper, so HistoryScreen itself stays purely
    // prop-driven (no navigation import, no mount effect).
    const onRangeChange = jest.fn();
    const onRoomChange = jest.fn();
    await create({ onRangeChange, onRoomChange });
    expect(onRangeChange).not.toHaveBeenCalled();
    expect(onRoomChange).not.toHaveBeenCalled();
  });

  it('renders the header: ☰ menu button + Lịch sử title (screenTitle)', async () => {
    const root = (await create()).root;
    const menu = root.findByProps({ testID: 'history-room-menu' });
    const menuStyle = StyleSheet.flatten(menu.props.style);
    expect(menuStyle.width).toBeGreaterThanOrEqual(44);
    expect(menuStyle.height).toBeGreaterThanOrEqual(44);
    expect(menu.props.accessibilityLabel).toBe(STRINGS.history.roomMenu);

    const title = texts(root, STRINGS.history.title)[0];
    expect(StyleSheet.flatten(title.props.style).fontSize).toBe(
      LIGHT_TOKENS.smart.typography.screenTitle,
    );
  });

  it('opens the shared RoomListModal from the menu and wires onRoomChange', async () => {
    const onRoomChange = jest.fn();
    const root = (await create({ onRoomChange })).root;

    expect(
      root.findByProps({ testID: 'dashboard-room-modal' }).props.visible,
    ).toBe(false);

    act(() => {
      root.findByProps({ testID: 'history-room-menu' }).props.onPress();
    });
    expect(
      root.findByProps({ testID: 'dashboard-room-modal' }).props.visible,
    ).toBe(true);

    act(() => {
      root.findByProps({ testID: 'dashboard-room-row-room-1' }).props.onPress();
    });
    expect(onRoomChange).toHaveBeenCalledTimes(1);
    expect(onRoomChange).toHaveBeenCalledWith('room-1');
    expect(
      root.findByProps({ testID: 'dashboard-room-modal' }).props.visible,
    ).toBe(false);
  });

  it('renders the room + range dropdowns (no chip strip, no range chip row)', async () => {
    const root = (await create()).root;

    // Room dropdown shows the current room name; the range dropdown shows
    // the active range's Vietnamese label.
    const roomTrigger = root.findByProps({
      testID: 'history-room-dropdown-trigger',
    });
    expect(roomTrigger.findAllByType(Text)[0].props.children).toBe(
      'Phòng khách',
    );
    const rangeTrigger = root.findByProps({
      testID: 'history-range-dropdown-trigger',
    });
    expect(rangeTrigger.findAllByType(Text)[0].props.children).toBe('1 giờ');

    // The legacy chip strip / range chips are gone.
    expect(() => root.findByProps({ testID: 'history-range-row' })).toThrow();
    expect(() =>
      root.findByProps({ testID: 'dashboard-room-strip' }),
    ).toThrow();
    expect(texts(root, '1H')).toHaveLength(0);
    expect(texts(root, '24H')).toHaveLength(0);
    expect(texts(root, '7D')).toHaveLength(0);
  });

  it('range dropdown offers exactly 1 giờ / 24 giờ / 7 ngày and drives onRangeChange', async () => {
    const onRangeChange = jest.fn();
    const root = (await create({ onRangeChange })).root;

    act(() => {
      root
        .findByProps({ testID: 'history-range-dropdown-trigger' })
        .props.onPress();
    });
    const modal = root.findByProps({ testID: 'history-range-dropdown-modal' });
    expect(modal.props.visible).toBe(true);
    root.findByProps({ testID: 'history-range-dropdown-option-1h' });
    root.findByProps({ testID: 'history-range-dropdown-option-24h' });
    root.findByProps({ testID: 'history-range-dropdown-option-7d' });

    act(() => {
      root
        .findByProps({ testID: 'history-range-dropdown-option-24h' })
        .props.onPress();
    });
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith('24h');
  });

  it('room dropdown lists the rooms and drives onRoomChange', async () => {
    const onRoomChange = jest.fn();
    const root = (await create({ onRoomChange })).root;

    act(() => {
      root
        .findByProps({ testID: 'history-room-dropdown-trigger' })
        .props.onPress();
    });
    act(() => {
      root
        .findByProps({ testID: 'history-room-dropdown-option-room-1' })
        .props.onPress();
    });
    expect(onRoomChange).toHaveBeenCalledTimes(1);
    expect(onRoomChange).toHaveBeenCalledWith('room-1');
  });

  it('renders the visible date-range line (DD/MM HH:mm – DD/MM HH:mm, 24h)', async () => {
    const root = (await create()).root;
    const line = root.findByProps({ testID: 'history-date-range' });
    const content = String(line.props.children);
    // 24h clock + both endpoints carry the date.
    expect(content).toMatch(
      /^\d{2}\/\d{2} \d{2}:\d{2} – \d{2}\/\d{2} \d{2}:\d{2}$/,
    );
  });

  it('renders one smart card per REGISTERED field in order, with units in title + stats', async () => {
    const root = (await create()).root;

    // Registration order preserved: temperature, co2, illuminance.
    expect(texts(root, 'Nhiệt độ (°C)')).toHaveLength(1);
    expect(texts(root, 'CO2')).toHaveLength(1);
    expect(texts(root, 'illuminance')).toHaveLength(1);

    // Two of the three registrations returned points → two charts; the
    // third (illuminance) renders the no-data card instead.
    expect(root.findAllByType(VictoryLine)).toHaveLength(2);
    expect(root.findAllByType(VictoryChart)).toHaveLength(2);
    // Two area fills (same-color ~5% opacity) under the two lines.
    const areas = root.findAllByType(VictoryArea);
    expect(areas).toHaveLength(2);
    for (const area of areas) {
      expect(area.props.style.data.fillOpacity).toBe(0.05);
    }
    const lines = root.findAllByType(VictoryLine);
    for (const line of lines) {
      expect(line.props.style.data.strokeWidth).toBe(2);
    }

    // Stats labels (spec wording) exist on every card WITH data; values
    // carry the unit and use the statsValue token. The assertions are
    // scoped to a single card because the mocked icon component renders
    // its glyph name through a Text node (the string keys below are
    // unique per card).
    const tempCard = root.findByProps({ testID: 'history-card-temperature' });
    const co2Card = root.findByProps({ testID: 'history-card-co2' });
    expect(texts(tempCard, STRINGS.history.statMin)).toHaveLength(1);
    expect(texts(tempCard, STRINGS.history.statMax)).toHaveLength(1);
    expect(texts(tempCard, STRINGS.history.statAvg)).toHaveLength(1);
    expect(texts(co2Card, STRINGS.history.statMin)).toHaveLength(1);
    expect(texts(tempCard, '20.0 °C')).toHaveLength(1); // min + unit
    expect(texts(tempCard, '22.0 °C')).toHaveLength(1); // max + unit
    const minValue = texts(tempCard, '20.0 °C')[0];
    expect(StyleSheet.flatten(minValue.props.style).fontSize).toBe(
      LIGHT_TOKENS.smart.typography.statsValue,
    );
    expect(StyleSheet.flatten(minValue.props.style).color).toBe(
      LIGHT_TOKENS.smart.colors.textPrimary,
    );
  });

  it('renders the sensor icons (thermometer teal / water blue / analytics fallback)', async () => {
    const root = (await create()).root;
    const tempIcon = root.findByProps({
      testID: 'history-card-temperature-icon',
    });
    expect(tempIcon.props.name).toBe('thermometer-outline');
    expect(tempIcon.props.color).toBe(LIGHT_TOKENS.smart.colors.teal);
    const co2Icon = root.findByProps({ testID: 'history-card-co2-icon' });
    expect(co2Icon.props.name).toBe('analytics-outline');
  });

  it('renders the Chưa có dữ liệu card for a registered sensor without points', async () => {
    const root = (await create()).root;

    // The illuminance registration keeps its card: explicit no-data state,
    // never a disappearing sensor and never a 0.
    root.findByProps({ testID: 'history-card-illuminance-no-data' });
    expect(texts(root, STRINGS.history.noData)).toHaveLength(1);
    expect(texts(root, '0')).toHaveLength(0);
  });

  it('never pairs wrong-room or untagged series into a registered card', async () => {
    const hostileSeries: HistorySeries[] = [
      {
        roomId: 'room-OTHER',
        field: 'temperature',
        points: [
          { t: 1, value: 30 },
          { t: 2, value: 31 },
        ],
      },
      { roomId: null, field: 'co2', points: [{ t: 1, value: 999 }] },
    ];
    const root = (await create({ series: hostileSeries })).root;

    // Both registrations keep their cards, but with ZERO paired points —
    // the wrong-room and untagged series never populate them.
    expect(root.findAllByType(VictoryLine)).toHaveLength(0);
    expect(root.findAllByType(VictoryChart)).toHaveLength(0);
    expect(texts(root, STRINGS.history.noData)).toHaveLength(3);
    expect(texts(root, 'Nhiệt độ (°C)')).toHaveLength(1);
    expect(texts(root, 'CO2')).toHaveLength(1);
  });

  it('shares one x-domain across charts and keeps the tooltip hidden on mount', async () => {
    const root = (await create()).root;
    const charts = root.findAllByType(VictoryChart);
    expect(charts.length).toBeGreaterThan(0);
    const domains = charts.map(chart => chart.props.domain.x);
    for (const domain of domains) {
      expect(domain).toEqual(domains[0]);
    }
    // Every chart uses the voronoi container (touch tooltip)…
    expect(root.findAllByType(VictoryVoronoiContainer)).toHaveLength(
      charts.length,
    );
    // …with label-only activation (touch end clears the tooltip)…
    for (const container of root.findAllByType(VictoryVoronoiContainer)) {
      expect(container.props.activateData).toBe(false);
    }
    // …and NO tooltip is active on mount (no persistent crosshair).
    const tooltips = root.findAllByType(VictoryTooltip);
    expect(tooltips.length).toBeGreaterThan(0);
    for (const tooltip of tooltips) {
      expect(tooltip.props.active).not.toBe(true);
    }
  });

  it('charts use a per-card adaptive y-domain (not zero-based)', async () => {
    const root = (await create()).root;
    const tempChart = root
      .findByProps({ testID: 'history-card-temperature' })
      .findAllByType(VictoryChart)[0];
    const co2Chart = root
      .findByProps({ testID: 'history-card-co2' })
      .findAllByType(VictoryChart)[0];

    // Temperature 20–22: 10% of the range (2) padded on each side →
    // [19.8, 22.2] — NOT [0, 22] (the getDomainWithZero regression).
    const tempY = tempChart.props.domain.y;
    expect(tempY[0]).toBeCloseTo(19.8);
    expect(tempY[1]).toBeCloseTo(22.2);
    // CO2 is a single point (flat series) → ±1 fallback → [399, 401].
    const co2Y = co2Chart.props.domain.y;
    expect(co2Y[0]).toBeCloseTo(399);
    expect(co2Y[1]).toBeCloseTo(401);

    // Neither domain includes 0 — each card scales to ITS OWN data.
    expect(tempY[0]).toBeGreaterThan(0);
    expect(co2Y[0]).toBeGreaterThan(0);

    // Per-card domains DIFFER while the x-domain stays shared.
    expect(tempY).not.toEqual(co2Y);
    expect(tempChart.props.domain.x).toEqual(co2Chart.props.domain.x);
  });

  it('renders no web SVG host elements (React 19 defaultProps regression)', async () => {
    const root = (await create()).root;
    expect(forbiddenHostElements(root)).toEqual([]);
  });

  it('paints the line + area through a Curve-derived node with ONLY SVG-safe props', async () => {
    // User-acceptance regression: on the web build the VictoryLine /
    // VictoryArea shapes never painted because victory's `Curve` ALWAYS
    // forwards its RN-only `pathComponent` prop into victory-native's
    // `VPath` → react-native-svg's web `WebShape` → the DOM `<path>`,
    // which react-dom rejects (`warnUnknownProperties`). The fix wraps the
    // series `dataComponent` in a module-local `SafeCurve` that passes an
    // explicit `<Path/>` as `pathComponent` AND strips that prop from the
    // spread, so victory's computed `d` reaches the `<path>` but the RN-only
    // `pathComponent` element never reaches the web DOM.
    //
    // react-test-renderer resolves react-native-svg's NATIVE `Path` (its
    // `extract` step drops the non-SVG keys AND flattens the victory style
    // into fill/stroke props). Pin the exact contract on BOTH series: the
    // Curve-derived node renders, the rendered RNSVG <Path> carries a
    // non-empty `d` (the shape paints), the series style survives (stroke
    // for the line / fill for the area), and NO RN-only/victory-internal
    // props (`pathComponent`, `data`, `scale`, `interpolation`, `x`, `y`,
    // `events`) leak onto the rendered path (they are what react-dom
    // rejects on the web build).
    const root = (await create()).root;
    const cards = [
      // resolveCapabilityAccent: temperature → tokens.temperature,
      // a non-builtin field without a catalog color → tokens.primary.
      {
        card: root.findByProps({ testID: 'history-card-temperature' }),
        accent: LIGHT_TOKENS.temperature,
      },
      {
        card: root.findByProps({ testID: 'history-card-co2' }),
        accent: LIGHT_TOKENS.primary,
      },
    ];
    const LEAKED_PROPS = [
      'pathComponent',
      'lineComponent',
      'data',
      'scale',
      'interpolation',
      'x',
      'y',
      'events',
      'polar',
      'origin',
      'index',
      'id',
    ];
    for (const { card, accent } of cards) {
      expect(card.findAllByType(VictoryLine)).toHaveLength(1);
      expect(card.findAllByType(VictoryArea)).toHaveLength(1);
      // The Curve-derived node IS in the tree (the SafeCurve → Curve chain).
      expect(card.findAllByType(Curve).length).toBeGreaterThanOrEqual(1);
      const paths = card.findAllByType(SvgPath);
      expect(paths.length).toBeGreaterThanOrEqual(2); // line + area paint
      for (const path of paths) {
        // d is a path STRING when the series has ≥2 points; a single-point
        // series legitimately yields null (a line needs two points) — the
        // contract under test is that the path is SVG-SAFE, not its length.
        expect(['string', 'object']).toContain(typeof path.props.d);
        for (const leaked of LEAKED_PROPS) {
          expect(path.props[leaked]).toBeUndefined();
        }
      }
      // The line paints with the series accent (stroke), the area fills with
      // it — VPath converted the victory style into native path props.
      expect(paths.map(path => path.props.stroke)).toContain(accent);
      expect(paths.map(path => path.props.fill)).toContain(accent);
    }
  });

  it('charts fill the card inner width with a responsive height in the approved bands', async () => {
    // The jest-expo default window (750) is ≥ STACKED_BREAKPOINT, so the
    // WIDE branch renders: 24pt band padding and the tablet height band.
    const windowWidth = Dimensions.get('window').width;
    expect(windowWidth).toBeGreaterThanOrEqual(560);
    const contentWidth = Math.min(windowWidth, 880) - 24 * 2; // wide padding
    const innerWidth = Math.max(
      200,
      contentWidth - LIGHT_TOKENS.smart.spacing.cardPadding * 2 - 2,
    );
    const root = (await create()).root;
    const charts = root.findAllByType(VictoryChart);
    expect(charts.length).toBeGreaterThan(0);
    for (const chart of charts) {
      expect(chart.props.width).toBe(innerWidth);
      expect(Number.isFinite(chart.props.width)).toBe(true);
      // Wide canvas → tablet band 200–240.
      expect(chart.props.height).toBeGreaterThanOrEqual(200);
      expect(chart.props.height).toBeLessThanOrEqual(240);
    }
  });

  it('keeps the NARROW band (<560) padding + phone height band identical', async () => {
    // Preservation pin (dashboard-view-wysiwyg-two-column): History's own
    // wide/narrow band decision is UNCHANGED — below the 560 threshold it
    // keeps the 16pt band padding and the 160–200 phone height band.
    const spy = jest.spyOn(Dimensions, 'get').mockImplementation(() => ({
      width: 360,
      height: 900,
      scale: 1,
      fontScale: 1,
    }));
    try {
      const root = (await create()).root;
      // Narrow: contentWidth = 360 − 2×16; the phone height band applies.
      const contentWidth = 360 - 16 * 2;
      const innerWidth = Math.max(
        200,
        contentWidth - LIGHT_TOKENS.smart.spacing.cardPadding * 2 - 2,
      );
      const charts = root.findAllByType(VictoryChart);
      expect(charts.length).toBeGreaterThan(0);
      for (const chart of charts) {
        expect(chart.props.width).toBe(innerWidth);
        // Narrow canvas → phone band 160–200 (360 × 0.5 = 180).
        expect(chart.props.height).toBeGreaterThanOrEqual(160);
        expect(chart.props.height).toBeLessThanOrEqual(200);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('renders the loading branch (smart-styled hint)', async () => {
    const root = (await create({ loading: true })).root;
    expect(texts(root, STRINGS.history.loading)).toHaveLength(1);
    expect(root.findAllByType(VictoryChart)).toHaveLength(0);
  });

  it('renders the error branch', async () => {
    const root = (await create({ error: 'boom' })).root;
    expect(texts(root, 'boom')).toHaveLength(1);
    expect(root.findAllByType(VictoryChart)).toHaveLength(0);
  });

  it('renders the no-rooms hint', async () => {
    const root = (await create({ rooms: [], roomId: null })).root;
    expect(texts(root, STRINGS.dashboard.noRooms)).toHaveLength(1);
  });

  it('renders the no-sensors hint and hides stale cards', async () => {
    const root = (await create({ noSensors: true })).root;
    expect(texts(root, STRINGS.history.noSensorForRoom)).toHaveLength(1);
    expect(root.findAllByType(VictoryChart)).toHaveLength(0);
  });
});

describe('HistoryScreen series pairing with the boardId tag (boards contract v2)', () => {
  const boardSeries: HistorySeries[] = [
    {
      roomId: 'room-1',
      boardId: 'board-1',
      field: 'temperature',
      points: [
        { t: 1, value: 21 },
        { t: 2, value: 23 },
      ],
    },
  ];

  function chartCardHasPoints(
    root: TestRenderer.ReactTestInstance,
    field: string,
  ): boolean {
    const card = root.findByProps({ testID: `history-card-${field}` });
    // A populated card renders VictoryChart; an empty one renders the
    // `Chưa có dữ liệu` hint instead.
    return card.findAllByType(VictoryChart).length > 0;
  }

  it('pairs a board-tagged series against the board code identity', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <HistoryScreen
            range="1h"
            series={boardSeries}
            loading={false}
            error={null}
            rooms={rooms}
            registeredFields={['temperature']}
            capabilities={capabilities}
            roomId="room-1"
            seriesRoomId="board-1"
            noSensors={false}
            onRangeChange={jest.fn()}
            onRoomChange={jest.fn()}
          />
        </ThemeProvider>,
      );
    });
    expect(chartCardHasPoints(renderer.root, 'temperature')).toBe(true);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('does NOT pair a board-tagged series against a mismatched identity', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <HistoryScreen
            range="1h"
            series={boardSeries}
            loading={false}
            error={null}
            rooms={rooms}
            registeredFields={['temperature']}
            capabilities={capabilities}
            roomId="room-1"
            seriesRoomId="room-1" // identity = the internal id, series is board-tagged
            noSensors={false}
            onRangeChange={jest.fn()}
            onRoomChange={jest.fn()}
          />
        </ThemeProvider>,
      );
    });
    expect(chartCardHasPoints(renderer.root, 'temperature')).toBe(false);
    expect(texts(renderer.root, STRINGS.history.noData).length).toBeGreaterThan(
      0,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('still pairs a roomId-only (legacy) series against the roomId identity', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <HistoryScreen
            range="1h"
            series={series} // legacy rows: roomId only, no boardId
            loading={false}
            error={null}
            rooms={rooms}
            registeredFields={['temperature']}
            capabilities={capabilities}
            roomId="room-1"
            noSensors={false}
            onRangeChange={jest.fn()}
            onRoomChange={jest.fn()}
          />
        </ThemeProvider>,
      );
    });
    expect(chartCardHasPoints(renderer.root, 'temperature')).toBe(true);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('HistoryScreen chart reveal (history-chart-reveal-downsample)', () => {
  /**
   * A 120-point local fixture (real Flux series are unaggregated): the
   * extremes (min 9 at index 6, max 31 at index 4) sit at indices that
   * NEITHER sample hits — the 50-point sample rounds to
   * {0,2,5,7,10,12,15,…} and the coarse 10-point sample to
   * {0,13,26,40,53,66,79,93,106,119} — so the stats/y-domain (computed
   * on the FULL series) can be pinned against the rendered downsample.
   */
  const revealSeries: HistorySeries[] = [
    {
      roomId: 'room-1',
      field: 'temperature',
      points: Array.from({ length: 120 }, (_, i) => ({
        t: 1000 + i,
        value: i === 4 ? 31 : i === 6 ? 9 : 20,
      })),
    },
  ];

  const revealProps = {
    range: '1h' as const,
    series: revealSeries,
    loading: false,
    error: null,
    rooms,
    registeredFields: ['temperature'],
    capabilities,
    roomId: 'room-1',
    noSensors: false,
    onRangeChange: jest.fn(),
    onRoomChange: jest.fn(),
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function createReveal(
    overrides: Partial<Parameters<typeof HistoryScreen>[0]> = {},
  ) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <HistoryScreen {...revealProps} {...overrides} />
        </ThemeProvider>,
      );
    });
    return renderer;
  }

  /** The victory transition wrappers the animated series mount inside. */
  function revealTransitions(
    root: TestRenderer.ReactTestInstance,
  ): TestRenderer.ReactTestInstance[] {
    return root.findAllByType(VictoryTransition);
  }

  /** Drive the settle flip + victory's morph to its completed state. */
  function settleCard() {
    act(() => {
      jest.advanceTimersByTime(SETTLE_DELAY_MS);
    });
    act(() => {
      jest.runAllTimers();
    });
  }

  it('chart data reveals coarse→fine then settles on the FULL aggregated series', async () => {
    const root = (await createReveal()).root;
    const line = root.findAllByType(VictoryLine)[0];

    // First frame: the COARSE 10-point sample spread across the full
    // window (first + last points kept), riding the pinned sweep prop.
    expect(line.props.data).toHaveLength(10);
    expect(line.props.data[0].t).toBe(1000);
    expect(line.props.data[9].t).toBe(1119);
    const transitions = revealTransitions(root);
    expect(transitions).toHaveLength(2); // line + area
    expect(transitions[0].props.animate).toEqual({
      duration: REVEAL_SWEEP_MS,
      onLoad: { duration: REVEAL_SWEEP_MS },
    });

    // One tick BEFORE the settle boundary the reveal is still coarse…
    act(() => {
      jest.advanceTimersByTime(SETTLE_DELAY_MS - 1);
    });
    expect(root.findAllByType(VictoryLine)[0].props.data).toHaveLength(10);

    // …at the boundary the card settles onto the FULL aggregated series
    // (the ≤200 render cap is above every expected window — 60/96/168 —
    // so the aggregated fixture passes through unstrided).
    act(() => {
      jest.advanceTimersByTime(1);
    });
    act(() => {
      jest.runAllTimers();
    });
    const settled = root.findAllByType(VictoryLine)[0].props.data;
    expect(settled.length).toBeLessThanOrEqual(MAX_RENDER_POINTS);
    expect(settled).toHaveLength(120);
    expect(settled[0].t).toBe(1000);
    expect(settled[settled.length - 1].t).toBe(1119);
  });

  it('stats and y-domain come from the full series, and the settled line shows the extremes', async () => {
    const root = (await createReveal()).root;

    // During the COARSE phase the stats ALREADY reflect the full series:
    // min 9 (index 6) and max 31 (index 4) are never sampled but must
    // show (AD-3 trade-off: the extremes may not sit on the drawn line).
    expect(texts(root, '9.0 °C')).toHaveLength(1);
    expect(texts(root, '31.0 °C')).toHaveLength(1);
    const chart = root
      .findByProps({ testID: 'history-card-temperature' })
      .findAllByType(VictoryChart)[0];
    const y = chart.props.domain.y;
    // 9–31 padded by 10% of the 22-wide range on each side → [6.8, 33.2].
    expect(y[0]).toBeCloseTo(6.8);
    expect(y[1]).toBeCloseTo(33.2);

    // After settling, the drawn line IS the full series — the extremes
    // are ON the line now (the aggregation made stats and the drawn
    // series agree, dashboard-history-board-touch-share AD-2).
    settleCard();
    const settled = root.findAllByType(VictoryLine)[0].props.data;
    expect(settled).toHaveLength(120);
    const values = settled.map((datum: { value: number }) => datum.value);
    expect(values).toContain(9);
    expect(values).toContain(31);
  });

  it('a data refresh does not replay the reveal', async () => {
    const renderer = await createReveal();
    const root = renderer.root;
    settleCard();
    expect(root.findAllByType(VictoryLine)[0].props.data).toHaveLength(120);

    // A refresh delivers a NEW points identity for the SAME room + range
    // (the card key is unchanged → no remount → the reveal never replays
    // back to the coarse phase).
    const refreshed: HistorySeries[] = revealSeries.map(seriesRow => ({
      ...seriesRow,
      points: seriesRow.points.map(point => ({ ...point })),
    }));
    await act(async () => {
      renderer.update(
        <ThemeProvider mode="light">
          <HistoryScreen {...revealProps} series={refreshed} />
        </ThemeProvider>,
      );
    });
    expect(root.findAllByType(VictoryLine)[0].props.data).toHaveLength(120);
  });

  it('a range change remounts the card and replays the reveal', async () => {
    const renderer = await createReveal();
    const root = renderer.root;
    settleCard();
    expect(root.findAllByType(VictoryLine)[0].props.data).toHaveLength(120);

    // Range change → the card key (`field:room:range`) changes → the card
    // REMOUNTS → the coarse reveal plays again from the first frame.
    await act(async () => {
      renderer.update(
        <ThemeProvider mode="light">
          <HistoryScreen {...revealProps} range="24h" />
        </ThemeProvider>,
      );
    });
    const line = root.findAllByType(VictoryLine)[0];
    expect(line.props.data).toHaveLength(10);
    expect(line.props.data[0].t).toBe(1000);
    expect(line.props.data[9].t).toBe(1119);
  });

  describe('reduce motion (AD-6: skip the animation entirely)', () => {
    let isReduceMotionEnabledSpy: jest.SpyInstance;
    let addEventListenerSpy: jest.SpyInstance;

    beforeEach(() => {
      isReduceMotionEnabledSpy = jest
        .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
        .mockResolvedValue(true);
      addEventListenerSpy = jest
        .spyOn(AccessibilityInfo, 'addEventListener')
        .mockImplementation((() => ({
          remove: () => undefined,
        })) as unknown as typeof AccessibilityInfo.addEventListener);
    });

    afterEach(() => {
      isReduceMotionEnabledSpy.mockRestore();
      addEventListenerSpy.mockRestore();
    });

    it('renders the fine chart on the first frame with NO animate prop', async () => {
      const root = (await createReveal()).root;
      await act(async () => {
        await Promise.resolve(); // flush the OS preference answer
      });

      const line = root.findAllByType(VictoryLine)[0];
      expect(line.props.data).toHaveLength(120); // the full series, never coarse
      expect(line.props.animate).toBeUndefined();
      expect(root.findAllByType(VictoryArea)[0].props.animate).toBeUndefined();
      expect(revealTransitions(root)).toHaveLength(0); // no victory wrapper

      // The settle boundary is a no-op: no phase to replay.
      act(() => {
        jest.advanceTimersByTime(SETTLE_DELAY_MS);
      });
      expect(root.findAllByType(VictoryLine)[0].props.data).toHaveLength(120);
    });
  });

  it('the touch tooltip contract still holds on the settled data', async () => {
    const root = (await createReveal()).root;
    settleCard();

    const card = root.findByProps({ testID: 'history-card-temperature' });
    expect(card.findAllByType(VictoryChart)).toHaveLength(1);
    // The voronoi container is still the (single) touch surface with
    // label-only activation, and NO tooltip is active on mount — the
    // reveal changes the presentation, never the tooltip contract.
    const containers = card.findAllByType(VictoryVoronoiContainer);
    expect(containers).toHaveLength(1);
    expect(containers[0].props.activateData).toBe(false);
    for (const tooltip of card.findAllByType(VictoryTooltip)) {
      expect(tooltip.props.active).not.toBe(true);
    }
    expect(card.findAllByType(VictoryLine)[0].props.data).toHaveLength(120);
  });
});

describe('HistoryScreen clip path contract (history-clip-path-web-fix)', () => {
  const clipProps = {
    range: '1h' as const,
    series,
    loading: false,
    error: null,
    rooms,
    registeredFields,
    capabilities,
    roomId: 'room-1',
    noSensors: false,
    onRangeChange: jest.fn(),
    onRoomChange: jest.fn(),
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('clip paths define the id the clipped group references (no victory junk props)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <HistoryScreen {...clipProps} />
        </ThemeProvider>,
      );
    });
    const root = renderer.root;

    // Settle exactly like the reveal tests: the phase machine flips onto
    // the fine sample and victory's animation timers drain, so the pinned
    // tree is the steady state (not a mid-sweep frame).
    act(() => {
      jest.advanceTimersByTime(SETTLE_DELAY_MS);
    });
    act(() => {
      jest.runAllTimers();
    });

    // The rendered react-native-svg <ClipPath> elements: an id MUST be
    // present (victory's `clipId` prop name mapped onto `id`), and NONE of
    // the container props victory clones onto the slot may survive.
    const clipPaths = root.findAllByType(ClipPath);
    expect(clipPaths.length).toBeGreaterThan(0);
    const definedIds = new Set<string>();
    for (const clipPath of clipPaths) {
      expect(typeof clipPath.props.id).toBe('string');
      expect(clipPath.props.id.length).toBeGreaterThan(0);
      definedIds.add(clipPath.props.id);
      for (const junk of VICTORY_JUNK_PROPS) {
        expect(clipPath.props[junk]).toBeUndefined();
      }
    }

    // Every clipped group's `url(#…)` reference resolves to one of the
    // ids actually defined above — without the mapping the group clips
    // against a non-existent clip path (the sweep renders full-width).
    const references = clipPathReferences(root);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(definedIds.has(reference)).toBe(true);
    }
  });
});
