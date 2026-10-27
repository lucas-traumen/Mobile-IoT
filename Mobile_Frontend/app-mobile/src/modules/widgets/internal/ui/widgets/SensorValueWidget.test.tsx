/**
 * SensorValueWidget tests (dashboard-smart-home-redesign anatomy).
 *
 * Verifies the approved Smart Home card anatomy WITHOUT touching the
 * numeric/query contracts:
 * - Vietnamese decimal display formatting: `28.5` renders as `28,5` (comma
 *   separator) — the pure `formatVietnameseValue` helper is display-only,
 * - no observation → the em-dash placeholder + the truthful "Chưa có dữ
 *   liệu" status line (live behavior intact),
 * - the status line renders the newest observation's wall-clock time
 *   ("Đã cập nhật HH:MM") from the live state entry — no invented
 *   thresholds, no mock numbers,
 * - the big reading + unit use the capability SEMANTIC ACCENT (theme
 *   temperature/humidity tokens — now teal/amber per D2; catalog color for
 *   custom capabilities),
 * - the label is MUTED (textSecondary) beside the soft icon chip,
 * - the sparkline and the 1h-delta caption are REMOVED (approved): full
 *   charts belong to the History tab — even for wide (2x1) layouts with a
 *   populated series.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Polyline } from 'react-native-svg';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';
import type {
  CapabilityDef,
  Device,
  DeviceCapabilityValue,
  Room,
  SeriesPoint,
} from '@modules/devices/api';
import { Errors, err, ok } from '@core/errors';

import type { WidgetConfig } from '../../domain/widgetTypes';
import { WidgetServicesProvider, type WidgetServices } from '../widgetContext';
import { formatVietnameseValue, SensorValueWidget } from './SensorValueWidget';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

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
  {
    type: 'pressure',
    label: 'Áp suất',
    kind: 'sensor',
    unit: 'hPa',
    color: '#123456',
    icon: 'speedometer-outline',
  },
];

const ROOMS: readonly Room[] = [
  { id: 'room-l', name: 'Phòng', order: 0, icon: 'home-outline' },
];

/** Seed-shaped devices for the per-device glyph tests (amendment 2). */
const DEVICES: readonly Device[] = [
  {
    id: 'sensor-lamp',
    name: 'Đèn cảm biến',
    roomId: 'room-l',
    type: 'sensor',
    capabilities: ['temperature'],
    icon: 'thermometer-outline',
    binding: { kind: 'telemetry-sensor' },
  },
  {
    id: 'sensor-fan',
    name: 'Quạt cảm biến',
    roomId: 'room-l',
    type: 'sensor',
    capabilities: ['temperature'],
    // Scope amendment 3: the REAL fan glyph (MaterialCommunityIcons).
    icon: 'fan',
    binding: { kind: 'telemetry-sensor' },
  },
];

const HOUR = 3_600_000;

const CONFIG: WidgetConfig = {
  id: 'w-temp',
  type: 'sensor-value',
  binding: { deviceId: 'sensor-01', capability: 'temperature' },
  layout: { x: 0, y: 0, width: 1, height: 1 },
};

/**
 * Controllable services: one stable state snapshot (`updatedAt` feeds the
 * status line) + an optional series (the widget must IGNORE it after the
 * sparkline removal — `useSyncExternalStore` requires identity stability).
 * The connection seam carries a stable connected snapshot (the amendment-2
 * offline lock applies to switch widgets only).
 */
function makeServices(options: {
  value?: number;
  updatedAt?: number;
  series?: readonly SeriesPoint[];
  devices?: readonly Device[];
}): WidgetServices {
  const state: DeviceCapabilityValue | undefined =
    options.value === undefined
      ? undefined
      : { value: options.value, updatedAt: options.updatedAt ?? 1000 };
  const series: readonly SeriesPoint[] = options.series ?? [];
  const connection = { state: 'connected' as const, label: 'Đã kết nối' };
  return {
    getState: () => state,
    getSeries: () => series,
    sendCommand: () => err(Errors.unknown('not wired')),
    queryHistory: async () => ok([]),
    getRooms: () => ROOMS,
    getDevices: () => options.devices ?? DEVICES,
    getCapabilities: () => CATALOG,
    getActiveRoomId: () => 'room-l',
    subscribeDeviceState: () => () => undefined,
    getConnectionState: () => connection,
    getCommandError: () => null,
    subscribeConnection: () => () => undefined,
  };
}

async function renderSensor(
  config: WidgetConfig,
  services: WidgetServices,
  mode: 'light' | 'dark' = 'light',
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <WidgetServicesProvider services={services}>
          <SensorValueWidget config={config} />
        </WidgetServicesProvider>
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

/** Deep-collect the text strings rendered under a node (RN nests Texts). */
function textOf(node: ReactTestInstance): string {
  return (node.children as unknown[])
    .map(child => {
      if (typeof child === 'string') {
        return child;
      }
      if (typeof child === 'number') {
        return String(child);
      }
      if (Array.isArray(child)) {
        return child.map(String).join('');
      }
      return textOf(child as ReactTestInstance);
    })
    .join('');
}

/** All text rendered by the widget (deep). */
function allText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType(Text).map(textOf).join('\n');
}

describe('formatVietnameseValue (pure display formatting)', () => {
  it('formats one-decimal values with a comma decimal separator', () => {
    expect(formatVietnameseValue(28.5)).toBe('28,5');
    expect(formatVietnameseValue(65)).toBe('65,0');
    expect(formatVietnameseValue(-1.25)).toBe('-1,3');
    expect(formatVietnameseValue(0)).toBe('0,0');
  });

  it('renders the em-dash placeholder for non-finite input', () => {
    expect(formatVietnameseValue(NaN)).toBe('—');
    expect(formatVietnameseValue(Infinity)).toBe('—');
  });

  it('is display-only (numeric input is untouched)', () => {
    const value = 28.5;
    expect(formatVietnameseValue(value)).toBe('28,5');
    expect(value).toBe(28.5);
  });
});

describe('SensorValueWidget display (Vietnamese decimal)', () => {
  it('renders 28,5 (comma) for a 28.5 reading — never a dot', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({ value: 28.5 }));
    const text = allText(renderer);
    expect(text).toContain('28,5');
    expect(text).not.toContain('28.5');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the live placeholder when no observation exists', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({}));
    expect(allText(renderer)).toContain('—');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('colors the value + unit with the semantic capability accent', async () => {
    const temp = await renderSensor(CONFIG, makeServices({ value: 28.5 }));
    const valueNode = temp.root
      .findAllByType(Text)
      .find(node => node.props.children === '28,5');
    expect(flatStyles(valueNode!.props.style).color).toBe(
      LIGHT_TOKENS.temperature,
    );
    await act(async () => {
      temp.unmount();
    });

    const humidity = await renderSensor(
      {
        ...CONFIG,
        binding: { deviceId: 'sensor-01', capability: 'humidity' },
      },
      makeServices({ value: 65 }),
    );
    const humNode = humidity.root
      .findAllByType(Text)
      .find(node => node.props.children === '65,0');
    expect(flatStyles(humNode!.props.style).color).toBe(LIGHT_TOKENS.humidity);
    await act(async () => {
      humidity.unmount();
    });
  });

  it('uses the catalog color as the accent for custom capabilities', async () => {
    const renderer = await renderSensor(
      {
        ...CONFIG,
        binding: { deviceId: 'sensor-01', capability: 'pressure' },
      },
      makeServices({ value: 1013 }),
    );
    const valueNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === '1013,0');
    expect(flatStyles(valueNode!.props.style).color).toBe('#123456');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders a MUTED label (smart textSecondary) next to the icon chip', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({ value: 28.5 }));
    const labelNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Nhiệt độ');
    expect(flatStyles(labelNode!.props.style).color).toBe(
      LIGHT_TOKENS.smart.colors.textSecondary,
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SensorValueWidget status line (live update time)', () => {
  it('renders "Đã cập nhật HH:MM" from the live state timestamp', async () => {
    const renderer = await renderSensor(
      CONFIG,
      makeServices({ value: 28.5, updatedAt: 1000 }),
    );
    const text = allText(renderer);
    expect(text).toContain('Đã cập nhật');
    // The pattern is exactly "Đã cập nhật HH:MM" (2-digit hour + minute).
    expect(text).toMatch(/Đã cập nhật \d{2}:\d{2}/);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders the truthful "Chưa có dữ liệu" when no observation exists', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({}));
    const text = allText(renderer);
    expect(text).toContain(STRINGS.dashboard.sensorNoData);
    expect(text).not.toContain('Đã cập nhật');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('never invents an update time (no status number without state)', async () => {
    // No state → the em-dash placeholder + the no-data line, nothing else.
    const renderer = await renderSensor(CONFIG, makeServices({}));
    const text = allText(renderer);
    expect(text).not.toMatch(/\d{2}:\d{2}/);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SensorValueWidget sparkline/delta removal (approved)', () => {
  it('renders no sparkline (no SVG polylines) in any layout', async () => {
    const series: readonly SeriesPoint[] = [
      { value: 27.9, ts: 1000 },
      { value: 28.2, ts: 1000 + 900_000 },
      { value: 28.5, ts: 1000 + HOUR },
    ];
    for (const width of [1, 2] as const) {
      const renderer = await renderSensor(
        { ...CONFIG, layout: { x: 0, y: 0, width, height: 1 } },
        makeServices({ value: 28.5, series }),
      );
      expect(renderer.root.findAllByType(Polyline)).toHaveLength(0);
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it('renders no 1h-delta caption even with a populated series', async () => {
    const series: readonly SeriesPoint[] = [
      { value: 28.1, ts: 1000 },
      { value: 28.5, ts: 1000 + HOUR },
    ];
    const renderer = await renderSensor(
      CONFIG,
      makeServices({ value: 28.5, series }),
    );
    const text = allText(renderer);
    expect(text).not.toContain(STRINGS.dashboard.deltaVsHourAgo);
    expect(text).not.toContain('↑');
    expect(text).not.toContain('↓');
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SensorValueWidget reflow (no data-hiding clamps — fix cycle 1)', () => {
  it('carries NO numberOfLines clamp on any text (font-scale reflow)', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({ value: 28.5 }));
    const texts = renderer.root.findAllByType(Text);
    // Title, reading, unit and status line — none may clamp.
    expect(texts.length).toBeGreaterThanOrEqual(4);
    for (const node of texts) {
      expect(node.props.numberOfLines).toBeUndefined();
    }
    await act(async () => {
      renderer.unmount();
    });
  });

  it('renders a LONG custom title and status in full (nothing truncated)', async () => {
    const LONG_TITLE =
      'Nhiệt độ phòng khách lớn khu vực bàn ăn cạnh cửa sổ hướng vườn';
    const renderer = await renderSensor(
      { ...CONFIG, title: LONG_TITLE },
      makeServices({ value: 28.5, updatedAt: 1000 }),
    );
    const text = allText(renderer);
    expect(text).toContain(LONG_TITLE);
    expect(text).toMatch(/Đã cập nhật \d{2}:\d{2}/);
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SensorValueWidget dark-mode smart anatomy (rendered values)', () => {
  it('renders the dark accent, muted status and page-tinted chip', async () => {
    const renderer = await renderSensor(
      CONFIG,
      makeServices({ value: 28.5, updatedAt: 1000 }),
      'dark',
    );
    // The big reading uses the dark temperature accent (D2 teal).
    const valueNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === '28,5');
    expect(flatStyles(valueNode!.props.style).color).toBe(
      DARK_TOKENS.temperature,
    );
    // The status line is muted with the dark textSecondary.
    const statusNode = renderer.root
      .findAllByType(Text)
      .find(
        node =>
          typeof node.props.children === 'string' &&
          (node.props.children as string).startsWith('Đã cập nhật'),
      );
    expect(flatStyles(statusNode!.props.style).color).toBe(
      DARK_TOKENS.smart.colors.textSecondary,
    );
    // The icon chip sits on the dark smart page tint with the dark border.
    const chipNode = renderer.root.findAllByType(View).find(view => {
      const style = flatStyles(view.props.style);
      return (
        style.width === 40 &&
        style.height === 40 &&
        style.borderColor === DARK_TOKENS.smart.colors.cardBorder
      );
    });
    expect(flatStyles(chipNode!.props.style).backgroundColor).toBe(
      DARK_TOKENS.smart.colors.page,
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SensorValueWidget no-value dash (scope amendments 2–3)', () => {
  it('renders the dash as NORMAL secondary text at the 28–32 token — not the accent style', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({}));
    const dashNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === '—');
    const style = flatStyles(dashNode!.props.style);
    // Secondary color, the `sensorNoDataValue` token (amendment 3: 28–32).
    expect(style.color).toBe(LIGHT_TOKENS.smart.colors.textSecondary);
    expect(style.fontSize).toBe(
      LIGHT_TOKENS.smart.typography.sensorNoDataValue,
    );
    expect(style.fontSize).toBeGreaterThanOrEqual(28);
    expect(style.fontSize).toBeLessThanOrEqual(32);
    expect(style.fontSize).toBeLessThan(
      LIGHT_TOKENS.smart.typography.sensorValue,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the unit smaller than the dash (baseline "— °C" pair)', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({}));
    const unitNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === '°C');
    expect(flatStyles(unitNode!.props.style).color).toBe(
      LIGHT_TOKENS.smart.colors.textSecondary,
    );
    // The no-data unit stays the (smaller) unit token — smaller than the
    // 28–32 dash, baseline-aligned by the shared valueRow.
    expect(flatStyles(unitNode!.props.style).fontSize).toBe(
      LIGHT_TOKENS.smart.typography.unit,
    );
    expect(flatStyles(unitNode!.props.style).fontSize).toBeLessThan(
      LIGHT_TOKENS.smart.typography.sensorNoDataValue,
    );
    await act(async () => {
      renderer.unmount();
    });
  });

  it('keeps the big accent reading once an observation arrives', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({ value: 28.5 }));
    const valueNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === '28,5');
    const style = flatStyles(valueNode!.props.style);
    expect(style.color).toBe(LIGHT_TOKENS.temperature);
    expect(style.fontSize).toBe(LIGHT_TOKENS.smart.typography.sensorValue);
    await act(async () => {
      renderer.unmount();
    });
  });

  it('treats a non-finite state value as no value (muted dash, not NaN)', async () => {
    const renderer = await renderSensor(CONFIG, makeServices({ value: NaN }));
    const dashNode = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === '—');
    expect(flatStyles(dashNode!.props.style).color).toBe(
      LIGHT_TOKENS.smart.colors.textSecondary,
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});

describe('SensorValueWidget per-device glyph (scope amendments 2–3)', () => {
  it('resolves the per-device icon over the capability def icon', async () => {
    const renderer = await renderSensor(
      {
        ...CONFIG,
        binding: { deviceId: 'sensor-fan', capability: 'temperature' },
      },
      makeServices({ value: 28.5, devices: DEVICES }),
    );
    // The device icon (`fan`) beats the temperature def icon
    // ('thermometer-outline') — and renders via ITS family
    // (MaterialCommunityIcons, scope amendment 3).
    const mci = renderer.root.findAllByType(MaterialCommunityIcons);
    expect(mci).toHaveLength(1);
    expect(mci[0]!.props.name).toBe('fan');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('falls back to the capability def icon when the device has none', async () => {
    const renderer = await renderSensor(
      CONFIG,
      makeServices({ value: 28.5, devices: [] }),
    );
    expect(renderer.root.findAllByType(Ionicons)[0].props.name).toBe(
      'thermometer-outline',
    );
    await act(async () => {
      renderer.unmount();
    });
  });
});
