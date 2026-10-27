/**
 * First-run seed data for the devices module.
 *
 * Room-first seed (V2): three rooms (Phòng khách / Phòng ngủ / Bếp) with
 * Ionicons icons, TWO separate logical sensor registrations per room — one
 * for `temperature` (Nhiệt độ) and one for `humidity` (Độ ẩm), per the
 * approved room-sensor rework (one visible sensor = one metric) — and the
 * THREE hardware relays (Đèn / Quạt / Bơm) in EVERY room (demo-three-rooms:
 * Phòng khách keeps relay-1..3; Phòng ngủ got relay-4..6 and Bếp relay-7..9
 * on the SAME room-scoped slots 1..3, so equal slots in separate rooms never
 * alias). The capability catalog seeds to the built-ins.
 *
 * Per-device glyphs (scope amendments 2–3): every Đèn seeds `bulb-outline`
 * (Ionicons) and every Quạt seeds `fan` (MaterialCommunityIcons — Ionicons
 * has no fan glyph; amendment 3 replaced the interim `aperture-outline`
 * substitute) so their widget cards no longer duplicate the capability
 * switch glyph; Bơm keeps the capability fallback.
 *
 * Seed ids are stable (`room-living`, `sensor-temp-01`, …) so other modules'
 * seeds (dashboard layout) can reference them. Counters start truthfully at
 * `2/10` sensors + `3/10` relays per seeded room.
 */

import type { DevicesSnapshot } from './devices';
import { BUILT_IN_CAPABILITIES } from './devices';

/** Seed room id: Phòng khách. */
export const SEED_ROOM_LIVING_ID = 'room-living';

/** Seed snapshot used on first run (nothing persisted yet). */
export function seedDevices(): DevicesSnapshot {
  return {
    rooms: [
      {
        id: SEED_ROOM_LIVING_ID,
        name: 'Phòng khách',
        order: 0,
        icon: 'home-outline',
      },
      { id: 'room-bedroom', name: 'Phòng ngủ', order: 1, icon: 'bed-outline' },
      { id: 'room-kitchen', name: 'Bếp', order: 2, icon: 'restaurant-outline' },
    ],
    devices: [
      {
        id: 'sensor-temp-01',
        name: 'Nhiệt độ',
        roomId: SEED_ROOM_LIVING_ID,
        type: 'sensor',
        capabilities: ['temperature'],
        binding: { kind: 'telemetry-sensor' },
      },
      {
        id: 'sensor-hum-01',
        name: 'Độ ẩm',
        roomId: SEED_ROOM_LIVING_ID,
        type: 'sensor',
        capabilities: ['humidity'],
        binding: { kind: 'telemetry-sensor' },
      },
      {
        id: 'sensor-temp-02',
        name: 'Nhiệt độ',
        roomId: 'room-bedroom',
        type: 'sensor',
        capabilities: ['temperature'],
        binding: { kind: 'telemetry-sensor' },
      },
      {
        id: 'sensor-hum-02',
        name: 'Độ ẩm',
        roomId: 'room-bedroom',
        type: 'sensor',
        capabilities: ['humidity'],
        binding: { kind: 'telemetry-sensor' },
      },
      {
        id: 'sensor-temp-03',
        name: 'Nhiệt độ',
        roomId: 'room-kitchen',
        type: 'sensor',
        capabilities: ['temperature'],
        binding: { kind: 'telemetry-sensor' },
      },
      {
        id: 'sensor-hum-03',
        name: 'Độ ẩm',
        roomId: 'room-kitchen',
        type: 'sensor',
        capabilities: ['humidity'],
        binding: { kind: 'telemetry-sensor' },
      },
      {
        id: 'relay-1',
        name: 'Đèn',
        roomId: SEED_ROOM_LIVING_ID,
        type: 'relay',
        capabilities: ['switch'],
        // Per-device display glyph (scope amendment 2): the lamp gets its
        // own line-style bulb instead of the capability switch glyph.
        icon: 'bulb-outline',
        binding: { kind: 'relay', index: 1 },
      },
      {
        id: 'relay-2',
        name: 'Quạt',
        roomId: SEED_ROOM_LIVING_ID,
        type: 'relay',
        capabilities: ['switch'],
        // Per-device display glyph (scope amendment 3): the REAL fan glyph
        // from MaterialCommunityIcons (`fan` — verified in the installed
        // glyph map; rendered family-aware by the widgets' icon resolver).
        // Replaces the amendment-2 interim `aperture-outline` substitute.
        icon: 'fan',
        binding: { kind: 'relay', index: 2 },
      },
      {
        id: 'relay-3',
        name: 'Bơm',
        roomId: SEED_ROOM_LIVING_ID,
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: 3 },
      },
      {
        id: 'relay-4',
        name: 'Đèn',
        roomId: 'room-bedroom',
        type: 'relay',
        capabilities: ['switch'],
        icon: 'bulb-outline',
        binding: { kind: 'relay', index: 1 },
      },
      {
        id: 'relay-5',
        name: 'Quạt',
        roomId: 'room-bedroom',
        type: 'relay',
        capabilities: ['switch'],
        icon: 'fan',
        binding: { kind: 'relay', index: 2 },
      },
      {
        id: 'relay-6',
        name: 'Bơm',
        roomId: 'room-bedroom',
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: 3 },
      },
      {
        id: 'relay-7',
        name: 'Đèn',
        roomId: 'room-kitchen',
        type: 'relay',
        capabilities: ['switch'],
        icon: 'bulb-outline',
        binding: { kind: 'relay', index: 1 },
      },
      {
        id: 'relay-8',
        name: 'Quạt',
        roomId: 'room-kitchen',
        type: 'relay',
        capabilities: ['switch'],
        icon: 'fan',
        binding: { kind: 'relay', index: 2 },
      },
      {
        id: 'relay-9',
        name: 'Bơm',
        roomId: 'room-kitchen',
        type: 'relay',
        capabilities: ['switch'],
        binding: { kind: 'relay', index: 3 },
      },
    ],
    capabilities: [...BUILT_IN_CAPABILITIES],
  };
}
