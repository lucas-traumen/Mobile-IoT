/**
 * BLE provisioning contract v2 (`ble-provisioning-v2-broker-push`): the
 * pure vocabulary of the BLE GATT provisioning flow — service/characteristic
 * UUIDs, the advertise name grammar, the Status notify values, the WiFi
 * credential limits, the broker-address format and the MQTT credential
 * limits, and the DeviceInfo JSON schema. The firmware side implements the
 * SAME contract (see `modules/devices/README.md`, section "BLE provisioning
 * contract" — the shared two-sided document).
 *
 * v2 extends v1 (WiFi-only) with three characteristics: the app also pushes
 * the BROKER ADDRESS (`host[:port]`, firmware default port 1883 MQTT-TCP —
 * NOT the app's WebSocket port) and the MQTT credentials, so a provisioned
 * board receives its full connectivity config. `CONNECTED` v2 semantics:
 * the board has an IP AND its broker MQTT connection is up.
 *
 * Every constant here mirrors the plan's GATT contract table verbatim;
 * changing a UUID is a FIRMWARE-BREAKING change and must go through both
 * sides at once. Pure file (same pattern as `boardQrLabel.ts`): no BLE
 * stack imports — the service layer (`bleWifiProvisioningService.ts`)
 * applies these values over `react-native-ble-plx`, and the display shell
 * (`BleProvisioningModal.tsx`) consumes only the parsed types.
 */

import { z } from 'zod';

import { ROOM_CODE_REGEX } from './devices';

// ---------------------------------------------------------------------------
// GATT identifiers (contract v2 table, base
// `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a01..09`).
// ---------------------------------------------------------------------------

/** The provisioning service the board advertises (app scan filter). */
export const BLE_SERVICE_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a01';

/** Device Info characteristic (READ): JSON in the QR label format. */
export const BLE_DEVICE_INFO_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a05';

/** WiFi SSID characteristic (WRITE, encrypted — pairing on first write). */
export const BLE_SSID_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a02';

/** WiFi Password characteristic (WRITE, encrypted; empty = open network). */
export const BLE_PASSWORD_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a03';

/** Command characteristic (WRITE): the app writes {@link PROVISION_COMMAND}. */
export const BLE_COMMAND_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a04';

/** Status characteristic (NOTIFY): ASCII values parsed by
 * {@link parseBleStatus}. */
export const BLE_STATUS_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a06';

/**
 * Broker address characteristic (WRITE, plain — `host:port` is not a
 * secret; the encrypted link/bond already exists from the SSID write):
 * ASCII `host` or `host:port`, validated by {@link validateBrokerAddress}.
 */
export const BLE_BROKER_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a07';

/**
 * MQTT username characteristic (WRITE, encrypted like the WiFi chars):
 * ASCII 0..64 bytes; empty = anonymous broker.
 */
export const BLE_MQTT_USERNAME_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a08';

/**
 * MQTT password characteristic (WRITE, encrypted like the WiFi chars):
 * ASCII/UTF-8 0..128 bytes; empty = no password.
 */
export const BLE_MQTT_PASSWORD_UUID = 'e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a09';

// ---------------------------------------------------------------------------
// Provisioning protocol constants.
// ---------------------------------------------------------------------------

/** Command written to the Command characteristic to start provisioning. */
export const PROVISION_COMMAND = 'PROVISION';

/** Advertised local-name prefix: `IoTBoard-{boardId}` (e.g. `IoTBoard-0`). */
export const BLE_BOARD_NAME_PREFIX = 'IoTBoard-';

/** MTU the app requests after connecting (best-effort, failure ignored). */
export const BLE_MTU_REQUEST = 128;

/** Firmware limit: SSID ≤ 32 bytes UTF-8 (required). */
export const BLE_SSID_MAX_BYTES = 32;

/** Firmware limit: password ≤ 63 bytes UTF-8 (empty = open network). */
export const BLE_PASSWORD_MAX_BYTES = 63;

/** Firmware limit: broker address 1..128 bytes (ASCII `host[:port]`). */
export const BLE_BROKER_MAX_BYTES = 128;

/** Firmware limit: MQTT username 0..64 bytes (empty = anonymous broker). */
export const BLE_MQTT_USERNAME_MAX_BYTES = 64;

/** Firmware limit: MQTT password 0..128 bytes (empty = no password). */
export const BLE_MQTT_PASSWORD_MAX_BYTES = 128;

/**
 * The MQTT-TCP port the firmware assumes when the broker address carries
 * no explicit port. NOT the app's WebSocket port — the firmware speaks raw
 * MQTT over TCP, so the app must never push its own WS port (AD-v2-2).
 */
export const BLE_BROKER_DEFAULT_PORT = 1883;

/**
 * App-side overall provisioning timeout: no `CONNECTED` (or `FAILED:*`)
 * status within this window → the provision fails with the `TIMEOUT`
 * reason (the plan's "timeout 30s không CONNECTED → báo TIMEOUT phía app").
 */
export const BLE_PROVISION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Status notify values.
// ---------------------------------------------------------------------------

/**
 * Firmware failure reasons carried by the `FAILED:{reason}` status values
 * (`BAD_AUTH` = WiFi wrong, `BAD_BROKER` = broker URI/format/connect or
 * MQTT-auth failure, plus `NO_SSID` / `TIMEOUT` / `ERROR` — exactly the
 * contract v2 list).
 */
export type BleProvisionFailureReason =
  | 'BAD_AUTH'
  | 'NO_SSID'
  | 'BAD_BROKER'
  | 'TIMEOUT'
  | 'ERROR';

/**
 * A parsed Status notification. `idle` arrives right after connect (before
 * PROVISION), `connecting` while the board tries WiFi, `connected` on
 * success, `failed` with the firmware's reason on any failure.
 */
export type BleProvisionStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  | {
      readonly kind: 'failed';
      readonly reason: BleProvisionFailureReason;
    };

/** The exact `FAILED:{reason}` wire values, mapped to typed reasons. */
const FAILED_STATUS_PREFIX = 'FAILED:';

const FAILED_REASONS_BY_SUFFIX: Readonly<
  Record<string, BleProvisionFailureReason>
> = {
  BAD_AUTH: 'BAD_AUTH',
  NO_SSID: 'NO_SSID',
  BAD_BROKER: 'BAD_BROKER',
  TIMEOUT: 'TIMEOUT',
  ERROR: 'ERROR',
};

/**
 * Pure Status-notify parse: an exact ASCII contract value → the typed
 * status; ANYTHING else (garbage, unknown value, unknown `FAILED:` suffix)
 * → `null`. Leading/trailing whitespace is tolerated (the notify may
 * arrive with padding); `null` keeps the service from confusing a broken
 * notification with a real terminal state.
 */
export function parseBleStatus(raw: string): BleProvisionStatus | null {
  const value = raw.trim();
  if (value === 'IDLE') {
    return { kind: 'idle' };
  }
  if (value === 'CONNECTING') {
    return { kind: 'connecting' };
  }
  if (value === 'CONNECTED') {
    return { kind: 'connected' };
  }
  if (value.startsWith(FAILED_STATUS_PREFIX)) {
    const reason =
      FAILED_REASONS_BY_SUFFIX[value.slice(FAILED_STATUS_PREFIX.length)];
    return reason === undefined ? null : { kind: 'failed', reason };
  }
  return null;
}

// ---------------------------------------------------------------------------
// WiFi credential validation (byte-accurate — the firmware limit is BYTES
// of UTF-8, not characters, so a Vietnamese SSID consumes 2–3 bytes/char).
// ---------------------------------------------------------------------------

/** Credential validation failures surfaced to the form (display concern). */
export type WifiCredentialsError =
  | 'ssidRequired'
  | 'ssidTooLong'
  | 'passwordTooLong';

/** Result of {@link validateWifiCredentials}. */
export type WifiCredentialsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: WifiCredentialsError };

/** UTF-8 code points of `text` (surrogate pairs collapse to one point). */
function utf8CodePoints(text: string): readonly number[] {
  const points: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i);
    if (code === undefined) {
      continue;
    }
    if (code > 0xffff) {
      // Astral code point — it consumed BOTH UTF-16 units of a pair.
      i += 1;
    }
    points.push(code);
  }
  return points;
}

/** UTF-8 byte length of `text` (the firmware limit counts bytes). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const code of utf8CodePoints(text)) {
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * Validate the provisioning credentials against the firmware limits:
 * SSID required, 1..32 UTF-8 BYTES; password optional (empty = open
 * network), 0..63 UTF-8 BYTES. The emptiness check trims (a whitespace-
 * only SSID is a typing accident, never a real network name); the byte
 * limits check the raw values — exactly what gets written to the board.
 */
export function validateWifiCredentials(
  ssid: string,
  password: string,
): WifiCredentialsValidation {
  if (ssid.trim().length === 0) {
    return { ok: false, error: 'ssidRequired' };
  }
  if (utf8ByteLength(ssid) > BLE_SSID_MAX_BYTES) {
    return { ok: false, error: 'ssidTooLong' };
  }
  if (utf8ByteLength(password) > BLE_PASSWORD_MAX_BYTES) {
    return { ok: false, error: 'passwordTooLong' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Broker address + MQTT credential validation (contract v2 — the board
// receives its full connectivity config, so the app validates the broker
// payload with the same byte-accuracy as the WiFi credentials).
// ---------------------------------------------------------------------------

/** Broker-address validation failures surfaced to the form (display). */
export type BrokerAddressError =
  | 'brokerRequired'
  | 'brokerTooLong'
  | 'brokerInvalid';

/** Result of {@link validateBrokerAddress}. */
export type BrokerAddressValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: BrokerAddressError };

/**
 * Hostname/IP characters accepted in the host part of a broker address:
 * letters, digits, dot (IP/hostname) and dash (hostname labels). IPv6
 * literals contain colons and are therefore NOT parseable by the tolerant
 * `host[:port]` grammar — a derived/typed IPv6 address fails validation and
 * the user must supply a reachable IPv4/hostname form instead.
 */
const BROKER_HOST_REGEX = /^[A-Za-z0-9._-]+$/;

/**
 * Validate the broker address against the firmware limits (contract v2):
 * required, 1..128 UTF-8 BYTES, the tolerant `host[:port]` format with NO
 * whitespace anywhere. The port part, when present, must be numeric and in
 * 1..65535; a bare `host` is valid (the firmware assumes
 * {@link BLE_BROKER_DEFAULT_PORT}). Emptiness trims (a whitespace-only
 * value is a typing accident, never an address); every other check sees
 * the raw value — exactly what gets written to the board.
 */
export function validateBrokerAddress(broker: string): BrokerAddressValidation {
  if (broker.trim().length === 0) {
    return { ok: false, error: 'brokerRequired' };
  }
  if (utf8ByteLength(broker) > BLE_BROKER_MAX_BYTES) {
    return { ok: false, error: 'brokerTooLong' };
  }
  if (/\s/.test(broker)) {
    return { ok: false, error: 'brokerInvalid' };
  }
  // Tolerant host[:port] split: a trailing `:<digits>` is a port, anything
  // else (including multi-colon IPv6) is part of the host string.
  const portMatch = /:\d+$/.exec(broker);
  const host = portMatch === null ? broker : broker.slice(0, portMatch.index);
  if (portMatch !== null) {
    const port = Number(portMatch[0].slice(1));
    if (port < 1 || port > 65535) {
      return { ok: false, error: 'brokerInvalid' };
    }
  }
  if (host.length === 0 || !BROKER_HOST_REGEX.test(host)) {
    return { ok: false, error: 'brokerInvalid' };
  }
  return { ok: true };
}

/** MQTT credential validation failures surfaced to the form (display). */
export type MqttCredentialsError = 'usernameTooLong' | 'mqttPasswordTooLong';

/** Result of {@link validateMqttCredentials}. */
export type MqttCredentialsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: MqttCredentialsError };

/**
 * Validate the MQTT credentials against the firmware limits (contract v2):
 * BOTH are optional — an empty username means an anonymous broker and an
 * empty password means none — and byte-accurate: username 0..64 UTF-8
 * BYTES, password 0..128 UTF-8 BYTES.
 */
export function validateMqttCredentials(
  username: string,
  password: string,
): MqttCredentialsValidation {
  if (utf8ByteLength(username) > BLE_MQTT_USERNAME_MAX_BYTES) {
    return { ok: false, error: 'usernameTooLong' };
  }
  if (utf8ByteLength(password) > BLE_MQTT_PASSWORD_MAX_BYTES) {
    return { ok: false, error: 'mqttPasswordTooLong' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Advertisement local-name grammar: `IoTBoard-{boardId}`.
// ---------------------------------------------------------------------------

/**
 * Extract the boardId from an advertised local name: the value must start
 * with the `IoTBoard-` prefix and the remainder must satisfy the SAME
 * board-code grammar as the QR label (`ROOM_CODE_REGEX`, 1–32 chars —
 * one MQTT topic segment). Anything else (`null`/missing prefix/grammar
 * violation) → `null`, so foreign BLE devices never enter the scan list.
 */
export function boardIdFromLocalName(localName: string | null): string | null {
  if (localName === null || !localName.startsWith(BLE_BOARD_NAME_PREFIX)) {
    return null;
  }
  const rest = localName.slice(BLE_BOARD_NAME_PREFIX.length);
  return rest.length >= 1 && rest.length <= 32 && ROOM_CODE_REGEX.test(rest)
    ? rest
    : null;
}

// ---------------------------------------------------------------------------
// DeviceInfo characteristic (READ): JSON identical in shape to the QR
// label (`boardQrLabel.ts`) — `{"schemaVersion":1,"boardId":"0",
// "boardType":"IoT_ESP32-S2R3"}`. The schema is duplicated here
// deliberately: the domain layer must not import from `ui/`, and the two
// contracts are pinned to stay identical by tests on both sides.
// ---------------------------------------------------------------------------

/** The DeviceInfo JSON schema — same shape as the QR label schema. */
export const BleBoardDeviceInfoSchema = z.object({
  schemaVersion: z.literal(1),
  boardId: z.string().min(1).max(32).regex(ROOM_CODE_REGEX, {
    message:
      'Board id must be 1-32 ASCII letters, digits, "_" or "-" (e.g. "board-1")',
  }),
  boardType: z.string().min(1),
});

/** A parsed DeviceInfo payload (extra fields stripped). */
export type BleBoardDeviceInfo = z.infer<typeof BleBoardDeviceInfoSchema>;

/**
 * Pure DeviceInfo parse: JSON string → the typed payload, or `null` for
 * every malformed input (non-JSON, wrong schemaVersion, missing fields,
 * boardId grammar violations). Mirrors `parseBoardQrLabel` — the board
 * describes itself in exactly the QR label format.
 */
export function parseBleDeviceInfo(json: string): BleBoardDeviceInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  const result = BleBoardDeviceInfoSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Typed provisioning error (domain-level: the modal may import this file —
// it never pulls the BLE stack).
// ---------------------------------------------------------------------------

/**
 * Why a provision attempt failed: the firmware reasons (from the Status
 * notify) or an app-side pre-flight reason — `TRANSPORT` (anything that
 * broke before the board could report: connect failure, write failure,
 * missing characteristic, the web/BLE-unavailable guard) or `VALIDATION`
 * (the payload failed {@link validateWifiCredentials} /
 * {@link validateBrokerAddress} / {@link validateMqttCredentials} BEFORE
 * any BLE call was made — a locally detectable mistake, never a firmware
 * report).
 */
export type BleProvisionErrorReason =
  | BleProvisionFailureReason
  | 'TRANSPORT'
  | 'VALIDATION';

/** Typed provision failure carrying the machine reason. */
export class BleProvisionError extends Error {
  readonly reason: BleProvisionErrorReason;

  constructor(reason: BleProvisionErrorReason, message: string) {
    super(message);
    this.name = 'BleProvisionError';
    this.reason = reason;
  }
}

/** Every reason {@link BleProvisionError} may carry. */
const VALID_PROVISION_REASONS: readonly BleProvisionErrorReason[] = [
  'BAD_AUTH',
  'NO_SSID',
  'BAD_BROKER',
  'TIMEOUT',
  'ERROR',
  'TRANSPORT',
  'VALIDATION',
];

/**
 * Structural reason extractor for caught values: a {@link BleProvisionError}
 * (or any error-like value carrying a valid string `reason`) yields that
 * reason; anything else is treated as a transport failure. Lets the display
 * shell map failures without importing the BLE service module.
 */
export function toBleProvisionErrorReason(
  error: unknown,
): BleProvisionErrorReason {
  if (typeof error === 'object' && error !== null && 'reason' in error) {
    const reason = (error as Record<string, unknown>).reason;
    if (typeof reason === 'string') {
      const match = VALID_PROVISION_REASONS.find(
        candidate => candidate === reason,
      );
      if (match !== undefined) {
        return match;
      }
    }
  }
  return 'TRANSPORT';
}

// ---------------------------------------------------------------------------
// Base64 codecs (pure — no Buffer/btoa/atob dependency; the service layer
// and tests rely on the exact same encoding the native BLE stack sees).
// ---------------------------------------------------------------------------

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP: Readonly<Record<string, number>> = (() => {
  const lookup: Record<string, number> = {};
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    lookup[BASE64_ALPHABET[i]] = i;
  }
  return lookup;
})();

function utf8Bytes(text: string): readonly number[] {
  const out: number[] = [];
  for (const code of utf8CodePoints(text)) {
    if (code <= 0x7f) {
      out.push(code);
    } else if (code <= 0x7ff) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return out;
}

function utf8FromBytes(bytes: readonly number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 === undefined) {
      break;
    }
    if (b0 < 0x80) {
      out += String.fromCodePoint(b0);
      i += 1;
    } else if (b0 < 0xe0) {
      const b1 = bytes[i + 1] ?? 0;
      out += String.fromCodePoint(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      i += 2;
    } else if (b0 < 0xf0) {
      const b1 = bytes[i + 1] ?? 0;
      const b2 = bytes[i + 2] ?? 0;
      out += String.fromCodePoint(
        ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f),
      );
      i += 3;
    } else {
      const b1 = bytes[i + 1] ?? 0;
      const b2 = bytes[i + 2] ?? 0;
      const b3 = bytes[i + 3] ?? 0;
      out += String.fromCodePoint(
        ((b0 & 0x07) << 18) |
          ((b1 & 0x3f) << 12) |
          ((b2 & 0x3f) << 6) |
          (b3 & 0x3f),
      );
      i += 4;
    }
  }
  return out;
}

/**
 * UTF-8 → Base64 (pure): the encoding for values written to the SSID /
 * Password / Broker / MQTT username / MQTT password / Command
 * characteristics (`react-native-ble-plx` carries Base64). Implemented
 * locally — Hermes/JS runtimes differ in `btoa` support, and a pure codec
 * keeps the round trip testable everywhere.
 */
export function utf8ToBase64(text: string): string {
  const bytes = utf8Bytes(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_ALPHABET[b0 >> 2];
    out +=
      b1 === undefined
        ? BASE64_ALPHABET[(b0 & 0x03) << 4]
        : BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out +=
      b1 === undefined
        ? '='
        : b2 === undefined
        ? BASE64_ALPHABET[(b1 & 0x0f) << 2]
        : BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Base64 → UTF-8 (pure): decodes a Status/DeviceInfo notification value
 * back to text. Non-alphabet characters (padding `=`, whitespace) are
 * ignored, so both padded and unpadded input decode identically.
 */
export function base64ToUtf8(base64: string): string {
  const bits: number[] = [];
  for (const char of base64) {
    const value = BASE64_LOOKUP[char];
    if (value !== undefined) {
      bits.push(value);
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i + 1 < bits.length; i += 4) {
    const sextets = [bits[i], bits[i + 1], bits[i + 2], bits[i + 3]];
    const group =
      ((sextets[0] ?? 0) << 18) |
      ((sextets[1] ?? 0) << 12) |
      ((sextets[2] ?? 0) << 6) |
      (sextets[3] ?? 0);
    // A 4-sextet group yields 3 bytes; the trailing group yields fewer —
    // the byte count is the sextet count rounded down, +1 per remainder.
    const byteCount = Math.floor(
      Math.min(sextets.filter(s => s !== undefined).length, 4) * 0.75,
    );
    for (let b = 0; b < byteCount; b += 1) {
      bytes.push((group >> (16 - 8 * b)) & 0xff);
    }
  }
  return utf8FromBytes(bytes);
}
