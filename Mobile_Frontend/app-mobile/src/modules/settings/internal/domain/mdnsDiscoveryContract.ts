/**
 * mDNS discovery contract (settings-mdns-discovery plan) — the pure,
 * server-facing half of the "Tìm máy chủ trong mạng" feature (Bước 1 của
 * flow lần đầu cài app).
 *
 * The Smart Home Server advertises ONE Bonjour/avahi service:
 * - service type `_smarthome._tcp` (domain `local.`)
 * - instance name: free-form display name (e.g. `Smart Home Server`)
 * - port: the MQTT WebSocket port (9001)
 * - TXT records (ALL optional): `prefix`, `influx_port` (default 8086),
 *   `influx_org`, `influx_bucket`
 *
 * The authoritative server-side config (the complete avahi service file
 * the user copies into `/etc/avahi/services/`) lives in
 * `modules/settings/README.md` — the two-sided contract document, same
 * pattern as the BLE GATT contract.
 *
 * Fill rule (AD-2/AD-3): ONLY non-secret fields are ever produced here.
 * `mqtt.username`, `mqtt.password` and `influx.token` have NO key in the
 * output type ({@link MdnsDiscoveredPatch}) — they are structurally
 * unreachable. Missing/garbage TXT records fall back to defaults
 * (`influx_port` → 8086) or keep-current (prefix/org/bucket → the
 * draft's current values). Nothing here saves: the user reviews the
 * filled form and presses Lưu (fill-never-autosaves).
 */

import { formatHostForUrl } from '@core/net';

import { MqttSettingsSchema, type AppSettings } from './settingsSchema';

/** Service type advertised by the Smart Home Server (avahi `<type>`). */
export const MDNS_SERVICE_TYPE = 'smarthome';

/** Wire protocol of the service (avahi `<type>` suffix). */
export const MDNS_SERVICE_PROTOCOL = 'tcp';

/** mDNS browse domain (avahi default). */
export const MDNS_SERVICE_DOMAIN = 'local.';

/**
 * The fully-qualified service type (`_smarthome._tcp`) — the constant the
 * README's avahi example and the iOS `NSBonjourServices` entry must match
 * character-for-character.
 */
export const MDNS_SERVICE_TYPE_FULL = `_${MDNS_SERVICE_TYPE}._${MDNS_SERVICE_PROTOCOL}`;

/**
 * InfluxDB port used when the `influx_port` TXT record is missing or
 * unusable (AD-3 default — a minimal advertisement still fills InfluxDB).
 */
export const DEFAULT_INFLUX_PORT = 8086;

/** TXT record keys of the contract (all optional). */
export const MDNS_TXT_KEYS = {
  prefix: 'prefix',
  influxPort: 'influx_port',
  influxOrg: 'influx_org',
  influxBucket: 'influx_bucket',
} as const;

/** Parsed TXT records of an advertisement (absent = missing/garbage). */
export interface MdnsTxtRecords {
  /** MQTT topic prefix (missing/garbage → keep the draft's current). */
  readonly prefix?: string;
  /** InfluxDB port of the server (missing/garbage → 8086). */
  readonly influxPort?: number;
  /** InfluxDB org (missing/garbage → keep the draft's current). */
  readonly influxOrg?: string;
  /** InfluxDB bucket (missing/garbage → keep the draft's current). */
  readonly influxBucket?: string;
}

/**
 * One resolved Smart Home Server advertisement (already mapped from the
 * zeroconf lib's resolved event by the discovery service).
 */
export interface DiscoveredServer {
  /** Instance name (display only — free-form per the contract). */
  readonly name: string;
  /**
   * MQTT host: the LAN-reachable IPv4 closest to the phone's subnet, else
   * any surviving IPv4, else a global IPv6 — filtered ranges (loopback/
   * link-local/Docker/CGNAT/IPv6 link-local/IPv6 loopback) are never
   * selected; advertisements without a usable address are skipped.
   */
  readonly host: string;
  /** The MQTT WebSocket port (the advertisement's port). */
  readonly port: number;
  /** Parsed TXT records (tolerant: garbage → absent). */
  readonly txt: MdnsTxtRecords;
}

/** Raw TXT map as delivered by the zeroconf lib (values are untrusted). */
export type RawTxtRecords = Record<string, unknown> | null | undefined;

/** Read one TXT value as a non-empty trimmed string (tolerant). */
function readTxtString(raw: RawTxtRecords, key: string): string | undefined {
  const value = raw?.[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  // Some advertisers emit non-string TXT values — accept finite numbers.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * Parse the raw TXT map into the typed contract records — tolerant of
 * garbage (plan: "khoan dung giá trị rác"): missing keys, empty strings,
 * wrong types, malformed ports and prefixes all degrade to "absent"
 * (→ default/keep-current), never throw. The prefix is validated against
 * the settings schema's own prefix rule — zod stays the single authority
 * (no duplicated regex here).
 */
export function parseMdnsTxt(raw: RawTxtRecords): MdnsTxtRecords {
  const prefix = readTxtString(raw, MDNS_TXT_KEYS.prefix);
  const influxPortRaw = readTxtString(raw, MDNS_TXT_KEYS.influxPort);
  const influxPortNumber =
    influxPortRaw === undefined ? Number.NaN : Number(influxPortRaw);
  const influxOrg = readTxtString(raw, MDNS_TXT_KEYS.influxOrg);
  const influxBucket = readTxtString(raw, MDNS_TXT_KEYS.influxBucket);

  const records: {
    prefix?: string;
    influxPort?: number;
    influxOrg?: string;
    influxBucket?: string;
  } = {};

  if (
    prefix !== undefined &&
    MqttSettingsSchema.shape.prefix.safeParse(prefix).success
  ) {
    records.prefix = prefix;
  }
  if (
    Number.isInteger(influxPortNumber) &&
    influxPortNumber >= 1 &&
    influxPortNumber <= 65535
  ) {
    records.influxPort = influxPortNumber;
  }
  if (influxOrg !== undefined) {
    records.influxOrg = influxOrg;
  }
  if (influxBucket !== undefined) {
    records.influxBucket = influxBucket;
  }
  return records;
}

/**
 * The non-secret fields a discovered server fills into the form — the
 * EXACT patch surfaces for the store's `updateMqtt` / `updateInflux`
 * actions (AD-7: fill goes through the store, never direct state). The
 * secret fields (`mqtt.username`, `mqtt.password`, `influx.token`) have
 * no key here and can never appear (AD-2).
 */
export interface MdnsDiscoveredPatch {
  readonly mqtt: {
    readonly host: string;
    readonly port: number;
    readonly prefix: string;
  };
  readonly influx: {
    readonly url: string;
    readonly org: string;
    readonly bucket: string;
  };
}

/**
 * Map a discovered server onto the form draft: the MQTT host/port come
 * from the advertisement (port = the MQTT WebSocket port), the Influx URL
 * is built `http://{host}:{port}` with the port from the `influx_port`
 * TXT record (default 8086), and a missing prefix/org/bucket KEEPS the
 * draft's current value (AD-3 keep-current). Only non-secret fields are
 * returned (AD-2); nothing here saves.
 */
export function applyDiscoveredService(
  draft: AppSettings,
  service: DiscoveredServer,
): MdnsDiscoveredPatch {
  return {
    mqtt: {
      host: service.host,
      port: service.port,
      prefix: service.txt.prefix ?? draft.mqtt.prefix,
    },
    influx: {
      url: `http://${formatHostForUrl(service.host)}:${
        service.txt.influxPort ?? DEFAULT_INFLUX_PORT
      }`,
      org: service.txt.influxOrg ?? draft.influx.org,
      bucket: service.txt.influxBucket ?? draft.influx.bucket,
    },
  };
}
