/**
 * Devices domain: rooms/devices schemas + pure helpers.
 *
 * V2 abstraction: a widget binds to `deviceId + capability`, never to an MQTT
 * topic. A `Device` declares its capabilities and a `binding` that tells the
 * app where its data comes from:
 *
 * - `telemetry-sensor` → values come from the shared telemetry topic; every
 *   declared sensor capability is mapped from the payload field with the same
 *   name as the capability type (e.g. `temperature`, `humidity`, `pressure`).
 * - `relay` (room-scoped slot 1..10) → `switch` capability, commands routed
 *   to the relay module
 *   (`<prefix>/boards/<boardId>/relays/K<slot>/set`); the room comes from
 *   the device's own `roomId`.
 *
 * The binding↔capability constraints below are enforced by zod so no invalid
 * device can ever be persisted or enter the registry.
 *
 * Capabilities are open: the app ships three built-ins
 * ({@link BUILT_IN_CAPABILITIES}) and the user can add more (e.g. `pressure`)
 * through the capability catalog (stored in the persisted snapshot).
 */

import { z } from 'zod';

import { RELAY_INDICES } from '@core/constants';

/**
 * All built-in capability types the app understands. Custom capability types
 * can be added through the capability catalog, so runtime capability values
 * are plain strings ({@link CapabilityType}).
 */
export const CAPABILITY_TYPES = ['temperature', 'humidity', 'switch'] as const;

/**
 * The built-in capability literals (`'temperature' | 'humidity' | 'switch'`).
 * Use in exhaustive switches; {@link CapabilityType} is the widened string
 * form accepted everywhere capabilities flow (devices, bindings, state keys).
 */
export type KnownCapability = (typeof CAPABILITY_TYPES)[number];

/**
 * A capability of a device or a widget binding. Widened to `string` so custom
 * capability types from the catalog are first-class citizens.
 */
export type CapabilityType = string;

/**
 * zod schema for a capability string (any non-empty string — the catalog
 * defines the known ones at runtime, not the schema).
 */
export const CapabilitySchema = z.string().min(1);

/** Behavior kind of a capability definition. */
export const CapabilityKindSchema = z.enum(['sensor', 'switch']);

/** Behavior kind of a capability definition ('sensor' | 'switch'). */
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;

/**
 * ASCII machine-key format for NEW capability types (CP-R4).
 *
 * Must start with a lowercase letter, followed by lowercase letters, digits
 * or underscores. No spaces, no dashes, no uppercase, no Vietnamese chars.
 * Examples: `temperature`, `humidity`, `pressure`, `co2_level`.
 *
 * NOTE: This is stricter than {@link CapabilityDefSchema} which accepts any
 * non-empty string for backwards compatibility with legacy persisted keys
 * (e.g. Vietnamese slugs like 'áp-suất'). Use this schema for validating
 * NEW capability creation input only.
 */
export const CAPABILITY_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

/** Zod schema for validating NEW capability machine keys (strict ASCII). */
export const CapabilityMachineKeySchema = z
  .string()
  .min(1)
  .regex(CAPABILITY_KEY_REGEX, {
    message:
      'Capability key must be lowercase ASCII letters/digits/underscores, starting with a letter (e.g. "pressure")',
  });

/**
 * One entry of the capability catalog: metadata describing a capability type
 * (label, kind, optional unit/color/icon).
 */
export const CapabilityDefSchema = z.object({
  /** Capability type key (unique in the catalog, e.g. 'pressure'). */
  type: z.string().min(1),
  /** Human-readable label (e.g. 'Áp suất'). */
  label: z.string().min(1),
  /** 'sensor' (numeric readings) or 'switch' (boolean commands). */
  kind: CapabilityKindSchema,
  /** Display unit (e.g. '°C', '%') — sensors only. */
  unit: z.string().optional(),
  /** Accent color used for display (hex). */
  color: z.string().optional(),
  /** Ionicons glyph name (e.g. 'thermometer-outline'). */
  icon: z.string().optional(),
  /**
   * Shipped-with-the-app capability (temperature/humidity/switch). Built-ins
   * are locked: the catalog UI shows a lock and the service rejects removal
   * (CP5) so seeds and bindings can never lose their core types.
   */
  builtin: z.boolean().optional(),
});

/** One entry of the capability catalog. */
export type CapabilityDef = z.infer<typeof CapabilityDefSchema>;

/**
 * The built-in capability catalog (temperature °C, humidity %, switch).
 * Snapshots persisted before the catalog existed migrate to this list.
 */
export const BUILT_IN_CAPABILITIES: readonly CapabilityDef[] = [
  {
    type: 'temperature',
    label: 'Nhiệt độ',
    kind: 'sensor',
    unit: '°C',
    color: '#e65100',
    icon: 'thermometer-outline',
    builtin: true,
  },
  {
    type: 'humidity',
    label: 'Độ ẩm',
    kind: 'sensor',
    unit: '%',
    color: '#00897b',
    icon: 'water-outline',
    builtin: true,
  },
  {
    type: 'switch',
    label: 'Công tắc',
    kind: 'switch',
    icon: 'toggle-outline',
    builtin: true,
  },
];

/**
 * Relay channel numbers supported by the hardware contract (1..10).
 *
 * Room-scoped relay protocol: slots are scoped per room, so two rooms can
 * each use slot N independently (identity = `{ roomId, slot }`).
 */
export const RELAY_CHANNELS = RELAY_INDICES;

/** A relay channel (1..10). */
export type RelayChannel = (typeof RELAY_CHANNELS)[number];

/** Where a device's data comes from. */
export const DeviceBindingSchema = z.discriminatedUnion('kind', [
  /** Sensor values from the shared telemetry topic. */
  z.object({ kind: z.literal('telemetry-sensor') }),
  /** ON/OFF relay with a fixed room-scoped hardware slot (1..10). */
  z.object({
    kind: z.literal('relay'),
    index: z.union(
      RELAY_CHANNELS.map(channel => z.literal(channel)) as [
        z.ZodLiteral<RelayChannel>,
        ...z.ZodLiteral<RelayChannel>[],
      ],
    ),
  }),
]);

/** A device binding ('telemetry-sensor' | 'relay' with a room-scoped slot 1..10). */
export type DeviceBinding = z.infer<typeof DeviceBindingSchema>;

/** A device registered in the app (id, name, capabilities, binding). */
export const DeviceSchema = z
  .object({
    /** Stable device id (generated by the registry on create). */
    id: z.string().min(1, 'Device id is required'),
    /** Display name (e.g. 'Đèn phòng khách'). */
    name: z.string().trim().min(1, 'Device name is required'),
    /** Id of the room this device belongs to (optional). */
    roomId: z.string().min(1).optional(),
    /** Device type label (e.g. 'sensor' | 'relay'). */
    type: z.string().trim().min(1, 'Device type is required'),
    /** Capabilities this device exposes (at least one; strings, catalog-defined). */
    capabilities: z.array(CapabilitySchema).min(1),
    /**
     * Optional per-DEVICE display glyph (scope amendment 2) — e.g.
     * 'bulb-outline' (Ionicons) for a lamp, 'fan' (MaterialCommunityIcons)
     * for a fan. The widgets' icon resolver validates each name against
     * the glyph map of ITS family and renders the matching component. When
     * absent, widgets fall back to the capability definition's icon and
     * then their own default. OPTIONAL for backwards compatibility:
     * persisted snapshots written before the field existed keep parsing
     * unchanged (legacy snapshots without icons are enriched at registry
     * load — see {@link enrichLegacyDeviceIcons}).
     */
    icon: z.string().optional(),
    /** Data binding (telemetry sensor or relay channel). */
    binding: DeviceBindingSchema,
  })
  .superRefine((device, ctx) => {
    if (device.binding.kind === 'relay') {
      const onlySwitch =
        device.capabilities.length === 1 && device.capabilities[0] === 'switch';
      if (!onlySwitch) {
        ctx.addIssue({
          code: 'custom',
          path: ['capabilities'],
          message: 'Relay devices must expose exactly the "switch" capability',
        });
      }
    } else if (device.capabilities.includes('switch')) {
      ctx.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'Telemetry sensors cannot expose the "switch" capability',
      });
    }
  });

/** A registered device. */
export type Device = z.infer<typeof DeviceSchema>;

/**
 * ASCII machine-key format for room board codes: 1–32 characters from
 * `[a-zA-Z0-9_-]` — the alphabet of one MQTT topic segment (no `/`, `+`, `#`,
 * no spaces, no Vietnamese characters). Exported so the UI (manual board-code
 * entry) validates with the SAME authority as the schema.
 */
export const ROOM_CODE_REGEX = /^[a-zA-Z0-9_-]+$/;

/** A room grouping devices. */
export const RoomSchema = z.object({
  /** Stable room id. */
  id: z.string().min(1, 'Room id is required'),
  /** Display name (e.g. 'Phòng khách'). */
  name: z.string().trim().min(1, 'Room name is required'),
  /** Sort order (integer, ascending). */
  order: z.number().int('Room order must be an integer'),
  /** Optional Ionicons glyph name shown next to the room (e.g. 'home-outline'). */
  icon: z.string().optional(),
  /**
   * Optional board code (board-discovery-binding plan): the MQTT identity the
   * board publishes under on the real backend (`<prefix>/boards/<code>/...`,
   * where the bridge maps `DEVICE_ID ≡ boardId`). ASCII machine key — the
   * same alphabet as MQTT topic segments — so a bound room routes telemetry,
   * relay commands and history tag filters through this code, while
   * code-less (seed demo) rooms keep their internal `id` everywhere.
   * OPTIONAL for backwards compatibility: snapshots persisted before the
   * field existed keep parsing unchanged. Uniqueness across rooms is
   * enforced by the snapshot-level check below (2 rooms can never bind the
   * same board).
   */
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(ROOM_CODE_REGEX, {
      message:
        'Board code must be 1-32 ASCII letters, digits, "_" or "-" (e.g. "board-1")',
    })
    .optional(),
});

/** A room grouping devices. */
export type Room = z.infer<typeof RoomSchema>;

/**
 * The ONE MQTT identity authority for a room (board-discovery-binding plan):
 * a bound room publishes/addresses `<prefix>/boards/<code>/...`; a code-less
 * (seed demo) room keeps its internal `id` exactly as before. Every identity
 * boundary (telemetry dispatch, relay command topics, history tag filters)
 * routes through this helper — nothing else may concatenate a room id into a
 * topic or tag.
 */
export function mqttRoomIdOf(room: Pick<Room, 'id' | 'code'>): string {
  return room.code ?? room.id;
}

/**
 * Resolve an MQTT topic room segment back to the app's internal room:
 * a room whose `code` matches wins FIRST (a bound board publishes under its
 * code), then the internal `id` fallback keeps code-less (seed demo) rooms
 * dispatching exactly as before (backward compatible). Pure.
 */
export function resolveRoomByMqttId(
  rooms: readonly Room[],
  mqttRoomId: string,
): Room | undefined {
  return (
    rooms.find(room => room.code !== undefined && room.code === mqttRoomId) ??
    rooms.find(room => room.id === mqttRoomId)
  );
}

/**
 * Pure board↔room assignment selector for the UI (board-discovery-binding
 * plan): `code → Room` for every code-bearing room. Code-less rooms are
 * absent (a board not in the map is unassigned). Pure — consumers recompute
 * from the devices snapshot on every render.
 */
export function boardAssignment(rooms: readonly Room[]): Map<string, Room> {
  const assignment = new Map<string, Room>();
  for (const room of rooms) {
    if (room.code !== undefined) {
      assignment.set(room.code, room);
    }
  }
  return assignment;
}

/** Raw snapshot shape before the capability-catalog migration. */
const RawDevicesSnapshotSchema = z
  .object({
    rooms: z.array(RoomSchema),
    devices: z.array(DeviceSchema),
    /** Capability catalog; absent on pre-catalog snapshots (parse migration). */
    capabilities: z.array(CapabilityDefSchema).optional(),
    /** Locally hidden boards stay hidden until explicit restoration. */
    deletedBoardCodes: z
      .array(z.string().trim().min(1).max(32).regex(ROOM_CODE_REGEX))
      .optional(),
  })
  .superRefine((snapshot, ctx) => {
    const deviceIds = new Set<string>();
    for (const device of snapshot.devices) {
      if (deviceIds.has(device.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['devices'],
          message: `Duplicate device id "${device.id}"`,
        });
      }
      deviceIds.add(device.id);
    }
    const roomIds = new Set<string>();
    const roomCodes = new Set<string>();
    for (const room of snapshot.rooms) {
      if (roomIds.has(room.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rooms'],
          message: `Duplicate room id "${room.id}"`,
        });
      }
      roomIds.add(room.id);
      // Board binding uniqueness (board-discovery-binding plan): two rooms
      // can never bind the SAME board code — the snapshot would make the
      // MQTT identity ambiguous. A code-less room never conflicts.
      if (room.code !== undefined) {
        if (roomCodes.has(room.code)) {
          ctx.addIssue({
            code: 'custom',
            path: ['rooms'],
            message: `Duplicate room board code "${room.code}"`,
          });
        }
        roomCodes.add(room.code);
      }
    }
    if (snapshot.capabilities) {
      const types = new Set<string>();
      for (const def of snapshot.capabilities) {
        if (types.has(def.type)) {
          ctx.addIssue({
            code: 'custom',
            path: ['capabilities'],
            message: `Duplicate capability type "${def.type}"`,
          });
        }
        types.add(def.type);
      }
    }
    if (snapshot.deletedBoardCodes) {
      if (
        new Set(snapshot.deletedBoardCodes).size !==
        snapshot.deletedBoardCodes.length
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['deletedBoardCodes'],
          message: 'Duplicate deleted board code',
        });
      }
    }
  });

/**
 * The persisted devices snapshot (rooms + devices + capability catalog).
 *
 * Parse migration: snapshots persisted before the capability catalog existed
 * (no `capabilities` field) parse with the built-in catalog
 * ({@link BUILT_IN_CAPABILITIES}); snapshots with an explicit catalog
 * round-trip unchanged.
 */
export const DevicesSnapshotSchema = RawDevicesSnapshotSchema.transform(
  snapshot => ({
    rooms: snapshot.rooms,
    devices: snapshot.devices,
    // Parse migration: pre-catalog snapshots get the built-ins; snapshots
    // persisted before the builtin lock (CP5) get `builtin: true` re-stamped
    // on the three core types so they stay locked.
    capabilities: (snapshot.capabilities ?? [...BUILT_IN_CAPABILITIES]).map(
      def =>
        BUILT_IN_CAPABILITIES.some(builtin => builtin.type === def.type)
          ? { ...def, builtin: true }
          : def,
    ),
    ...(snapshot.deletedBoardCodes === undefined
      ? {}
      : { deletedBoardCodes: snapshot.deletedBoardCodes }),
  }),
);

/**
 * The persisted devices snapshot.
 *
 * Declared manually (rather than inferred) so every field is `readonly` —
 * the zod pipeline above infers the same shape with mutable arrays.
 */
export interface DevicesSnapshot {
  readonly rooms: readonly Room[];
  readonly devices: readonly Device[];
  /** Capability catalog (built-ins when the snapshot was migrated). */
  readonly capabilities: readonly CapabilityDef[];
  /** Local deletion markers; absent in legacy snapshots. */
  readonly deletedBoardCodes?: readonly string[];
}

/**
 * Legacy icon migration map (scope amendment 3, user-adopted decision):
 * known SEED device ids whose persisted snapshots predate the per-device
 * `icon` field, mapped to their canonical display glyphs (the same glyphs
 * {@link ./seeds} seeds for fresh installs). Matched by STABLE SEED ID —
 * relay-1 (Đèn) → Ionicons `bulb-outline`, relay-2 (Quạt) →
 * MaterialCommunityIcons `fan` — so a user who RENAMED a seed device still
 * gets the deterministic enrichment.
 */
export const LEGACY_DEVICE_ICON_SEEDS: Readonly<Record<string, string>> = {
  'relay-1': 'bulb-outline',
  'relay-2': 'fan',
};

/**
 * Pure migration (scope amendment 3): fill the per-device `icon` ONLY on
 * KNOWN SEED devices whose field is MISSING, so legacy persisted snapshots
 * render the same glyphs as fresh seeds instead of the generic capability
 * glyph.
 *
 * Safety contract (pinned by devices/devicesRepository tests):
 * - fills ONLY the `icon` field — every other field is carried through
 *   untouched (spread of the original device object),
 * - NEVER overwrites an existing value (an `icon` already present —
 *   including a user-customized one — survives byte-identical), so the
 *   migration is IDEMPOTENT across loads: the second load sees the field
 *   set and no-ops,
 * - unknown/custom device ids are NOT in the map and keep the capability
 *   icon fallback (the resolver's own chain),
 * - the empty string counts as MISSING (it is not a glyph; the resolver
 *   already treats it as absent) and is filled for the seed ids.
 *
 * The enrichment lives at the registry LOAD boundary
 * (`AsyncStorageDevicesRepository.load`), NOT inside the zod schema or
 * `save` — so parsing and persistence stay side-effect-free, and the
 * enriched value simply persists with the next legitimate save (a plain
 * load/save round-trip already returns the enriched snapshot).
 *
 * @param snapshot - the parsed snapshot as stored.
 * @returns the same snapshot when nothing was filled (identity, not a
 *   fresh object); otherwise a copy with only the missing seed icons set.
 */
export function enrichLegacyDeviceIcons(
  snapshot: DevicesSnapshot,
): DevicesSnapshot {
  let changed = false;
  const devices = snapshot.devices.map(device => {
    if (device.icon !== undefined && device.icon !== '') {
      return device;
    }
    const icon = LEGACY_DEVICE_ICON_SEEDS[device.id];
    if (icon === undefined) {
      return device;
    }
    changed = true;
    return { ...device, icon };
  });
  return changed ? { ...snapshot, devices } : snapshot;
}

/**
 * Pure helper: build the canonical state-store key for a device capability
 * (`${deviceId}:${capability}`).
 */
export function capabilityKey(deviceId: string, capability: string): string {
  return `${deviceId}:${capability}`;
}

/**
 * Maximum number of telemetry-sensor devices per concrete room (approved
 * product decision). The registry service is the authoritative enforcer;
 * UI counters, disabled states and messages mirror these constants.
 *
 * Room-sensor rework (approved `room-sensor-derived-history-layout-rework`
 * plan): the quota counts PROJECTED sensor metric registrations — one
 * visible sensor = one metric/field — not telemetry container records.
 */
export const MAX_SENSORS_PER_ROOM = 10;

/**
 * Maximum number of relay devices per concrete room (approved product
 * decision). Relay slots are room-scoped 1..10 — one relay device per slot
 * per room.
 */
export const MAX_RELAYS_PER_ROOM = 10;

/** Coarse device category used by the per-room quotas (binding-driven). */
export type DeviceCategory = 'sensor' | 'relay';

/** Category of a device for quota purposes (binding kind decides). */
export function deviceCategory(
  device: Pick<Device, 'binding'>,
): DeviceCategory {
  return device.binding.kind === 'relay' ? 'relay' : 'sensor';
}

/** The per-room device cap for a category (10 sensors / 10 relays). */
export function maxDevicesPerRoom(category: DeviceCategory): number {
  return category === 'relay' ? MAX_RELAYS_PER_ROOM : MAX_SENSORS_PER_ROOM;
}

/**
 * One user-facing sensor registration (approved room-sensor rework): a
 * projected view of a telemetry-device capability — one visible sensor =
 * one metric/field. Canonical source identity is `{roomId, field}`; the
 * field is both the MQTT topic suffix and the InfluxDB `_field` key.
 */
export interface SensorRegistration {
  /** Enclosing telemetry device id (ephemeral state key part). */
  readonly deviceId: string;
  /** Room the registration lives in (`undefined` = legacy roomless record). */
  readonly roomId: string | undefined;
  /** Sensor field (capability machine key, e.g. `temperature`). */
  readonly field: string;
  /** Display name of the enclosing device. */
  readonly deviceName: string;
}

/**
 * Pure projection: every sensor-kind capability of every telemetry-sensor
 * device becomes ONE registration. Legacy multi-capability records
 * (temperature + humidity on one board) therefore project as two separate
 * user-facing sensors without rewriting the persisted data.
 *
 * @param devices - registered devices.
 * @param capabilities - the capability catalog (sensor kinds are projected).
 */
export function projectSensorRegistrations(
  devices: readonly Pick<
    Device,
    'id' | 'name' | 'roomId' | 'capabilities' | 'binding'
  >[],
  capabilities: readonly Pick<CapabilityDef, 'type' | 'kind'>[],
): readonly SensorRegistration[] {
  const sensorKinds = new Set(
    capabilities.filter(def => def.kind === 'sensor').map(def => def.type),
  );
  const registrations: SensorRegistration[] = [];
  for (const device of devices) {
    if (device.binding.kind !== 'telemetry-sensor') {
      continue;
    }
    for (const field of device.capabilities) {
      if (!sensorKinds.has(field)) {
        continue;
      }
      registrations.push({
        deviceId: device.id,
        roomId: device.roomId,
        field,
        deviceName: device.name,
      });
    }
  }
  return registrations;
}

/**
 * Projected sensor-metric count of one concrete room (approved semantics:
 * Temperature + Humidity on one legacy board count as 2). Roomless devices
 * never consume a room quota.
 */
export function countRoomSensors(
  devices: readonly Device[],
  capabilities: readonly Pick<CapabilityDef, 'type' | 'kind'>[],
  roomId: string,
): number {
  return projectSensorRegistrations(devices, capabilities).filter(
    registration => registration.roomId === roomId,
  ).length;
}

/**
 * Count the room quota units of a category: projected sensor metrics for
 * `sensor`, relay device records for `relay`.
 */
export function countRoomCategory(
  devices: readonly Device[],
  capabilities: readonly Pick<CapabilityDef, 'type' | 'kind'>[],
  roomId: string,
  category: DeviceCategory,
): number {
  return category === 'relay'
    ? countRoomDevices(devices, roomId, 'relay')
    : countRoomSensors(devices, capabilities, roomId);
}

/**
 * Pure `{roomId, field}` duplicate check: `true` when another projected
 * sensor registration in `roomId` already uses `field` (excluding the
 * edited device). The same field in a DIFFERENT room is allowed — the
 * check is room-scoped.
 */
export function sensorFieldTakenInRoom(
  devices: readonly Device[],
  capabilities: readonly Pick<CapabilityDef, 'type' | 'kind'>[],
  roomId: string,
  field: string,
  excludeDeviceId?: string,
): boolean {
  return projectSensorRegistrations(devices, capabilities).some(
    registration =>
      registration.roomId === roomId &&
      registration.field === field &&
      registration.deviceId !== excludeDeviceId,
  );
}

/**
 * Count the devices of a category inside one concrete room. Roomless
 * (legacy/migration) devices never consume a room quota.
 *
 * NOTE: for the SENSOR category this is the telemetry CONTAINER count —
 * the user-facing quota uses {@link countRoomSensors} (projected metric
 * registrations) instead. `countRoomCategory` dispatches correctly.
 */
export function countRoomDevices(
  devices: readonly Pick<Device, 'binding' | 'roomId'>[],
  roomId: string,
  category: DeviceCategory,
): number {
  return devices.filter(
    device => device.roomId === roomId && deviceCategory(device) === category,
  ).length;
}

/**
 * Pure quota check with the approved LEGACY-TOLERANT semantics: a mutation
 * is rejected ONLY when it would WORSEN the room/category count — i.e. the
 * count after applying `nextDevice` exceeds the per-room cap AND exceeds
 * the count before the mutation.
 *
 * Sensor quota counts PROJECTED metric registrations (one visible sensor =
 * one field); relay quota counts device records.
 *
 * - Adding into a full room (before 10 → after 11): rejected.
 * - Moving another device into a full room: rejected.
 * - Renaming / re-saving a device inside a legacy over-capacity room
 *   (before 11 → after 11): ALLOWED — the mutation does not worsen it.
 * - Moving a device out of a room: always allowed (count decreases).
 *
 * `currentDevices` is the registry WITHOUT the mutation applied;
 * `excludeDeviceId` (the edited device) is replaced by `nextDevice` for the
 * after-count — omit it when adding a brand-new device.
 *
 * @returns a validation message when the mutation would worsen an
 *   over-capacity room, `null` when allowed.
 */
export function roomCapacityWorseningError(
  currentDevices: readonly Device[],
  nextDevice: Device,
  capabilities: readonly Pick<CapabilityDef, 'type' | 'kind'>[],
  roomId: string,
  excludeDeviceId?: string,
): string | null {
  const category = deviceCategory(nextDevice);
  const max = maxDevicesPerRoom(category);
  const before = countRoomCategory(
    currentDevices,
    capabilities,
    roomId,
    category,
  );
  const afterDevices = excludeDeviceId
    ? currentDevices.map(device =>
        device.id === excludeDeviceId ? nextDevice : device,
      )
    : [...currentDevices, nextDevice];
  const after = countRoomCategory(afterDevices, capabilities, roomId, category);
  if (after > max && after > before) {
    return category === 'relay'
      ? `Room already has the maximum of ${max} relay devices`
      : `Room already has the maximum of ${max} sensor metrics`;
  }
  return null;
}

/**
 * Pure duplicate-slot check: `true` when another device (excluding
 * `excludeDeviceId`) in `roomId` already occupies the relay `slot`. Equal
 * slots in DIFFERENT rooms are allowed — the check is room-scoped.
 */
export function relaySlotTakenInRoom(
  devices: readonly Pick<Device, 'binding' | 'roomId' | 'id'>[],
  roomId: string,
  slot: number,
  excludeDeviceId?: string,
): boolean {
  return devices.some(
    device =>
      device.id !== excludeDeviceId &&
      device.roomId === roomId &&
      device.binding.kind === 'relay' &&
      device.binding.index === slot,
  );
}

/**
 * Derive a machine type key from a user-entered capability label (CP5).
 *
 * Slug rules: lowercase, runs of non-alphanumerics collapse to a single `-`,
 * leading/trailing dashes trimmed. Uniqueness: when the slug already exists
 * in `existingTypes`, `-2`, `-3`, … are appended until free. An empty/
 * un-sluggable label falls back to `cap` (then `cap-2`, …).
 *
 * @param label - the human label (e.g. 'Áp suất' → 'áp-suất').
 * @param existingTypes - capability types already in the catalog.
 * @returns a unique type key (pure).
 */
export function capabilityTypeFromLabel(
  label: string,
  existingTypes: readonly string[],
): string {
  // Vietnamese letters live in Latin-1 Supplement, Latin Extended-A and
  // Latin Extended Additional — keep them, collapse everything else to '-'.
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9à-öø-ÿā-ſḀ-ỿ]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug.length > 0 ? slug : 'cap';
  const taken = new Set(existingTypes);
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** Built-in capabilities offered when *creating* a device for a binding kind. */
export function deviceCapabilityOptions(
  binding: DeviceBinding,
): readonly KnownCapability[] {
  return binding.kind === 'relay'
    ? (['switch'] as const)
    : (['temperature', 'humidity'] as const);
}

/**
 * Validate arbitrary input against the snapshot schema.
 * Returns the parsed snapshot or a list of human-readable field errors.
 */
export function parseDevicesSnapshot(
  input: unknown,
): { ok: true; value: DevicesSnapshot } | { ok: false; errors: string[] } {
  const result = DevicesSnapshotSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      issue => `${issue.path.join('.') || 'snapshot'}: ${issue.message}`,
    ),
  };
}
