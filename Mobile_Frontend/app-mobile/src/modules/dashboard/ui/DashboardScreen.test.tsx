/**
 * DashboardScreen tests — the Dashboard tab's VIEW-ONLY surface (Smart
 * Home design language, dashboard-smart-home-redesign).
 *
 * Verifies:
 * - AMBIENT PAGE: the diagonal Smart Home wash (LinearGradient tealTint →
 *   page → amberTint from the active theme's `smart` tokens) in light AND
 *   dark — no app title, no Template name anywhere,
 * - HEADER: menu button (≥44 touch target, opens the shared room list) +
 *   the selected ROOM NAME (the active room, from the Template's ordered
 *   references) + the small connection chip whose dot/label follow the
 *   LIVE connection state (connected/failed/connecting/reconnecting),
 * - ROOM MENU = ACTIVE TEMPLATE: the opened list shows exactly the
 *   Template's ordered room references RESOLVED to physical room names, in
 *   TEMPLATE order (not the devices registry order); rooms not referenced
 *   by the Template never appear; a dangling reference (physical room
 *   deleted) is not displayed and the view normalizes without writing,
 * - SELECTION IS VIEW-ONLY: selecting a room in the menu changes the
 *   viewed room only (other room's layout renders; an empty room shows the
 *   no-widgets hint) — nothing is persisted and no navigation happens,
 * - SECTIONS: the "Môi trường"/"Thiết bị" split of the seed layout with
 *   the small secondary labels (no gel pill),
 * - SMART APPEARANCE: the section grids opt into the `'smart'` card
 *   appearance (card surface from the smart tokens),
 * - MEASURED WIDE GEOMETRY (fix cycle 1 blocker + growth-safe flow, fix
 *   cycle 2): a fired WIDE `onLayout` drives the smart-view mapping —
 *   symmetric 24pt screen padding (flow container) and a 16pt card gap on
 *   BOTH axes in the TWO-COLUMN FLOW presentation; the smart cards render
 *   in normal flow rows (NO absolute positioning, NO fixed section
 *   heights), computed from the measured canvas (not just the pre-layout
 *   window fallback),
 * - NARROW-CANVAS WYSIWYG (dashboard-view-wysiwyg-two-column): at a
 *   ~360dp canvas the view renders the SAME two-column flow — a persisted
 *   width-2 widget spans the full flow row, a dragged row reorders the
 *   view, 1-wide cards keep their persisted column — and the stacked
 *   full-width reflow is GONE (the retired presentation never renders),
 * - GROWTH SAFETY (fix cycle 2 major): a long inline command error in a
 *   wide multi-row section grows its card's flow row — the structure is
 *   flow (rows push down, siblings stretch, no absolute slots) so later
 *   cards/sections are reflowed BELOW the grown content and the ScrollView
 *   extent (content-driven) always covers the final content,
 * - HONEST EMPTY STATES: a Template with no (surviving) room references
 *   points the user at the Settings management hierarchy — and shows no
 *   menu button (nothing to list),
 * - NO CLIPPING (fix cycle 1): a long inline command error inside a
 *   compact ~92pt smart switch card renders in full — the card's height is
 *   a `minHeight` floor and the smart card layers never hide overflow.
 */

import React from 'react';
import { Dimensions, Pressable, Text, View } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { LinearGradient } from 'expo-linear-gradient';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';
import type { CapabilityDef, Device, Room } from '@modules/devices/api';
import type { SeriesPoint } from '@modules/devices/api';
import {
  createDefaultRegistry,
  type WidgetConfig,
  type WidgetServices,
} from '@modules/widgets/api';
import { Errors, err, ok } from '@core/errors';

import type { DashboardTemplate } from '@modules/dashboard/api';
import { SMART_VIEW_MAX_CONTENT_WIDTH } from '../internal/domain/gridMetrics';
import { defaultDashboardsFile } from '../internal/domain/seeds';
import { DashboardScreen } from './DashboardScreen';

// The widgets facade transitively requires AsyncStorage (devices api).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const ROOMS: readonly Room[] = [
  { id: 'room-living', name: 'Phòng khách', order: 0, icon: 'home-outline' },
  { id: 'room-bedroom', name: 'Phòng ngủ', order: 1, icon: 'bed-outline' },
  { id: 'room-kitchen', name: 'Bếp', order: 2, icon: 'restaurant-outline' },
  { id: 'room-garage', name: 'Nhà để xe', order: 3, icon: 'car-outline' },
];

const CATALOG: readonly CapabilityDef[] = [
  { type: 'temperature', label: 'Nhiệt độ', kind: 'sensor', unit: '°C' },
  { type: 'humidity', label: 'Độ ẩm', kind: 'sensor', unit: '%' },
  { type: 'switch', label: 'Công tắc', kind: 'switch' },
];

/** Stable snapshot — `useSyncExternalStore` requires identity stability. */
const STABLE_STATE = { value: 24.5, updatedAt: 1000 };
const NO_SERIES: readonly SeriesPoint[] = [];

function makeServices(): WidgetServices {
  // Stable connected snapshot (amendment-2 connection seam; identity
  // stability for useSyncExternalStore).
  const connection = { state: 'connected' as const, label: 'Đã kết nối' };
  return {
    getState: () => STABLE_STATE,
    getSeries: () => NO_SERIES,
    sendCommand: () => err(Errors.unknown('not wired')),
    queryHistory: async () => ok([]),
    getRooms: () => ROOMS,
    getDevices: () => [],
    getCapabilities: () => CATALOG,
    getActiveRoomId: () => 'room-living',
    subscribeDeviceState: () => () => undefined,
    // Stable connected snapshot (amendment-2 connection seam).
    getConnectionState: () => connection,
    getCommandError: () => null,
    subscribeConnection: () => () => undefined,
  };
}

/**
 * The window-width seam: `useWindowDimensions` is the documented pre-layout
 * fallback, so tests control the presentation mode through it (TestRenderer
 * never fires `onLayout`).
 */
let windowWidth = 800;

beforeAll(() => {
  jest.spyOn(Dimensions, 'get').mockImplementation(() => ({
    width: windowWidth,
    height: 900,
    scale: 1,
    fontScale: 1,
  }));
});

afterAll(() => {
  (Dimensions.get as jest.Mock).mockRestore();
});

/** A minimal one-widget Template-room reference builder. */
function widget(
  id: string,
  type: 'sensor-value' | 'switch',
  roomId: string,
  deviceId: string,
  capability: string,
  x: number,
  y: number,
): WidgetConfig {
  return {
    id,
    type,
    roomId,
    binding: { deviceId, capability },
    layout: { x, y, width: 1, height: 1 },
  };
}

/** The seed Template (Phòng khách: 2 sensors + 3 switches). */
function seedTemplate(): DashboardTemplate {
  const file = defaultDashboardsFile();
  return file.templates[0]!;
}

/** Render the view-only screen with an explicit Template + connection. */
function renderScreen(
  template: DashboardTemplate | undefined,
  mode: 'light' | 'dark' = 'light',
  connectionState:
    | 'idle'
    | 'connected'
    | 'failed'
    | 'connecting'
    | 'reconnecting' = 'connected',
  services: WidgetServices = makeServices(),
): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <DashboardScreen
          template={template}
          connection={{ state: connectionState, label: 'snapshot' }}
          rooms={ROOMS}
          registry={createDefaultRegistry()}
          services={services}
        />
      </ThemeProvider>,
    );
  });
  return renderer;
}

/** Deep-collect the text strings rendered under a node (RN nests Texts). */
function textOf(node: ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' ? child : textOf(child as ReactTestInstance),
    )
    .join('');
}

function allText(renderer: TestRenderer.ReactTestRenderer): string {
  return textOf(renderer.root);
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

describe('DashboardScreen ambient page (smart tokens)', () => {
  beforeEach(() => {
    windowWidth = 800; // wide canvas → the wide (24pt) band by default
  });

  it('renders the diagonal teal→page→amber wash (light)', async () => {
    const renderer = renderScreen(seedTemplate());
    const gradient = renderer.root.findByType(LinearGradient);
    expect(gradient.props.colors).toEqual([
      LIGHT_TOKENS.smart.colors.tealTint,
      LIGHT_TOKENS.smart.colors.page,
      LIGHT_TOKENS.smart.colors.amberTint,
    ]);
    // Diagonal: top-left → bottom-right.
    expect(gradient.props.start).toEqual({ x: 0, y: 0 });
    expect(gradient.props.end).toEqual({ x: 1, y: 1 });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the dark-theme wash when the active theme is dark', async () => {
    const renderer = renderScreen(seedTemplate(), 'dark');
    expect(renderer.root.findByType(LinearGradient).props.colors).toEqual([
      DARK_TOKENS.smart.colors.tealTint,
      DARK_TOKENS.smart.colors.page,
      DARK_TOKENS.smart.colors.amberTint,
    ]);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders NO app title and NO Template name on the view surface', async () => {
    const renderer = renderScreen(seedTemplate());
    const text = allText(renderer);
    expect(text).not.toContain('IoT Dashboard');
    expect(text).not.toContain(templateNameOf(renderer));
    await act(async () => {
      renderer.unmount();
    });
  });

  /** The seed Template's display name (never rendered on the view). */
  function templateNameOf(renderer: TestRenderer.ReactTestRenderer): string {
    void renderer;
    return seedTemplate().name;
  }
});

describe('DashboardScreen header (menu + room name + connection chip)', () => {
  beforeEach(() => {
    windowWidth = 800;
  });

  it('shows the menu button (>=44 touch) + the selected room name', async () => {
    const renderer = renderScreen(seedTemplate());
    const menu = renderer.root.findByProps({
      testID: 'dashboard-room-menu',
    });
    const style = flatStyles(menu.props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    // The header title is the ACTIVE room's name (first reference).
    expect(allText(renderer)).toContain('Phòng khách');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('opens the shared room list from the menu and closes it', async () => {
    const renderer = renderScreen(seedTemplate());
    // Closed initially.
    expect(
      renderer.root.findByProps({ testID: 'dashboard-room-modal' }).props
        .visible,
    ).toBe(false);
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-menu' })
        .props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'dashboard-room-modal' }).props
        .visible,
    ).toBe(true);
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-close' })
        .props.onPress();
    });
    expect(
      renderer.root.findByProps({ testID: 'dashboard-room-modal' }).props
        .visible,
    ).toBe(false);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the connection chip from the LIVE connection state', async () => {
    const connected = renderScreen(seedTemplate(), 'light', 'connected');
    expect(allText(connected)).toContain(STRINGS.dashboard.connConnected);
    await act(async () => {
      connected.unmount();
    });

    const failed = renderScreen(seedTemplate(), 'light', 'failed');
    expect(allText(failed)).toContain(STRINGS.dashboard.connFailed);
    await act(async () => {
      failed.unmount();
    });

    const connecting = renderScreen(seedTemplate(), 'light', 'connecting');
    expect(allText(connecting)).toContain(STRINGS.dashboard.connConnecting);
    await act(async () => {
      connecting.unmount();
    });
  });

  it('renders the reconnecting chip state (not collapsed into connecting)', async () => {
    const renderer = renderScreen(seedTemplate(), 'light', 'reconnecting');
    expect(allText(renderer)).toContain(STRINGS.dashboard.connReconnecting);
    // The reconnecting dot uses the smart AMBER (D3 connection/health
    // contract — settings-smart-home-sync unified the ambers): distinct
    // from the teal online dot and the danger failed dot.
    const dot = renderer.root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return flat.width === 8 && flat.height === 8;
    });
    expect(flatStyles(dot!.props.style).backgroundColor).toBe(
      LIGHT_TOKENS.smart.colors.amber,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('follows the D3 connection color contract for EVERY state (direct color assertions)', async () => {
    // The shared contract (settings-smart-home-sync D3): teal = connected,
    // amber = connecting AND reconnecting ONLY, danger = failed, and the
    // idle state = smart textSecondary (never amber — idle is not a
    // progress state). Regression for the reviewer's MAJOR-1: `idle` used
    // to fall through to the amber default.
    const expectations: readonly [
      'idle' | 'connected' | 'failed' | 'connecting' | 'reconnecting',
      string,
    ][] = [
      ['connected', LIGHT_TOKENS.smart.colors.teal],
      ['connecting', LIGHT_TOKENS.smart.colors.amber],
      ['reconnecting', LIGHT_TOKENS.smart.colors.amber],
      ['failed', LIGHT_TOKENS.danger],
      ['idle', LIGHT_TOKENS.smart.colors.textSecondary],
    ];
    for (const [state, expectedColor] of expectations) {
      const renderer = renderScreen(seedTemplate(), 'light', state);
      const dot = renderer.root.findAllByType(View).find(view => {
        const flat = flatStyles(view.props.style);
        return flat.width === 8 && flat.height === 8;
      });
      expect(dot).toBeTruthy();
      expect(flatStyles(dot!.props.style).backgroundColor).toBe(expectedColor);
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('renders no menu button when the Template has no room references', async () => {
    const template: DashboardTemplate = {
      id: 'tpl-empty',
      name: 'Trống',
      updatedAt: 0,
      rooms: [],
    };
    const renderer = renderScreen(template);
    expect(
      renderer.root.findAllByProps({ testID: 'dashboard-room-menu' }),
    ).toHaveLength(0);
    expect(allText(renderer)).toContain(STRINGS.dashboard.noTemplateRooms);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardScreen room menu (active Template references)', () => {
  beforeEach(() => {
    windowWidth = 800;
  });

  it('lists exactly the Template references resolved to physical names, in TEMPLATE order', async () => {
    // Template references [garage (order 0), living (order 1)] — the
    // registry order (living, bedroom, garage) must NOT win.
    const template: DashboardTemplate = {
      id: 'tpl-order',
      name: 'Sắp xếp',
      updatedAt: 0,
      rooms: [
        {
          roomId: 'room-garage',
          order: 0,
          widgets: [
            widget('w-g', 'switch', 'room-garage', 'relay-1', 'switch', 0, 0),
          ],
        },
        { roomId: 'room-living', order: 1, widgets: [] },
      ],
    };
    const renderer = renderScreen(template);
    // The header shows the FIRST referenced room (garage).
    expect(allText(renderer)).toContain('Nhà để xe');
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-menu' })
        .props.onPress();
    });
    const rows = ['room-garage', 'room-living'].map(id =>
      textOf(renderer.root.findByProps({ testID: `dashboard-room-row-${id}` })),
    );
    expect(rows).toEqual(['Nhà để xe', 'Phòng khách']);
    // A physical room NOT referenced by the Template never appears.
    expect(
      renderer.root.findAllByProps({
        testID: 'dashboard-room-row-room-bedroom',
      }),
    ).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('lists the seed Template room menu with all THREE demo rooms, in reference order', async () => {
    // Demo-three-rooms: the seed 'Trang chủ' references living/bedroom/
    // kitchen (orders 0/1/2) — the room menu resolves all three to their
    // physical names, in TEMPLATE order, and the garage never appears.
    const renderer = renderScreen(seedTemplate());
    expect(allText(renderer)).toContain('Phòng khách');
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-menu' })
        .props.onPress();
    });
    const rowIds = ['room-living', 'room-bedroom', 'room-kitchen'];
    const rows = rowIds.map(id =>
      textOf(renderer.root.findByProps({ testID: `dashboard-room-row-${id}` })),
    );
    expect(rows).toEqual(['Phòng khách', 'Phòng ngủ', 'Bếp']);
    expect(
      renderer.root.findAllByProps({
        testID: 'dashboard-room-row-room-garage',
      }),
    ).toHaveLength(0);
    // Switching to the kitchen reference renders ITS seeded layout.
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-row-room-kitchen' })
        .props.onPress();
    });
    expect(allText(renderer)).toContain('Bếp');
    expect(allText(renderer)).toContain(STRINGS.dashboard.environment);
    expect(allText(renderer)).toContain(STRINGS.dashboard.devices);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('selecting a room switches the VIEWED room only (empty room → hint)', async () => {
    // Seed living-room layout + a second (empty) room reference.
    const template: DashboardTemplate = {
      id: 'tpl-two',
      name: 'Hai phòng',
      updatedAt: 0,
      rooms: [
        {
          roomId: 'room-living',
          order: 0,
          widgets: seedTemplate().rooms[0]!.widgets,
        },
        { roomId: 'room-bedroom', order: 1, widgets: [] },
      ],
    };
    const renderer = renderScreen(template);
    // The first referenced room renders the sensor/switch content.
    expect(allText(renderer)).toContain(STRINGS.dashboard.environment);
    // Switch via the room menu → the viewed room changes, no navigation,
    // no persisted write (selection is presentation state).
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-menu' })
        .props.onPress();
    });
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-row-room-bedroom' })
        .props.onPress();
    });
    expect(allText(renderer)).toContain(STRINGS.dashboard.noWidgets);
    expect(allText(renderer)).not.toContain(STRINGS.dashboard.environment);
    // The menu closed after the selection (host-owned visibility).
    expect(
      renderer.root.findByProps({ testID: 'dashboard-room-modal' }).props
        .visible,
    ).toBe(false);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('hides dangling references and normalizes the view without writing', async () => {
    const template: DashboardTemplate = {
      id: 'tpl-dangling',
      name: 'Tham chiếu mất',
      updatedAt: 0,
      rooms: [
        { roomId: 'room-gone', order: 0, widgets: [] },
        {
          roomId: 'room-living',
          order: 1,
          widgets: [
            widget(
              'w-t',
              'sensor-value',
              'room-living',
              's1',
              'temperature',
              0,
              0,
            ),
          ],
        },
      ],
    };
    const renderer = renderScreen(template);
    // The dangling reference is never displayed (no menu row for it)…
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-menu' })
        .props.onPress();
    });
    expect(
      renderer.root.findAllByProps({
        testID: 'dashboard-room-row-room-gone',
      }),
    ).toHaveLength(0);
    // …and the view normalized to the first SURVIVING reference's widgets.
    expect(allText(renderer)).toContain(STRINGS.dashboard.environment);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardScreen sections + appearance (smart)', () => {
  beforeEach(() => {
    windowWidth = 800;
  });

  it('splits the seed layout into "Môi trường" and "Thiết bị" sections', async () => {
    const renderer = renderScreen(seedTemplate());
    expect(allText(renderer)).toContain(STRINGS.dashboard.environment);
    expect(allText(renderer)).toContain(STRINGS.dashboard.devices);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders small secondary section labels (no gel pill background)', async () => {
    const renderer = renderScreen(seedTemplate());
    const label = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === STRINGS.dashboard.environment);
    expect(label).toBeTruthy();
    const style = flatStyles(label!.props.style);
    expect(style.color).toBe(LIGHT_TOKENS.smart.colors.textSecondary);
    // No pill: no background color on the label itself.
    expect(style.backgroundColor).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('opts the section grids into the smart card appearance', async () => {
    const renderer = renderScreen(seedTemplate());
    // Cards render on the smart card surface (white card in light theme).
    const cardSurface = renderer.root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return (
        flat.backgroundColor === LIGHT_TOKENS.smart.colors.card &&
        flat.elevation === LIGHT_TOKENS.smart.cardShadow.elevation
      );
    });
    expect(cardSurface).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders NO management affordances (all mutations live behind Settings)', async () => {
    const renderer = renderScreen(seedTemplate());
    // No edit/management test ids may exist on the view surface.
    expect(
      renderer.root.findAllByProps({ testID: 'room-dashboard-edit' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'room-edit-save' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'room-edit-add-widget' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'template-create-card' }),
    ).toHaveLength(0);
    // The only Pressables are the header menu + widget switches (no
    // Template-name navigation row).
    const pressableLabels = renderer.root
      .findAllByType(Pressable)
      .map(p => p.props.accessibilityLabel)
      .filter(Boolean);
    expect(pressableLabels).not.toContain(STRINGS.templates.createTemplate);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardScreen measured wide geometry (smart-view mapping, growth-safe flow)', () => {
  // At a measured 800pt canvas the smart-view metrics give cellWidth 368,
  // screen inset 24 and card gap 16 (the per-TYPE card floors are the
  // amendment-2 view floors: sensor 136 / switch 92).
  const INSET = 24;
  const GAP = 16;
  const CELL = 368;

  /** Fire the measured WIDE layout on the canvas wrapper. */
  const fireWideLayout = async (
    renderer: TestRenderer.ReactTestRenderer,
    width = 800,
  ) => {
    await act(async () => {
      renderer.root.findByProps({ testID: 'dashboard-canvas' }).props.onLayout({
        nativeEvent: { layout: { width, height: 600 } },
      });
    });
  };

  /** The smart two-column FLOW container (owns the screen inset + row gap). */
  const flowContainerOf = (root: ReactTestInstance) =>
    root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return flat.padding === INSET && flat.rowGap === GAP;
    });

  it('fires the WIDE onLayout and renders the two-column FLOW with symmetric 24pt padding + 16pt gaps', async () => {
    windowWidth = 800;
    const renderer = renderScreen(seedTemplate());
    // The measured path (post-layout) must produce the correct geometry —
    // not just the pre-layout window fallback.
    await fireWideLayout(renderer);

    // The flow container carries the smart screen inset (24) and the
    // inter-row smart gap (16) — the geometry source for both sections.
    expect(flowContainerOf(renderer.root)).toBeTruthy();

    // The absolute smart cards: 5 seed cards (2 sensors row 0, 3 switches
    // rows 1–2), each cellWidth wide, TWO per flow row — plus the
    // column-alignment SPACER the smart flow renders in the odd switch
    // row's empty right slot (see DashboardGrid.renderSlot).
    const cellViews = viewsWithStyle(renderer.root, { width: CELL });
    expect(cellViews).toHaveLength(6);
    const cards = cellViews.filter(view =>
      [136, 92].includes(flatStyles(view.props.style).minHeight as number),
    );
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      const flat = flatStyles(card.props.style);
      // FLOW rendering: NO absolute slot positioning at all — grown
      // content can never overlap a sibling slot nor escape the extent.
      expect(flat.left).toBeUndefined();
      expect(flat.top).toBeUndefined();
      expect(flat.position).toBeUndefined();
      // The per-type floors stay minHeight (never a clipping fixed height).
      expect([136, 92]).toContain(flat.minHeight);
      expect(flat.height).toBeUndefined();
    }

    // The inter-card gap is the smart 16 on BOTH axes: the rows carry the
    // column gap; the container carries the row gap.
    const rowGaps = renderer.root.findAllByType(View).filter(view => {
      const flat = flatStyles(view.props.style);
      return flat.flexDirection === 'row' && flat.gap === GAP;
    }).length;
    expect(rowGaps).toBeGreaterThanOrEqual(2);

    // The canvas wrapper itself carries NO horizontal padding: the measured
    // width and the metrics' screen inset are one consistent geometry.
    const canvas = flatStyles(
      renderer.root.findByProps({ testID: 'dashboard-canvas' }).props.style,
    );
    expect(canvas.paddingHorizontal).toBeUndefined();
    expect(canvas.width).toBe('100%');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('carries the amendment-2 content cap + label spacing (cap 880 centered, gap owned by the label)', async () => {
    windowWidth = 800;
    const renderer = renderScreen(seedTemplate());
    await fireWideLayout(renderer, 2000);
    // The canvas wrapper caps the smart content at ~880 and CENTERS it —
    // the ambient wash fills the rest of an oversized screen.
    const canvas = flatStyles(
      renderer.root.findByProps({ testID: 'dashboard-canvas' }).props.style,
    );
    expect(canvas.maxWidth).toBe(SMART_VIEW_MAX_CONTENT_WIDTH);
    expect(canvas.alignSelf).toBe('center');
    // The section labels own the label→card gap (marginBottom 16) and the
    // smart flow containers carry NO top padding (absorbed).
    const labels = renderer.root.findAllByType(Text).filter(node => {
      const flat = flatStyles(node.props.style);
      return flat.marginBottom === 16;
    });
    expect(labels.length).toBeGreaterThanOrEqual(2);
    const paddedFlow = renderer.root.findAllByType(View).filter(view => {
      const flat = flatStyles(view.props.style);
      return flat.paddingTop === 24 && flat.rowGap === 16;
    });
    expect(paddedFlow).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('re-projects a REMEASURED canvas (metrics follow the measured width, capped)', async () => {
    windowWidth = 800;
    const renderer = renderScreen(seedTemplate());
    await fireWideLayout(renderer, 1000);
    // cellWidth = (min(1000, 880) - 48 - 16) / 2 = 408 — the amendment-2
    // content cap (~880) bounds the canvas on oversized screens; the flow
    // container keeps the 24pt inset and the 16pt gaps. Six width-408
    // views: 5 cards + the odd switch row's alignment spacer.
    const cellViews = viewsWithStyle(renderer.root, { width: 408 });
    expect(cellViews).toHaveLength(6);
    expect(
      cellViews.filter(view =>
        [136, 92].includes(flatStyles(view.props.style).minHeight as number),
      ),
    ).toHaveLength(5);
    expect(flowContainerOf(renderer.root)).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('reserves NO fixed section height (the flow extent covers grown content)', async () => {
    windowWidth = 800;
    const renderer = renderScreen(seedTemplate());
    await fireWideLayout(renderer);
    // No view in the sections tree carries the legacy fixed section shell
    // height — the flow is the ONLY height source, so grown cards extend
    // the ScrollView content instead of escaping it. (Fixed-size controls
    // legitimately carry both width AND height — e.g. the 44pt menu
    // button — and are excluded by the width guard.)
    const fixedHeights = renderer.root.findAllByType(View).filter(view => {
      const flat = flatStyles(view.props.style);
      return (
        typeof flat.height === 'number' &&
        flat.position === undefined &&
        flat.width === undefined
      );
    });
    expect(fixedHeights).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardScreen smart cards never clip content (fix cycle 1) + grow safely (fix cycle 2)', () => {
  /** The seeded relay devices (so the switch widgets are NOT lost-binding). */
  const RELAY_DEVICES: readonly Device[] = [
    {
      id: 'relay-1',
      name: 'Đèn',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 1 },
    },
    {
      id: 'relay-2',
      name: 'Quạt',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 2 },
    },
    {
      id: 'relay-3',
      name: 'Bơm',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 3 },
    },
  ];

  it('grows the compact ~92pt switch card for a LONG inline error', async () => {
    windowWidth = 800;
    const LONG_ERROR =
      'MQTT chưa kết nối — lệnh không thể gửi đến relay-1, vui lòng kiểm tra broker và kết nối mạng rồi thử lại sau khi trạng thái được khôi phục.';
    const services: WidgetServices = {
      ...makeServices(),
      getDevices: () => RELAY_DEVICES,
      sendCommand: () => err(Errors.network(LONG_ERROR)),
    };
    const renderer = renderScreen(
      seedTemplate(),
      'light',
      'connected',
      services,
    );

    // Trigger the command failure inside the devices section (the first
    // rendered relay switch).
    await act(async () => {
      renderer.root
        .findAllByProps({ accessibilityRole: 'switch' })
        .filter(node => typeof node.props.onPress === 'function')[0]!
        .props.onPress();
    });

    // The LONG error renders IN FULL (data never hidden)…
    expect(allText(renderer)).toContain(LONG_ERROR);
    // …on an unclamped line…
    const errorNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === LONG_ERROR);
    expect(errorNode).toBeTruthy();
    expect(errorNode!.props.numberOfLines).toBeUndefined();

    // …inside a NON-clipping floor card: the device cards are minHeight-92
    // floors (no fixed height cap)…
    const deviceCards = viewsWithStyle(renderer.root, { minHeight: 92 });
    expect(deviceCards).toHaveLength(3);
    for (const card of deviceCards) {
      expect(flatStyles(card.props.style).height).toBeUndefined();
      // …and their smart inner layer never hides overflow.
      const inner = card.findAll(
        node => flatStyles(node.props.style).overflow === 'visible',
      );
      expect(inner.length).toBeGreaterThan(0);
    }
    await act(async () => {
      renderer.unmount();
    });
  });

  it('GROWTH SAFETY (wide, ≥2 rows): the grown card reflows the rows below it — no overlap, extent covers the content', async () => {
    // Wide canvas → the two-column flow; the seed layout has TWO rows
    // (sensors row 0, switches row 1) in TWO sections. The first card is
    // forced past its floor with a long inline command error.
    windowWidth = 800;
    const LONG_ERROR =
      'MQTT chưa kết nối — lệnh không thể gửi đến relay-1, vui lòng kiểm tra broker và kết nối mạng rồi thử lại sau khi trạng thái được khôi phục.';
    const services: WidgetServices = {
      ...makeServices(),
      getDevices: () => RELAY_DEVICES,
      sendCommand: () => err(Errors.network(LONG_ERROR)),
    };
    const renderer = renderScreen(
      seedTemplate(),
      'light',
      'connected',
      services,
    );
    await act(async () => {
      renderer.root.findByProps({ testID: 'dashboard-canvas' }).props.onLayout({
        nativeEvent: { layout: { width: 800, height: 600 } },
      });
    });
    await act(async () => {
      renderer.root
        .findAllByProps({ accessibilityRole: 'switch' })
        .filter(node => typeof node.props.onPress === 'function')[0]!
        .props.onPress();
    });
    expect(allText(renderer)).toContain(LONG_ERROR);

    // NON-OVERLAP (structural guarantee): NOT ONE card in the whole view
    // tree is absolutely positioned — every smart card lives in a normal
    // flow row, so a grown card can only make its row taller and push the
    // following rows/sections DOWN (Yoga flow), never cover them.
    const flowCards = [
      ...viewsWithStyle(renderer.root, { minHeight: 136 }),
      ...viewsWithStyle(renderer.root, { minHeight: 92 }),
    ];
    expect(flowCards).toHaveLength(5);
    for (const card of flowCards) {
      const flat = flatStyles(card.props.style);
      expect(flat.position).toBeUndefined();
      expect(flat.top).toBeUndefined();
      expect(flat.left).toBeUndefined();
    }

    // REFLow: the cards sit inside flexDirection-row flow rows (the row
    // stretches with the grown card; the sibling stretches along).
    const flowRows = renderer.root.findAllByType(View).filter(view => {
      const flat = flatStyles(view.props.style);
      return flat.flexDirection === 'row' && flat.gap === 16;
    });
    expect(flowRows.length).toBeGreaterThanOrEqual(2);

    // SCROLL EXTENT (structural guarantee): no fixed section shell height
    // exists — the ScrollView content height is computed BY the flow from
    // the real (grown) content, so the final content can never render
    // outside the scrollable range.
    const fixedShells = renderer.root.findAllByType(View).filter(view => {
      const flat = flatStyles(view.props.style);
      return (
        typeof flat.height === 'number' &&
        flat.position === undefined &&
        flat.width === undefined
      );
    });
    expect(fixedShells).toHaveLength(0);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardScreen narrow canvas (WYSIWYG two-column flow at every width)', () => {
  // The ~360dp phone band (dashboard-view-wysiwyg-two-column): the view
  // renders the SAME two-column smart flow as wide canvases — the stacked
  // full-width reflow is retired, so persisted position/size are visible
  // outside the editor.
  const NARROW_CELL = 156; // (360 − 2×16 − 16) / 2
  const WIDE_CELL = 368; // (800 − 2×24 − 16) / 2

  beforeEach(() => {
    windowWidth = 360;
  });

  /** All flow cards in document (render) order — View-scoped: props
   *  searches in react-test-renderer double-count composite + host. */
  const flowCardIds = (renderer: TestRenderer.ReactTestRenderer): string[] =>
    renderer.root
      .findAllByType(View)
      .map(view => view.props.testID)
      .filter(
        (id): id is string =>
          typeof id === 'string' && id.startsWith('dashboard-flow-card-'),
      );

  /** Any retired stacked-reflow card (must never render again). */
  const stackedCards = (renderer: TestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByType(View).filter(view => {
      const id = view.props.testID;
      return typeof id === 'string' && id.startsWith('dashboard-stacked-card-');
    });

  const fireNarrowLayout = async (
    renderer: TestRenderer.ReactTestRenderer,
    width = 360,
  ) => {
    await act(async () => {
      renderer.root.findByProps({ testID: 'dashboard-canvas' }).props.onLayout({
        nativeEvent: { layout: { width, height: 600 } },
      });
    });
  };

  /** An all-switch template (one devices section — one flow mapping). */
  function switchTemplate(
    specs: readonly {
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly width?: 1 | 2;
    }[],
  ): DashboardTemplate {
    return {
      id: 'tpl-narrow',
      name: 'Hẹp',
      updatedAt: 0,
      rooms: [
        {
          roomId: 'room-living',
          order: 0,
          widgets: specs.map(spec => ({
            id: spec.id,
            type: 'switch',
            roomId: 'room-living',
            binding: { deviceId: `relay-${spec.id}`, capability: 'switch' },
            layout: {
              x: spec.x,
              y: spec.y,
              width: spec.width ?? 1,
              height: 1,
            },
          })),
        },
      ],
    };
  }

  it('renders the two-column flow, not full-width stacked cards', async () => {
    const renderer = renderScreen(seedTemplate());
    await fireNarrowLayout(renderer);

    // NO stacked-reflow card exists anywhere in the tree.
    expect(stackedCards(renderer)).toHaveLength(0);

    // The seed's 5 cards render as FLOW cards at the NARROW column width
    // (~156pt) with their per-type floors — the two-column mapping, not
    // one full-width card per row.
    const cards = renderer.root
      .findAllByType(View)
      .filter(view => {
        const flat = flatStyles(view.props.style);
        return flat.width === NARROW_CELL;
      })
      .filter(view =>
        [136, 92].includes(flatStyles(view.props.style).minHeight as number),
      );
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      const flat = flatStyles(card.props.style);
      expect(flat.left).toBeUndefined();
      expect(flat.top).toBeUndefined();
      expect(flat.position).toBeUndefined();
    }

    // The flow container owns the NARROW smart inset (16 — AD-3) + the
    // 16pt row gap.
    expect(
      viewsWithStyle(renderer.root, { padding: 16, rowGap: 16 }).length,
    ).toBeGreaterThanOrEqual(1);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('spans a persisted width-2 widget across the full flow row at narrow AND wide', async () => {
    // The user's 2x1 resize must be visible outside the editor at EVERY
    // canvas width (AD-2).
    const template = switchTemplate([{ id: 'w-wide', x: 0, y: 0, width: 2 }]);

    const narrow = renderScreen(template);
    await fireNarrowLayout(narrow);
    const narrowCard = flatStyles(
      narrow.root.findByProps({ testID: 'dashboard-flow-card-w-wide' }).props
        .style,
    );
    expect(narrowCard.width).toBe(2 * NARROW_CELL + 16);
    await act(async () => {
      narrow.unmount();
    });

    windowWidth = 800;
    const wide = renderScreen(template);
    await fireNarrowLayout(wide, 800);
    const wideCard = flatStyles(
      wide.root.findByProps({ testID: 'dashboard-flow-card-w-wide' }).props
        .style,
    );
    expect(wideCard.width).toBe(2 * WIDE_CELL + 16);
    await act(async () => {
      wide.unmount();
    });
  });

  it('reorders the view when a widget changes its persisted row', async () => {
    // a is persisted on row 2 → the flow (persisted-row order) is
    // [b, c, a]; after dragging a to row 0 the flow is [[a, b], [c]] —
    // document order [a, b, c]. The drag is visible outside the editor.
    const before = renderScreen(
      switchTemplate([
        { id: 'w-a', x: 0, y: 2 },
        { id: 'w-b', x: 1, y: 0 },
        { id: 'w-c', x: 0, y: 1 },
      ]),
    );
    await fireNarrowLayout(before);
    expect(flowCardIds(before)).toEqual([
      'dashboard-flow-card-w-b',
      'dashboard-flow-card-w-c',
      'dashboard-flow-card-w-a',
    ]);
    await act(async () => {
      before.unmount();
    });

    const after = renderScreen(
      switchTemplate([
        { id: 'w-a', x: 0, y: 0 },
        { id: 'w-b', x: 1, y: 0 },
        { id: 'w-c', x: 0, y: 1 },
      ]),
    );
    await fireNarrowLayout(after);
    expect(flowCardIds(after)).toEqual([
      'dashboard-flow-card-w-a',
      'dashboard-flow-card-w-b',
      'dashboard-flow-card-w-c',
    ]);
    await act(async () => {
      after.unmount();
    });
  });

  it('keeps 1-wide cards in their persisted column (left/right)', async () => {
    // A card persisted at x=1 on a narrow canvas keeps the RIGHT column:
    // the flow row renders the invisible left spacer (column width) then
    // the card — WYSIWYG with the editor's columns.
    const renderer = renderScreen(
      switchTemplate([{ id: 'w-right', x: 1, y: 0 }]),
    );
    await fireNarrowLayout(renderer);
    expect(stackedCards(renderer)).toHaveLength(0);

    const columnViews = renderer.root
      .findAllByType(View)
      .filter(view => flatStyles(view.props.style).width === NARROW_CELL);
    // The column-width views: the left SPACER + the card itself.
    expect(columnViews).toHaveLength(2);
    expect(columnViews[0]!.props.testID).toBeUndefined();
    expect(columnViews[1]!.props.testID).toBe('dashboard-flow-card-w-right');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('DashboardScreen header band + badge (scope amendment 3)', () => {
  beforeEach(() => {
    windowWidth = 1000; // wide canvas → the band alignment matters
  });

  it('constrains the header to the SAME centered 880 band as the cards', async () => {
    const renderer = renderScreen(seedTemplate());
    // The header row is capped at the smart content width and centered,
    // so menu + room name + connection chip align with the card edges.
    const header = renderer.root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return (
        flat.maxWidth === SMART_VIEW_MAX_CONTENT_WIDTH &&
        flat.flexDirection === 'row'
      );
    });
    expect(header).toBeTruthy();
    const flat = flatStyles(header!.props.style);
    expect(flat.alignSelf).toBe('center');
    expect(flat.width).toBe('100%');
    // The band owns the header content (menu + chip live inside it).
    expect(header!.findByProps({ testID: 'dashboard-room-menu' })).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the connection badge slightly larger (text 13, a bit more padding)', async () => {
    const renderer = renderScreen(seedTemplate());
    const badgeText = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === STRINGS.dashboard.connConnected);
    expect(badgeText).toBeTruthy();
    expect(flatStyles(badgeText!.props.style).fontSize).toBe(13);
    const chip = renderer.root.findAllByType(View).find(view => {
      const flat = flatStyles(view.props.style);
      return flat.borderRadius === 999 && flat.flexDirection === 'row';
    });
    expect(chip).toBeTruthy();
    const chipStyle = flatStyles(chip!.props.style);
    expect(chipStyle.paddingHorizontal).toBe(12);
    expect(chipStyle.paddingVertical).toBe(6);
    await act(async () => {
      renderer.unmount();
    });
  });
});
