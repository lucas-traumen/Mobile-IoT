# Current Plan

Status: APPROVED (2026-08-29)

Task: `custom-dashboard` — V2 (Room/Device/Capability model) + V3 (Widget Registry, grid dashboard tùy biến, multiple dashboards) theo spec "Customizable IoT Dashboard" của user, migration incremental, UI tiếng Việt + dark/light theme theo mock đính kèm (3 màn × 2 theme).

## Goal

Biến app từ fixed dashboard thành IoT Dashboard Engine:
1. Device/Capability abstraction: widget không biết MQTT topic; binding qua `deviceId + capability`.
2. Widget Registry + grid layout engine (2 cột, sizes 1x1/2x1/1x2/2x2) + Edit Mode (add/remove/drag/resize) + multiple dashboards, persist AsyncStorage.
3. Tab thứ 4 "Thiết bị": CRUD rooms + devices.
4. UI tiếng Việt + theme Light/Dark/System theo mock; History có stats Min/Max/Trung bình; Settings có section Giao diện + Kiểm tra kết nối.
5. Migration incremental: telemetry/relay giữ nguyên internal; lớp devices đồng bộ state qua EventBus và delegate command qua `relay/api`.

## Current state

- V1 accepted 2026-08-28: 4 module settings/telemetry/relay/history; composition root `app-mobile/src/app/wiring/container.ts`; TabShell 3 tab tự viết; 90/90 tests.
- MQTT contract (ADR-006): `<prefix>/tele/sensor` JSON `{temperature,humidity,ts?}`; `<prefix>/cmnd|stat/relay/<1|2|3>` `"ON"|"OFF"`.
- Boundaries hard-code 4 module trong `.eslintrc.js` — thêm module mới phải sửa config.
- Chưa có gesture lib, theme, i18n; màu hard-code; `STORAGE_KEYS` chỉ có `settings`.
- KNOWN_ISSUES ISSUE-001 (relay toggle lỗi không hiển thị) — đóng bởi SwitchWidget mới.
- GitNexus CLI có nhưng repo chưa index → chạy `gitnexus analyze` đầu phiên implement.

## Target state

```
src/core/            + theme/ (ThemeTokens light/dark, ThemeProvider nhận mode prop, useTheme)
                     + i18n/ (STRINGS tiếng Việt)
                     + constants (STORAGE_KEYS.devices/dashboards)
                     + events (SettingsSnapshot.ui.theme; events devices:changed, dashboards:changed)
src/modules/
  settings/          + ui.theme trong schema (zod default → migrate bản persist cũ)
                     + SettingsScreen: section Giao diện (Hệ thống/Tối/Sáng), Kiểm tra kết nối, nút Lưu cài đặt
  telemetry/         giữ nguyên; bỏ ui/DashboardScreen.tsx
  relay/             giữ nguyên
  history/           + computeSeriesStats; restyle mock
  devices/           MỚI: rooms+devices registry, capability model, state sync, command routing, tab Thiết bị
  widgets/           MỚI: WidgetRegistry + WidgetContext + SensorValue/Switch/HistoryChart/Connection widgets
  dashboard/         MỚI: layout engine, repository, service, store, DashboardScreen + EditMode + AddWidgetFlow
src/app/             TabShell 4 tab + icons (@expo/vector-icons), ThemeProvider, wiring mới
```

## Scope

1. CP1 — Foundations: `.eslintrc.js` thêm elements/policies cho devices/widgets/dashboard; `core/theme`; `core/i18n`; STORAGE_KEYS; settings `ui.theme` + test migration; SettingsSnapshot.ui.
2. CP2 — `devices` module: domain (zod schemas, CapabilityType 'temperature'|'humidity'|'switch', DeviceBinding discriminated union `{kind:'telemetry-sensor'}|{kind:'relay';index}`), seeds (sensor-01 "Cảm biến môi trường" temp+hum; relay-1 "Đèn", relay-2 "Quạt", relay-3 "Bơm"), repository AsyncStorage, DeviceStateStore (zustand, key `${deviceId}:${capability}`), DeviceStateSync (subscribe bus telemetry:received/relay:feedback/relay:command), DeviceCommandService (relay binding → relayService.setRelay; khác → err), registry service CRUD + emit `devices:changed` (payload `{removedDeviceIds}`), tab Thiết bị UI (room chips, device list, form add/edit room+device).
3. CP3 — `widgets` module: WidgetDefinition {type,label,supportedCapabilities,supportedSizes,component}; registry register/get/list/suggest(device capabilities); WidgetConfig type (id,type,title?,binding{deviceId,capability},layout); WidgetContext (getState, sendCommand, queryHistory, connection, theme-independent); 4 widgets: SensorValue (1x1 value; 2x1 + sparkline SVG + delta), Switch (2x1, inline error khi command err → ISSUE-001), HistoryChart (2x2 victory + stats Min/Max/Trung bình), Connection (2x1 trạng thái MQTT + host).
4. CP4 — `dashboard` domain/data: layout engine pure (COLS=2; parseSize; collides; findFreeSlot bounds+overlap reject; applyResize same-pos-else-findFreeSlot; compactVertical; zod DashboardSchema); repository AsyncStorage `{dashboards, activeId}`; service (CRUD dashboards, add/remove/move/resize widget validate registry+capability, prevent delete last dashboard, `removeWidgetsForDevice`); store.
5. CP5 — dashboard UI + wiring: grid render (useWindowDimensions, absolute positioning), EditMode (PanResponder drag snap grid, resize cycle button, × remove), AddWidgetFlow 4 bước (widget→device→capability→size), dashboard switcher chips + create; container.ts tokens mới; App.tsx: ThemeProvider (mode từ settings store), 4 tab, xóa DashboardScreen cũ, start DeviceStateSync, reaction devices:changed → removeWidgetsForDevice; cài `@expo/vector-icons` (npx expo install).
6. CP6 — Restyle History (stats row, theme tokens) + Settings (Giao diện, Kiểm tra kết nối: Influx query + MQTT state → Thành công/Thất bại) + toàn bộ screen dùng tokens + strings VI; READMEs 3 module mới + cập nhật app README; TSDoc mọi export api/.
7. Mỗi CP kết thúc: `npm test && npm run typecheck && npm run lint && npm run format:check` trong `app-mobile/` pass.

## Out of scope

Camera/Energy/Security/Automation (V4); cloud sync/multi-user; đa ngôn ngữ; per-widget màu/custom font; absolute positioning; gesture-handler/reanimated; Influx v1; navigation library; iOS tuning; room filter chips trên dashboard (rooms chỉ trong tab Thiết bị).

## Architecture decisions (task-level)

- D1 Incremental bridge: devices không sở hữu MQTT; sync qua EventBus hiện có; command delegate qua relay/api. telemetry/relay internal bất biến.
- D2 Binding kinds V2: `telemetry-sensor` | `relay(n)` (zod discriminated union); topic mapping tập trung trong devices; UI/widget không biết topic.
- D3 Grid 2 cột constrained customization; drag PanResponder (không dependency mới cho gesture); resize nút cycle.
- D4 Sparkline bằng react-native-svg; chart lớn victory-native (ADR-008).
- D5 Theme mode nằm trong settings schema; tokens/ThemeProvider ở core/theme, ThemeProvider nhận `mode` prop (core không import modules); App đọc settings store truyền vào.
- D6 Cascade xóa device → dashboard service removeWidgetsForDevice (wiring qua event `devices:changed`).
- D7 Icons: `@expo/vector-icons` (Ionicons) cho tab bar + widget icons theo mock.
- D8 Widgets nhận services qua React context (WidgetContext) do App wiring cung cấp — widgets không import internal module khác.

## Relevant files/modules

- Sửa: `.eslintrc.js`, `src/core/{constants,events,index}.ts`, `src/modules/settings/**`, `src/modules/history/**`, `src/app/wiring/container.ts`, `App.tsx`, `src/app/shell/TabShell.tsx`, package.json (expo install @expo/vector-icons).
- Mới: `src/core/theme/`, `src/core/i18n/`, `src/modules/{devices,widgets,dashboard}/`.
- Xóa: `src/modules/telemetry/ui/DashboardScreen.tsx`.

## Implementation steps

Theo CP1..CP6 ở Scope; coder implement từng CP, verify 4 lệnh sau mỗi CP. Dùng GitNexus impact analysis trước khi sửa App.tsx/container.ts (CP5).

## Constraints

- TS strict; không `any`; không console.* ngoài core/logger; Prettier singleQuote/trailingComma all/arrowParens avoid; TSDoc mọi export api/; boundaries pass; zod cho dữ liệu persist + external; domain pure; Result cho lỗi nghiệp vụ; không commit/push tự động; không secret trong repo.

## Acceptance criteria

1. `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass trong `app-mobile/`.
2. First-run: default dashboard giống cấu trúc mock (2 sensor card + 3 switch Đèn/Quạt/Bơm + connection widget), UI tiếng Việt; toggle Tối/Sáng persist.
3. Add widget 4 bước → widget hiển thị giá trị live; SwitchWidget báo lỗi inline khi disconnected (đóng ISSUE-001).
4. Edit mode: drag snap grid không overlap; resize đúng supportedSizes; remove; layout persist sau restart.
5. Multiple dashboards create/switch/delete persist; xóa device → widget bind nó bị xóa (test phủ).
6. Stats Min/Max/Trung bình đúng với series (test computeSeriesStats).
7. Settings bản persist cũ (thiếu `ui`) parse ra theme default (test).
8. Boundaries lint pass với 7 element types; README + TSDoc đủ.

## Required tests

- settings schema: parse bản cũ thiếu `ui` → default theme.
- devices domain: schemas valid/invalid; binding↔capability constraints; seeds.
- devices services: sync bus events → state store; command routing (fake RelayService), unsupported → err.
- dashboard layout: findFreeSlot/collides/applyMove (overlap+out-of-bounds)/applyResize/compactVertical.
- dashboard service: add/remove/move/resize persist round-trip (AsyncStorage mock); cascade removeWidgetsForDevice; prevent delete last dashboard.
- widgets registry: register/get/unknown; suggest theo capabilities.
- history: computeSeriesStats.

## Risks

- R1 Scope lớn → 6 CP verify riêng. R2 UX drag PanResponder chưa test on-device (user kiểm tra). R3 Migration settings cũ → test + zod default. R4 Sửa boundaries sai fail lint toàn repo → làm ở CP1. R5 @expo/vector-icons cần expo install (network) — fallback text-only nếu thất bại.
