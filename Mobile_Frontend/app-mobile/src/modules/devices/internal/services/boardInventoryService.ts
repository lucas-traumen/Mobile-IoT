/**
 * BoardInventoryService — descriptor-driven board discovery on the shared
 * MQTT client (boards-topic-contract-v2).
 *
 * Real-backend boards publish under `{prefix}/boards/{boardId}/...`:
 *
 * - a RETAINED JSON descriptor on `<prefix>/boards/<id>/descriptor` is the
 *   AUTHORITATIVE source for the board's sensor channels (`S<n>` → semantic
 *   field), relay channels (`K1..K10`), board type and optional display
 *   name. A republished descriptor REPLACES the previous one (no union of
 *   stale channels).
 * - a RETAINED plain-text status on `<prefix>/boards/<id>/status`
 *   (`online`/`offline`; the JSON `{"status":...}` shape is tolerated
 *   defensively) drives the badge.
 *
 * Entries merge on partial arrival in EITHER order: a descriptor without a
 * status makes the board `seen`; a status without a descriptor keeps the
 * descriptor slot empty until one arrives. Discovery is descriptor/status
 * driven ONLY — bus data events (telemetry/relay) no longer create or
 * mutate entries.
 *
 * Validation contract: invalid descriptors/payloads are warned + skipped,
 * NEVER thrown. A descriptor whose payload `boardId` disagrees with the
 * topic `boardId` is rejected (topic identity wins the wire, the payload
 * must agree).
 *
 * Client discipline mirrors `RelayService` (B1): the bus subscriptions are
 * attached ONCE in the constructor (no stacking on settings changes); the
 * MQTT descriptor + status wildcards are (re)subscribed through
 * `startListeners()` / `applyPrefix` on the SHARED client
 * (`AppDependencies.mqttClient`) — no extra connection.
 */

import type { EventBus } from '@core/eventbus';
import type { Logger } from '@core/logger';
import {
  isSensorChannel,
  parseBoardStatusTopic,
  parseDescriptorTopic,
} from '@core/topics';
import { z } from 'zod';

import type { MqttClientPort } from '@modules/telemetry/api';

/** One descriptor-declared sensor channel (wire `S<n>` → semantic field). */
export interface BoardDescriptorSensor {
  /** Wire channel (`S1`, `S2`, … — strict grammar, no leading zeros). */
  readonly channel: string;
  /** Semantic field key (the app capability type, e.g. `temperature`). */
  readonly field: string;
  /** Optional engineering unit (metadata only — the app catalog stays the UI authority). */
  readonly unit?: string;
}

/** The parsed descriptor data attached to a board entry. */
export interface BoardDescriptorData {
  readonly boardType: string;
  readonly sensors: readonly BoardDescriptorSensor[];
  /** Declared relay channels (`K1`..`K10` labels, declaration order). */
  readonly relays: readonly string[];
  readonly displayName?: string;
}

/**
 * One discovered board (descriptor-driven entry shape). `seen` = a
 * descriptor was received but no status message was observed (yet).
 */
export interface BoardInventoryEntry {
  /** Wire board id (the MQTT boards segment the board publishes under). */
  readonly code: string;
  /**
   * `online`/`offline` come from the retained status topic; `seen` marks a
   * board whose descriptor arrived but published no status message (yet).
   */
  readonly status: 'online' | 'offline' | 'seen';
  /** The latest valid descriptor (replaced — never unioned — on republish). */
  readonly descriptor?: BoardDescriptorData;
}

/**
 * Descriptor payload contract (boards-topic-contract-v2 decision 12/13):
 * `schemaVersion` MUST be 1; sensor channels follow the strict `S<positive
 * int>` grammar (no leading zeros); relay channels are `K1`..`K10`; fields
 * must be non-empty topic-safe strings; duplicate channels (sensor OR relay)
 * are rejected. Everything else is metadata.
 */
export const BoardDescriptorPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    boardId: z.string().min(1),
    boardType: z.string().min(1),
    sensors: z.array(
      z.object({
        channel: z.string().refine(isSensorChannel, {
          message: 'Sensor channel must match S<positive int> (e.g. "S1")',
        }),
        field: z
          .string()
          .min(1)
          .regex(/^[^/+#]+$/, 'Field must be a non-empty topic-safe string'),
        unit: z.string().optional(),
      }),
    ),
    relays: z.array(
      z.object({
        channel: z.string().regex(/^K(?:[1-9]|10)$/, {
          message: 'Relay channel must be one of K1..K10',
        }),
      }),
    ),
    displayName: z.string().optional(),
  })
  .superRefine((descriptor, ctx) => {
    const sensorChannels = new Set<string>();
    for (const sensor of descriptor.sensors) {
      if (sensorChannels.has(sensor.channel)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sensors'],
          message: `Duplicate sensor channel "${sensor.channel}"`,
        });
      }
      sensorChannels.add(sensor.channel);
    }
    const relayChannels = new Set<string>();
    for (const relay of descriptor.relays) {
      if (relayChannels.has(relay.channel)) {
        ctx.addIssue({
          code: 'custom',
          path: ['relays'],
          message: `Duplicate relay channel "${relay.channel}"`,
        });
      }
      relayChannels.add(relay.channel);
    }
  });

/**
 * Status payload contract: the bridge publishes a bare `"online"`/`"offline"`
 * string; an object `{"status": "online"}` is tolerated defensively — both
 * validate to the same normalized state. Anything else is dropped.
 */
const BoardStatusPayloadSchema = z.union([
  z
    .object({ status: z.enum(['online', 'offline']) })
    .passthrough()
    .transform(value => value.status),
  z.enum(['online', 'offline']),
]);

/**
 * Pure content equality for two parsed descriptors (order-sensitive lists —
 * a reordered republish is treated as a real change, which is harmless;
 * the guarded case is the content-identical broker replay). `unit` and
 * `displayName` are compared with `undefined` normalization so an omitted
 * optional equals an explicitly-`undefined` one.
 */
function descriptorEquals(
  a: BoardDescriptorData,
  b: BoardDescriptorData,
): boolean {
  if (a.boardType !== b.boardType) {
    return false;
  }
  if ((a.displayName ?? undefined) !== (b.displayName ?? undefined)) {
    return false;
  }
  if (a.sensors.length !== b.sensors.length) {
    return false;
  }
  if (a.relays.length !== b.relays.length) {
    return false;
  }
  for (let index = 0; index < a.sensors.length; index++) {
    const left = a.sensors[index]!;
    const right = b.sensors[index]!;
    if (
      left.channel !== right.channel ||
      left.field !== right.field ||
      (left.unit ?? undefined) !== (right.unit ?? undefined)
    ) {
      return false;
    }
  }
  for (let index = 0; index < a.relays.length; index++) {
    if (a.relays[index] !== b.relays[index]) {
      return false;
    }
  }
  return true;
}

/** Inventory mutation + persistence + broadcast (single fan-out point). */
export class BoardInventoryService {
  private readonly client: MqttClientPort;
  private readonly bus: EventBus;
  private readonly logger: Logger;
  private readonly store: BoardInventoryStorePort;
  private readonly getDeletedBoardCodes: () => readonly string[];
  private prefix: string;
  private readonly entries = new Map<string, BoardInventoryEntry>();

  constructor(options: {
    client: MqttClientPort;
    bus: EventBus;
    logger: Logger;
    store: BoardInventoryStorePort;
    prefix: string;
    getDeletedBoardCodes?: () => readonly string[];
  }) {
    this.client = options.client;
    this.bus = options.bus;
    this.logger = options.logger;
    this.store = options.store;
    this.prefix = options.prefix;
    this.getDeletedBoardCodes = options.getDeletedBoardCodes ?? (() => []);
    this.bus.subscribe('devices:changed', () => this.refreshVisibility());
  }

  /** Update the topic prefix and re-subscribe both wildcards (B1/M2). */
  applyPrefix(prefix: string): void {
    this.prefix = prefix;
    // Old-prefix subscriptions stay on the broker until disconnect but no
    // longer match the handlers (same discipline as RelayService).
    this.startListeners();
  }

  /**
   * Subscribe BOTH MQTT wildcards (descriptor + status) on the shared
   * client. Safe to call repeatedly (e.g. after every settings change /
   * reconnect) — the client port de-duplicates subscription topics in a
   * Set.
   */
  startListeners(): void {
    this.client.subscribe(`${this.prefix}/boards/+/descriptor`);
    this.client.subscribe(`${this.prefix}/boards/+/status`);
  }

  /**
   * Handle an MQTT message that may be a board descriptor
   * (`<prefix>/boards/<id>/descriptor`, retained). Returns true when the
   * topic matched (regardless of payload validity — same contract as
   * `handleStatusMessage`).
   *
   * A VALID descriptor REPLACES the previous descriptor for that board and
   * marks a status-less board `seen`.
   */
  handleDescriptorMessage(message: {
    topic: string;
    payload: string;
  }): boolean {
    const boardId = parseDescriptorTopic(message.topic, this.prefix);
    if (!boardId.ok) {
      return false;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(message.payload) as unknown;
    } catch {
      payload = null;
    }
    const parsed = BoardDescriptorPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(
        `Boards: ignoring invalid descriptor for "${
          boardId.value
        }": ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
      );
      return true;
    }
    if (parsed.data.boardId !== boardId.value) {
      this.logger.warn(
        `Boards: descriptor payload boardId "${parsed.data.boardId}" does not match topic boardId "${boardId.value}" — dropped`,
      );
      return true;
    }
    const existing = this.entries.get(boardId.value);
    const nextDescriptor: BoardDescriptorData = {
      boardType: parsed.data.boardType,
      sensors: parsed.data.sensors.map(sensor =>
        sensor.unit === undefined
          ? { channel: sensor.channel, field: sensor.field }
          : {
              channel: sensor.channel,
              field: sensor.field,
              unit: sensor.unit,
            },
      ),
      relays: parsed.data.relays.map(relay => relay.channel),
      ...(parsed.data.displayName === undefined
        ? {}
        : { displayName: parsed.data.displayName }),
    };
    // Content-identical retained replay (broker re-send / reconnect): NOT a
    // change — skip the upsert so `board:changed` fires only on real
    // changes (the parsed object is fresh each time, so the caller-side
    // reference comparison in `upsert` cannot see this equality).
    if (
      existing?.descriptor !== undefined &&
      descriptorEquals(existing.descriptor, nextDescriptor)
    ) {
      return true;
    }
    this.upsert(boardId.value, {
      status: existing?.status ?? 'seen',
      descriptor: nextDescriptor,
    });
    return true;
  }

  /**
   * Handle an MQTT message that may be a board status message
   * (`<prefix>/boards/<id>/status`, retained). Returns true when the topic
   * matched (regardless of payload validity).
   */
  handleStatusMessage(message: { topic: string; payload: string }): boolean {
    const code = parseBoardStatusTopic(message.topic, this.prefix);
    if (!code.ok) {
      return false;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(message.payload) as unknown;
    } catch {
      payload = message.payload;
    }
    const parsed = BoardStatusPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(
        `Boards: ignoring invalid status payload for "${code.value}": ${message.payload}`,
      );
      return true;
    }
    this.upsert(code.value, {
      status: parsed.data,
      descriptor: this.entries.get(code.value)?.descriptor,
    });
    return true;
  }

  /**
   * Seed an inventory entry from a valid QR label after its local hidden
   * marker is restored. A later MQTT descriptor replaces this placeholder
   * with the authoritative sensor and relay channels.
   */
  restoreFromQr(code: string, boardType?: string): void {
    const existing = this.entries.get(code);
    if (existing?.descriptor !== undefined) {
      this.refreshVisibility();
      return;
    }
    this.upsert(code, {
      status: existing?.status ?? 'seen',
      descriptor: {
        // A BLE-only recovery has no QR label to read the type from. The
        // empty type never matches an image key, so the card falls back to
        // the hardware-chip placeholder until the next descriptor arrives
        // (same path as any descriptor-less board — see `boardImages.ts`).
        boardType: boardType ?? '',
        sensors: [],
        relays: [],
      },
    });
  }

  /** The current inventory (insertion order). */
  getBoards(): readonly BoardInventoryEntry[] {
    const deletedCodes = new Set(this.getDeletedBoardCodes());
    return [...this.entries.values()].filter(
      board => !deletedCodes.has(board.code),
    );
  }

  /** Reconcile local deletion/restoration without changing the MQTT cache. */
  private refreshVisibility(): void {
    this.store.getState().setBoards(this.getBoards());
  }

  /**
   * Descriptor lookup (telemetry resolver port): the semantic field a board
   * channel carries, or `null` when the board/channel is unknown (no
   * descriptor yet, or the channel is not declared — never guess).
   */
  resolveSensorField(boardId: string, channel: string): string | null {
    if (!isSensorChannel(channel)) {
      return null;
    }
    if (this.getDeletedBoardCodes().includes(boardId)) {
      return null;
    }
    return (
      this.entries
        .get(boardId)
        ?.descriptor?.sensors.find(sensor => sensor.channel === channel)
        ?.field ?? null
    );
  }

  /**
   * Create/update one entry, persist into the mirror store and broadcast
   * `board:changed`. Callers pass the complete next state (merge happens at
   * the call sites above), so the bus event fires only on real changes.
   */
  private upsert(code: string, next: Omit<BoardInventoryEntry, 'code'>): void {
    const previous = this.entries.get(code);
    if (
      previous &&
      previous.status === next.status &&
      previous.descriptor === next.descriptor
    ) {
      return;
    }
    this.entries.set(code, { code, ...next });
    this.store.getState().setBoards(this.getBoards());
    this.bus.emit('board:changed', { code });
  }
}

/** Narrow store port the service pushes snapshots into (zustand board store). */
export interface BoardInventoryStorePort {
  getState(): {
    setBoards(boards: readonly BoardInventoryEntry[]): void;
  };
}
