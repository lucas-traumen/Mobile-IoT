/**
 * Curated capability icon groups + sensor presets (typed data, approved
 * settings-information-architecture plan).
 *
 * The capability add form renders these generically: selecting an icon group
 * only switches the icon + reveals the group's suggested presets; selecting
 * a preset FILLS key/label/unit (icon selection alone never overwrites
 * user-entered text). The machine key stays immutable after creation —
 * presets only prefill the creation form.
 */

import type { CapabilityKind } from './devices';

/** One suggested sensor preset (fills key + label + unit). */
export interface CapabilityPreset {
  /** Machine key for the MQTT payload field / InfluxDB `_field`. */
  readonly key: string;
  /** Human-readable Vietnamese label. */
  readonly label: string;
  /** Display unit (optional). */
  readonly unit?: string;
}

/** An icon group: an Ionicons glyph + its curated preset suggestions. */
export interface CapabilityIconGroup {
  /** Ionicons glyph name (validated against `Ionicons.glyphMap` in the UI). */
  readonly icon: string;
  /** Vietnamese group label shown as the suggestion section title. */
  readonly label: string;
  /** Kind of capability the presets describe (suggestions are sensors). */
  readonly kind: CapabilityKind;
  readonly presets: readonly CapabilityPreset[];
}

/** Accent colors offered by the capability add form. */
export const CAPABILITY_COLORS = [
  '#e65100',
  '#00897b',
  '#1565c0',
  '#6a1b9a',
  '#2e7d32',
  '#c62828',
] as const;

/**
 * The curated icon groups with suggested presets (plan example: light →
 * `illuminance` / `Ánh sáng` / `lux`). Presets never duplicate the locked
 * built-in keys (`temperature`, `humidity`, `switch`).
 */
export const CAPABILITY_ICON_GROUPS: readonly CapabilityIconGroup[] = [
  {
    icon: 'sunny-outline',
    label: 'Ánh sáng',
    kind: 'sensor',
    presets: [
      { key: 'illuminance', label: 'Ánh sáng', unit: 'lux' },
      { key: 'uv_index', label: 'Chỉ số UV', unit: 'UV' },
    ],
  },
  {
    icon: 'thermometer-outline',
    label: 'Nhiệt',
    kind: 'sensor',
    presets: [
      { key: 'dew_point', label: 'Điểm sương', unit: '°C' },
      { key: 'heat_index', label: 'Chỉ số nhiệt', unit: '°C' },
    ],
  },
  {
    icon: 'water-outline',
    label: 'Nước & độ ẩm đất',
    kind: 'sensor',
    presets: [
      { key: 'soil_moisture', label: 'Độ ẩm đất', unit: '%' },
      { key: 'water_level', label: 'Mực nước', unit: 'cm' },
    ],
  },
  {
    icon: 'speedometer-outline',
    label: 'Áp suất',
    kind: 'sensor',
    presets: [{ key: 'pressure', label: 'Áp suất', unit: 'hPa' }],
  },
  {
    icon: 'leaf-outline',
    label: 'Chất lượng không khí',
    kind: 'sensor',
    presets: [
      { key: 'co2', label: 'CO₂', unit: 'ppm' },
      { key: 'pm25', label: 'PM2.5', unit: 'µg/m³' },
      { key: 'tvoc', label: 'TVOC', unit: 'ppb' },
    ],
  },
  {
    icon: 'flash-outline',
    label: 'Điện',
    kind: 'sensor',
    presets: [
      { key: 'voltage', label: 'Điện áp', unit: 'V' },
      { key: 'current', label: 'Dòng điện', unit: 'A' },
      { key: 'power', label: 'Công suất', unit: 'W' },
    ],
  },
  {
    icon: 'cloud-outline',
    label: 'Thời tiết',
    kind: 'sensor',
    presets: [
      { key: 'rainfall', label: 'Lượng mưa', unit: 'mm' },
      { key: 'wind_speed', label: 'Tốc độ gió', unit: 'm/s' },
    ],
  },
  {
    icon: 'pulse-outline',
    label: 'Sức khỏe',
    kind: 'sensor',
    presets: [{ key: 'heart_rate', label: 'Nhịp tim', unit: 'bpm' }],
  },
  {
    icon: 'volume-high-outline',
    label: 'Âm thanh',
    kind: 'sensor',
    presets: [{ key: 'sound_level', label: 'Mức âm thanh', unit: 'dB' }],
  },
  {
    icon: 'flame-outline',
    label: 'Khí & khói',
    kind: 'sensor',
    presets: [
      { key: 'smoke_level', label: 'Khói', unit: 'ppm' },
      { key: 'gas_leak', label: 'Rò rỉ khí', unit: 'ppm' },
    ],
  },
];
