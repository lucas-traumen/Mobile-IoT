# relay module

Board-scoped relay command building + optimistic switch state with a
deterministic acknowledgement timeout (M13-4), corrected by device state.

## Topic contract (boards protocol v2, clean cut)

- command (app → device): `<prefix>/boards/<boardId>/relays/K<1..10>/set`
  with payload `"ON"` / `"OFF"` — QoS 1, NOT retained
- state (device → app): `<prefix>/boards/<boardId>/relays/K<1..10>/state`
  with payload `"ON"` / `"OFF"` — the acknowledgement / feedback path

Relay identity is the `{ roomId, slot }` value object (`RelayAddress`):
`roomId` carries the room's MQTT identity (the board `code` for bound
rooms, the internal id for unbound demo rooms) and the same slot number can
be used independently in different rooms. The wire channel is the `K<n>`
string (`relayIndexToChannel` / `parseRelayChannel`, `K1`..`K10`); the
persisted slot model stays numeric 1..10. Out-of-contract slots (0, 11, …)
and malformed ids (empty, `/`, `+`, `#`) are rejected at build/parse time.
The state subscription is a single MQTT wildcard
(`<prefix>/boards/+/relays/+/state`), so room/device changes need no
re-subscription — only prefix changes do (`applyPrefix`). The configured
prefix is regex-escaped during state parsing (M2).

## Acknowledgement timeout (M13-4)

`setRelay` captures the pre-command store state (`null` = the slot had no
known state), publishes the `set` topic, applies the optimistic state and
registers a pending command with a `RELAY_COMMAND_TIMEOUT_MS` = 3000 ms
timer (injected `Clock` — deterministic in tests via `FakeClock`):

- a state message MATCHING the request confirms (state + pending cleared,
  timer cancelled);
- a NON-matching state while pending is applied WITHOUT clearing pending
  (most likely the stale retained pre-command state — it must not ack a
  toggle);
- on timeout the store rolls back (previous known → restored; unknown → the
  slot key is DELETED so it honestly reads as never-touched), pending
  clears and the typed `relay:commandFailed` event is emitted
  (`{roomId, index, attempted, previous, error}` — `core/events.ts`);
- a second command for the SAME address while one is pending is rejected
  (validation error, surfaces inline); different addresses are independent.

> **Wire limitation (documented, accepted):** MQTT has no command
> correlation id. The local generation counter protects timers/concurrency
> but cannot prove a late state packet belongs to the newest command — when
> no confirmed baseline exists, a stale retained packet equal to the
> requested state can ack a command it does not belong to.

There is NO error topic on the wire — the timeout IS the failure signal.

## Public API (`api/index.ts`)

- `RelayService` — `setRelay({ roomId, index }, state)` plus
  `applyPrefix(prefix)`, `startFeedbackListener()`, `handleFeedbackMessage(msg)`
  on the implementation.
- `relayStore` — zustand store: optimistic ON/OFF per room-scoped slot,
  keyed by `relaySlotKey(roomId, index)` so equal slots in separate rooms
  never alias. Ack split: `apply` (state only, pending untouched),
  `confirm` (state + pending false), `rollback` (restore previous or delete
  the key when unknown).
- Pure builders/guards: `buildRelayAddress`, `buildRelayCommand`,
  `buildRelaySetTopic`, `buildRelayStateTopic`,
  `relayStateSubscriptionTopic`, `parseRelayStateTopic`,
  `parseRelayStatePayload`, `parseRelayChannel`, `relayIndexToChannel`,
  `isRelayChannel`, `isRelayIndex`, `isRelayRoomId`, `isRelayState`.

## Internal

- `domain/commands.ts` — address/command value objects + K-channel mapping +
  topic builders + topic/payload parsers (pure).
- `data/relayStore.ts` — optimistic state + apply/confirm/rollback keyed by
  room + slot.
- `services/relayService.ts` — publish (QoS 1, non-retained), pending
  command lifecycle with the injected `Clock`, wildcard state subscription
  and room-scoped state parsing.

## Notes

- The devices module delegates `switch` capability commands here via the
  device command service, which derives the address from the device's own
  `roomId` + `binding.index` — widgets never publish topics directly.
  Roomless legacy relay devices are rejected with a validation error (no
  board-scoped topic can be built); assign them to a room first.
- `relay:feedback` is ALWAYS emitted for a valid state message so the sync
  bridge keeps the device state fresh; the relay module itself consumes its
  own pending lifecycle in `handleFeedbackMessage` (no bus round-trip).
- Migration: persisted legacy relay devices that already carry `roomId` +
  slot 1..3 remain structurally valid and naturally use the boards route
  (slot n → channel `K<n>`) — no stored device/dashboard data is rewritten.
  The topics are a BREAKING change for old firmware/automation listening on
  the legacy `<prefix>/room/...` or global `<prefix>/cmnd|stat/relay/<n>`
  topics (clean cut — no dual-read).

## Guideline (khung chung — tiếng Việt)

- **Mục đích:** lệnh relay room-scoped `{roomId, slot 1..10}` + optimistic
  state có rollback. Publish `.../relays/K<n>/set` (QoS 1, non-retained),
  ack bằng `.../relays/K<n>/state` trong 3000 ms (`Clock` seam), timeout
  phát `relay:commandFailed` — đó là tín hiệu lỗi duy nhất (không có
  error topic).
- **Public API:** `RelayService.setRelay` (đồng bộ, trả publish `Result`),
  `applyPrefix`/`startFeedbackListener`/`handleFeedbackMessage`,
  `relayStore` (apply/confirm/rollback) qua `api/`.
- **Mở rộng:** builder/parser thuần trong `domain/commands.ts`; kênh dây
  chỉ khi descriptor khai báo; lệnh trùng khi đang pending bị từ chối.
- **Test seam:** `FakeClock` cho timeout, generation guard chống timer
  cũ/state retained muộn ack nhầm.
