# telemetry module

MQTT transport: connect over WebSocket, validate inbound payloads with zod,
resolve descriptor channels to semantic fields, expose connection state.

## Public API (`api/index.ts`)

- `TelemetryService` — `start()`, `stop()`, `applyConfig(cfg)`.
- `MqttConnectionConfig` — host/port/username/password/prefix.
- `telemetryStore` — zustand store with `connection` state + `lastErrorCode`.

## Internal

- `data/mqttJsClient.ts` — `mqtt` v5 adapter (pure JS, WebSocket, no native
  module — works in Expo Go).
- `data/telemetryStore.ts` — connection ViewModel; `payloads.ts` — numeric
  payload parsing for the wire contract (invalid payloads are dropped
  with a warn log, never crash).
- Topic contract (boards protocol v2, clean cut): one finite numeric metric
  per topic, identity is the board-scoped `{boardId, channel}` pair —
  `<prefix>/boards/<boardId>/sensors/S<n>/state`; subscription wildcard
  `<prefix>/boards/+/sensors/+/state` (QoS 1). Sensor channels follow the
  strict `S<positive int>` grammar (`S1`/`S10` valid; `S0`/`S01` rejected).
  The legacy `<prefix>/room/...` topics and the global JSON topic
  `<prefix>/tele/sensor` are RETIRED (not dual-read). Relay topics are owned
  by the relay module:
  `<prefix>/boards/<boardId>/relays/K<1..10>/set|state` (see
  `modules/relay/README.md`).

## Channel resolution + replay buffer (boards contract v2)

The service takes an OPTIONAL injected resolver port
`resolveSensorField(boardId, channel) → field | null` — the composition
root wires it to the devices module's descriptor inventory (lazy resolve,
no import cycle). A reading whose channel is not declared yet is BUFFERED
(latest value per `{boardId, channel}`, capped at 128 entries, FIFO
eviction) and replayed when `board:changed` fires for that board (the
inventory upserts its descriptor BEFORE emitting, so the resolver is
already current). Arrival order of retained messages (descriptor first vs
state first) therefore never loses the first reading.

Noise discipline: messages that are NOT sensor-state topics (descriptor,
status, relay, legacy shapes) are ignored SILENTLY — the shared client
fans them through here too. The service warns ONLY for sensor-SHAPED
topics with an invalid channel and for non-numeric payloads.

## Notes

- The devices module (not this one) maps capabilities onto the wire format —
  widgets bind `deviceId + capability`, never topics.
- AppState lifecycle (background disconnect / foreground reconnect) is wired
  in the composition root.

## Guideline (khung chung — tiếng Việt)

- **Mục đích:** transport MQTT duy nhất của app (WebSocket, `mqtt@5`).
  Validate payload zod, resolve channel qua descriptor, phát trạng thái
  kết nối (`idle → connecting → connected → reconnecting → failed`,
  backoff `1s × 2^n` trần 30s, tối đa 10 lần).
- **Public API:** `TelemetryService` (`start/stop/applyConfig`),
  `MqttConnectionConfig`, `telemetryStore` qua `api/`.
- **Mở rộng:** mọi host đi qua `normalizeBrokerHost` (`@core/net`);
  channel lạ buffer 128-entry + replay khi descriptor tới; topic không
  phải sensor-state bỏ qua im lặng, chỉ warn đúng topic sensor sai.
- **Test seam:** fake `MqttClientPort`, `FakeClock` cho backoff, resolver
  inject thay vì import devices (tránh cycle).
