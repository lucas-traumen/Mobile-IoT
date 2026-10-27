/**
 * Cross-module MQTT naming conventions (pure functions).
 *
 * Topic contract — boards protocol v2 (boards-topic-contract-v2 plan,
 * clean cut: the legacy `<prefix>/room/...` topics are NOT dual-read):
 *
 * - descriptor (RETAINED, one per board, the authoritative channel source):
 *
 *   ```text
 *   <prefix>/boards/<boardId>/descriptor -> JSON (schemaVersion 1)
 *   ```
 *
 * - sensor state (RETAINED; ONE finite numeric metric per topic; identity is
 *   the board-scoped `{boardId, channel}` pair, normalized to the semantic
 *   `{roomId: boardId, field}` event by the telemetry resolver):
 *
 *   ```text
 *   <prefix>/boards/<boardId>/sensors/S<1..>/state -> 25.6
 *   ```
 *
 * - board status (RETAINED, plain text `online`/`offline`):
 *
 *   ```text
 *   <prefix>/boards/<boardId>/status -> online
 *   ```
 *
 * - relay topics are built/validated in
 *   `modules/relay/internal/domain/commands.ts`:
 *
 *   ```text
 *   <prefix>/boards/<boardId>/relays/K<1..10>/set   (app -> device, QoS 1, NOT retained)
 *   <prefix>/boards/<boardId>/relays/K<1..10>/state (device -> app)
 *   ```
 *
 * Every parser enforces: exact configured prefix, exact topic shape,
 * non-empty concrete segments free of MQTT wildcard (`+`, `#`) and separator
 * (`/`) characters. Sensor channels additionally follow the strict
 * {@link SENSOR_CHANNEL_REGEX} grammar.
 */

import { Errors, err, ok, type Result } from '@core/errors';

/** One sensor-state reading identity (topic suffix; channel is `S<n>`). */
export interface SensorStateAddress {
  readonly boardId: string;
  readonly channel: string;
}

/**
 * The sensor channel grammar: `S` followed by a positive integer WITHOUT a
 * leading zero (approved rule — `S1`/`S2`/`S10` valid; `S0`, `S01` rejected).
 */
export const SENSOR_CHANNEL_REGEX = /^S[1-9]\d*$/;

/** Guard: true when `channel` follows the strict `S<positive int>` grammar. */
export function isSensorChannel(channel: string): boolean {
  return SENSOR_CHANNEL_REGEX.test(channel);
}

/**
 * MQTT wildcard characters that must never appear inside a concrete topic
 * segment (a `+`/`#` in the board/channel segment would silently widen
 * dispatch).
 */
const WILDCARD_CHARS = new Set(['+', '#']);

/** Validate one concrete topic segment (non-empty, no wildcards/slashes). */
function isValidSegment(segment: string): boolean {
  if (segment.length === 0) {
    return false;
  }
  for (const ch of segment) {
    if (ch === '/' || WILDCARD_CHARS.has(ch)) {
      return false;
    }
  }
  return true;
}

/** Validate the configured prefix itself (non-empty, segment-safe). */
function isValidPrefix(prefix: string): boolean {
  return isValidSegment(prefix);
}

/** Validation error for a topic outside the boards contract. */
function topicError(message: string) {
  return err(Errors.validation(message));
}

/**
 * Build the descriptor topic for one board
 * (`<prefix>/boards/<boardId>/descriptor`).
 */
export function descriptorTopic(prefix: string, boardId: string): string {
  return `${prefix}/boards/${boardId}/descriptor`;
}

/** The descriptor subscription wildcard: `<prefix>/boards/+/descriptor`. */
export function descriptorSubscriptionTopic(prefix: string): string {
  return `${prefix}/boards/+/descriptor`;
}

/**
 * Parse a descriptor topic into its board id (pure, exact).
 *
 * @returns `ok(boardId)` for a well-formed
 *   `<prefix>/boards/<boardId>/descriptor` topic; `err(code: 'validation')`
 *   otherwise (wrong prefix, wrong shape, empty/wildcard-like segments).
 */
export function parseDescriptorTopic(
  topic: string,
  prefix: string,
): Result<string> {
  if (!isValidPrefix(prefix)) {
    return topicError(`Configured prefix is not topic-safe: "${prefix}"`);
  }
  const boardsPrefix = `${prefix}/boards/`;
  if (!topic.startsWith(boardsPrefix)) {
    return topicError(
      `Descriptor topic does not start with "${boardsPrefix}": ${topic}`,
    );
  }
  const parts = topic.slice(boardsPrefix.length).split('/');
  // Exactly `boardId + "descriptor"`.
  if (parts.length !== 2 || parts[1] !== 'descriptor') {
    return topicError(`Malformed descriptor topic: ${topic}`);
  }
  const boardId = parts[0] ?? '';
  if (!isValidSegment(boardId)) {
    return topicError(
      `Descriptor topic has an empty or wildcard-like segment: ${topic}`,
    );
  }
  return ok(boardId);
}

/**
 * Build the sensor-state topic for one board channel
 * (`<prefix>/boards/<boardId>/sensors/<channel>/state`).
 */
export function sensorStateTopic(
  prefix: string,
  boardId: string,
  channel: string,
): string {
  return `${prefix}/boards/${boardId}/sensors/${channel}/state`;
}

/** The sensor-state subscription wildcard: `<prefix>/boards/+/sensors/+/state`. */
export function sensorStateSubscriptionTopic(prefix: string): string {
  return `${prefix}/boards/+/sensors/+/state`;
}

/**
 * LENIENT sensor-state shape matcher (no channel-grammar validation):
 * returns the `{boardId, channel}` structure when the topic has the exact
 * `<prefix>/boards/<boardId>/sensors/<channel>/state` form with non-empty,
 * wildcard-free segments — `null` for anything else (status, descriptor,
 * relay, legacy room topics, wrong prefixes).
 *
 * The telemetry service uses this to split "not a sensor topic" (silently
 * ignored — no warn noise from descriptor/status/relay fan-out) from
 * "sensor-SHAPED topic with an invalid channel" (warned, then dropped).
 */
export function sensorStateTopicShape(
  topic: string,
  prefix: string,
): SensorStateAddress | null {
  if (!isValidPrefix(prefix)) {
    return null;
  }
  const boardsPrefix = `${prefix}/boards/`;
  if (!topic.startsWith(boardsPrefix)) {
    return null;
  }
  const parts = topic.slice(boardsPrefix.length).split('/');
  // Exactly `boardId + "sensors" + channel + "state"`.
  if (parts.length !== 4 || parts[1] !== 'sensors' || parts[3] !== 'state') {
    return null;
  }
  const boardId = parts[0] ?? '';
  const channel = parts[2] ?? '';
  if (!isValidSegment(boardId) || !isValidSegment(channel)) {
    return null;
  }
  return { boardId, channel };
}

/**
 * Parse a sensor-state topic into its `{boardId, channel}` identity (pure,
 * exact — shape match PLUS the strict channel grammar).
 *
 * @returns `ok({boardId, channel})` for a well-formed topic with a valid
 *   `S<positive int>` channel; `err(code: 'validation')` otherwise.
 */
export function parseSensorStateTopic(
  topic: string,
  prefix: string,
): Result<SensorStateAddress> {
  const shape = sensorStateTopicShape(topic, prefix);
  if (!shape) {
    return topicError(`Malformed sensor state topic: ${topic}`);
  }
  if (!isSensorChannel(shape.channel)) {
    return topicError(
      `Sensor channel must match S<positive int> without a leading zero (got "${shape.channel}"): ${topic}`,
    );
  }
  return ok(shape);
}

/**
 * Build the board status topic (`<prefix>/boards/<boardId>/status`). The
 * bridge publishes a RETAINED plain-text status per board here — the app's
 * discovery source for online/offline state.
 */
export function boardStatusTopic(prefix: string, boardId: string): string {
  return `${prefix}/boards/${boardId}/status`;
}

/** The board status subscription wildcard: `<prefix>/boards/+/status`. */
export function boardStatusSubscriptionTopic(prefix: string): string {
  return `${prefix}/boards/+/status`;
}

/**
 * Parse a board status topic into its board id (pure, exact).
 *
 * @returns `ok(boardId)` for a well-formed
 *   `<prefix>/boards/<boardId>/status` topic; `err(code: 'validation')` for
 *   wrong prefixes, wrong shapes, empty or wildcard-like segments (such
 *   messages are dropped by the board inventory service).
 */
export function parseBoardStatusTopic(
  topic: string,
  prefix: string,
): Result<string> {
  if (!isValidPrefix(prefix)) {
    return topicError(`Configured prefix is not topic-safe: "${prefix}"`);
  }
  const boardsPrefix = `${prefix}/boards/`;
  if (!topic.startsWith(boardsPrefix)) {
    return topicError(
      `Board status topic does not start with "${boardsPrefix}": ${topic}`,
    );
  }
  const parts = topic.slice(boardsPrefix.length).split('/');
  // Exactly `boardId + "status"`.
  if (parts.length !== 2 || parts[1] !== 'status') {
    return topicError(`Malformed board status topic: ${topic}`);
  }
  const boardId = parts[0] ?? '';
  if (!isValidSegment(boardId)) {
    return topicError(
      `Board status topic has an empty or wildcard-like segment: ${topic}`,
    );
  }
  return ok(boardId);
}
