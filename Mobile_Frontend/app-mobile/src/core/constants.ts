/**
 * Centralized app-wide constants.
 *
 * No magic numbers/strings in domain or UI code — import from here.
 * Secrets are NEVER stored here; tokens live in device storage only.
 */

/**
 * Default MQTT topic prefix (configurable through settings).
 *
 * boards-topic-contract-v2 decision 7: `smarthome` for NEW installs only —
 * persisted settings are never rewritten by this constant.
 */
export const DEFAULT_MQTT_PREFIX = 'smarthome';

/** Default MQTT WebSocket port (mosquitto `listener 9001` + `protocol websocket`). */
export const DEFAULT_MQTT_WS_PORT = 9001;

/** Default MQTT keepalive interval in seconds. */
export const DEFAULT_MQTT_KEEPALIVE_SECONDS = 60;

/** MQTT connection timeout in milliseconds. */
export const DEFAULT_MQTT_CONNECT_TIMEOUT_MS = 10_000;

/** Base delay for the first reconnect attempt (exponential backoff). */
export const RECONNECT_BASE_DELAY_MS = 1_000;

/** Maximum delay between reconnect attempts. */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/** Multiplier applied to the delay after every failed attempt. */
export const RECONNECT_BACKOFF_FACTOR = 2;

/** Maximum reconnect attempts before giving up (state → `failed`). */
export const RECONNECT_MAX_ATTEMPTS = 10;

/**
 * MQTT QoS used for telemetry/descriptor/status subscriptions and the relay
 * `set` publish (boards contract v2 — QoS 1).
 */
export const MQTT_QOS = 1 as const;

/**
 * Relay command acknowledgement timeout (boards-topic-contract-v2 decision
 * M13-4 / decision 2): a `set` command not confirmed by a matching
 * `.../relays/K{n}/state` message within this window rolls the optimistic
 * state back and emits `relay:commandFailed`.
 */
export const RELAY_COMMAND_TIMEOUT_MS = 3_000;

/**
 * Relay slots supported by the hardware contract (1..10).
 *
 * Room-scoped protocol (settings-information-architecture plan): every
 * concrete room owns slots 1..10 independently, so the same slot number can
 * exist in two rooms without aliasing. Identity is always
 * `{ roomId, slot }` (see `modules/relay` + `modules/devices`).
 */
export const RELAY_INDICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** A relay slot number (1..10). */
export type RelaySlotIndex = (typeof RELAY_INDICES)[number];

/** InfluxDB v2 query API path (relative to the configured base URL). */
export const INFLUX_QUERY_PATH = '/api/v2/query';

/** Max number of points returned by one history query. */
export const INFLUX_MAX_POINTS = 500;

/** InfluxDB token header name. */
export const INFLUX_TOKEN_HEADER = 'Authorization';

/** InfluxDB Bearer token prefix. */
export const INFLUX_TOKEN_PREFIX = 'Token ';

/** Default history range when the app starts. */
export const DEFAULT_HISTORY_RANGE = '1h' as const;

/** Available history ranges, in display order. */
export const HISTORY_RANGES = ['1h', '24h', '7d'] as const;

/** AsyncStorage keys (prefixed to avoid collisions with future keys). */
export const STORAGE_KEYS = {
  settings: 'iot-dashboard:settings',
  devices: 'iot-dashboard:devices',
  dashboards: 'iot-dashboard:dashboards',
} as const;

/** Default theme preference (explicit Light choice; legacy `system` migrates here). */
export const DEFAULT_THEME_MODE = 'light' as const;

/** Number of columns in the constrained 2-column widget grid. */
export const WIDGET_GRID_COLUMNS = 2 as const;

/** App display name (mirrors `app.json`). */
export const APP_NAME = 'IoT Dashboard';

/**
 * App release version (mirrors `expo.version` in `app.json`).
 *
 * Single source of truth for the Settings version footer — the UI renders
 * it through the `settings.versionLabel` i18n template and never reads or
 * parses `app.json` at runtime. Bumping the release version means updating
 * BOTH this constant and `app.json` in the same change.
 */
export const APP_VERSION = '1.0.0';
