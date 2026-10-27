/**
 * DashboardGrid tests (M2 section fix → responsive redesign → Smart Home
 * redesign → fix cycle 1 → growth-safe flow, fix cycle 2).
 *
 * Verifies:
 * - a widget at a persisted row > 0 renders shifted UP by `layoutYOffset`
 *   rows (section-local drawing) while the default stays unchanged,
 * - the pure `moveTarget` release math re-bases the section-local drag
 *   target back to the ABSOLUTE persisted row (`y + layoutYOffset`) so the
 *   store keeps dashboard-absolute coords,
 * - with the default offset 0 the math is exactly the legacy behavior
 *   (the room-scoped editor unaffected),
 * - edit mode still attaches the drag responder (wiring intact),
 * - the smart VIEW mode renders the growth-safe two-column flow at EVERY
 *   width (the stacked reflow was retired with
 *   dashboard-view-wysiwyg-two-column): the caller's metrics decide the
 *   geometry — narrow-band metrics → ~156pt columns — and the persisted
 *   coordinates map to rows/columns via `smartFlowLayout` while the
 *   DEFAULT stays the absolute two-column editor grid,
 * - DEFAULT cards are neutral surfaces (theme surface + border) — the
 *   editor contract,
 * - the OPT-IN smart card appearance renders per-TYPE heights as
 *   minHeight FLOORS with a non-clipping inner layer and the
 *   `smart.radius.card` token radius, and takes its card gap from the
 *   metrics the caller passes (smart-view metrics = 16),
 * - GROWTH-SAFE SMART VIEW (fix cycle 2): in VIEW mode the smart cards
 *   render in NORMAL FLOW — two persisted-derived columns per row
 *   (`smartFlowLayout`) at EVERY canvas width — so grown content (long
 *   inline errors, font-scaled text) makes its flow row taller and pushes
 *   everything below down: overlap is structurally impossible and the
 *   scroll extent always covers the content. The editor (edit mode) keeps
 *   the exact persisted slot grid byte-identical,
 * - the former `'gel'` branch is REMOVED (scope amendment 1: the last
 *   consumer moved to `'smart'`; History owns the gel recipe directly).
 */

import React from 'react';
import { View } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import {
  createWidgetRegistry,
  type WidgetConfig,
  type WidgetRegistry,
} from '@modules/widgets/api';

import {
  computeSmartViewMetrics,
  SMART_VIEW_SENSOR_ROW_HEIGHT,
} from '../internal/domain/gridMetrics';
import {
  clampedDragTranslation,
  DashboardGrid,
  dragTargetCell,
  dropOccupant,
  moveTarget,
} from './DashboardGrid';

// The widgets facade transitively requires AsyncStorage (devices api).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const METRICS = {
  padding: 10,
  gap: 5,
  rowHeight: 100,
  cellWidth: 50,
};
/** One row step in pixels (rowHeight + gap). */
const ROW_STEP = 105;
/** One column step in pixels (cellWidth + gap). */
const COL_STEP = 55;

function FakeWidget(): null {
  return null;
}

function makeRegistry(): WidgetRegistry {
  const registry = createWidgetRegistry();
  registry.register({
    type: 'switch',
    label: 'Công tắc',
    description: 'test widget',
    icon: 'power-outline',
    category: 'control',
    supportedCapabilities: ['switch'],
    supportedSizes: ['1x1', '2x1'],
    component: FakeWidget,
  });
  return registry;
}

function makeWidget(y: number): WidgetConfig {
  return {
    id: 'w1',
    type: 'switch',
    binding: { deviceId: 'relay-1', capability: 'switch' },
    layout: { x: 0, y, width: 2, height: 1 },
  };
}

async function renderGrid(
  widget: WidgetConfig,
  props: {
    readonly layoutYOffset?: number;
    readonly editMode?: boolean;
    readonly cardAppearance?: 'default' | 'smart';
    readonly mode?: 'light' | 'dark';
  } = {},
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={props.mode ?? 'light'}>
        <DashboardGrid
          widgets={[widget]}
          registry={makeRegistry()}
          editMode={props.editMode ?? false}
          metrics={METRICS}
          onMoveWidget={() => false}
          onResizeWidget={() => false}
          onRemoveWidget={() => undefined}
          {...(props.layoutYOffset === undefined
            ? {}
            : { layoutYOffset: props.layoutYOffset })}
          {...(props.cardAppearance === undefined
            ? {}
            : { cardAppearance: props.cardAppearance })}
        />
      </ThemeProvider>,
    );
  });
  return renderer;
}

/** Flatten an RN style (object or array of objects) into one plain object. */
function flatStyles(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  return Object.assign(
    {},
    ...(layers.filter(
      layer => layer !== null && typeof layer === 'object',
    ) as Record<string, unknown>[]),
  );
}

/** Views whose flattened style carries the given `top` value (the cards). */
function viewsWithTop(
  root: ReactTestInstance,
  top: number,
): ReactTestInstance[] {
  return root.findAllByType(View).filter(view => {
    const style = view.props.style;
    const layers = Array.isArray(style) ? style : [style];
    return layers.some(
      layer =>
        layer !== null &&
        typeof layer === 'object' &&
        (layer as Record<string, unknown>).top === top,
    );
  });
}

/** Views whose flattened style carries ALL the given style entries. */
function viewsWithStyle(
  root: ReactTestInstance,
  match: Record<string, unknown>,
): ReactTestInstance[] {
  return root.findAllByType(View).filter(view => {
    const flat = flatStyles(view.props.style);
    return Object.entries(match).every(([key, value]) => flat[key] === value);
  });
}

describe('DashboardGrid layoutYOffset (render)', () => {
  it('renders a persisted y=2 card shifted up by layoutYOffset=1 row', async () => {
    // top = padding + (2 - 1) * (rowHeight + gap) = 10 + 105 = 115.
    const renderer = await renderGrid(makeWidget(2), { layoutYOffset: 1 });
    expect(viewsWithTop(renderer.root, 115)).toHaveLength(1);
    expect(viewsWithTop(renderer.root, 220)).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the persisted row unchanged when no offset is passed (default 0)', async () => {
    // top = padding + 2 * (rowHeight + gap) = 10 + 210 = 220.
    const renderer = await renderGrid(makeWidget(2));
    expect(viewsWithTop(renderer.root, 220)).toHaveLength(1);
    expect(viewsWithTop(renderer.root, 115)).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('moveTarget (drag release math)', () => {
  const widget = makeWidget(2);

  it('re-bases the section-local target back to absolute persisted rows', () => {
    // One row down in the section (y=2, offset 1 → local row 1 → 2) must
    // move the PERSISTED widget to row 3.
    expect(moveTarget(widget, 0, ROW_STEP, METRICS, 1)).toEqual({
      widgetId: 'w1',
      x: 0,
      y: 3,
    });
  });

  it('re-bases column moves too and keeps x in persisted coords', () => {
    expect(moveTarget(widget, COL_STEP, 0, METRICS, 1)).toEqual({
      widgetId: 'w1',
      x: 1,
      y: 2,
    });
  });

  it('returns null when the gesture snaps back to the current cell', () => {
    expect(moveTarget(widget, 0, 0, METRICS, 1)).toBeNull();
    expect(moveTarget(widget, 4, 4, METRICS, 1)).toBeNull();
  });

  it('with the default offset 0 the math is exactly the legacy target', () => {
    expect(moveTarget(widget, 0, ROW_STEP, METRICS, 0)).toEqual({
      widgetId: 'w1',
      x: 0,
      y: 3,
    });
    expect(moveTarget(widget, -COL_STEP, -ROW_STEP, METRICS, 0)).toEqual({
      widgetId: 'w1',
      x: -1,
      y: 1,
    });
  });
});

describe('DashboardGrid edit-mode wiring', () => {
  it('still attaches the drag responder in edit mode', async () => {
    const renderer = await renderGrid(makeWidget(0), { editMode: true });
    const responders = renderer.root.findAll(
      node => typeof node.props.onResponderRelease === 'function',
    );
    expect(responders.length).toBeGreaterThan(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardGrid neutral card surface (default — editor contract)', () => {
  it('renders cards as theme surface + border in BOTH themes (editor contract)', async () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = await renderGrid(makeWidget(0), { mode });
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }),
      ).toHaveLength(1);
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('keeps the neutral surface when the appearance is explicitly default', async () => {
    const renderer = await renderGrid(makeWidget(0), {
      cardAppearance: 'default',
    });
    expect(
      viewsWithStyle(renderer.root, {
        backgroundColor: LIGHT_TOKENS.surface,
        borderColor: LIGHT_TOKENS.border,
      }),
    ).toHaveLength(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardGrid smart card appearance (opt-in — Smart Home view recipe)', () => {
  it('paints smart cards with the smart card surface + border + shadow in BOTH themes', async () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = await renderGrid(makeWidget(0), {
        cardAppearance: 'smart',
        mode,
      });
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
        }),
      ).toHaveLength(1);
      // Smart shadow on the outer surface (dark: zeroed border-borne).
      expect(
        renderer.root
          .findAllByType(View)
          .filter(
            view =>
              flatStyles(view.props.style).elevation ===
              tokens.smart.cardShadow.elevation,
          ).length,
      ).toBeGreaterThan(0);
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('renders the wide smart view as a growth-safe FLOW (no absolute slots)', async () => {
    // 2x2 persisted grid: two sensors on row 0, two switches on row 1.
    const widgets: readonly WidgetConfig[] = [
      {
        ...makeWidget(0),
        id: 's1',
        type: 'switch',
        layout: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        ...makeWidget(0),
        id: 's2',
        type: 'switch',
        layout: { x: 1, y: 0, width: 1, height: 1 },
      },
      {
        ...makeWidget(0),
        id: 'd1',
        type: 'switch',
        layout: { x: 0, y: 1, width: 1, height: 1 },
      },
      {
        ...makeWidget(0),
        id: 'd2',
        type: 'switch',
        layout: { x: 1, y: 1, width: 1, height: 1 },
      },
    ];
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={widgets}
            registry={makeRegistry()}
            editMode={false}
            metrics={METRICS}
            cardAppearance="smart"
            onMoveWidget={() => false}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
          />
        </ThemeProvider>,
      );
    });

    // The flow container owns the inset (padding) + inter-row gap (rowGap).
    const container = renderer.root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return flat.rowGap === METRICS.gap && flat.padding === METRICS.padding;
    });
    expect(container).toBeTruthy();

    // Two flow rows of two columns; each row owns the inter-column gap.
    const rows = renderer.root
      .findAllByType(View)
      .filter(view => flatStyles(view.props.style).flexDirection === 'row');
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Every card renders in flow: width = the column width, the per-type
    // floor as minHeight, and NO absolute positioning at all (no `top`,
    // no `position: 'absolute'`) — grown content cannot overlap siblings.
    for (const id of ['s1', 's2', 'd1', 'd2']) {
      const card = flatStyles(
        renderer.root.findByProps({ testID: `dashboard-flow-card-${id}` }).props
          .style,
      );
      expect(card.width).toBe(METRICS.cellWidth);
      expect(card.minHeight).toBe(92); // compact switch floor
      expect(card.height).toBeUndefined();
      expect(card.top).toBeUndefined();
      expect(card.left).toBeUndefined();
      expect(card.position).toBeUndefined();
    }
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the persisted COLUMN alignment via an invisible spacer', async () => {
    // A card persisted at x=1 stays in the right flow column.
    const widget: WidgetConfig = {
      ...makeWidget(0),
      layout: { x: 1, y: 0, width: 1, height: 1 },
    };
    const renderer = await renderGrid(widget, { cardAppearance: 'smart' });
    const card = flatStyles(
      renderer.root.findByProps({ testID: 'dashboard-flow-card-w1' }).props
        .style,
    );
    expect(card.width).toBe(METRICS.cellWidth);
    // The left spacer reserves the column (a width-only empty view).
    const row = renderer.root
      .findAllByType(View)
      .find(
        view =>
          view !== renderer.root &&
          flatStyles(view.props.style).flexDirection === 'row' &&
          view.props.testID === undefined,
      );
    expect(row).toBeTruthy();
    const spacer = row!
      .findAllByType(View)
      .filter(view => view !== row)
      .find(
        view =>
          flatStyles(view.props.style).width === METRICS.cellWidth &&
          view.props.testID === undefined,
      );
    expect(spacer).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('spans a 2-wide card across the whole flow row', async () => {
    const widget: WidgetConfig = {
      ...makeWidget(0),
      layout: { x: 0, y: 0, width: 2, height: 1 },
    };
    const renderer = await renderGrid(widget, { cardAppearance: 'smart' });
    const card = flatStyles(
      renderer.root.findByProps({ testID: 'dashboard-flow-card-w1' }).props
        .style,
    );
    expect(card.width).toBe(METRICS.cellWidth * 2 + METRICS.gap);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders sensor cards at the amendment-2 compact smart floor (~136)', async () => {
    const sensor: WidgetConfig = {
      ...makeWidget(0),
      type: 'sensor-value',
      layout: { x: 0, y: 0, width: 1, height: 1 },
    };
    const renderer = await renderGrid(sensor, { cardAppearance: 'smart' });
    const card = flatStyles(
      renderer.root.findByProps({ testID: 'dashboard-flow-card-w1' }).props
        .style,
    );
    // Scope amendment 2: sensor rows floor at the compact smart height —
    // the persisted 160–176 policy stays the EDITOR's contract only (the
    // floor-vs-policy relation is pinned in the gridMetrics tests).
    expect(card.minHeight).toBe(SMART_VIEW_SENSOR_ROW_HEIGHT);
    expect(card.height).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders smart cards with a NON-CLIPPING inner layer + token radius (fix cycle 1)', async () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = await renderGrid(makeWidget(0), {
        cardAppearance: 'smart',
        mode,
      });
      // The smart inner never hides overflow (content can grow the card).
      expect(
        viewsWithStyle(renderer.root, {
          overflow: 'visible',
          borderColor: tokens.smart.colors.cardBorder,
        }),
      ).toHaveLength(1);
      // The card radius comes from the smart.radius.card token (the outer
      // surface AND the inner layer).
      expect(
        viewsWithStyle(renderer.root, {
          borderRadius: tokens.smart.radius.card,
          backgroundColor: tokens.smart.colors.card,
        }).length,
      ).toBeGreaterThan(0);
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('renders no drag responder in the wide smart flow (view-only)', async () => {
    const renderer = await renderGrid(makeWidget(0), {
      cardAppearance: 'smart',
    });
    const responders = renderer.root.findAll(
      node => typeof node.props.onResponderRelease === 'function',
    );
    expect(responders).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the exact persisted slot rect in EDIT mode (editor contract untouched)', async () => {
    const renderer = await renderGrid(makeWidget(0), {
      cardAppearance: 'smart',
      editMode: true,
    });
    // Edit mode never applies the per-type view heights nor the flow:
    // the exact slot rect (absolute, clipping inner) is the contract.
    expect(
      viewsWithStyle(renderer.root, { top: 10, height: 100 }),
    ).toHaveLength(1);
    expect(
      renderer.root.findAllByProps({ testID: 'dashboard-flow-card-w1' }),
    ).toHaveLength(0);
    // The editor's smart surface keeps the CLIPPING inner (exact slots).
    expect(viewsWithStyle(renderer.root, { overflow: 'visible' })).toHaveLength(
      0,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('spans a 2-wide card across the whole flow row at NARROW metrics too', async () => {
    // WYSIWYG at every width (dashboard-view-wysiwyg-two-column): the
    // user's 2x1 resize is visible on a ~360dp phone — the card carries
    // the FULL flow-row width (2 columns + the smart gap) from the
    // narrow-band metrics.
    const narrowMetrics = computeSmartViewMetrics(360, true);
    expect(narrowMetrics.padding).toBe(16); // AD-3: narrow inset stays 16
    const widget: WidgetConfig = {
      ...makeWidget(0),
      layout: { x: 0, y: 0, width: 2, height: 1 },
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={[widget]}
            registry={makeRegistry()}
            editMode={false}
            metrics={narrowMetrics}
            cardAppearance="smart"
            onMoveWidget={() => false}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
          />
        </ThemeProvider>,
      );
    });
    const card = flatStyles(
      renderer.root.findByProps({ testID: 'dashboard-flow-card-w1' }).props
        .style,
    );
    expect(card.width).toBe(2 * narrowMetrics.cellWidth + narrowMetrics.gap);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the NARROW smart view as the same two-column flow (no stacked reflow)', async () => {
    // The smart caller passes NARROW smart-view metrics — the gap/padding
    // the grid renders come from them (one gap source at every width), and
    // two 1-wide cards share ONE flow row (left + right) exactly like on a
    // wide canvas.
    const smartMetrics = computeSmartViewMetrics(360, true);
    expect(smartMetrics.gap).toBe(LIGHT_TOKENS.smart.spacing.cardGap);
    const widgets: readonly WidgetConfig[] = [
      {
        ...makeWidget(0),
        id: 'w-a',
        layout: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        ...makeWidget(0),
        id: 'w-b',
        layout: { x: 1, y: 0, width: 1, height: 1 },
      },
    ];
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={widgets}
            registry={makeRegistry()}
            editMode={false}
            metrics={smartMetrics}
            cardAppearance="smart"
            onMoveWidget={() => false}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
          />
        </ThemeProvider>,
      );
    });
    // Both switch cards render in the flow row at the COLUMN width (not
    // one full-width card per row) and at the compact device FLOOR.
    for (const id of ['w-a', 'w-b']) {
      const card = flatStyles(
        renderer.root.findByProps({ testID: `dashboard-flow-card-${id}` }).props
          .style,
      );
      expect(card.width).toBe(smartMetrics.cellWidth);
      expect(card.minHeight).toBe(92);
      expect(card.height).toBeUndefined();
      expect(card.backgroundColor).toBe(LIGHT_TOKENS.smart.colors.card);
      expect(card.top).toBeUndefined();
      expect(card.position).toBeUndefined();
    }
    // The flow container owns the smart card gap (16) + inset from the
    // narrow smart-view metrics.
    const container = renderer.root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return (
        flat.rowGap === smartMetrics.gap &&
        flat.padding === smartMetrics.padding
      );
    });
    expect(container).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('leaves default callers at the exact persisted slots (no smart drift)', async () => {
    const renderer = await renderGrid(makeWidget(0), {
      cardAppearance: 'default',
    });
    expect(
      viewsWithStyle(renderer.root, { top: 10, height: 100 }),
    ).toHaveLength(1);
    expect(
      renderer.root.findAllByProps({ testID: 'dashboard-flow-card-w1' }),
    ).toHaveLength(0);
    // Default keeps the clipping inner (the smart non-clipping layer
    // never leaks into the editor contract).
    expect(viewsWithStyle(renderer.root, { overflow: 'visible' })).toHaveLength(
      0,
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardGrid non-overlapping editor chrome (opt-in, approved repair)', () => {
  it('renders the chrome BAR with resize/remove controls above the content when opted in', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={[makeWidget(0)]}
            registry={makeRegistry()}
            editMode
            metrics={METRICS}
            onMoveWidget={() => false}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
            editorChrome
          />
        </ThemeProvider>,
      );
    });
    // The chrome bar exists (dedicated flow row, not an absolute overlay).
    expect(
      viewsWithStyle(renderer.root, { flexDirection: 'row', gap: 6 }).length,
    ).toBeGreaterThan(0);
    // The content area shifts below the bar (paddingTop) so controls can
    // never overlap widget icons/titles/values/switches.
    expect(
      viewsWithStyle(renderer.root, { flex: 1, paddingTop: 6 }).length,
    ).toBeGreaterThan(0);
    // The absolute legacy overlay buttons are NOT rendered in this mode.
    expect(viewsWithStyle(renderer.root, { top: 6, right: 6 })).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the legacy overlay controls when editorChrome is not passed (default unchanged)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={[makeWidget(0)]}
            registry={makeRegistry()}
            editMode
            metrics={METRICS}
            onMoveWidget={() => false}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
          />
        </ThemeProvider>,
      );
    });
    // Legacy absolute remove button (top-right overlay) still present.
    expect(
      viewsWithStyle(renderer.root, { top: 6, right: 6 }).length,
    ).toBeGreaterThan(0);
    // No chrome-bar content padding (legacy content style).
    expect(
      viewsWithStyle(renderer.root, { flex: 1, paddingTop: 6 }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders no chrome at all in view mode (Dashboard view-mode semantics untouched)', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={[makeWidget(0)]}
            registry={makeRegistry()}
            editMode={false}
            metrics={METRICS}
            onMoveWidget={() => false}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
            editorChrome
          />
        </ThemeProvider>,
      );
    });
    expect(viewsWithStyle(renderer.root, { top: 6, right: 6 })).toHaveLength(0);
    expect(
      viewsWithStyle(renderer.root, { flex: 1, paddingTop: 6 }).length,
    ).toBe(0);
    expect(
      viewsWithStyle(renderer.root, { flexDirection: 'row', gap: 6 }).length,
    ).toBe(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

/** Widget factories for the drag-highlight tests (1x1 / 2x1 spans). */
const w1x1 = (x: number, y: number): WidgetConfig => ({
  id: 'w1',
  type: 'switch',
  binding: { deviceId: 'relay-1', capability: 'switch' },
  layout: { x, y, width: 1, height: 1 },
});
const w2x1 = (x: number, y: number): WidgetConfig => ({
  id: 'w1',
  type: 'switch',
  binding: { deviceId: 'relay-1', capability: 'switch' },
  layout: { x, y, width: 2, height: 1 },
});
const w2x2 = (x: number, y: number): WidgetConfig => ({
  id: 'w1',
  type: 'switch',
  binding: { deviceId: 'relay-1', capability: 'switch' },
  layout: { x, y, width: 2, height: 2 },
});

describe('dragTargetCell (pure drag-highlight target)', () => {
  it('returns the snapped destination cell with the widget span', () => {
    // 1x1 one column right.
    expect(dragTargetCell(w1x1(0, 0), COL_STEP, 0, METRICS, 0)).toEqual({
      x: 1,
      y: 0,
      width: 1,
      height: 1,
    });
    // 2x1 one row down.
    expect(dragTargetCell(w2x1(0, 0), 0, ROW_STEP, METRICS, 0)).toEqual({
      x: 0,
      y: 1,
      width: 2,
      height: 1,
    });
  });

  it('keeps the SECTION-AWARE rebase (absolute persisted rows)', () => {
    // Persisted row 2, rendered section-locally at row 0 (offset 2):
    // one row down → absolute target row 3.
    expect(dragTargetCell(w1x1(0, 2), 0, ROW_STEP, METRICS, 2)).toEqual({
      x: 0,
      y: 3,
      width: 1,
      height: 1,
    });
  });

  it('yields NO highlight before crossing a cell boundary (no move)', () => {
    expect(dragTargetCell(w1x1(0, 0), 10, 10, METRICS, 0)).toBeNull();
    expect(dragTargetCell(w2x1(0, 0), 0, 0, METRICS, 0)).toBeNull();
  });

  it('yields NO highlight for out-of-bounds targets (release would be rejected)', () => {
    // 1x1 off the left edge / beyond the last column.
    expect(dragTargetCell(w1x1(0, 0), -COL_STEP, 0, METRICS, 0)).toBeNull();
    expect(dragTargetCell(w1x1(1, 0), COL_STEP, 0, METRICS, 0)).toBeNull();
    // A 2x1 can never move right (only 2 columns exist).
    expect(dragTargetCell(w2x1(0, 0), COL_STEP, 0, METRICS, 0)).toBeNull();
  });
});

/**
 * A minimal PanResponder-compatible event: `touchHistory` with one
 * active touch whose `currentPageX/Y` are the finger position (the
 * gesture dx/dy are computed against the grant start).
 */
function panEvent(pageX: number, pageY: number, timestamp: number) {
  return {
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

describe('DashboardGrid drag destination highlight (editor feedback)', () => {
  const HIGHLIGHT_RECT = {
    // Section-local highlight rect for cell (1,0) 1x1 at the test metrics.
    left: 10 + 1 * 55,
    top: 10,
    width: 50,
    height: 100,
  };

  async function renderEditableGrid(
    widget: WidgetConfig,
    onMoveWidget: (id: string, x: number, y: number) => boolean = () => false,
    layoutYOffset?: number,
  ) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={[widget]}
            registry={makeRegistry()}
            editMode
            metrics={METRICS}
            onMoveWidget={onMoveWidget}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
            {...(layoutYOffset === undefined ? {} : { layoutYOffset })}
          />
        </ThemeProvider>,
      );
    });
    return renderer;
  }

  function cardResponder(
    renderer: TestRenderer.ReactTestRenderer,
  ): ReactTestInstance {
    const responders = renderer.root.findAll(
      node => typeof node.props.onResponderMove === 'function',
    );
    expect(responders.length).toBeGreaterThan(0);
    return responders[0]!;
  }

  it('shows the destination highlight while dragging and clears it on drop', async () => {
    const onMoveWidget = jest.fn(() => false);
    const renderer = await renderEditableGrid(w1x1(0, 0), onMoveWidget);
    const responder = cardResponder(renderer);

    // No highlight before any gesture.
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);

    await act(async () => {
      // PanResponder initializes its gesture accumulator on the START
      // handler — grant/move assume it ran.
      responder.props.onStartShouldSetResponderCapture({
        nativeEvent: { touches: [{}] },
        touchHistory: panEvent(0, 0, 0).touchHistory,
      });
      responder.props.onResponderGrant(panEvent(0, 0, 1));
      responder.props.onResponderMove(panEvent(COL_STEP, 0, 2));
    });
    // The destination cells (1,0) 1x1 are highlighted.
    const moved = renderer.root.findAllByType(View).some(v => {
      const flat = flatStyles(v.props.style);
      return (
        typeof flat.translateX === 'number' ||
        (Array.isArray(v.props.style) &&
          v.props.style.some?.((l: { transform?: unknown[] }) =>
            Array.isArray(l?.transform),
          ))
      );
    });
    expect(moved).toBe(true);
    const draggedX = renderer.root
      .findAllByType(View)
      .flatMap((v: TestRenderer.ReactTestInstance) =>
        Array.isArray(v.props.style) ? v.props.style : [v.props.style],
      )
      .filter(
        (l: unknown) =>
          l !== null &&
          typeof l === 'object' &&
          Array.isArray((l as { transform?: unknown[] }).transform),
      )
      .flatMap(
        (l: { transform?: { translateX?: number }[] }) => l.transform ?? [],
      )
      .map((t: { translateX?: number }) => t.translateX)
      .filter((x: number | undefined) => typeof x === 'number');
    expect(draggedX).toEqual([55]);
    const highlight = renderer.root.findByProps({
      testID: 'drag-highlight',
    });
    const flat = flatStyles(highlight.props.style);
    expect(flat.left).toBe(HIGHLIGHT_RECT.left);
    expect(flat.top).toBe(HIGHLIGHT_RECT.top);
    expect(flat.width).toBe(HIGHLIGHT_RECT.width);
    expect(flat.height).toBe(HIGHLIGHT_RECT.height);

    // Drop: the highlight clears and the move commits as before.
    await act(async () => {
      responder.props.onResponderRelease(panEvent(COL_STEP, 0, 3));
    });
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);
    expect(onMoveWidget).toHaveBeenCalledWith('w1', 1, 0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('clears the highlight when the computed target is invalid/out of bounds', async () => {
    const renderer = await renderEditableGrid(w1x1(1, 0));
    const responder = cardResponder(renderer);
    await act(async () => {
      // PanResponder initializes its gesture accumulator on the START
      // handler — grant/move assume it ran.
      responder.props.onStartShouldSetResponderCapture({
        nativeEvent: { touches: [{}] },
        touchHistory: panEvent(0, 0, 0).touchHistory,
      });
      responder.props.onResponderGrant(panEvent(0, 0, 1));
      responder.props.onResponderMove(panEvent(COL_STEP, 0, 2));
    });
    // (2,0) is beyond the last column — no highlight (no false promise).
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);
    await act(async () => {
      // The gesture terminates (canceled) → highlight stays cleared.
      responder.props.onResponderTerminate();
    });
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('never renders a highlight in view mode (no responder, presentation-only)', async () => {
    const renderer = await renderGrid(makeWidget(0), { editMode: false });
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('moveTarget/dragTargetCell section containment (fix cycle 8 H)', () => {
  // Persisted row 1 rendered section-locally at row 0 (the section's base).
  const widget = w1x1(0, 1);

  it('rejects an upward drag whose SECTION-LOCAL row would be negative', () => {
    // One row up: local −1 while the REBASED persisted row (−1 + 1 = 0)
    // would stay "valid" — exactly the cycle-7 reviewer bug. The target is
    // rejected at this validation level (no move, no highlight, snap back).
    expect(moveTarget(widget, 0, -ROW_STEP, METRICS, 1)).toBeNull();
  });

  it('still re-bases downward drags to absolute persisted rows (round-trip intact)', () => {
    expect(moveTarget(widget, 0, ROW_STEP, METRICS, 1)).toEqual({
      widgetId: 'w1',
      x: 0,
      y: 2,
    });
  });

  it('yields NO highlight for a section-escaping target (no false promise)', () => {
    expect(dragTargetCell(widget, 0, -ROW_STEP, METRICS, 1)).toBeNull();
    // Two rows up from the section top is equally invalid.
    expect(dragTargetCell(widget, 0, -2 * ROW_STEP, METRICS, 1)).toBeNull();
  });
});

describe('clampedDragTranslation (fix cycle 8 H completion — in-flight visual clamp)', () => {
  it('clamps an upward dy beyond the section boundary to the card top', () => {
    // Local row 0 → section-local top = padding = 10: the card may rise
    // until its visual top touches the section's top edge (10 - 10 = 0)
    // but never above it.
    expect(
      clampedDragTranslation(w1x1(0, 1), 0, -ROW_STEP, METRICS, 1),
    ).toEqual({ dx: 0, dy: -10 });
    // Far beyond the boundary — the clamp is a floor, not a snap.
    expect(
      clampedDragTranslation(w1x1(0, 1), 0, -3 * ROW_STEP, METRICS, 1),
    ).toEqual({ dx: 0, dy: -10 });
  });

  it('derives the boundary from the widget OWN layout (local row > 0)', () => {
    // Persisted row 2 rendered at local row 1 → top = 10 + 105 = 115.
    expect(clampedDragTranslation(w1x1(0, 2), 0, -200, METRICS, 1)).toEqual({
      dx: 0,
      dy: -115,
    });
    // Within the boundary the translation passes through untouched (the
    // natural in-section drag feel is preserved).
    expect(clampedDragTranslation(w1x1(0, 2), 0, -50, METRICS, 1)).toEqual({
      dx: 0,
      dy: -50,
    });
  });

  it('ignores the card SPAN (a 2x2 clamps exactly like a 1x1 at the same row)', () => {
    expect(
      clampedDragTranslation(w2x2(0, 1), 0, -ROW_STEP, METRICS, 1),
    ).toEqual({ dx: 0, dy: -10 });
  });

  it('keeps dx and downward dy untouched, and matches the offset-0 editor frame', () => {
    expect(
      clampedDragTranslation(w1x1(0, 0), COL_STEP, ROW_STEP, METRICS, 0),
    ).toEqual({ dx: COL_STEP, dy: ROW_STEP });
    // Full-layout editor (offset 0), card at row 0 → same padding floor.
    expect(
      clampedDragTranslation(w1x1(0, 0), 0, -ROW_STEP, METRICS, 0),
    ).toEqual({ dx: 0, dy: -10 });
  });
});

describe('dropOccupant (pure drag-to-swap partner — fix cycle 8 L)', () => {
  const a = w1x1(0, 0);
  const b = { ...w1x1(1, 0), id: 'w2' };
  const wide = { ...w2x1(0, 1), id: 'w3' };

  it('finds the FIRST other widget overlapping the drop cell (array order)', () => {
    const target = { x: 1, y: 0, width: 1, height: 1 };
    expect(dropOccupant(target, [a, b, wide], 'w1')).toBe(b);
  });

  it('matches partial overlaps with the dragged widget SPAN', () => {
    // A 1x1 dropped onto the middle of a 2x1 card (cols 0-1, row 1).
    const target = { x: 1, y: 1, width: 1, height: 1 };
    expect(dropOccupant(target, [a, b, wide], 'w1')).toBe(wide);
  });

  it('returns null on a FREE cell (plain move) and never the dragged widget', () => {
    expect(
      dropOccupant({ x: 0, y: 2, width: 1, height: 1 }, [a, b], 'w1'),
    ).toBeNull();
    // The dragged card's own cell is NOT an occupant (snap-back territory).
    expect(
      dropOccupant({ x: 0, y: 0, width: 1, height: 1 }, [a, b], 'w1'),
    ).toBeNull();
  });
});

describe('DashboardGrid drag-to-swap release (fix cycle 8 L — editor)', () => {
  const a = { ...w1x1(0, 0), id: 'w-a' };
  const b = { ...w1x1(1, 0), id: 'w-b' };

  async function renderSwapGrid(
    widgets: readonly WidgetConfig[],
    handlers: {
      readonly onMoveWidget?: (id: string, x: number, y: number) => boolean;
      readonly onSwapWidgets?: (idA: string, idB: string) => boolean;
    },
  ) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={widgets}
            registry={makeRegistry()}
            editMode
            metrics={METRICS}
            onMoveWidget={handlers.onMoveWidget ?? (() => false)}
            onSwapWidgets={handlers.onSwapWidgets}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
          />
        </ThemeProvider>,
      );
    });
    return renderer;
  }

  function firstCardResponder(
    renderer: TestRenderer.ReactTestRenderer,
  ): ReactTestInstance {
    // Document-order responders: the first is the FIRST widget's card.
    const responders = renderer.root.findAll(
      node => typeof node.props.onResponderMove === 'function',
    );
    expect(responders.length).toBeGreaterThan(0);
    return responders[0]!;
  }

  /** Grant + move + release one drag from the first card. */
  const dragAndRelease = async (
    responder: ReactTestInstance,
    pageX: number,
    pageY: number,
  ) => {
    await act(async () => {
      responder.props.onStartShouldSetResponderCapture({
        nativeEvent: { touches: [{}] },
        touchHistory: panEvent(0, 0, 0).touchHistory,
      });
      responder.props.onResponderGrant(panEvent(0, 0, 1));
      responder.props.onResponderMove(panEvent(pageX, pageY, 2));
      responder.props.onResponderRelease(panEvent(pageX, pageY, 3));
    });
  };

  it('a drop onto an OCCUPIED cell swaps the two widgets (not a doomed move)', async () => {
    const onMoveWidget = jest.fn(() => false);
    const onSwapWidgets = jest.fn(() => true);
    const renderer = await renderSwapGrid([a, b], {
      onMoveWidget,
      onSwapWidgets,
    });
    // Drag w-a one column RIGHT — onto w-b's cell.
    await dragAndRelease(firstCardResponder(renderer), COL_STEP, 0);
    expect(onSwapWidgets).toHaveBeenCalledTimes(1);
    expect(onSwapWidgets).toHaveBeenCalledWith('w-a', 'w-b');
    expect(onMoveWidget).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('a REJECTED swap leaves everything unchanged (no move fallback, snap back)', async () => {
    const onMoveWidget = jest.fn(() => false);
    const onSwapWidgets = jest.fn(() => false);
    const renderer = await renderSwapGrid([a, b], {
      onMoveWidget,
      onSwapWidgets,
    });
    await dragAndRelease(firstCardResponder(renderer), COL_STEP, 0);
    expect(onSwapWidgets).toHaveBeenCalledWith('w-a', 'w-b');
    // The store refused (invalid double placement) → NO other callback, the
    // draft did not change → both cards snap back.
    expect(onMoveWidget).not.toHaveBeenCalled();
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('a drop onto a FREE cell keeps the plain move (behavior unchanged)', async () => {
    const onMoveWidget = jest.fn(() => true);
    const onSwapWidgets = jest.fn(() => true);
    const renderer = await renderSwapGrid([a, b], {
      onMoveWidget,
      onSwapWidgets,
    });
    // Drag w-a one row DOWN — (0,1) is free.
    await dragAndRelease(firstCardResponder(renderer), 0, ROW_STEP);
    expect(onSwapWidgets).not.toHaveBeenCalled();
    expect(onMoveWidget).toHaveBeenCalledWith('w-a', 0, 1);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('without the swap seam (view-surface callers) an occupied drop issues NO callback', async () => {
    const onMoveWidget = jest.fn(() => false);
    const renderer = await renderSwapGrid([a, b], { onMoveWidget });
    await dragAndRelease(firstCardResponder(renderer), COL_STEP, 0);
    // Occupied + no onSwapWidgets → no doomed move call either; the card
    // snaps back (the same visible outcome as the legacy rejection).
    expect(onMoveWidget).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardGrid upward drag with layoutYOffset (fix cycle 8 H — component)', () => {
  async function renderOffsetGrid(
    widget: WidgetConfig,
    onMoveWidget: (id: string, x: number, y: number) => boolean,
  ) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={[widget]}
            registry={makeRegistry()}
            editMode
            metrics={METRICS}
            onMoveWidget={onMoveWidget}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
            layoutYOffset={1}
          />
        </ThemeProvider>,
      );
    });
    return renderer;
  }

  it('an upward gesture cannot render a highlight above the section or move the card', async () => {
    const onMoveWidget = jest.fn(() => true);
    // Persisted row 1 = the section's base row (local row 0).
    const renderer = await renderOffsetGrid(w1x1(0, 1), onMoveWidget);
    const responder = renderer.root.findAll(
      node => typeof node.props.onResponderMove === 'function',
    )[0]!;
    await act(async () => {
      responder.props.onStartShouldSetResponderCapture({
        nativeEvent: { touches: [{}] },
        touchHistory: panEvent(0, 0, 0).touchHistory,
      });
      responder.props.onResponderGrant(panEvent(0, 0, 1));
      // Drag UP one full row (toward/above the section top).
      responder.props.onResponderMove(panEvent(0, -ROW_STEP, 2));
    });
    // NO drop highlight rendered (it would draw ABOVE the section
    // container, overlapping the previous section).
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);
    await act(async () => {
      responder.props.onResponderRelease(panEvent(0, -ROW_STEP, 3));
    });
    // The release is rejected (snap back) — no move callback.
    expect(onMoveWidget).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('a downward gesture still highlights + moves with the persisted rebase', async () => {
    const onMoveWidget = jest.fn(() => true);
    const renderer = await renderOffsetGrid(w1x1(0, 1), onMoveWidget);
    const responder = renderer.root.findAll(
      node => typeof node.props.onResponderMove === 'function',
    )[0]!;
    await act(async () => {
      responder.props.onStartShouldSetResponderCapture({
        nativeEvent: { touches: [{}] },
        touchHistory: panEvent(0, 0, 0).touchHistory,
      });
      responder.props.onResponderGrant(panEvent(0, 0, 1));
      responder.props.onResponderMove(panEvent(0, ROW_STEP, 2));
    });
    // Local row 1 → the highlight draws INSIDE the section container.
    const highlight = renderer.root.findByProps({ testID: 'drag-highlight' });
    const flat = flatStyles(highlight.props.style);
    // top = padding + (target local row 1) * ROW_STEP = 10 + 105 = 115.
    expect(flat.top).toBe(115);
    await act(async () => {
      responder.props.onResponderRelease(panEvent(0, ROW_STEP, 3));
    });
    expect(onMoveWidget).toHaveBeenCalledWith('w1', 0, 2);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardGrid in-flight drag clamp (fix cycle 8 H completion — component)', () => {
  /**
   * The translateY values currently rendered by ANY view: during a drag
   * exactly the dragged card carries a transform, so this isolates its
   * applied translation (the transformed-card assertion the reviewer
   * required — the visual top = rect.top + translateY).
   */
  function renderedTranslateY(root: ReactTestInstance): number[] {
    return root
      .findAllByType(View)
      .flatMap(v =>
        Array.isArray(v.props.style) ? v.props.style : [v.props.style],
      )
      .filter(
        (layer: unknown): layer is { transform: { translateY?: number }[] } =>
          layer !== null &&
          typeof layer === 'object' &&
          Array.isArray((layer as { transform?: unknown[] }).transform),
      )
      .flatMap(layer => layer.transform)
      .map(entry => entry.translateY)
      .filter((y): y is number => typeof y === 'number');
  }

  async function renderOffsetGrid(
    widget: WidgetConfig,
    onMoveWidget: (id: string, x: number, y: number) => boolean,
  ) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DashboardGrid
            widgets={[widget]}
            registry={makeRegistry()}
            editMode
            metrics={METRICS}
            onMoveWidget={onMoveWidget}
            onResizeWidget={() => false}
            onRemoveWidget={() => undefined}
            layoutYOffset={1}
          />
        </ThemeProvider>,
      );
    });
    return renderer;
  }

  /** Grant + move one (upward) gesture on the only card. */
  const dragTo = async (
    renderer: TestRenderer.ReactTestRenderer,
    pageY: number,
  ) => {
    const responder = renderer.root.findAll(
      node => typeof node.props.onResponderMove === 'function',
    )[0]!;
    await act(async () => {
      responder.props.onStartShouldSetResponderCapture({
        nativeEvent: { touches: [{}] },
        touchHistory: panEvent(0, 0, 0).touchHistory,
      });
      responder.props.onResponderGrant(panEvent(0, 0, 1));
      responder.props.onResponderMove(panEvent(0, pageY, 2));
    });
  };

  it('a base-row card dragged UP renders at most AT the section top edge, never above', async () => {
    const onMoveWidget = jest.fn(() => true);
    // Persisted row 1 = the section's base row: rect top = padding = 10.
    const renderer = await renderOffsetGrid(w1x1(0, 1), onMoveWidget);
    await dragTo(renderer, -ROW_STEP);
    // The raw dy −105 would put the visual top at 10 − 105 = −95 (above
    // the section container); the applied translation is clamped to −10
    // → the visual top stops exactly at the section top edge (0).
    expect(renderedTranslateY(renderer.root)).toEqual([-10]);
    // A far larger gesture is pinned to the same floor — never above.
    await dragTo(renderer, -3 * ROW_STEP);
    expect(renderedTranslateY(renderer.root)).toEqual([-10]);
    // The validation level is untouched: still no highlight above the
    // section while the (clamped) card is in flight.
    expect(
      renderer.root.findAllByProps({ testID: 'drag-highlight' }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('a 2x2 card at the base row clamps identically (span-independent)', async () => {
    const renderer = await renderOffsetGrid(w2x2(0, 1), () => true);
    await dragTo(renderer, -2 * ROW_STEP);
    expect(renderedTranslateY(renderer.root)).toEqual([-10]);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('a deeper card keeps its natural in-section movement and clamps only at the boundary', async () => {
    const renderer = await renderOffsetGrid(w1x1(0, 2), () => true);
    // Local row 1 → top = 115: a small upward drag passes through raw.
    await dragTo(renderer, -50);
    expect(renderedTranslateY(renderer.root)).toEqual([-50]);
    // Past the boundary the same floor applies (visual top 0).
    await dragTo(renderer, -200);
    expect(renderedTranslateY(renderer.root)).toEqual([-115]);
    await act(async () => {
      renderer.unmount();
    });
  });
});
