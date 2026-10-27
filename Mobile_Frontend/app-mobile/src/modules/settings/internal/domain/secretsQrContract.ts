/**
 * Secrets QR contract (settings-secrets-qr plan) — the pure, server-facing
 * half of the "quét QR từ server" fill path (Bước 2 của flow lần đầu cài
 * app, sau khi mDNS đã điền các trường non-secret).
 *
 * The Smart Home Server prints ONE credentials QR for the owner to scan
 * (server-init.sh → terminal; see the settings README — the two-sided
 * contract document):
 *
 * ```json
 * { "schemaVersion": 1, "kind": "credentials",
 *   "mqttUsername": "...", "mqttPassword": "...", "influxToken": "...",
 *   "mqttHost": "192.168.x.x", "mqttPort": 9001, "mqttPrefix": "smarthome",
 *   "influxUrl": "http://192.168.x.x:8086", "influxOrg": "smarthome",
 *   "influxBucket": "telemetry" }
 * ```
 *
 * - `kind: "credentials"` — forward-compat: a future `kind: "system"`
 *   (full-system share) is a separate task. An unknown kind is an HONEST
 *   typed error ("Loại QR không hỗ trợ") and parsing never continues.
 * - All three secret fields are OPTIONAL keep-current: a missing OR empty
 *   field keeps the form's current value (never overwrites with nothing).
 *   A QR where NO secret field has a value is a typed "QR rỗng" error.
 * - The six non-secret connection fields (M27a backend, M27b app) are
 *   OPTIONAL and keep-current too: present AND non-empty fills verbatim;
 *   missing/empty keeps the form value; a junk value (wrong type, port
 *   out of 1–65535, prefix failing the settings rule) drops ONLY that
 *   field — the QR still parses.
 * - The fill NEVER saves: the screen dispatches the fields through the
 *   store's `updateMqtt` / `updateInflux` actions and the user still
 *   presses Lưu (same fill-never-autosaves rule as mDNS).
 *
 * Same pure-file pattern as `mdnsDiscoveryContract.ts`: NOT exported
 * through the module `api/` — a screen-local concern. zod is the single
 * authority on the shape (`schemaVersion` literal pin, the
 * `boardQrLabel.ts` pattern).
 */

import { normalizeInfluxBaseUrl } from '@core/net';
import { z } from 'zod';

import { MqttSettingsSchema } from './settingsSchema';

/**
 * The credentials QR schema (credentials-qr-nonsecret-fields / M27b):
 * `schemaVersion` pinned to 1, `kind` pinned to `"credentials"`, the three
 * SECRET fields optional strings (verbatim, NO catch — a junk secret must
 * fail loudly, and the `'empty'` check only ever looks at these three).
 * The six NON-SECRET fields are optional and per-field JUNK-TOLERANT
 * (`.optional().catch(undefined)`): a wrong-typed/garbage value drops that
 * one field while the QR still parses and fills everything else — the
 * `mdnsDiscoveryContract.ts` tolerance pattern. `mqttPort` is a NUMBER
 * (the server emits a JSON number, int 1–65535). Unknown/extra fields are
 * tolerated (zod default strip) so server tooling can enrich the payload
 * without breaking older app versions.
 */
export const CredentialsQrSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('credentials'),
  // Secrets — plain optional strings, never `.catch`-tolerated.
  mqttUsername: z.string().optional(),
  mqttPassword: z.string().optional(),
  influxToken: z.string().optional(),
  // Non-secret connection fields — per-field junk tolerance.
  mqttHost: z.string().optional().catch(undefined),
  mqttPort: z.number().int().min(1).max(65535).optional().catch(undefined),
  mqttPrefix: z.string().optional().catch(undefined),
  influxUrl: z.string().optional().catch(undefined),
  influxOrg: z.string().optional().catch(undefined),
  influxBucket: z.string().optional().catch(undefined),
});

/** A raw (pre-normalization) credentials QR payload. */
export type CredentialsQrPayload = z.infer<typeof CredentialsQrSchema>;

/**
 * The parsed credentials patch: ONLY the fields the QR actually carries
 * with a non-empty value. An absent key means "keep the current form
 * value" — the key is structurally unreachable for the applier, so an
 * empty QR field can never overwrite a secret with nothing.
 */
export interface CredentialsQrPatch {
  readonly mqttUsername?: string;
  readonly mqttPassword?: string;
  readonly influxToken?: string;
  /** Non-secret connection fields (M27b) — present only when usable. */
  readonly mqttHost?: string;
  readonly mqttPort?: number;
  readonly mqttPrefix?: string;
  readonly influxUrl?: string;
  readonly influxOrg?: string;
  readonly influxBucket?: string;
}

/** Why a scanned QR was rejected (each reason maps to an honest UI string). */
export type SecretsQrParseError =
  /** Not JSON / not a JSON object — not a QR this app understands. */
  | 'malformed'
  /** `kind` present but not `"credentials"` (e.g. a future `"system"`). */
  | 'unsupportedKind'
  /** `schemaVersion` missing or not 1. */
  | 'unsupportedVersion'
  /** A well-formed credentials QR where NO secret field has a value. */
  | 'empty';

/** The pure parse result: a normalized patch or a typed rejection reason. */
export type SecretsQrParseResult =
  | { readonly ok: true; readonly credentials: CredentialsQrPatch }
  | { readonly ok: false; readonly reason: SecretsQrParseError };

/**
 * Read one string field off a parsed payload (secrets AND non-secret
 * connection fields): present AND non-empty keeps its VERBATIM value
 * (secrets are never trimmed — a trailing space can be part of the
 * secret); missing or empty string drops out of the patch (keep-current).
 * Returns `undefined` when the field must not overwrite.
 */
function readSecretField(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.length > 0 ? value : undefined;
}

/** Writable builder form of the patch (the patch itself is readonly). */
type WritableCredentialsQrPatch = {
  -readonly [K in keyof CredentialsQrPatch]: CredentialsQrPatch[K];
};

/**
 * Pure QR parse: JSON.parse the raw scan, discriminate the kind, zod-
 * validate, and normalize to the keep-current patch — or a typed error
 * (never throws). The kind check runs BEFORE field parsing (an unknown
 * kind is honest "Loại QR không hỗ trợ" even if the rest would parse).
 */
export function parseCredentialsQr(raw: string): SecretsQrParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'malformed' };
  }
  const record = parsed as Record<string, unknown>;
  if (record.kind !== undefined && record.kind !== 'credentials') {
    return { ok: false, reason: 'unsupportedKind' };
  }
  if (record.schemaVersion !== 1) {
    return { ok: false, reason: 'unsupportedVersion' };
  }
  const result = CredentialsQrSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: 'malformed' };
  }
  const payload = result.data;
  const credentials: WritableCredentialsQrPatch = {};
  const username = readSecretField(payload.mqttUsername);
  const password = readSecretField(payload.mqttPassword);
  const token = readSecretField(payload.influxToken);
  if (username !== undefined) {
    credentials.mqttUsername = username;
  }
  if (password !== undefined) {
    credentials.mqttPassword = password;
  }
  if (token !== undefined) {
    credentials.influxToken = token;
  }
  // Non-secret fields (M27b): present AND non-empty → verbatim keep-value
  // (absent/empty → keep-current, never overwrite with nothing). The
  // prefix additionally passes the settings prefix rule (the
  // mdnsDiscoveryContract pattern — zod stays the single authority); a
  // junk prefix drops ONLY that field.
  const nonSecretStrings = [
    'mqttHost',
    'influxUrl',
    'influxOrg',
    'influxBucket',
  ] as const;
  for (const key of nonSecretStrings) {
    const value = readSecretField(payload[key]);
    if (value !== undefined) {
      // influx-ipv6-url-normalization: the known broken backend shape
      // emits `http://<unbracketed-ipv6>:8086`. Repair ONLY that
      // deterministic defect (bracket the host, separate the port);
      // non-http junk stays present verbatim so the existing settings
      // validation rejects it honestly.
      credentials[key] =
        key === 'influxUrl' ? normalizeInfluxBaseUrl(value) : value;
    }
  }
  if (payload.mqttPort !== undefined) {
    credentials.mqttPort = payload.mqttPort;
  }
  if (
    payload.mqttPrefix !== undefined &&
    payload.mqttPrefix.length > 0 &&
    MqttSettingsSchema.shape.prefix.safeParse(payload.mqttPrefix).success
  ) {
    credentials.mqttPrefix = payload.mqttPrefix;
  }
  if (
    credentials.mqttUsername === undefined &&
    credentials.mqttPassword === undefined &&
    credentials.influxToken === undefined
  ) {
    return { ok: false, reason: 'empty' };
  }
  return { ok: true, credentials };
}
