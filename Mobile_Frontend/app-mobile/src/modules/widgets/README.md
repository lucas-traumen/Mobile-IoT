# widgets module

Widget registry + runtime context + built-in widget components.

## Public API (`api/index.ts`)

- `createWidgetRegistry()` — widget definitions: `sensor-value`,
  `switch`; each with
  category, `defaultSize`, `supportedSizes` and `suggestForCapabilities`
  (filters by the selected device's capabilities). RETIRED types (never
  registered again; legacy persisted instances are removed on dashboard
  load): `connection` (Phase 1), `history-chart` (approved room-sensor
  rework — History is a derived tab, never a Dashboard widget) and
  `room-device-list` (device-acceptance rework — the per-room overview
  card; devices are reachable through the room selector and History).
- `validateWidgetBinding(def, binding)` — enforce one binding per widget.
- `effectiveCapabilities(def, binding)` — merged capability list.
- `resolveCapabilityAccent(field, def, tokens)` — **the** accent resolver
  (CP-R6): built-in temperature/humidity → theme tokens, custom → catalog
  color, unknown → primary. Built-in widgets never hard-code per-field
  colors.
- Widget uniqueness (approved room-sensor rework):
  `widgetUniquenessKey` / `duplicateWidgetError` / `duplicateWidgetKeys` /
  `dedupeWidgets` — the invariant constrains EXACTLY `sensor-value` +
  `switch` (room + type + exact binding); unknown custom types have NO
  uniqueness constraint and every instance survives migrations.

## Internal

- `domain/widgetTypes.ts` — `WidgetConfig`, size parsing.
- `domain/capabilityColor.ts` — the accent resolver + tests.
- `domain/widgetUniqueness.ts` — the pure uniqueness classes/check/dedupe.
- `ui/widgetContext.tsx` — `WidgetServices` seam (D8): widgets never import
  other modules directly. Reactive hooks (CP-R1):
  - `useCapabilityState(deviceId, capability, enabled)` — live value via
    `useSyncExternalStore`; per-key snapshot identity, so unrelated store
    writes notify but skip re-render.
  - `useCapabilitySeries(deviceId, capability, enabled)` — recent numeric
    points; stable empty-array reference while there is no data.
- `ui/widgets/` — the built-ins (`SensorValueWidget`, `SwitchWidget`;
  `RoomDeviceListWidget` was retired with its type). Smart Home anatomy
  (dashboard-smart-home-redesign; WYSIWYG — the same anatomy renders in the
  view tab, the editor previews and the management previews):
  - `SensorValueWidget` — icon chip + muted name + big accent reading +
    the "Đã cập nhật HH:MM" status line from the live state entry
    ("Chưa có dữ liệu" when absent); the sparkline and the 1h delta caption
    were REMOVED (full charts belong to the History tab). Accents:
    temperature = teal, humidity = blue (amendment-2 token value change —
    amber stays reserved for warning/offline semantics), custom
    capabilities keep their catalog color. Without an observation the `—`
    placeholder renders as NORMAL secondary text at the 28–32
    `sensorNoDataValue` token (amendment 3), with the smaller baseline-
    aligned unit — never in the big accent style. Glyph resolution
    (`internal/domain/widgetIcon.ts`): per-DEVICE icon → capability def
    icon → widget default, each name validated against the glyph map of
    ITS family (Ionicons AND MaterialCommunityIcons — amendment 3; Quạt's
    `fan` is a MaterialCommunityIcons glyph) and rendered through the
    matching component (`WidgetGlyphIcon`).
  - `SwitchWidget` — one row (icon + name column + RN switch), the state
    caption STACKED UNDER the device name (amendment 3). ON = teal accent,
    OFF = neutral gray, UNKNOWN (no state entry) = muted neutral rendering
    at reduced opacity with the VISIBLE caption "Chưa rõ trạng thái" (never
    plain OFF). OFFLINE (MQTT not connected — scope amendment 2) = the
    switch is DISABLED with the visible caption "Không thể điều khiển";
    the ICON stays visually clear (amendment 3 — only the switch wrapper
    stays muted; no optimistic flip offline). An explicitly defined catalog
    color keeps its precedence. While connected: optimistic toggle +
    rollback + feedback reconciliation unchanged. Glyph resolution as
    above.

## Notes

- Widget components must tolerate `undefined` results (no value yet, no
  history data).
- CP-R1 regression tests (`widgetContext.test.tsx`) prove subscription
  updates + snapshot identity stability on a minimal fake store.

## Guideline (khung chung — tiếng Việt)

- **Mục đích:** registry + runtime render cho `sensor-value` và `switch`
  (các type retired bị strip khi load: `connection`, `history-chart`,
  `room-device-list`). Widget nhận mọi service qua
  `WidgetServicesProvider`, không import module khác.
- **Public API:** `createWidgetRegistry`, `validateWidgetBinding`,
  `effectiveCapabilities`, `resolveCapabilityAccent`,
  `useCapabilityState`/`useCapabilitySeries` (`useSyncExternalStore`
  per-key) qua `api/`.
- **Mở rộng:** thêm widget = khai `supportedSizes` +
  `suggestForCapabilities` + tôn trọng `sectionKeyOf` theo TYPE; target
  chạm icon-only ≥44×44 (không thay bằng `hitSlop`); trạng thái UNKNOWN/
  OFFLINE render trung thực, không đoán OFF.
- **Test seam:** fake store cho subscription identity, render test cho
  optimistic toggle/rollback/offline lock.
