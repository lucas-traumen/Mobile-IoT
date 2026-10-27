/**
 * RoomDashboardScreen tests (scope amendment 1 — smart visual sync, fix
 * cycle 2).
 *
 * Verifies the Settings room preview is WYSIWYG with the Dashboard view:
 * - AMBIENT PAGE: the same diagonal Smart Home wash (LinearGradient
 *   tealTint → page → amberTint from the active theme's `smart` tokens) in
 *   light AND dark,
 * - SMART CARDS: the section grids render the `'smart'` card recipe —
 *   smart card surface + hairline smart border + `smart.radius.card` token
 *   radius — in light AND dark (the former `'gel'` recipe is gone; the
 *   neutral editor surface never leaks into the view),
 * - SMART SECTION LABELS: small secondary text (no gel pill),
 * - GROWTH-SAFE FLOW: the wide canvas renders the two-column flow (no
 *   absolute card slots, per-type minHeight floors),
 * - HEADER AFFORDANCES UNCHANGED: back button + room name + Template name
 *   + `Chỉnh sửa` — same testIDs, labels and behavior as before the
 *   reskin.
 */

import React from 'react';
import { Dimensions, Text, View } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';
import { Errors, err, ok } from '@core/errors';
import type { CapabilityDef, Room, SeriesPoint } from '@modules/devices/api';
import {
  createDefaultRegistry,
  type WidgetConnectionState,
  type WidgetServices,
} from '@modules/widgets/api';

import { defaultDashboardsFile } from '../internal/domain/seeds';
import { SMART_VIEW_MAX_CONTENT_WIDTH } from '../internal/domain/gridMetrics';
import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import { RoomDashboardScreen } from './RoomDashboardScreen';

// The widgets facade transitively requires AsyncStorage (devices api).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const ROOMS: readonly Room[] = [
  { id: 'room-living', name: 'Phòng khách', order: 0, icon: 'home-outline' },
];

const CATALOG: readonly CapabilityDef[] = [
  {
    type: 'temperature',
    label: 'Nhiệt độ',
    kind: 'sensor',
    unit: '°C',
    icon: 'thermometer-outline',
  },
  {
    type: 'humidity',
    label: 'Độ ẩm',
    kind: 'sensor',
    unit: '%',
    icon: 'water-outline',
  },
  // The switch def deliberately carries NO icon: the switch widget then
  // proves the DEVICE glyph wins over the 'power-outline' default.
  { type: 'switch', label: 'Công tắc', kind: 'switch' },
];

/** Stable snapshot — `useSyncExternalStore` requires identity stability. */
const STABLE_STATE = { value: 24.5, updatedAt: 1000 };
const NO_SERIES: readonly SeriesPoint[] = [];

const DEVICES = [
  {
    id: 'sensor-temp-01',
    name: 'Cảm biến nhiệt',
    roomId: 'room-living',
    type: 'sensor',
    capabilities: ['temperature', 'humidity'],
    binding: { kind: 'telemetry-sensor' } as const,
  },
  {
    id: 'relay-1',
    name: 'Đèn',
    roomId: 'room-living',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 1 } as const,
  },
];

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
    getDevices: () => DEVICES,
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
 * fallback, so tests control the presentation mode through it.
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

/** The seed Template (room-living: 2 sensors + 2 switches). */
function seedTemplate(): DashboardTemplate {
  return defaultDashboardsFile().templates[0]!;
}

function renderScreen(mode: 'light' | 'dark' = 'light') {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <RoomDashboardScreen
          template={seedTemplate()}
          roomId="room-living"
          rooms={ROOMS}
          registry={createDefaultRegistry()}
          services={makeServices()}
          onBack={jest.fn()}
          onEdit={jest.fn()}
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

describe('RoomDashboardScreen ambient page (smart tokens — WYSIWYG with the Dashboard view)', () => {
  it('renders the diagonal teal→page→amber wash (light)', async () => {
    const renderer = renderScreen('light');
    const gradient = renderer.root.findByType(LinearGradient);
    expect(gradient.props.colors).toEqual([
      LIGHT_TOKENS.smart.colors.tealTint,
      LIGHT_TOKENS.smart.colors.page,
      LIGHT_TOKENS.smart.colors.amberTint,
    ]);
    expect(gradient.props.start).toEqual({ x: 0, y: 0 });
    expect(gradient.props.end).toEqual({ x: 1, y: 1 });
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the dark-theme wash when the active theme is dark', async () => {
    const renderer = renderScreen('dark');
    expect(renderer.root.findByType(LinearGradient).props.colors).toEqual([
      DARK_TOKENS.smart.colors.tealTint,
      DARK_TOKENS.smart.colors.page,
      DARK_TOKENS.smart.colors.amberTint,
    ]);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('RoomDashboardScreen smart cards (former gel preview — scope amendment 1)', () => {
  it('renders the smart card surface + hairline border + token radius (light AND dark)', async () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = renderScreen(mode);
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
        }).length,
      ).toBeGreaterThan(0);
      expect(
        viewsWithStyle(renderer.root, {
          borderRadius: tokens.smart.radius.card,
          backgroundColor: tokens.smart.colors.card,
        }).length,
      ).toBeGreaterThan(0);
      // The neutral editor surface never leaks into the view.
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        }),
      ).toHaveLength(0);
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('renders smart section labels (small secondary text, no gel pill)', async () => {
    const renderer = renderScreen('light');
    const label = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === STRINGS.dashboard.environment);
    expect(label).toBeTruthy();
    const style = flatStyles(label!.props.style);
    expect(style.color).toBe(LIGHT_TOKENS.smart.colors.textSecondary);
    expect(style.backgroundColor).toBeUndefined();
    const devicesLabel = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === STRINGS.dashboard.devices);
    expect(devicesLabel).toBeTruthy();
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the header title/subtitle on the smart text tokens (settings-smart-home-sync)', async () => {
    const renderer = renderScreen('light');
    const title = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Phòng khách');
    expect(title).toBeTruthy();
    const titleStyle = flatStyles(title!.props.style);
    expect(titleStyle.color).toBe(LIGHT_TOKENS.smart.colors.textPrimary);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the growth-safe wide flow (no absolute slots, per-type floors)', async () => {
    const renderer = renderScreen('light');
    // Cards carry the per-type minHeight floors (sensor 136 / switch 92 —
    // amendment-2 compact floors) and NO absolute positioning — the flow
    // reflows grown content.
    const floors = [
      ...viewsWithStyle(renderer.root, { minHeight: 136 }),
      ...viewsWithStyle(renderer.root, { minHeight: 92 }),
    ];
    expect(floors).toHaveLength(5);
    for (const card of floors) {
      const flat = flatStyles(card.props.style);
      expect(flat.position).toBeUndefined();
      expect(flat.top).toBeUndefined();
      expect(flat.left).toBeUndefined();
      expect(flat.height).toBeUndefined();
    }
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('RoomDashboardScreen header affordances (unchanged by the reskin)', () => {
  it('keeps back + room name + Template name + Chỉnh sửa', async () => {
    const renderer = renderScreen('light');
    const back = renderer.root.findByProps({
      testID: 'room-dashboard-back',
    });
    expect(back.props.accessibilityLabel).toBe(STRINGS.settings.back);
    const edit = renderer.root.findByProps({ testID: 'room-dashboard-edit' });
    expect(edit.props.accessibilityLabel).toBe(STRINGS.templates.editRoom);
    // The room name + Template name render in the header.
    const texts = renderer.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .filter((child): child is string => typeof child === 'string');
    expect(texts).toContain('Phòng khách');
    expect(texts).toContain(seedTemplate().name);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('wires the header affordances to the navigation props (behavior unchanged)', async () => {
    const onBack = jest.fn();
    const onEdit = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <RoomDashboardScreen
            template={seedTemplate()}
            roomId="room-living"
            rooms={ROOMS}
            registry={createDefaultRegistry()}
            services={makeServices()}
            onBack={onBack}
            onEdit={onEdit}
          />
        </ThemeProvider>,
      );
    });
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'room-dashboard-back' })
        .props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'room-dashboard-edit' })
        .props.onPress();
    });
    expect(onEdit).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('RoomDashboardScreen amendment-2 settings sync (icons, captions, dash, spacing)', () => {
  /**
   * The seed room-living layout: sensor-temp-01 + sensor-hum-01 sensors,
   * relay-1 (Đèn) + relay-2 (Quạt) + relay-3 (Bơm) switches. This fixture
   * mirrors the device seeds (per-device glyphs; Bơm deliberately carries
   * NO icon — the capability fallback) and controls the state/connection
   * seams so the amendment-2 renderings are provable ON THE PREVIEW.
   */
  const SYNC_DEVICES = [
    {
      id: 'sensor-temp-01',
      name: 'Cảm biến nhiệt',
      roomId: 'room-living',
      type: 'sensor',
      capabilities: ['temperature', 'humidity'],
      binding: { kind: 'telemetry-sensor' } as const,
    },
    {
      id: 'relay-1',
      name: 'Đèn',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      icon: 'bulb-outline',
      binding: { kind: 'relay', index: 1 } as const,
    },
    {
      id: 'relay-2',
      name: 'Quạt',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      // Scope amendment 3: the REAL fan glyph (MaterialCommunityIcons).
      icon: 'fan',
      binding: { kind: 'relay', index: 2 } as const,
    },
    {
      id: 'relay-3',
      name: 'Bơm',
      roomId: 'room-living',
      type: 'relay',
      capabilities: ['switch'],
      // The capability fallback: NO per-device glyph (the seed design).
      binding: { kind: 'relay', index: 3 } as const,
    },
  ];

  const makeSyncServices = (options: {
    /** Connection state (default connected). */
    connection?: 'connected' | 'failed';
    /** Whether sensors have observations (default true). */
    sensorState?: boolean;
    /** Whether switches have confirmed state (default true=OFF). */
    switchState?: boolean;
  }): WidgetServices => {
    const connectionState: WidgetConnectionState['state'] =
      options.connection ?? 'connected';
    const connection = {
      state: connectionState,
      label: options.connection === 'failed' ? 'Mất kết nối' : 'Đã kết nối',
    };
    const sensorValue =
      options.sensorState === false ? undefined : STABLE_STATE;
    const switchValue =
      options.switchState === false ? undefined : STABLE_STATE;
    return {
      getState: (_deviceId, capability) =>
        capability === 'switch' ? switchValue : sensorValue,
      getSeries: () => NO_SERIES,
      sendCommand: () => err(Errors.unknown('not wired')),
      queryHistory: async () => ok([]),
      getRooms: () => ROOMS,
      getDevices: () => SYNC_DEVICES,
      getCapabilities: () => CATALOG,
      getActiveRoomId: () => 'room-living',
      subscribeDeviceState: () => () => undefined,
      getConnectionState: () => connection,
      getCommandError: () => null,
      subscribeConnection: () => () => undefined,
    };
  };

  const renderSyncScreen = (
    services: WidgetServices,
    mode: 'light' | 'dark' = 'light',
  ) => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ThemeProvider mode={mode}>
          <RoomDashboardScreen
            template={seedTemplate()}
            roomId="room-living"
            rooms={ROOMS}
            registry={createDefaultRegistry()}
            services={services}
            onBack={jest.fn()}
            onEdit={jest.fn()}
          />
        </ThemeProvider>,
      );
    });
    return renderer;
  };

  it('renders the per-DEVICE glyphs on the preview (Đèn bulb / Quạt MCI fan / Bơm fallback)', () => {
    const renderer = renderSyncScreen(makeSyncServices({}));
    const glyphs = renderer.root
      .findAllByType(Ionicons)
      .map(node => node.props.name as string);
    // The switch cards resolve the per-device glyphs (the switch catalog
    // def carries NO icon — the fallback would be 'power-outline').
    expect(glyphs).toContain('bulb-outline');
    // Đèn (bulb) and Quạt (fan) win over the default; Bơm (relay-3, no
    // per-device glyph by seed design) renders EXACTLY the 'power-outline'
    // capability fallback — once.
    expect(glyphs.filter(name => name === 'power-outline')).toHaveLength(1);
    expect(glyphs).toContain('thermometer-outline');
    // Scope amendment 3: Quạt's `fan` renders through ITS family —
    // MaterialCommunityIcons — never as an Ionicons glyph.
    const mci = renderer.root
      .findAllByType(MaterialCommunityIcons)
      .map(node => node.props.name as string);
    expect(mci).toContain('fan');
    expect(glyphs).not.toContain('fan');
    renderer.unmount();
  });

  it('renders the offline lock caption + disabled switches when disconnected', () => {
    const renderer = renderSyncScreen(
      makeSyncServices({ connection: 'failed' }),
    );
    const text = renderer.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .filter((child): child is string => typeof child === 'string')
      .join('\n');
    expect(text).toContain(STRINGS.widgets.offlineCaption);
    // Both switch widgets render DISABLED drawn controls (the drawn
    // switch replaced the platform Switch — the disabled state rides the
    // accessibility state).
    const switches = renderer.root
      .findAllByProps({ accessibilityRole: 'switch' })
      .filter(node => typeof node.props.onPress === 'function');
    expect(switches.length).toBeGreaterThanOrEqual(2);
    for (const node of switches) {
      expect(node.props.disabled).toBe(true);
    }
    renderer.unmount();
  });

  it('renders the visible unknown caption for switches with no confirmed state', () => {
    const renderer = renderSyncScreen(makeSyncServices({ switchState: false }));
    const text = renderer.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .filter((child): child is string => typeof child === 'string')
      .join('\n');
    expect(text).toContain(STRINGS.widgets.unknownCaption);
    expect(text).not.toContain(STRINGS.widgets.offlineCaption);
    renderer.unmount();
  });

  it('renders the sensor dash as muted normal text when no observation exists', () => {
    const renderer = renderSyncScreen(makeSyncServices({ sensorState: false }));
    const text = renderer.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .filter((child): child is string => typeof child === 'string')
      .join('\n');
    expect(text).toContain(STRINGS.dashboard.sensorNoData);
    // The dash renders (muted style asserted at the widget level); the
    // preview shows the truthful no-value state.
    expect(text).toContain('—');
    renderer.unmount();
  });

  it('keeps the amendment-2 label→card spacing (label owns the gap)', () => {
    const renderer = renderSyncScreen(makeSyncServices({}));
    // The section labels own the 16pt gap (marginBottom 16)…
    const labels = renderer.root.findAllByType(Text).filter(node => {
      const flat = flatStyles(node.props.style);
      return flat.marginBottom === 16;
    });
    expect(labels.length).toBeGreaterThanOrEqual(2);
    // …and the smart flow containers carry NO top padding (absorbed).
    const paddedFlow = viewsWithStyle(renderer.root, {
      paddingTop: 16,
    }).filter(view => flatStyles(view.props.style).rowGap === 16);
    expect(paddedFlow).toHaveLength(0);
    renderer.unmount();
  });
});

describe('RoomDashboardScreen header band (scope amendment 3 — coherence)', () => {
  it('constrains the header to the SAME centered 880 band as the content', () => {
    const renderer = renderScreen();
    // The header row is capped at the smart content width and centered —
    // coherent with the Dashboard tab's header band. The affordances are
    // unchanged (back + name + Chỉnh sửa still inside it).
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
    expect(header!.findByProps({ testID: 'room-dashboard-back' })).toBeTruthy();
    expect(header!.findByProps({ testID: 'room-dashboard-edit' })).toBeTruthy();
    renderer.unmount();
  });
});

describe('RoomDashboardScreen 44pt touch targets (dashboard-history-board-touch-share)', () => {
  it('the back button carries explicit ≥44×44 hit bounds (not hitSlop)', () => {
    const renderer = renderScreen('light');
    const back = renderer.root.findByProps({ testID: 'room-dashboard-back' });
    const flat = flatStyles(back.props.style);
    expect(typeof flat.minWidth).toBe('number');
    expect(flat.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof flat.minHeight).toBe('number');
    expect(flat.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});

describe('RoomDashboardScreen narrow canvas (WYSIWYG two-column flow at every width)', () => {
  // The ~360dp phone band (dashboard-view-wysiwyg-two-column): the room
  // view renders the SAME two-column smart flow as wide canvases — the
  // stacked full-width reflow never renders again.
  const NARROW_CELL = 156; // (360 − 2×16 − 16) / 2

  beforeEach(() => {
    windowWidth = 360;
  });

  afterAll(() => {
    windowWidth = 800;
  });

  it('renders the two-column flow, not full-width stacked cards, at ~360dp', async () => {
    const renderer = renderScreen('light');

    // No retired stacked-reflow card exists anywhere in the tree
    // (View-scoped: props searches in react-test-renderer double-count
    // composite + host).
    expect(
      renderer.root.findAllByType(View).filter(view => {
        const id = view.props.testID;
        return (
          typeof id === 'string' && id.startsWith('dashboard-stacked-card-')
        );
      }),
    ).toHaveLength(0);

    // The seed's 5 cards render as FLOW cards at the NARROW column width
    // with their per-type floors, inside the narrow-inset (16) flow
    // container — the same mapping wide canvases use.
    const cards = renderer.root.findAllByType(View).filter(view => {
      const flat = flatStyles(view.props.style);
      return (
        flat.width === NARROW_CELL &&
        [136, 92].includes(flat.minHeight as number)
      );
    });
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      const flat = flatStyles(card.props.style);
      expect(flat.left).toBeUndefined();
      expect(flat.top).toBeUndefined();
      expect(flat.position).toBeUndefined();
    }
    expect(
      viewsWithStyle(renderer.root, { padding: 16, rowGap: 16 }).length,
    ).toBeGreaterThanOrEqual(1);
    await act(async () => {
      renderer.unmount();
    });
  });
});
