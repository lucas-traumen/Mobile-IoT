/**
 * First-run seed data for the dashboard module (Template model).
 *
 * Approved seed: ONE Template 'Trang chủ' (id 'main') with THREE ordered
 * physical-room references — Phòng khách (`room-living`), Phòng ngủ
 * (`room-bedroom`) and Bếp (`room-kitchen`, matching the devices seed) —
 * each owning the same five-card demo layout in its OWN coordinate space
 * (per-room visibility, CP-R3): two sensor-value cards (temp + humidity,
 * 1x1 each in row 0 — the "Môi trường" band) and three switch cards bound
 * to the room's seeded relays (Đèn / Quạt / Bơm, 1x1 SIDE BY SIDE +
 * third slot in rows 1–2 — the "Thiết bị" band, contiguous behind the env
 * band per the ADR-019 section band model; no collisions). Phòng khách
 * keeps its original widget ids and positions (w-temp/w-hum/w-light/w-fan)
 * plus the demo-three-rooms w-pump; the bedroom/kitchen ids mirror the
 * `w-<room>-<card>` convention. The retired built-ins (`connection`,
 * Phase 1; `history-chart` and `room-device-list`, device-acceptance
 * rework) are not seeded, not registrable and legacy persisted instances
 * are migrated out on load (see DashboardServiceImpl). Widget ids and the
 * Template id are stable so tests can reference them.
 *
 * `updatedAt` starts at 0; the dashboard service stamps the real Clock time
 * on first load (a Template-owned creation event) and persists it — so the
 * Template list shows a truthful "last updated" from the first session on.
 *
 * `activeRoomId` defaults to `null` (the History compatibility seam has no
 * initial room selection).
 */

import { collides } from './layout';
import type { DashboardsFile } from './dashboardSchema';
import type { WidgetConfig } from '@modules/widgets/api';

/** Default Template id ('main'). */
export const DEFAULT_DASHBOARD_ID = 'main';

/** Default Template name ('Trang chủ'). */
export const DEFAULT_DASHBOARD_NAME = 'Trang chủ';

/** Seed room id for Phòng khách (matches the devices seed). */
const SEED_LIVING_ROOM_ID = 'room-living';
/** Seed room id for Phòng ngủ (matches the devices seed). */
const SEED_BEDROOM_ROOM_ID = 'room-bedroom';
/** Seed room id for Bếp (matches the devices seed). */
const SEED_KITCHEN_ROOM_ID = 'room-kitchen';

/**
 * The shared demo layout of ONE seeded room: the ids/bindings differ per
 * room (prefix + the room's own seeded devices) but the BAND SHAPE is the
 * same — 2 sensor-value cards in env row 0, 3 switch cards in devices
 * rows 1–2 (contiguous behind the env band, no collisions).
 */
function seedRoomWidgets(prefix: {
  temp: string;
  hum: string;
  light: string;
  fan: string;
  pump: string;
  tempDevice: string;
  humDevice: string;
  lightDevice: string;
  fanDevice: string;
  pumpDevice: string;
  roomId: string;
}): WidgetConfig[] {
  return [
    {
      id: prefix.temp,
      type: 'sensor-value',
      roomId: prefix.roomId,
      binding: {
        deviceId: prefix.tempDevice,
        capability: 'temperature',
      },
      layout: { x: 0, y: 0, width: 1, height: 1 },
    },
    {
      id: prefix.hum,
      type: 'sensor-value',
      roomId: prefix.roomId,
      binding: { deviceId: prefix.humDevice, capability: 'humidity' },
      layout: { x: 1, y: 0, width: 1, height: 1 },
    },
    {
      id: prefix.light,
      type: 'switch',
      roomId: prefix.roomId,
      binding: { deviceId: prefix.lightDevice, capability: 'switch' },
      layout: { x: 0, y: 1, width: 1, height: 1 },
    },
    {
      id: prefix.fan,
      type: 'switch',
      roomId: prefix.roomId,
      binding: { deviceId: prefix.fanDevice, capability: 'switch' },
      layout: { x: 1, y: 1, width: 1, height: 1 },
    },
    {
      id: prefix.pump,
      type: 'switch',
      roomId: prefix.roomId,
      binding: { deviceId: prefix.pumpDevice, capability: 'switch' },
      layout: { x: 0, y: 2, width: 1, height: 1 },
    },
  ];
}

/** Seed dashboards file used on first run (nothing persisted yet). */
export function defaultDashboardsFile(): DashboardsFile {
  return {
    templates: [
      {
        id: DEFAULT_DASHBOARD_ID,
        name: DEFAULT_DASHBOARD_NAME,
        updatedAt: 0,
        rooms: [
          {
            roomId: SEED_LIVING_ROOM_ID,
            order: 0,
            // Phòng khách keeps its original seed ids/positions + w-pump.
            widgets: seedRoomWidgets({
              roomId: SEED_LIVING_ROOM_ID,
              temp: 'w-temp',
              hum: 'w-hum',
              light: 'w-light',
              fan: 'w-fan',
              pump: 'w-pump',
              tempDevice: 'sensor-temp-01',
              humDevice: 'sensor-hum-01',
              lightDevice: 'relay-1',
              fanDevice: 'relay-2',
              pumpDevice: 'relay-3',
            }),
          },
          {
            roomId: SEED_BEDROOM_ROOM_ID,
            order: 1,
            widgets: seedRoomWidgets({
              roomId: SEED_BEDROOM_ROOM_ID,
              temp: 'w-bed-temp',
              hum: 'w-bed-hum',
              light: 'w-bed-light',
              fan: 'w-bed-fan',
              pump: 'w-bed-pump',
              tempDevice: 'sensor-temp-02',
              humDevice: 'sensor-hum-02',
              lightDevice: 'relay-4',
              fanDevice: 'relay-5',
              pumpDevice: 'relay-6',
            }),
          },
          {
            roomId: SEED_KITCHEN_ROOM_ID,
            order: 2,
            widgets: seedRoomWidgets({
              roomId: SEED_KITCHEN_ROOM_ID,
              temp: 'w-kitchen-temp',
              hum: 'w-kitchen-hum',
              light: 'w-kitchen-light',
              fan: 'w-kitchen-fan',
              pump: 'w-kitchen-pump',
              tempDevice: 'sensor-temp-03',
              humDevice: 'sensor-hum-03',
              lightDevice: 'relay-7',
              fanDevice: 'relay-8',
              pumpDevice: 'relay-9',
            }),
          },
        ],
      },
    ],
    activeId: DEFAULT_DASHBOARD_ID,
    activeRoomId: null,
  };
}

/** The legacy (pre-responsive) seed arrangement of the two relay cards. */
const LEGACY_LIGHT_LAYOUT = { x: 0, y: 1, width: 2, height: 1 } as const;
const LEGACY_FAN_LAYOUT = { x: 0, y: 2, width: 2, height: 1 } as const;

/** The approved side-by-side arrangement (normalization target). */
const NORMALIZED_LIGHT_LAYOUT = { x: 0, y: 1, width: 1, height: 1 } as const;
const NORMALIZED_FAN_LAYOUT = { x: 1, y: 1, width: 1, height: 1 } as const;

/**
 * True when `widget` is EXACTLY the untouched legacy seed relay card: the
 * seed id, the switch type, the seed binding, no custom title, and the
 * exact legacy default layout. Any difference (a moved, resized, renamed
 * or re-bound card) fails the check — user-customized layouts are never
 * rewritten.
 */
function isUntouchedLegacyRelay(
  widget: WidgetConfig | undefined,
  id: string,
  deviceId: string,
  legacy: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): boolean {
  return (
    widget !== undefined &&
    widget.id === id &&
    widget.type === 'switch' &&
    widget.title === undefined &&
    widget.binding?.deviceId === deviceId &&
    widget.binding?.capability === 'switch' &&
    widget.layout.x === legacy.x &&
    widget.layout.y === legacy.y &&
    widget.layout.width === legacy.width &&
    widget.layout.height === legacy.height
  );
}

/**
 * CONDITIONAL legacy-seed normalization (pure): when BOTH relay cards are
 * the untouched legacy seed arrangement (w-light/w-fan, switch bindings to
 * relay-1/relay-2, no custom title, the exact original default 2x1
 * coordinates), rewrite ONLY those two layouts to the approved side-by-side
 * 1x1 pair. In every other case the input array is returned unchanged:
 * - either card customized (moved/resized/renamed/re-bound) → no-op,
 * - the target cells occupied by any OTHER widget → no-op (never overlaps),
 * - already normalized → the legacy condition no longer matches → no-op
 *   (idempotent).
 *
 * Runs on LEGACY files (pre-Template migration) so an untouched seed
 * dashboard migrates into the Template model with the approved arrangement.
 *
 * @returns the normalized widget list, or the ORIGINAL array reference when
 *   nothing matched (the service only persists on a real change).
 */
export function normalizeLegacySeedLayouts(
  widgets: readonly WidgetConfig[],
): readonly WidgetConfig[] {
  const light = widgets.find(widget => widget.id === 'w-light');
  const fan = widgets.find(widget => widget.id === 'w-fan');
  const legacyPair =
    isUntouchedLegacyRelay(light, 'w-light', 'relay-1', LEGACY_LIGHT_LAYOUT) &&
    isUntouchedLegacyRelay(fan, 'w-fan', 'relay-2', LEGACY_FAN_LAYOUT);
  if (!legacyPair) {
    // Same REFERENCE on no-op: the service only persists when the returned
    // array is not the input array (cheap change detection).
    return widgets;
  }
  // Never create an overlap: if any OTHER widget already occupies one of
  // the normalized target cells, leave the legacy arrangement untouched.
  const targets = [NORMALIZED_LIGHT_LAYOUT, NORMALIZED_FAN_LAYOUT];
  for (const other of widgets) {
    if (other.id === 'w-light' || other.id === 'w-fan') {
      continue;
    }
    for (const target of targets) {
      if (collides(other.layout, target)) {
        return widgets;
      }
    }
  }
  return widgets.map(widget => {
    if (widget.id === 'w-light') {
      return { ...widget, layout: { ...NORMALIZED_LIGHT_LAYOUT } };
    }
    if (widget.id === 'w-fan') {
      return { ...widget, layout: { ...NORMALIZED_FAN_LAYOUT } };
    }
    return widget;
  });
}
