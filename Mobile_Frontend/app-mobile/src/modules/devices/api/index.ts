/**
 * Devices module — public facade.
 *
 * The only entry point other modules may use. Everything else lives in
 * `internal/` and must not be imported across modules (enforced by
 * `eslint-plugin-boundaries`).
 *
 * V2 abstraction: widgets bind to `deviceId + capability`, never to MQTT
 * topics. This facade exposes the devices registry (CRUD rooms/devices), the
 * live capability state store, and the command router.
 */

import type { AppError, Result } from '@core/errors';

import type {
  CapabilityDef,
  CapabilityType,
  Device,
  Room,
} from '../internal/domain/devices';
import type {
  CapabilityPatch,
  DevicePatch,
  NewCapabilityInput,
  NewDeviceInput,
  RoomMigrationTarget,
  RoomPatch,
} from '../internal/services/deviceRegistryService';
import type { DevicesStore } from '../internal/ui/devicesStore';

/** Devices domain types: capability, device, binding, snapshot, room, relay channel. */
export type {
  CapabilityDef,
  CapabilityKind,
  CapabilityType,
  Device,
  DeviceBinding,
  DeviceCategory,
  DevicesSnapshot,
  KnownCapability,
  RelayChannel,
  Room,
  SensorRegistration,
} from '../internal/domain/devices';
/** Devices domain: zod schemas + pure helpers (binding↔capability constraint). */
export {
  BUILT_IN_CAPABILITIES,
  CAPABILITY_TYPES,
  CapabilityDefSchema,
  CapabilityKindSchema,
  CapabilitySchema,
  DeviceBindingSchema,
  DeviceSchema,
  DevicesSnapshotSchema,
  RELAY_CHANNELS,
  RoomSchema,
  capabilityKey,
  capabilityTypeFromLabel,
  CAPABILITY_KEY_REGEX,
  CapabilityMachineKeySchema,
  deviceCapabilityOptions,
  parseDevicesSnapshot,
  // Board↔room binding identity (board-discovery-binding plan): the ONE
  // authority turning a room into its MQTT topic identity and back.
  ROOM_CODE_REGEX,
  mqttRoomIdOf,
  resolveRoomByMqttId,
  boardAssignment,
  // Per-room capacity contract (service-authoritative; UI mirrors these).
  MAX_SENSORS_PER_ROOM,
  MAX_RELAYS_PER_ROOM,
  countRoomDevices,
  countRoomCategory,
  countRoomSensors,
  deviceCategory,
  maxDevicesPerRoom,
  projectSensorRegistrations,
  roomCapacityWorseningError,
  relaySlotTakenInRoom,
  sensorFieldTakenInRoom,
} from '../internal/domain/devices';

/** First-run seed snapshot (3 rooms + separate temperature/humidity sensors + a Đèn/Quạt/Bơm relay triple per room). */
export { seedDevices, SEED_ROOM_LIVING_ID } from '../internal/domain/seeds';
/** Persistence port (implemented by {@link AsyncStorageDevicesRepository}). */
export type { DevicesRepository } from '../internal/data/devicesRepository';
/** AsyncStorage adapter: load → seed, zod-validated round-trip. */
export { AsyncStorageDevicesRepository } from '../internal/data/devicesRepository';
/** zustand store factory: live capability values keyed `${deviceId}:${capability}`. */
export {
  createDeviceStateStore,
  deltaOverHorizon,
} from '../internal/data/deviceStateStore';
/** Live-value shape + store type. */
export type {
  DeviceCapabilityValue,
  DeviceStateStore,
  SeriesPoint,
} from '../internal/data/deviceStateStore';
/** Default {@link DeviceRegistryService} implementation (repository + bus + zod). */
export { DeviceRegistryServiceImpl } from '../internal/services/deviceRegistryService';
/** Service input/patch types (CRUD rooms/devices + capability catalog). */
export type {
  CapabilityPatch,
  DevicePatch,
  NewCapabilityInput,
  NewDeviceInput,
  RoomMigrationTarget,
  RoomPatch,
} from '../internal/services/deviceRegistryService';
/** Bridge `telemetry:received` / `relay:*` bus events → live capability values. */
export { DeviceStateSync } from '../internal/services/deviceStateSync';
/** Default {@link DeviceCommandService} implementation (switch → relay module). */
export { DeviceCommandServiceImpl } from '../internal/services/deviceCommandService';
/** Board discovery (boards-topic-contract-v2): descriptor + status wildcards, descriptor-driven inventory. */
export { BoardInventoryService } from '../internal/services/boardInventoryService';
/** Descriptor payload schema (schemaVersion 1, strict S/K channel grammars). */
export { BoardDescriptorPayloadSchema } from '../internal/services/boardInventoryService';
/** One discovered board (status + descriptor data per wire code). */
export type { BoardInventoryEntry } from '../internal/services/boardInventoryService';
/** Parsed descriptor data (boardType, sensor channels, relay channels, displayName). */
export type {
  BoardDescriptorData,
  BoardDescriptorSensor,
} from '../internal/services/boardInventoryService';
/** Mirror-store port the discovery service pushes snapshots into. */
export type { BoardInventoryStorePort } from '../internal/services/boardInventoryService';
/** zustand store factory mirroring the discovered boards for the UI. */
export { createBoardStore } from '../internal/ui/boardStore';
/** Board mirror store type (discovered boards snapshot). */
export type { BoardStore } from '../internal/ui/boardStore';
/** zustand store factory mirroring the registry snapshot for the UI. */
export { createDevicesStore } from '../internal/ui/devicesStore';
/** Mirror store type (rooms + devices snapshot). */
export type { DevicesStore } from '../internal/ui/devicesStore';

/**
 * Devices registry service — CRUD for rooms + devices.
 *
 * The service owns the persisted snapshot; every mutation validates, persists
 * and broadcasts `devices:changed` (payload `{ removedDeviceIds }`).
 */
export interface DeviceRegistryService {
  /** The zustand store mirrored to the UI (subscribe for re-renders). */
  getStore(): DevicesStore;
  /** Load the persisted snapshot (seeds defaults on first run). */
  load(): Promise<Result<void>>;
  /** All registered devices. */
  getDevices(): readonly Device[];
  /** All rooms. */
  getRooms(): readonly Room[];
  /** Board codes hidden locally; QR or explicit assignment can restore them. */
  getDeletedBoardCodes(): readonly string[];
  /**
   * Hide a board from this app in ONE write.
   * The room binding, logical devices, widgets and InfluxDB data remain
   * untouched. Explicitly restoring or assigning this code makes it visible.
   */
  removeBoard(code: string): Promise<Result<void>>;
  /** Restore a board hidden by removeBoard without changing room bindings. */
  restoreBoard(code: string): Promise<Result<void>>;
  /** The capability catalog (built-ins + user-defined). */
  getCapabilities(): readonly CapabilityDef[];
  /** Find a device by id (undefined when unknown). */
  findDevice(id: string): Device | undefined;
  /**
   * Add a room. Returns the created room so the UI can open it immediately
   * on success (approved room-first device management).
   *
   * @param name - display name of the room.
   * @param code - optional board code binding the room to a board's MQTT
   *   identity (board-discovery-binding plan): schema-validated format, must
   *   be unique across rooms. Omit for an unbound (seed-demo style) room.
   */
  addRoom(name: string, code?: string): Promise<Result<Room>>;
  /**
   * Update a room (partial patch; id must exist). Note: the plain set path
   * REJECTS a code that another room already holds — use
   * {@link DeviceRegistryService.rebindRoomBoard} to TRANSFER a bound board
   * to a different room (atomic clear-source + set-target).
   */
  updateRoom(id: string, patch: RoomPatch): Promise<Result<void>>;
  /**
   * Atomically (re)bind a board to a room (board-discovery-binding plan,
   * item 12 — the transfer action of the boards screen). One validated
   * write: the code's current holder (if any) is cleared and the target
   * room receives the code; a target that previously held a different code
   * releases it. Failure leaves the previous state untouched. Assigning a
   * board to the room that already holds it is a no-op success.
   */
  rebindRoomBoard(code: string, targetRoomId: string): Promise<Result<void>>;
  /**
   * Remove a room with an explicit device/widget migration (CP5): `move`
   * retargets devices + widgets to another room; `unassign` makes devices
   * roomless and widgets global. Room deletion is ONLY possible through
   * this explicit migration — there is no un-migrated removal path (fix
   * cycle 1: the plain `removeRoom` bypass was removed).
   */
  removeRoomWithMigration(
    id: string,
    target: RoomMigrationTarget,
  ): Promise<Result<void>>;
  /** Add a device (id generated; validated against the binding constraint). */
  addDevice(input: NewDeviceInput): Promise<Result<void>>;
  /** Update a device (partial patch; id must exist). */
  updateDevice(id: string, patch: DevicePatch): Promise<Result<void>>;
  /**
   * Remove a device; broadcasts `devices:changed` with its id in
   * `removedDeviceIds` so bindings (widgets) can be cascaded away.
   */
  removeDevice(id: string): Promise<Result<void>>;
  /**
   * Remove ONE projected sensor metric (approved binding-level lifecycle):
   * a legacy multi-capability record loses only the given capability and
   * sibling metrics survive; removing the last capability cascades to a
   * whole-device removal. The `devices:changed` event carries the exact
   * `{deviceId, capability}` removal in `removedBindings`.
   */
  removeDeviceCapability(
    deviceId: string,
    field: string,
  ): Promise<Result<void>>;
  /** Add a capability definition to the catalog (`type` must be unique). */
  addCapability(input: NewCapabilityInput): Promise<Result<void>>;
  /** Update a capability definition (patch; the type key is immutable). */
  updateCapability(type: string, patch: CapabilityPatch): Promise<Result<void>>;
  /**
   * Remove a capability definition; rejected (validation error) when any
   * device still declares it or any widget still binds it (injected check).
   */
  removeCapability(type: string): Promise<Result<void>>;
}

/**
 * Device command service — capability-level command entry point for widgets.
 *
 * Routes `switch` commands to the relay module through the device binding;
 * unsupported device/capability combinations return a validation error so the
 * UI can surface the failure (closes KNOWN ISSUE-001 UX gap).
 */
export interface DeviceCommandService {
  /**
   * Send a command to a device capability (`switch` → relay module).
   *
   * @returns `ok` when routed; `err` with code `not-found` for unknown
   *   devices, or `validation` for unsupported capability / binding.
   */
  sendCommand(
    deviceId: string,
    capability: CapabilityType,
    value: boolean,
  ): Result<void, AppError>;
}
