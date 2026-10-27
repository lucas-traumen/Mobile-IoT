# history module

InfluxDB v2 history queries (read-only Flux) + series statistics.

## Public API (`api/index.ts`)

- `HistoryQuery` value object: `{ measurement, range, fields, roomId,
boardId? }`. Empty `fields` = default sensor fields; `roomId: null` = no
  room filter (used by the Settings raw Influx probe); `boardId` (optional,
  boards-topic-contract-v2) — when set the query filters the `boardId` tag
  INSTEAD of `roomId` and keeps both tag columns.
- `HistorySeries`: `{ roomId: string | null, boardId?: string | null, field,
points }` — identity is `(boardId ?? roomId) + field` (board-bound rows
  pair by the board tag, legacy rows by `roomId`). Rows written without the
  tags parse as `null` and are never guessed into a room (not displayed).
  Collector contract: write sensor rows with the `boardId` tag (and the 1:1
  `roomId` tag) for real-board rooms.
- `buildFluxQuery(bucket, query)`, `parseFluxCsv(csv)` — pure functions.
- `HistoryService` port + `historyQueryForRoom(devices, capabilities, roomId,
range, tagRoomId?, boardCode?, savedWidgets?)` — builds the room's exact query
  or `null` when no registered sensor is eligible in the supplied saved layout. A present `boardCode` (the
  room's board binding) switches the query to `{boardId, roomId: null}`;
  without it the exact historical `roomId`-tag behavior applies.
- `computeSeriesStats(points)` — min/max/avg.
- `historyStore` — zustand store with a **stale-request guard**: `beginRequest()`
  returns an id; `setSeriesIfCurrent(id, ...)` / `setErrorIfCurrent(id, ...)`
  drop results from superseded requests, so a slow older response can never
  overwrite a newer room/range result.

## Internal

- `domain/fluxQueryBuilder.ts` — board-bound queries filter
  `r.boardId == "…"` and `keep(columns: ["_time","_field","_value","roomId",
"boardId"])`; unbound queries keep the historical roomId filter and keep
  columns. The group key is ALWAYS `["roomId", "_field"]` (boardId stays a
  plain column). The CSV parser reads the optional `boardId` column and
  identifies series by `(boardId ?? roomId) | field`.
- `domain/roomSensorFields.ts` — room + saved layout → eligible registered
  sensor fields. Only `sensor-value` widgets whose `deviceId + capability`
  matches a current telemetry-sensor registration in that physical room count.
  Duplicates collapse in registration order; custom sensor capabilities work.
  App always supplies the active Template's **saved** room widgets: empty
  layouts or missing room references select nothing, with no network query.
  Draft edits, Cancel, failed Save and tab-leave discard leave History unchanged.
  Saved removals hide cards; saved additions and Template switches query their
  fields on the next History focus (also on room/range selection). Stored data
  is never deleted. Cards, query fields and the empty state share this scope;
  returned/cached fields cannot restore a hidden card. Physical-room navigation,
  board/room identity pairing and request-id guards remain in place.
  Helpers retain unfiltered registration behavior only when `savedWidgets` is
  omitted; explicit `[]` or `null` means no fields. A `null` room yields `[]`,
  never a cross-room union.
- `data/influxV2Adapter.ts` — HTTP `POST {url}/api/v2/query?org={org}` with
  Bearer token; zod-validated CSV → `HistorySeries[]`.
- `data/demoHistorySource.ts` — `DemoHistoryDataSource`: deterministic
  (seeded) fake series per requested `room × field` for the Settings
  "Dữ liệu demo (lịch sử)" toggle — no network, no persistence; unit-less
  capability fields are produced like any other field, so the demo toggle
  exercises every registered room out of the box.
- `data/historySourceSelector.ts` — `SelectableHistoryDataSource`: the UI
  front door (same port). OFF (default) → Influx; ON → demo. The flag is
  in-memory only (resets to OFF on restart); `configure` always reaches the
  Influx adapter and the Settings connection probe keeps probing Influx
  directly, so demo mode can never fake a connectivity check.
- `data/historyStore.ts` — request-id guard + `range` UI state. The room
  selection is owned by the `dashboard` module (one shared active room);
  this store holds only query results.

## UI

- `ui/HistoryScreen.tsx` — the Smart Home layout
  (history-smart-home-redesign; the screen consumes the shared
  `tokens.smart` block and no longer touches the legacy gel tokens):
  - ambient diagonal wash background (`smart.colors.tealTint → page →
amberTint`, same recipe as the Dashboard tab);
  - header: ☰ menu button + `Lịch sử` (`smart.typography.screenTitle`) in
    the centered 880pt content band; the menu opens the shared
    `RoomListModal` imported through the dashboard module's public facade
    (`@modules/dashboard/api` — cross-module UI may only cross via `api/`,
    per the boundaries rules in `.eslintrc.js`);
  - filters: two white `FilterDropdown`s (room + range; the range dropdown
    keeps the `HistoryRange` values and shows the Vietnamese labels
    `1 giờ`/`24 giờ`/`7 ngày`) plus the visible date-range line
    (`DD/MM HH:mm – DD/MM HH:mm`, computed end = now; wraps on narrow
    screens). No chip strip, no range chip row;
  - content scrolls vertically with one smart chart card per selected
    registered room sensor (`ui/HistoryChartCard.tsx`: white `smart.colors.card`,
    hairline `cardBorder`, `smart.radius.card`, `smart.cardShadow`; sensor
    icon + `label (unit)` title + Thấp nhất/Cao nhất/Trung bình stats WITH
    units — stats values at `smart.typography.statsValue`; registration
    order preserved, a registration without points renders the truthful
    `Chưa có dữ liệu` card, never a 0). Stats layout is responsive
    (`useWindowDimensions` + the Dashboard's `STACKED_BREAKPOINT`): wide =
    stats right of the title row, narrow = stats row below the title;
  - chart recipe: line strokeWidth 2 + area fill in the same accent at 5%
    opacity, light-gray grid, shared x-domain/ticks (`ui/timeAxis.ts`:
    24h `HH:mm`, date added when the range crosses midnight, tick count
    reduced on narrow widths), height 160–200 phone / 200–240 tablet,
    tooltip on touch via `VictoryVoronoiContainer` + `VictoryTooltip`
    (`activateData={false}` — hidden on mount and cleared on touch end);
  - `null` room → "no rooms" hint; no eligible saved sensor widgets → a hint
    directing the user to add a sensor in Dashboard layout editing (and
    stale cards from the previous room are hidden). Series without a room
    id (legacy untagged rows) are never rendered.
- **Charts must pass native SVG primitives as EXPLICIT props** — React 19
  removed function-component `defaultProps`, so victory-native@36's native
  overrides (`groupComponent`, `containerComponent`, `backgroundComponent`,
  `axisComponent`/`tickComponent`/`gridComponent`, `tickLabelComponent`/
  `axisLabelComponent`, `dataComponent`, `labelComponent` — and the
  tooltip's `labelComponent`/`flyoutComponent`/`groupComponent`, see
  `HistoryChartCard.tsx`) are silently dropped; without them victory-core's
  web SVG defaults render and crash on device ("View config getter callback
  for component 'line' must be a function").

## Guideline (khung chung — tiếng Việt)

- **Mục đích:** query InfluxDB v2 read-only (Flux + Bearer token) + vẽ
  chart 1 card/cảm biến được chọn trong bố cục đã lưu. Query gom `aggregateWindow mean`
  (`1m/15m/1h` cho `1h/24h/7d`); stats/y-domain tính trên full series,
  render tối đa `MAX_RENDER_POINTS = 200`.
- **Public API:** `HistoryQuery` (`roomId`/`boardCode` → filter `boardId`
  khi phòng đã gán), `buildFluxQuery`/`parseFluxCsv`,
  `historyQueryForRoom` (trả `null` khi bố cục không chọn sensor hợp lệ),
  `SelectableHistoryDataSource` (cửa trước demo↔Influx), `historyStore`
  (stale-request guard) qua `api/`.
- **Mở rộng:** chart mới PHẢI truyền native SVG primitives explicit
  (React 19 rớt `defaultProps`); card mới giữ recipe Smart Home + y-domain
  adaptive (`ui/valueAxis.ts`) + reveal (`ui/seriesSampling.ts`).
- **Test seam:** Flux builder/parser thuần, fetch inject, URL qua
  `normalizeInfluxBaseUrl`, focus-refresh thuộc shell (`TabFocusRefresh`)
  không thuộc module.
