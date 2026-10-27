# core — hạ tầng dùng chung (không chứa business logic)

`core` là lớp hạ tầng thuần túy: mọi module đều được import, nhưng `core`
chỉ được import chính nó. Quy tắc này do `eslint-plugin-boundaries` thực
thi (xem `app-mobile/.eslintrc.js`).

Đối chứng code: `src/core/` (HEAD `5d884dd`).

## Thành phần

- `eventbus/` — EventBus typed theo `EventMap`. Pub-sub giữa các module
  (telemetry/relay/history/devices/dashboard/settings) mà không import
  chéo `internal/`. Đọc `src/core/eventbus/` + `src/core/events.ts`.
- `di/` — Container thủ công (`Container`, `TOKENS`). Chỉ composition
  root (`src/app/wiring/container.ts`) được khởi tạo implementation của
  module khác.
- `errors/` — `Result<T, AppError>` + `tryCatch` ở biên adapter. Payload
  ngoài sai (MQTT/InfluxDB) chỉ log + bỏ qua, không throw.
- `time/` — `Clock` (`SystemClock`/`FakeClock`): mọi timeout/delay phải
  qua seam này để test quyết định được (ví dụ relay ack 3000 ms,
  reconnect backoff).
- `logger/` — nơi DUY NHẤT được dùng `console.*` (lint `no-console`).
  Dùng `createLogger`/`NullLogger` trong test.
- `topics.ts` — builder/parser topic boards protocol v2 (descriptor,
  sensor-state `S<n>`, status). Relay `K<n>` nằm ở
  `modules/relay/internal/domain/commands.ts`.
- `constants.ts` — hằng số tập trung, không magic number: prefix mặc
  định `smarthome` (chỉ cho install mới), WS port `9001`, QoS 1,
  `RELAY_COMMAND_TIMEOUT_MS = 3000`, reconnect `1s × 2^n` trần 30s tối
  đa 10 lần, `STORAGE_KEYS`, `APP_NAME`/`APP_VERSION`.
- `net.ts` — normalize host/URL thuần regex (KHÔNG dùng `URL`
  constructor vì Hermes): `normalizeBrokerHost`, `formatHostForUrl`,
  `normalizeInfluxBaseUrl`. Mọi biên MQTT/Influx phải đi qua đây.
- `theme/` — `ThemeTokens` light/dark + `ThemeProvider`/`useTheme`. Màn
  hình không hard-code màu (ngoại lệ duy nhất: accent chart theo field
  đã document).
- `i18n/` — `STRINGS`: mọi label tiếng Việt. Thêm key mới theo nhóm
  module, không xóa key cũ nếu test còn pin (dead-key cleanup làm riêng).
- `safeArea.ts` + `ui/` — helper inset runtime + `OperationBanner`
  (`useOperationFeedback`, `AUTO_HIDE_MS` duy nhất).

## Quy ước dùng chung

1. Pure trước: logic domain là hàm thuần trong `internal/domain`,
   side-effect chỉ ở adapter/composition root.
2. Zod là nguồn chân lý duy nhất cho dữ liệu ngoài (payload MQTT, CSV
   InfluxDB, form settings, QR, descriptor).
3. Không `any` (`strict: true`), không `console.*` ngoài logger.
4. Hằng số/magic string mới phải vào `constants.ts` hoặc `STRINGS`,
   không rải rác trong UI.
5. Mọi timeout phải nhận `Clock` inject để test được.

## Cách mở rộng

- Thêm event bus mới: khai type payload trong `events.ts`, đăng ký vào
  `EventMap`, re-export qua `api/` của module sở hữu. Không import
  `internal/` module khác để đọc payload.
- Thêm hằng số: đặt vào `constants.ts` kèm TSDoc ghi đơn vị + nơi dùng.
- Thêm helper mạng: đặt cạnh `net.ts`, pure + regex-only, có
  `net.test.ts` đi kèm.

## Test seam

- `FakeClock` cho timeout/backoff, `NullLogger` cho service test,
  `formatHostForUrl`/`normalizeBrokerHost`/`normalizeInfluxBaseUrl` test
  thuần trong `net.test.ts`.
