# devices module

Rooms, devices and the capability model — the V2 bridge between widgets and
the MQTT wire format.

## BLE provisioning contract v2 (`ble-provisioning-v2-broker-push` — SHARED DOC, firmware side implements this)

Board mới rút hộp (chưa có WiFi) được cấu hình mạng qua BLE từ app. Phần
dưới đây là hợp đồng 2 phía: app (đã code) và firmware (cần flash theo
đúng bảng này) — đổi bất kỳ UUID/giá trị nào là đổi CẢ HAI phía.

**v2 SUPERSEDE v1 (WiFi-only):** app giờ đẩy **đầy đủ** cấu hình kết nối —
WiFi + địa chỉ broker + tài khoản MQTT — board không cần `.env` network
config gì nữa. Firmware cũ (v1, broker trong `.env`) vẫn advertise thấy
nhưng provisioning v2 cần firmware v2; app KHÔNG có chế độ fallback v1.

**Base UUID (cố định, 128-bit):**

| Mục                                           | UUID                                   |
| --------------------------------------------- | -------------------------------------- |
| Service                                       | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a01` |
| WiFi SSID (WRITE, encrypted)                  | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a02` |
| WiFi Password (WRITE, encrypted)              | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a03` |
| Command (WRITE)                               | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a04` |
| Device Info (READ)                            | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a05` |
| Status (NOTIFY)                               | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a06` |
| **Broker address (WRITE, plain — MỚI v2)**    | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a07` |
| **MQTT username (WRITE, encrypted — MỚI v2)** | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a08` |
| **MQTT password (WRITE, encrypted — MỚI v2)** | `e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a09` |

**Định dạng giá trị:**

- WiFi SSID: UTF-8, 1..32 bytes, bắt buộc. WiFi Password: UTF-8,
  0..63 bytes, rỗng = mạng mở.
- **Broker (3a07):** ASCII `host` hoặc `host:port` (VD
  `192.168.100.3:1883`), 1..128 bytes, KHÔNG chứa whitespace. Port thiếu →
  firmware mặc định **1883 (MQTT TCP)** — KHÔNG phải port WebSocket 9001
  của app (firmware nói raw TCP, app nói WS — 2 listener khác nhau của
  mosquitto). App tự chốt: prefill luôn là `host:1883`; user sửa tay được.
- **MQTT username (3a08):** ASCII 0..64 bytes; rỗng = broker ẩn danh.
- **MQTT password (3a09):** ASCII/UTF-8 0..128 bytes; rỗng = không pass.
- 3a07 là WRITE **thường** (`host:port` không phải secret — bond/encrypted
  link đã thiết lập từ lần ghi 3a02); 3a02/3a03/3a08/3a09 là WRITE
  **encrypted** (ESP_GATT_PERM_WRITE_ENCRYPTED).

**Sequence ghi (app → board, mọi ghi write-with-response, Base64 UTF-8):**

```
SSID(3a02) → passWiFi(3a03) → broker(3a07) → userMQTT(3a08)
  → passMQTT(3a09) → PROVISION(3a04)
```

**Hành vi firmware (ESP32):**

1. Boot **không có WiFi đã lưu** (hoặc sau BOOT-clear) → bật BLE
   advertising: service UUID trên + local name `IoTBoard-{boardId}`
   (VD `IoTBoard-0`)
2. **Device Info** (read): trả về JSON y format nhãn QR —
   `{"schemaVersion":1,"boardId":"0","boardType":"IoT_ESP32-S2R3"}` (board
   tự mô tả bằng đúng descriptor của nó)
3. **SSID/Password/MQTT username/MQTT password** chars: `WRITE` + yêu cầu
   encrypted link (ESP_GATT_PERM_WRITE_ENCRYPTED) → lần ghi đầu kích hoạt
   **pairing Just Works + bond** (chấp nhận không MITM — đây là hạn chế
   đã ghi rõ). **Broker address** char: WRITE thường.

4'. **Command** char: nhận `PROVISION` (ASCII) → thử WiFi bằng SSID/pass
đã ghi; WiFi OK → lưu NVS → **nối broker TCP `host:port` bằng user/pass
MQTT đã ghi** (lưu NVS khi kết nối broker thành công). MQTT auth/URI fail
→ notify `FAILED:BAD_BROKER` (KHÔNG xoá WiFi đã lưu — chỉ sai broker,
user sửa broker/MQTT rồi gửi lại). Giới hạn byte: xem bảng định giá trị
phía trên.

4. **Status** notify (ASCII):
   - `IDLE` (sau khi app connect, chưa PROVISION)
   - `CONNECTING` (đang thử WiFi, rồi cả broker)
   - `CONNECTED` (**v2: WiFi có IP VÀ broker MQTT đã nối** — semantics
     mở rộng so với v1 "có IP"; firmware giữ BLE ~30s nữa rồi tắt)
   - `FAILED:BAD_AUTH` (WiFi sai) | `FAILED:NO_SSID` |
     `FAILED:BAD_BROKER` (**v2: broker URI sai format / không nối được /
     MQTT auth bị từ chối** — tách khỏi lỗi WiFi để user biết secret nào
     sai) | `FAILED:TIMEOUT` | `FAILED:ERROR` (app cho sửa + gửi lại;
     chars ghi lại được)
5. Ghi dài (>MTU) dùng write-with-response — firmware reassemble (ATT long
   write chuẩn); app request MTU 128 sau connect (best-effort)

**Re-provision (cứu chữa — chỉ firmware):** giữ nút **BOOT 5s** → board
xoá WiFi + broker + auth khỏi NVS → phát BLE lại (localName
`IoTBoard-{boardId}`) → app scan thấy, form prefill như thường (lastSsid
nhớ) → gửi cấu hình mới. App KHÔNG cản re-provision bao giờ.

**App side (đã triển khai trong module này):**

- Scan lọc theo Service UUID; board nhận diện qua local name
  `IoTBoard-{boardId}` (`bleProvisioningContract.boardIdFromLocalName`,
  boardId dùng đúng grammar mã board như nhãn QR).
- Thứ tự provisioning: connect → request MTU 128 (best-effort) → discover
  → subscribe Status (TRƯỚC khi ghi) → 6 ghi theo sequence trên — toàn bộ
  write-with-response, Base64 UTF-8. Đếm byte bằng UTF-8 thật
  (`validateWifiCredentials` / `validateBrokerAddress` /
  `validateMqttCredentials`), không đếm ký tự; payload không hợp lệ bị
  chặn phía app (typed `VALIDATION`) TRƯỚC khi chạm BLE.
- Prefill Broker/MQTT: BoardsScreen đọc settings qua settings api facade,
  suy broker HOST từ broker URL bằng regex khoan dung (strip
  scheme/`user:pass@`/path/port WS — KHÔNG dùng `URL` constructor, Hermes
  không có; suy hỏng → field trống, user tự gõ, không block), port luôn
  chốt `:1883`; MQTT user/pass lấy thẳng từ settings. App KHÔNG BAO GIỜ
  persist MQTT credentials (chỉ gửi qua BLE); WiFi password cũng không.
- Timeout phía app 30s không thấy `CONNECTED`/`FAILED:*` → báo TIMEOUT
  (`BLE_PROVISION_TIMEOUT_MS`); lỗi firmware trả về dạng typed
  (`BleProvisionError.reason`).
- Sau `CONNECTED` (WiFi + broker), app khôi phục card của board đã chọn,
  bỏ marker ẩn nếu có và xóa bộ lọc tìm kiếm đang che card. Card chỉ hiện
  Online khi nhận status MQTT; descriptor cung cấp các kênh sensor/relay.
  Board tắt BLE sau ~30s. MQTT không tự bỏ marker ẩn khi chưa khôi phục.
- App nhớ SSID lần gửi thành công gần nhất (AsyncStorage key riêng
  `devices.ble.lastSsid` — KHÔNG đụng schema registry chính).
- Hạn chế đã duyệt: pairing Just Works + bond, không MITM; validator
  broker chỉ nhận host IPv4/hostname (`[A-Za-z0-9._-]`), KHÔNG hỗ trợ IPv6
  literal (dạng nhiều dấu `:`).
- **NVS plain-text (hạn chế đã chấp nhận):** pass WiFi + tài khoản MQTT
  được lưu trong NVS của board dạng plain-text (ESP32 không có flash
  encryption) — kế thừa từ v1, đây là hạn chế đã được chấp nhận.

## Public API (`api/index.ts`)

- `Room`, `Device`, `DeviceBinding` (`telemetry-sensor` | `relay` with a
  room-scoped slot 1..10), `CapabilityDef`, `CapabilityType`,
  `DeviceCapabilityValue`, `SeriesPoint`.
- `DeviceRegistryService` — load/save rooms + devices + capability catalog.
- `DeviceCommandService` — `switch` capability → room-scoped relay command;
  sensor capabilities are read-only.
- `createDeviceStateStore` — zustand store: live values keyed
  `deviceId:capability` + capped numeric series (`subscribe(listener)` is the
  reactive seam for widgets).
- Sensor projection (approved room-sensor rework): `projectSensorRegistrations`,
  `countRoomSensors`, `countRoomCategory`, `sensorFieldTakenInRoom` — one
  user-facing sensor = ONE metric; identity is `{roomId, field}` (unique per
  room); a legacy multi-capability board projects as separate
  temperature/humidity registrations.
- Per-room capacity contract (service-authoritative): `MAX_SENSORS_PER_ROOM`,
  `MAX_RELAYS_PER_ROOM` (10 + 10), plus pure helpers `countRoomDevices`,
  `maxDevicesPerRoom`, `deviceCategory`, `roomCapacityWorseningError`
  (sensor quota counts PROJECTED metric registrations),
  `relaySlotTakenInRoom` — the UI mirrors them for counters/disabled states.

## Internal

- `domain/` — capability model (kind: sensor/switch; unit, icon, color,
  machine key + editable label), room migration helpers, per-room capacity
  helpers, curated capability icon groups/presets (`capabilityPresets.ts`),
  pure validation.
- `data/deviceRegistry.ts` — AsyncStorage persistence (zod-validated).
- `data/deviceStateSync.ts` — mirrors `telemetry:received` / `relay:*` /
  `relay:commandFailed` bus events into the state store; room/field readings
  dispatch EXACTLY (a `{roomId, field, value}` message updates only the
  matching registrations); relay events match `{roomId, slot}` so equal
  slots in separate rooms stay isolated. A `relay:commandFailed` (M13-4
  timeout) restores the pre-command device value (or clears it to unknown
  when none was known) and stores the per-capability command error;
  the next `relay:command`/`relay:feedback` on the matched device clears it
  (read by widgets through `WidgetServices.getCommandError`).
- `services/boardInventoryService.ts` — descriptor-driven board discovery
  on the shared MQTT client (boards-topic-contract-v2): the RETAINED
  descriptor on `<prefix>/boards/<id>/descriptor` (zod-validated,
  schemaVersion 1, topic/payload id equality, strict `S<n>`/`K1..K10`
  channel grammars, duplicate-channel rejection, replacement-not-union) is
  the authoritative channel source; the RETAINED plain-text status on
  `<prefix>/boards/<id>/status` drives the online/offline badge. Entries
  merge in EITHER order (`seen` = descriptor received, no status yet);
  discovery is descriptor/status-driven ONLY — bus data events never create
  entries. `resolveSensorField(boardId, channel)` is the resolver port the
  telemetry module consumes. No auto-provisioning: descriptors never create
  rooms, devices or capabilities.
- `ui/DevicesScreen.tsx` — `DeviceManagementScreen` (opened from Settings →
  Quản lý) is ROOM-FIRST (approved room-sensor rework): a room list with the
  explicit `+ Thêm phòng` action opens a room's detail with ONLY
  `Cảm biến n/10` and `Điều khiển n/10` sections — no `Tất cả`, repeated
  room chooser or binding-kind chooser. The chosen room is inherited by
  every form: sensor add picks exactly ONE metric (duplicates/full rooms
  omitted, curated custom-metric creation as a secondary action with the
  immutable machine key "Mã trường dữ liệu (MQTT/InfluxDB)"); relay add asks
  only name + free room-scoped slot 1..10. For a room BOUND to a board with
  a descriptor, the add-device dialog offers the DESCRIPTOR's fields
  (catalog label when the field matches, raw field otherwise, filtered by
  the not-taken rule) and the descriptor's K channels ∩ free slots —
  unbound rooms keep the full catalog + slots 1..10. Room rename/delete keep the
  migration dialog; legacy roomless records stay manageable in a dedicated
  room-list section (assign/delete — never a global filter). General
  operation feedback shows top-center (`OperationBanner`); field validation
  stays inline.
- `ui/BoardsScreen.tsx` — the hardware-boards surface (Settings root):
  one gel card per discovered board — the title IS the descriptor
  `boardType` (the wire code stays visible as the labeled `Id: {code}`
  line), the status chip, the declared sensor channels as chips and the
  declared relay channels compressed to K-ranges (`K1–K3`). The footer is
  two stacked regions (boards-reassign-layout-remove-sharing): the room
  status line (`Phòng: {tên}`, one-line ellipsized — or the tappable
  `Chưa gán phòng — nhấn để gán` hint that opens the assign dialog
  directly) above a stable action row with the primary `Gán vào phòng` /
  `Đổi phòng` button and the `⋯` sheet (WiFi setup for known boards,
  native only; `Xóa board` for both assigned and unassigned boards). Deletion
  requires confirmation and persists a local visibility marker
  (`deletedBoardCodes`) so the card stays hidden while MQTT retained messages
  continue to update its cached data. The room binding, rooms, logical
  devices, widgets and InfluxDB history are preserved. Scanning the same board
  QR label restores the card immediately from its `boardId`/`boardType`,
  including an empty inventory or legacy deletion with no local marker.
  A QR-only card stays `seen` with no sensor/relay channels until MQTT supplies
  authoritative status and descriptor data; cached MQTT data is preserved.
  QR and successful BLE recovery clear a hiding search and highlight the card.
  Restoration storage failures keep the scanner available for retry. Explicitly
  assigning the same code (add/update room or `rebindRoomBoard`) remains an
  optional manual recovery path. `Đổi phòng`
  transfers the binding without marking the board deleted. Deletion affects
  this app's local inventory; the board firmware and broker are untouched.
  Board share actions are NOT
  part of the UI — the QR label scanner identifies boards only, it never
  carried credentials. The assign dialog lists the candidate rooms
  (current room excluded) as full-width selectable rows inside a bounded
  scroll region, with the confirm/cancel actions outside the scroll area.
  The QR not-found sheet (a scanned board the broker never saw) doubles
  as the BLE onboarding entry: a `Cấu hình WiFi qua Bluetooth` handoff
  (hidden on web) opens `ui/BleProvisioningModal.tsx` with the QR label's
  boardId — the modal is a display shell + form over
  `internal/services/bleWifiProvisioningService.ts` (the ONLY BLE-stack
  touchpoint; tests inject fakes through the
  `BleWifiProvisioningServiceLike` seam; the GATT contract itself lives
  in `internal/domain/bleProvisioningContract.ts` — see the contract
  section at the top of this file). v2 (`ble-provisioning-v2-broker-push`):
  the screen reads the persisted settings ONCE through the settings
  module's api facade and passes the Broker/MQTT prefill as props
  (`deriveBrokerAddress` — tolerant-regex host derivation + the firmware
  default port 1883; the modal never reads storage itself, AD-v2-6).

## Key rules

- **Capability label vs machine key:** the UI shows the catalog `label`
  (e.g. "Nhiệt độ"); bindings, MQTT topics and InfluxDB `_field` values carry
  the machine key (`temperature`), fixed at capability creation. NEW keys
  must satisfy the strict ASCII format (`CAPABILITY_KEY_REGEX`); legacy
  persisted keys remain loadable.
- **Per-room capacity (service-authoritative):** every concrete room accepts
  at most 10 PROJECTED sensor metrics (one visible sensor = one metric; a
  legacy multi-capability board consumes two quota units) and 10 relay
  devices — enforced on add and on move/update (excluding the edited
  device). Loaded legacy multi-capability records permit non-worsening
  edits (e.g. rename); any new multi-field write is rejected. A relay slot may be used at
  most once per room; the SAME slot in different rooms is fine. Room count
  itself is unlimited. Over-capacity legacy snapshots stay loadable, and
  mutations may not worsen the violating room (a migration `move` into a
  full room is rejected; `unassign` always remains).
- **New devices require a room:** `NewDeviceInput.roomId` is required and
  must reference an existing room; the persisted `Device.roomId` stays
  optional so roomless legacy records and the room-deletion `unassign`
  migration remain loadable and manageable.
- **Catalog membership enforcement (fix cycle 1):** `addDevice` /
  `updateDevice` reject capability types that are not in the catalog and
  kinds that do not match the binding (`sensor` ↔ telemetry-sensor,
  `switch` ↔ relay).
- **Room removal is migration-only:** there is no plain `removeRoom` on the
  service — deletion always goes through `removeRoomWithMigration`. The
  mutation is two-phase (registry commit → widget migration); when the
  widget migration fails, the registry performs a compensating rollback
  (previous snapshot restored in the repository and mirror store) and
  returns an explicit failure carrying both details — a partial mutation is
  never reported as success.
- **Removal cascade:** deleting a device publishes `devices:changed` with
  `removedDeviceIds`; the composition root removes its widgets from all
  dashboards and drops its live values/series.
- Device deletion with rooms still populated triggers the migration dialog
  (move devices to another room or unassign) — a room is never deleted with
  devices silently orphaned.

## Guideline (khung chung — tiếng Việt)

- **Mục đích:** registry rooms/devices/capabilities + đồng bộ trạng thái
  cho widget + discovery board (descriptor là chân lý kênh, KHÔNG tự
  sinh room/device từ descriptor). Widget chỉ bind `deviceId +
capability`, không biết topic.
- **Public API:** `DeviceRegistryServiceImpl`, `BoardInventoryService`,
  `DeviceStateSync`, `DeviceCommandServiceImpl`, `mqttRoomIdOf` /
  `resolveRoomByMqttIdOf` (`code ?? id`), `rebindRoomBoard` nguyên tử
  qua `api/`.
- **Mở rộng:** thêm capability vào catalog (label hiển thị vs machine
  key bất biến); tôn trọng quota 10 sensor + 10 relay/phòng; xóa device
  cascade qua `devices:changed` → `removeWidgetsForDevice`.
- **Test seam:** service thuần + repository AsyncStorage mock, descriptor
  fixture strict (`schemaVersion 1`, `S<n>`/`K<n>`, REPLACE không union).
