# IoT Dashboard (app-mobile)

Expo (SDK 57) + TypeScript mobile app (Android-first) for a customizable IoT
dashboard: realtime temperature/humidity over MQTT (WebSocket), room-scoped
relay control (`{roomId, slot}` identity, slots 1..10 per room), sensor
history charts from InfluxDB v2, a Room/Device/Capability model, a
Template-based dashboard engine (Templates with ordered physical-room
references, a view-only Dashboard tab, room-scoped draft editing) and
settings for broker/InfluxDB/theme. UI is Vietnamese with two explicit
themes (Sáng/Tối — light/dark).

Architecture: **Modular Monolith + Hexagonal** — see [Architecture](#architecture).

## Requirements

- Node `>= 22.11.0`
- Expo SDK 57 toolchain (`npx expo` commands below)

## Setup

```bash
cd app-mobile
npm install
npm start            # Metro dev server
npm run android      # build & launch on emulator/device (Expo Go or dev build)
```

First Android build may need `expo run:android` for native modules
(`react-native-svg` etc. are Expo-compatible and work in Expo Go).

## Commands

| Command                           | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `npm start`                       | Start Metro                               |
| `npm run android` / `npm run ios` | Launch on device/emulator                 |
| `npm test`                        | Jest (jest-expo preset)                   |
| `npx tsc --noEmit`                | Typecheck (strict)                        |
| `npm run lint`                    | ESLint (incl. `eslint-plugin-boundaries`) |
| `npm run format:check`            | Prettier check                            |

## Architecture

```
app-mobile/
  App.tsx                    # root: composition root bootstrap + lifecycle
  src/
    core/                    # no business logic — shared infrastructure
      eventbus/              # typed EventBus (Observer), EventMap
      di/                    # manual DI Container
      errors/                # Result<T, AppError>, error taxonomy
      time/                  # Clock abstraction (SystemClock/FakeClock)
      logger/                # structured logger (only place using console)
      theme/                 # ThemeTokens (light/dark) + ThemeProvider/useTheme
      i18n/                  # STRINGS — every Vietnamese UI label
      constants.ts           # centralized constants (no magic numbers)
      events.ts              # shared event payload types
      topics.ts              # MQTT topic builders
    modules/                 # each module has api/index.ts facade + internal/
      settings/              # broker + InfluxDB + ui.theme settings (zod → AsyncStorage)
      telemetry/             # MQTT client port/adapter, payload validation, store
      relay/                 # relay command builders + optimistic store
      history/               # HistoryQuery + FluxQueryBuilder + InfluxDB v2 adapter + series stats
      devices/               # rooms/devices registry, capability model, state sync
      widgets/               # WidgetRegistry + WidgetContext + 2 built-in widgets (sensor-value / switch)
      dashboard/             # room-aware grid layout engine, repository, service, dashboards UI
    app/
      wiring/container.ts    # composition root (manual DI wiring)
      shell/RootTabs.tsx     # 3 bottom tabs: Dashboard / Lịch sử / Cài đặt
      settings/              # SettingsNavigator: the Settings tab's ONE typed
                             # native stack (root → advanced / device-management
                             # → Template → Room → Widget management hierarchy)
```

### Dependency rules (enforced by `eslint-plugin-boundaries`)

- Modules import **`core`** and **other modules' `api/` facade** only.
- A module must **never** import another module's `internal/`.
- `app/` (composition root + shell) may import anything; `core` imports only
  `core`; external packages are unrestricted.
- Domain logic lives in `internal/domain/` as **pure functions**; side effects
  (MQTT, HTTP, storage) only in `internal/data/` adapters; UI state in zustand
  stores (thin ViewModels, no business logic).

### Data flow

1. Settings are persisted via AsyncStorage and validated with zod.
2. `settings:changed` events reconfigure telemetry / relay / history.
3. MQTT messages arrive on the shared client; telemetry payloads are
   zod-validated; invalid payloads are dropped with a warn log (never crash).
4. Relay commands are validated (room-scoped `{roomId, index 1..10}`, state
   ON/OFF) before publishing to
   `<prefix>/boards/<boardId>/relays/K<1..10>/set` (QoS 1, non-retained);
   the UI is optimistic, confirmed by
   `<prefix>/boards/<boardId>/relays/K<1..10>/state` and rolled back with a
   visible error if the acknowledgement does not arrive within 3 s
   (M13-4 — no error topic exists on the wire; the timeout is the failure
   signal).
5. History queries InfluxDB v2 (Flux, read-only) with a Bearer token and maps
   CSV responses to chart points.
6. Devices layer (incremental bridge): widgets never know MQTT topics. A widget
   binds `deviceId + capability`; `DeviceStateSync` mirrors `telemetry:received`
   / `relay:*` bus events into the capability state store, and `switch`
   commands are delegated to the relay service. Deleting a device cascades via
   `devices:changed` → `removeWidgetsForDevice` across all dashboards.

### Dashboard engine (`dashboard` + `widgets` modules)

- Grid: 2 columns; widget sizes `1x1 | 2x1 | 1x2 | 2x2`; pure layout engine
  (find free slot, move/resize with bounds+overlap rejection, vertical
  compaction).
- **Responsive rendering:** the grid canvas width is measured with
  `onLayout` (window width only until the first layout event) and fed to the
  pure `gridMetrics` helpers — card rects and drag snapping always share the
  same metrics. Row height tracks the cell width 1:1, clamped to
  `[160, 176]`; invalid/unmeasured widths fall back to a documented default
  canvas so cells are never negative/NaN.
- **Safe area:** `SafeAreaProvider` mounts at the app root; `RootTabs` owns
  the runtime insets exactly once (content top inset + tab-bar bottom inset,
  whose surface fills the inset). Absolute surfaces (Add Widget flow) pad
  their footer by the runtime bottom inset via `@core/safeArea` helpers.
- **Room-scoped layout (V2):** a slot is free only within the same room — a
  widget added in room A never pushes widgets in room B, and vertical
  compaction runs per room (the room-level "Tất cả" was removed).
- **View surface vs management split:** the Dashboard tab renders ONLY the
  view-only screen — the "Smart Home" design language (dashboard-smart-home-
  redesign): ambient diagonal wash from the `smart` token block, header with
  the room menu button (opens the shared room list; the quick strip lives
  only on the History screen), the selected room name, the live connection
  chip, and the selected room's sectioned widgets (`'smart'` card
  appearance, per-TYPE view-mode card heights) with live values +
  commandable relays. Selecting a room changes the viewed room only — it
  never navigates and never mutates persisted layout. The
  Template → Room → Widget management hierarchy lives INSIDE the Settings
  tab (one native stack, opened by the "Quản lý Dashboard" entry): Template
  list → room cards → room widget dashboard → room-scoped editor.
- Draft editing: the editor mutates a draft copy of the Template's layouts;
  the live view stays untouched until "Lưu" — which commits the WHOLE draft
  end-state (source room + cross-room duplicate/move destinations) in ONE
  atomic service save. Lưu errors (validation, persistence) surface in the
  editor and keep the form open; "Hủy"/back (including the iOS swipe
  gesture via `beforeRemove`) discards the draft after an explicit
  confirmation. Removing a device rebinds its widgets via a draft rebind
  picker.
- Templates: a Template is one complete presentation/layout profile over
  the SAME physical home — it owns ORDERED REFERENCES to physical rooms
  (rooms/devices/MQTT/History identities are shared, never cloned) plus
  each referenced room's widget layout. Exactly one Template is ACTIVE and
  drives the Dashboard tab; create/rename/duplicate/delete plus
  room-reference add/duplicate/reorder/remove and the active-Template
  switch all live in the Settings hierarchy (the last Template is
  protected; deleting the active one falls back deterministically).
- Widget registry: `sensor-value`, `switch`. RETIRED types (never
  registered again; legacy persisted instances are removed on load):
  `connection` (Phase 1 — the global MQTT status lives in the Dashboard
  header and Settings), `history-chart` (approved room-sensor rework —
  History is a derived tab, never a Dashboard widget) and
  `room-device-list` (device-acceptance rework — the per-room overview
  card); each definition declares `supportedSizes` and
  `suggestForCapabilities` filters by the selected device's capabilities. Widgets receive runtime services (live state,
  series, commands, history queries) through React context
  (`WidgetServicesProvider`) — never module internals.
- **Reactive widget state (CP-R1):** widgets subscribe to the device state
  store through `subscribeDeviceState` + `useSyncExternalStore`
  (`useCapabilityState`/`useCapabilitySeries`). Snapshots are per-key, so a
  widget only re-renders when _its_ `deviceId:capability` value changes —
  unrelated store writes notify but skip the render (identity stability).
- **Add-widget flow (room-authoritative):** while editing a room the flow
  lists only that room's compatible devices, skips the redundant room step
  and always persists `roomId = editorRoomId` (the retired unbound
  `room-device-list` overview is never offered).
- **Per-room device capacity:** each concrete room holds at most 10
  telemetry-sensor and 10 relay devices (relay slots are room-scoped 1..10,
  duplicate slots rejected per room). The registry service is authoritative;
  the device-management UI mirrors the caps with counters/filters and shows
  general operation feedback in a top-center banner (field errors stay
  inline; destructive actions keep their confirmation dialogs).

### Single active room (V2)

- History reads the persisted shared active room
  (`dashboardStore.activeRoomId`): first run / deleted room falls back to
  the first ordered room; `null` = no rooms yet (directed to Settings).
- The Dashboard tab's view surface keeps its OWN local room selection
  (presentation-only, never persisted) over the ACTIVE Template's room
  references — it deliberately does NOT share History's selection.
- Capability labels shown in UI are the catalog's `label` (e.g. "Nhiệt độ"),
  while bindings, MQTT topics, InfluxDB `_field` values and the history query
  carry the machine key (`temperature`). The catalog form labels the machine
  key "Mã trường dữ liệu (MQTT/InfluxDB)" — it is fixed at creation (strict
  ASCII format for new keys), the label stays editable, and curated
  icon/preset suggestions prefill key/label/unit (selecting an icon alone
  never overwrites typed text).

### Theme system (`core/theme`)

- `ThemeTokens` (light + dark) are the only color source; screens call
  `useTheme()` and never hard-code colors (fixed per-field chart accents are
  the documented exception).
- Capability accents (sensor tiles, history cards, device list values) go
  through the centralized `resolveCapabilityAccent(field, def, tokens)`:
  built-in temperature/humidity resolve from the active theme tokens, custom
  capabilities use the catalog color. Built-in widgets never hard-code
  per-field colors.
- `ThemeProvider` receives the persisted mode (`light | dark`) from the
  settings store (`ui.theme`); the user picks Light/Dark explicitly —
  `Hệ thống` (`'system'`) was removed and persisted legacy values migrate
  deterministically to Light while valid MQTT/Influx credentials survive.
  Toggle it in Settings → Giao diện (Sáng/Tối) — it applies immediately.
- `app.json` still sets `userInterfaceStyle: "automatic"` (native OS chrome
  follows the device scheme); the in-app UI no longer does — the Expo
  `StatusBar` is themed per the explicitly selected tokens. Aligning the
  native chrome with the explicit choice is a possible follow-up.

## MQTT topic contract (boards protocol v2)

Prefix is configurable in Settings (default `smarthome` for NEW installs;
persisted settings are never rewritten).

The app consumes and publishes the backend's board protocol
(`{prefix}/boards/{boardId}/...`, descriptor-driven). `boardId` is the wire
identity of a board — the code a bound room carries (`DEVICE_ID ≡ boardId`
on the bridge; see the warning below).

| Topic                                          | Payload                                        | QoS | Retained | Direction      |
| ---------------------------------------------- | ---------------------------------------------- | --- | -------- | -------------- |
| `<prefix>/boards/<boardId>/descriptor`         | JSON descriptor (schemaVersion 1)              | 1   | yes      | device → app   |
| `<prefix>/boards/<boardId>/status`             | plain `online` / `offline` (JSON tolerated)    | 1   | yes      | device → app   |
| `<prefix>/boards/<boardId>/sensors/S<n>/state` | one finite number (e.g. `25.6`)                | 1   | yes      | device → app   |
| `<prefix>/boards/<boardId>/relays/K<1..10>/state` | `"ON"` / `"OFF"` (ack / feedback)           | 1   | yes      | device → app   |
| `<prefix>/boards/<boardId>/relays/K<1..10>/set`   | `"ON"` / `"OFF"` (command)                  | 1   | **no**   | app → device   |

Subscriptions (QoS 1): `{prefix}/boards/+/descriptor`,
`{prefix}/boards/+/status`, `{prefix}/boards/+/sensors/+/state`,
`{prefix}/boards/+/relays/+/state`.

### Descriptor (the authoritative channel source)

A RETAINED JSON descriptor declares what the board carries — the app NEVER
infers channels from observed data and never auto-creates rooms, devices or
capabilities from it:

```json
{
  "schemaVersion": 1,
  "boardId": "board-1",
  "boardType": "esp32-sensor-relay",
  "sensors": [
    { "channel": "S1", "field": "temperature", "unit": "°C" },
    { "channel": "S2", "field": "humidity" }
  ],
  "relays": [{ "channel": "K1" }, { "channel": "K2" }, { "channel": "K3" }],
  "displayName": "Phòng khách"
}
```

Validation rules (warn + skip, never crash): `schemaVersion` MUST be 1; the
payload `boardId` MUST equal the topic `boardId`; sensor channels follow
`S<positive int>` without a leading zero (`S1`, `S2`, `S10` — `S0`/`S01`
rejected); relay channels are `K1`..`K10`; duplicate sensor/relay channels
are rejected; a republished descriptor REPLACES the previous one (no
union). `displayName` is optional metadata — the stable `boardId` stays the
identity everywhere.

### Sensor state → semantic telemetry

Sensor channels resolve through the descriptor: `S1` on `board-1` means
`temperature` (the `field`), so the app emits its internal
`{roomId: boardId, field, value}` event — the identity model (ADR-022)
is unchanged. Arrival order does not matter: a retained sensor state that
arrives BEFORE its descriptor is buffered (latest value per
`{boardId, channel}`, capped at 128 entries) and replayed when the
descriptor lands. Channels NOT declared by the descriptor are never
displayed or dispatched (no invented values), while a declared channel
without data stays a valid capability.

### Relay command acknowledgement timeout (M13-4)

Relay commands publish exactly
`<prefix>/boards/<boardId>/relays/K<n>/set` (QoS 1, NOT retained) and the
device reports state on `<prefix>/boards/<boardId>/relays/K<n>/state`. The
app treats a matching state message as the acknowledgement and rolls the
optimistic UI state back if none arrives within `RELAY_COMMAND_TIMEOUT_MS`
= 3000 ms, emitting a typed `relay:commandFailed` event that surfaces as a
visible inline error on the switch widget. A second command for the same
relay while one is in flight is rejected. There is NO error topic on the
wire — the timeout IS the failure signal.

> **Documented wire limitation:** MQTT has no command correlation id. Local
> generations protect timers and concurrent local commands, but a late state
> packet cannot be proven to belong to the newest command. When a confirmed
> baseline is known, a non-matching state never acks a toggle; when no
> baseline was ever observed, a stale retained packet equal to the requested
> state can ack a command it does not belong to. The implementation does not
> claim stronger guarantees than the wire provides.

The legacy `<prefix>/room/...` protocol is RETIRED (clean cut, not
dual-read): the backend bridge v1 + firmware v2 publish exclusively on
`boards/...` topics.

The app connects over **WebSocket** (`ws://host:port`, default port 9001).

> The broker **host** field tolerates a pasted URL and a bare IPv6 literal:
> scheme (`ws://`), userinfo (`user:pass@`), path, and a trailing `:port`
> suffix are stripped, and a bare IPv6 literal is bracket-wrapped. The
> separate **port** field always stays authoritative.

> Note: since V2 widgets bind to `deviceId + capability` (devices module), not
> to topics — the topic contract above stays the wire format; the
> telemetry-sensor/relay bindings map capabilities onto it. History filters
> the InfluxDB `boardId` tag for board-bound rooms (see InfluxDB below).

### mosquitto WebSocket listener

Add to `mosquitto.conf`:

```ini
listener 9001
protocol websocket
allow_anonymous true        # or configure auth + set username/password in the app
```

Then (re)start mosquitto. The app connects to `ws://<broker-host>:9001` with
the settings entered in Settings → Cấu hình nâng cao. For a quick test
(prefix `smarthome`):

```bash
# Descriptor (retained) — declares the board's channels
mosquitto_pub -t 'smarthome/boards/board-1/descriptor' -r -m '{"schemaVersion":1,"boardId":"board-1","boardType":"esp32-sensor-relay","sensors":[{"channel":"S1","field":"temperature","unit":"°C"}],"relays":[{"channel":"K1"}]}'

# Status (retained, plain text)
mosquitto_pub -t 'smarthome/boards/board-1/status' -r -m 'online'

# Retained sensor state + relay state
mosquitto_pub -t 'smarthome/boards/board-1/sensors/S1/state' -r -m '25.6'
mosquitto_pub -t 'smarthome/boards/board-1/relays/K1/state' -r -m 'ON'

# Inspect everything the board publishes
mosquitto_sub -t 'smarthome/boards/board-1/#' -v

# Simulate the app's relay command (what the app publishes)
mosquitto_pub -t 'smarthome/boards/board-1/relays/K1/set' -m 'ON'
```

## Kết nối backend thật (board discovery + room↔board binding)

App hỗ trợ stack backend thật (Mobile_Backend bridge v1 + firmware v2): board
ESP32 thật đăng broker theo mã board (`DEVICE_ID ≡ boardId`), app nhận
descriptor + status + telemetry + điều khiển relay + khám phá board qua
Settings → **Thiết bị phần cứng**.

### 1. Cấu hình kết nối (Settings → Cấu hình nâng cao)

- **MQTT broker (WebSocket)**: host = IP LAN của broker (ví dụ
  `192.168.1.10`), port `9001` (WebSocket listener), user/pass nếu broker có
  auth; **Tiền tố topic** = `smarthome` (giá trị mặc định của app cho cài
  đặt mới và của bridge — đổi một bên thì phải đổi cả hai).
- **InfluxDB v2 (chỉ đọc)**: url `http://IP:8086`, org/bucket theo dashboard
  backend, token **chỉ có quyền đọc** (Data → API Tokens → Read bucket).

### 2. Quy ước DEVICE_ID = boardId trên firmware (⚠️ bẫy lệch phổ biến)

Bridge map `DEVICE_ID ≡ boardId`: mọi topic của board chạy dưới mã board —
`smarthome/boards/<mã board>/descriptor` (retained),
`.../status` (retained, plain `online`/`offline`),
`.../sensors/S1/state`, `.../relays/K1/state`, và app phát lệnh
`.../relays/K1/set`. App **không** dùng id nội bộ `room-…` cho MQTT:
phòng nào được gán board thì telemetry/dispatch, lệnh relay và filter lịch
sử (`boardId` tag) đều đi qua mã board; phòng không gán board (3 phòng demo
seed) tiếp tục dùng id nội bộ như cũ.

> Bẫy lệch: firmware flash `DEVICE_ID = 2` nhưng bạn tạo phòng và nhập mã
> `board-2` → board sẽ KHÔNG khớp phòng. Nhập mã board trong app ĐÚNG chuỗi
> firmware publish (một segment topic: chữ/số/`_`/`-`, không dấu cách,
> không tiếng Việt). Kiểm tra nhanh bằng
> `mosquitto_sub -t 'smarthome/boards/+/status' -v`.

### 3. Quy trình flash → dán nhãn → tạo phòng

1. Flash firmware cho board (deviceId đúng số đã kế hoạch), dán nhãn vật lý
   mã board lên vỏ board.
2. Bật board — nó hiện ngay trong Settings → **Thiết bị phần cứng**
   (online/loại board/kênh cảm biến theo descriptor/kênh relay K1–K3…)
   nhờ topic descriptor + status retained.
3. Settings → Phòng & thiết bị → `＋ Thêm phòng`: chọn board từ danh sách
   đang online (chip hiển thị `displayName` nếu board có phát, không thì mã
   board), rồi thêm cảm biến/rơ le vào phòng — với phòng gán board, danh
   sách lựa chọn theo ĐÚNG descriptor (kênh `S<n>` → trường, kênh
   `K<n>` còn trống).
4. Đổi board hỏng: ở **Thiết bị phần cứng**, gán board mới vào phòng cũ —
   widget giữ nguyên (binding theo phòng); `Gỡ gán` nếu muốn phòng không
   còn board. Một board chỉ gán được cho một phòng (service từ chối trùng).

## InfluxDB v2 setup (read-only)

1. Create an organization + bucket (e.g. `iot` / `sensors`).
2. Create an **API token with read access** (`Data → API Tokens → Generate`).
3. Enter url / org / bucket / token in the app Settings screen.

The token is stored **on the device only** (AsyncStorage) and never committed.
The app issues `POST {url}/api/v2/query?org={org}` with `Authorization: Token
…` and `Accept: application/csv`, then maps the CSV to chart series.

### Writing sensor data into InfluxDB

The backend writes the `sensors` measurement with a `boardId` tag (the wire
board id) AND a `roomId` tag (1:1 for real-board rows), the sensor field as
the Influx field key:

```influx
# line protocol example (one point per metric is fine — fields may be batched)
sensors,boardId=board-1,roomId=room-living temperature=25.6
sensors,boardId=board-1,roomId=room-living humidity=60
```

For a BOARD-BOUND room the app filters the `boardId` tag (the backend's
direct-Influx contract) and keeps BOTH tag columns — `boardId` stays a plain
column while the group key remains `roomId + _field`, so series pairing
stays mechanical:

```flux
from(bucket: "sensors")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "sensors")
  |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
  |> filter(fn: (r) => r.boardId == "board-1")
  |> keep(columns: ["_time", "_field", "_value", "roomId", "boardId"])
  |> group(columns: ["roomId", "_field"])
```

Unbound (seed-demo) rooms keep the historical `roomId` filter:

```flux
from(bucket: "sensors")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "sensors")
  |> filter(fn: (r) => r._field == "temperature")
  |> filter(fn: (r) => r.roomId == "room-living")
  |> keep(columns: ["_time", "_field", "_value", "roomId"])
  |> group(columns: ["roomId", "_field"])
```

> **Series identity (boards contract v2):** a parsed series is identified by
> `(boardId ?? roomId) + field` — board-bound rows pair by the board tag,
> legacy rows by `roomId`. One History card per REGISTERED room sensor,
> automatically (no chart configuration exists anywhere in the app). A
> registered sensor with no points in the range renders a
> `Chưa có dữ liệu` card instead of disappearing. Rows WITHOUT either tag
> cannot be attributed and are never guessed into a room.

## Key libraries

| Library                                     | Purpose                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `mqtt` (v5)                                 | Pure-JS MQTT over WebSocket (RN's built-in WebSocket)                   |
| `zustand`                                   | Thin ViewModel stores                                                   |
| `zod`                                       | Validation of all external data (MQTT payloads, InfluxDB CSV, settings) |
| `@react-native-async-storage/async-storage` | Settings / devices / dashboards persistence                             |
| `victory-native` (v36) + `react-native-svg` | Charts + sparklines                                                     |
| `@expo/vector-icons`                        | Tab bar + widget icons                                                  |

> **Note on fallbacks:** the plan named `react-native-mqtt-expo` (primary) and
> `sp-react-native-mqtt` (fallback). `react-native-mqtt-expo` does not exist on
> npm; `sp-react-native-mqtt` is a native TCP-only module that would break the
> WebSocket/no-dev-client design. Chosen instead: `mqtt` v5 (pure JS,
> WebSocket, ships RN types). Charting chose `victory-native` v36 (works with
> plain `react-native-svg`, no Skia) over v40 (requires Skia + reanimated +
> gesture-handler).

## Module READMEs

- [`src/core/README.md`](src/core/README.md)
- [`src/modules/settings/README.md`](src/modules/settings/README.md)
- [`src/modules/telemetry/README.md`](src/modules/telemetry/README.md)
- [`src/modules/relay/README.md`](src/modules/relay/README.md)
- [`src/modules/history/README.md`](src/modules/history/README.md)
- [`src/modules/devices/README.md`](src/modules/devices/README.md)
- [`src/modules/widgets/README.md`](src/modules/widgets/README.md)
- [`src/modules/dashboard/README.md`](src/modules/dashboard/README.md)

## Guideline cho contributor (đọc trước khi sửa code)

Đối chứng: `src/core/`, `src/modules/*/api/`, `src/app/wiring/container.ts`,
`app-mobile/.eslintrc.js` (HEAD `5d884dd`).

1. Luật biên module (lint chặn ở mức error): module chỉ import `core`
   và `api/` của module khác — KHÔNG BAO GIỜ import `internal/` của
   module khác. `core` chỉ import `core`. `app/` (composition root +
   shell) được import mọi thứ. UI cross-module chỉ đi qua `api/`
   (ví dụ History mượn `RoomListModal` qua `@modules/dashboard/api`).
2. Giao tiếp liên module qua EventBus typed (`EventMap` trong
   `src/core/events.ts`: `telemetry:received`, `relay:commandFailed`,
   `board:changed`, `devices:changed`, `dashboards:changed`,
   `settings:changed`) + facade `api/`. Khởi tạo implementation chỉ ở
   `src/app/wiring/container.ts` (TOKENS + manual DI) — module không tự
   `new` implementation của nhau.
3. Domain thuần khiết: logic nằm ở `internal/domain/` (hàm thuần, dễ
   test); side-effect (MQTT, HTTP, storage) chỉ ở `internal/data/`
   adapter; zustand store chỉ là ViewModel mỏng. Zod validate mọi dữ
   liệu ngoài (payload MQTT, CSV InfluxDB, form settings, QR,
   descriptor, TXT mDNS).
4. Chuẩn code: TS `strict`, không `any`, không `console.*` ngoài
   `src/core/logger/`. Prettier `singleQuote: true`,
   `trailingComma: 'all'`, `arrowParens: 'avoid'`. Alias
   `@core/*`, `@modules/*`, `@app/*` (đồng bộ tsconfig + babel +
   jest). Timeout/delay phải qua `Clock` seam (`FakeClock` trong test).
5. Thêm widget mới: định nghĩa trong `widgets` registry
   (`category/defaultSize/supportedSizes/suggestForCapabilities`),
   render qua `WidgetServicesProvider` (không import module khác trực
   tiếp), chịu được `undefined` (chưa có dữ liệu), tôn trọng
   `resolveCapabilityAccent` thay vì hard-code màu.
6. Thêm module mới: tạo `api/` (facade + types + events, TSDoc mọi
   export) + `internal/` (domain/data/services) + `ui/` + `README.md`
   theo khung chung; khai boundary trong `.eslintrc.js`; wiring trong
   `container.ts`; test colocated `*.test.ts` trong `internal/`.

## Quy trình dev + verify

Mọi lệnh chạy trong `app-mobile/`:

```bash
npm install          # lần đầu (node_modules gitignored)
npm start            # Metro dev server
npm test             # Jest (jest-expo); file đơn: npm test -- payloads
npm run lint         # ESLint incl. module-boundary
npx tsc --noEmit     # typecheck strict (script: npm run typecheck)
```

Lưu ý verify (bài học durable):

- `npm run format:check` (`prettier --check .`) quét cả `android/`
  generated khi thư mục này tồn tại (ISSUE-007) — khi đỏ vì native
  output, chạy source-scoped `npx prettier --check 'src/**/*.ts*'
  App.tsx` và giữ nguyên script gốc.
- Mọi thay đổi chạy thêm `git diff --check` (trắng mới được commit).
- Prettier PHẢI chạy từ trong `app-mobile/` (chạy từ repo root sẽ
  trúng binary khác và format sai — ISSUE-012 item 11).
- Phân biệt smoke: JS-only chỉ cần reload Metro; native-rebuild bắt
  buộc khi đụng `expo-camera`, `react-native-ble-plx`,
  `react-native-zeroconf`, `expo-network`, `expo-splash-screen`
  (`npx expo prebuild` + `npm run android` hoặc `gradlew` +
  `adb install -r`).
- Không commit/push tự động — harness chỉ commit khi user yêu cầu
  tường minh; secret/token chỉ ở AsyncStorage trên máy, không `.env`.

## Contract bổ sung (ngoài MQTT/Influx ở trên)

- mDNS discovery: browse `_smarthome._tcp` (`local.`), timeout 10s thật
  (`ok([])` chứ không phải lỗi). Chọn host qua `pickHost`
  (`mdnsDiscoveryService.ts`): lọc `fe80::/10`, `::1`, `127/8`,
  `169.254/16`, `172.16/12`, `100.64/10`, strip zone-id, unwrap
  `::ffff:a.b.c.d`; ưu tiên IPv4 cùng subnet điện thoại (heuristic
  shared-leading-octets vì JS không có subnet mask, qua `expo-network`);
  không fallback hostname/`.local`. Android dùng `ImplType.DNSSD` cho
  cả `scan` lẫn `stop` để nhận đủ list A/AAAA.
- Credentials QR (server in, app quét): JSON `kind: "credentials"`,
  secret thật chỉ có user/pass MQTT + token Influx (`'empty'` chỉ cho
  secret); 6 field non-secret optional (`mqttPort` số 1–65535...),
  junk chỉ rớt đúng field đó; `parseCredentialsQr` keep-current
  (thiếu/rỗng → giữ), fill không tự save — user vẫn bấm Lưu.
  Chi tiết 11 field: `src/modules/settings/README.md`.
- BLE provisioning v2 (thay v1 WiFi-only): app đẩy đủ SSID → pass
  WiFi → broker `host[:port]` (mặc định firmware `1883` TCP, KHÔNG
  phải WS `9001` của app) → user/pass MQTT → `PROVISION` qua 9 UUID
  `e5f4a3b2-…3a01..09`; trạng thái có `FAILED:BAD_BROKER` riêng;
  password WiFi/MQTT không persist (chỉ `lastSsid`). Contract verbatim:
  `src/modules/devices/README.md`.
- Cleartext Android: LAN dùng `ws://` + `http://` nên cần plugin local
  `plugins/withAndroidCleartextTraffic.js` set
  `android:usesCleartextTraffic="true"` lúc prebuild (bare key trong
  `app.json` không có tác dụng). Sửa manifest tay vô ích vì output
  prebuild bị xóa khi prebuild lại.

## Onboarding contributor mới (làm theo thứ tự)

1. `npm install` trong `app-mobile/`, đọc `src/core/README.md` rồi
   README của module mình sẽ chạm.
2. Mở `src/app/wiring/container.ts` để biết implementation nào đang
   đấu vào seam nào; tìm EventMap trong `src/core/events.ts` trước khi
   thêm event mới.
3. Muốn thêm 1 sensor mới: tạo capability trong `devices` (catalog),
   gán vào phòng, thêm widget `sensor-value`/`switch` trong editor
   (Settings → Quản lý Dashboard), xem live ở tab Dashboard, xem chart
   ở tab Lịch sử. Không cần biết topic MQTT khi làm widget — binding
   là `deviceId + capability`.
4. Muốn thêm 1 màn hình mới: đặt dưới Settings stack
   (`SettingsNavigator`), KHÔNG thêm tab thứ 4 (chỉ đúng 3 tab
   Dashboard / Lịch sử / Cài đặt). Dashboard tab là view-only.
5. Trước khi nhờ review: `npm test`, `npx tsc --noEmit`, `npm run
   lint`, Prettier file chạm, `git diff --check`, liệt kê file:dòng
   đối chứng cho mọi khẳng định contract.

## Security notes

- No `.env`, no secrets in the repo. The InfluxDB token lives in device
  storage only.
- MQTT credentials are optional and stored on-device as well.
