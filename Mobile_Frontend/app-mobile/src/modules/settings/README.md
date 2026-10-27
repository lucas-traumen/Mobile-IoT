# settings module

User preferences (MQTT broker, InfluxDB v2, UI theme) persisted in
AsyncStorage and validated with zod. This module owns broker/Influx/theme
persistence — even though the management screens that edit devices and
dashboards live inside the Settings tab, that data belongs to the `devices`
and `dashboard` modules, not here.

## Public API (`api/index.ts`)

- `SettingsService` — `load()`, `save(patch)`, `onChanged(cb)`; returns
  `Result` (never throws for expected failures). Declared next to its
  implementation (`internal/services/settingsService.ts`) and re-exported
  here — no barrel cycle (ISSUE-006 fixed).
- `defaultSettings()` — safe defaults for first run (theme `light`).
- Types: `AppSettings`, `SettingsSnapshot` (zod-parsed; theme is exactly
  `'light' | 'dark'`).
- `UiSettingsSchema`, `SettingsSchema`, `parseSettings` — the single
  authority on the persisted shape, including the legacy theme migration.

## Theme (explicit light | dark)

The runtime theme has exactly two explicit choices: `Sáng` (`'light'`) and
`Tối` (`'dark'`). `Hệ thống` (`'system'`) was removed
(settings-information-architecture plan): `UiSettingsSchema` accepts the
legacy persisted value and deterministically migrates it to `'light'` at
parse time, and the repository persists the normalized snapshot back
(best-effort) so valid MQTT/Influx credentials survive untouched. No runtime
path resolves or exposes `'system'`.

## Internal

- `data/settingsRepository.ts` — zod schema + AsyncStorage persistence +
  legacy-snapshot normalization write-through.
- `internal/services/settingsService.ts` — snapshot logic + change events.
- `internal/domain/mdnsDiscoveryContract.ts` — the pure mDNS contract
  half (`settings-mdns-discovery`): service-type constants
  (`_smarthome._tcp`), tolerant TXT parsing, and the
  `applyDiscoveredService(draft, service)` mapping that produces ONLY the
  non-secret fields (`mqtt.host/port/prefix`, `influx.url/org/bucket`).
- `internal/domain/secretsQrContract.ts` — the pure credentials-QR
  contract half (`settings-secrets-qr`): `parseCredentialsQr(raw)`
  validates the server-printed credentials QR (zod, `schemaVersion` +
  `kind` literal pins) and returns the non-empty secret fields PLUS the
  six optional non-secret connection fields (M27b, per-field junk
  tolerance) only — absent/empty/junk fields are structurally dropped
  (keep-current).
- `internal/services/mdnsDiscoveryService.ts` — the ONLY place that
  touches `react-native-zeroconf` (web-safe lazy getter, typed errors,
  10 s honest-timeout scan session).
- `internal/services/mqttProbeService.ts` — the one-shot `Kiểm tra kết
nối` probe (`advanced-config-stepper-redesign`, D4): a THROWAWAY
  `mqtt` WebSocket client per probe (~8 s timeout, typed
  auth/timeout/network/transport causes, cleanup on every exit path);
  never touches the shared telemetry client; web refuses with a typed
  transport error; lazy singleton + the injectable
  `MqttProbeServiceLike` seam.
- `internal/services/influxProbeService.ts` — the InfluxDB half of the
  dual probe (Amendment 1, A3): ONE InfluxDB v2 query against an
  EXPLICIT draft config via a THROWAWAY `InfluxV2Adapter` built from the
  history module's PUBLIC api (`@modules/history/api` — R1 outcome;
  no raw fetch duplication inside settings), ~8 s window ABORTING the
  in-flight request, typed auth/timeout/network/transport causes, lazy
  singleton + injectable seam. Never touches the shared
  `historyAdapter` (which keeps probing the PERSISTED config for the
  status card).
- `ui/SettingsScreen.tsx` — the summary/navigation ROOT: Giao diện (two
  explicit theme buttons, applied immediately), Quản lý (navigation rows to
  the Dashboard & Templates management entry — the Template → Room → Widget
  hierarchy hosted by the Settings tab's native stack — the devices manager
  and the advanced screen), demo-history toggle, and a failure-only
  connection warning (a concise, actionable row shown ONLY for a confirmed
  failure — no permanent status cards, no combined check button).
- `ui/AdvancedSettingsScreen.tsx` — the dedicated MQTT/InfluxDB
  configuration screen, REDESIGNED (`advanced-config-stepper-redesign`,
  then re-modeled by `advanced-settings-sequential-recovery`) as ONE
  guided flow over the `ui/advanced/` components (`ConfigurationStepper`,
  `ServerDiscoveryStep`, `AuthenticationStep`, `CompletionStep`,
  `MqttStatusCard`, `InfluxDbStatusCard`, `RuntimeRecoveryNotice`,
  `ConnectionStatusBadge` — the screen itself is a thin composition).
  The screen has two MODES of one flow — NOT two selectable tabs:
  **setup mode** renders the stepper → current step card (the wizard
  NEVER shows status widgets); **status mode** (the post-save `Trạng
  thái`, informally "step 4" but NEVER a fourth stepper level) renders
  the MQTT status card → `Cơ sở dữ liệu` group title + InfluxDB card →
  the `Cấu hình lại` entry → safe bottom padding.
  - **Mode model (advanced-settings-sequential-recovery):** the old
    `Thiết lập | Trạng thái` selectable sub-tab split is RETIRED. A
    successful `Lưu cấu hình` ENTERS status mode; a valid persisted
    configuration opens the screen directly in status mode; first run
    (nothing persisted) opens setup Step 1. `Cấu hình lại` is the only
    explicit path from status mode back to setup Step 1 (draft kept,
    nothing auto-saved). Web carve-out (user decision 2a): with no
    guided flow (`discovery === null`) there is no wizard and no mode
    chrome — the status content (widgets, no `Cấu hình lại` entry)
    renders directly below the hint.
  - **Stepper:** `Máy chủ` / `Xác thực` / `Hoàn tất` — EXACTLY three
    official levels — with thin connector lines; amber = current, teal +
    ✓ = completed, gray = not reached/locked; labels below the dots; NOT
    freely-switchable — navigation is flow-driven and forward movement
    is sequential and gated. The initial position is resolved once at
    mount (stored session position → persisted-config default →
    host-validity step); afterwards the flow alone moves it.
  - **Step 1 (Máy chủ, `ServerDiscoveryStep`):** a SLIM card — title +
    description + the primary `Tìm máy chủ trong mạng` button. The mDNS
    scan renders INLINE (the centered modal is retired): honest
    loading (no double-press) → per-server rows (name, IP, WS port +
    `Chọn máy chủ này`) → honest none/error states (distinct copy from
    the MulticastLock crash-fix) with `Thử lại` + the `Nhập tay địa chỉ`
    link. Selecting applies the existing `applyDiscoveredService`
    non-secret patch and IMMEDIATELY advances to step 2 — the screen owns
    that transition (user-approved `ok` amendment): never saves, never
    probes, never touches secrets. The explicit `Tiếp tục` (rendered
    whenever the draft host/port is valid — e.g. when returning to this
    step with a valid draft) remains the forward action out of the default
    view. The hidden manual fallback reveals host/port
    (default 9001)/prefix (D5: the prefix lives ONLY here) with `Quay
lại tìm` + `Tiếp tục` gated by the settings schema's host/port rules.
  - **Step 2 (Xác thực, `AuthenticationStep`):** username + password
    (masked, reveal toggle), the `Broker không yêu cầu xác thực` option
    (probe runs WITHOUT credentials when checked), secondary `Quay lại`,
    the compact `Quét QR từ server` affordance (same `QrScannerModal` +
    `secretsQrContract` flow, fill-never-save — a QR fill NEVER
    auto-probes or advances; the QR's `influxToken` fills the Influx
    draft shown in the section below), an InfluxDB DRAFT section
    (url/org/bucket + masked token with reveal — the same four fields
    the post-save status detail owns; typing only patches the draft),
    and the primary
    **`Kiểm tra kết nối` — a REAL one-shot MQTT probe**
    (`internal/services/mqttProbeService.ts`: throwaway `mqtt` client
    over WebSocket, ~8 s timeout, typed auth/timeout/network causes,
    ALWAYS cleaned up — never the shared telemetry client). Success
    auto-advances to step 3; failure keeps all entered data and shows a
    short inline cause.
    **Dual probe (Amendment 1, A3):** the same button also probes
    InfluxDB against the DRAFT config when url/org/bucket/token are all
    filled (`internal/services/influxProbeService.ts`: a throwaway
    `InfluxV2Adapter` built from the history module's PUBLIC api per
    probe, ~8 s window with a real abort signal, typed
    auth/timeout/network causes — never the shared `historyAdapter`).
    Insufficient draft → an honest skip line; both results show inline;
    an InfluxDB failure NEVER blocks the flow (MQTT alone gates step 3)
    and its result carries into the summary.
  - **Step 3 (Hoàn tất, `CompletionStep`):** large ✓, `Kết nối thành
công`, summary rows (broker address, WS port, auth status =
    username or `không xác thực` + `đã kiểm tra`, InfluxDB = `đã kiểm
tra ✓` / `thất bại` / `chưa cấu hình — bỏ qua`), primary `Lưu cấu
hình` (the EXISTING save path — the only commit action).
  - **Save-failure policy (advanced-settings-sequential-recovery):** a
    FAILED save STAYS on step 3 — the draft and validation errors are
    preserved, nothing is marked persisted, nothing is applied to the
    runtime, and the user is NEVER navigated backward automatically. The
    retryable error renders near the save action and the primary button
    becomes `Thử lại` (the approved primary recovery action). Explicit
    contextual edit actions are offered instead of an automatic back:
    `Chỉnh sửa xác thực` returns to step 2; `Chỉnh sửa máy chủ` (only
    when a save flagged a server-field error) returns to step 1 — the
    draft survives both, and returning invalidates the dependent probe
    gates (step 3 re-locks until a fresh MQTT probe succeeds).
  - **Runtime-failure recovery (replaces the retired automatic
    fallback):** the old behavior — jump to step 1 on terminal `failed`,
    the 60 s sustained-`reconnecting` timer, the tab yank — is RETIRED.
    A lost or degraded PERSISTED runtime connection NEVER resets the
    step/mode/draft. In setup mode a `RuntimeRecoveryNotice` renders AT
    the user's current official step (danger on `failed` with `Thử lại`
    — the real telemetry stop/start lifecycle — and `Cấu hình lại`;
    calm amber on `reconnecting`, no actions, no timer escalation). In
    status mode the failed MQTT card itself is the notice (retry +
    `Cấu hình lại`). The draft-vs-live distinction is explicit: the
    notice text names the PERSISTED config and states that the draft is
    untouched. `Cấu hình lại` moves to setup Step 1 ONLY on the user's
    press.
  - **Wizard session persistence (Amendment 2, B2; mode model):**
    `currentStep` + `savedOk` + `mode` live in the session-scoped
    `internal/ui/wizardSessionStore.ts` (module-scope zustand, NOT
    persisted): leaving to the Dashboard tab and returning restores the
    reached step AND the setup/status mode; an app restart resets to the
    mount-resolve. Mount precedence: the stored position/mode → the
    fresh default (valid persisted configuration → status mode;
    otherwise setup, step by host validity). There is deliberately NO
    broker-loss mount override anymore — a runtime failure never decides
    where the user is. Probe results stay screen-local (honest — they
    describe the current mount's checks) and are INVALIDATED (AD-5
    epoch) by any draft edit, no-auth toggle, or user step transition: a
    late result from a stale draft can never unlock step 3 or overwrite
    a current error.
  - **Status widgets (Amendment 3, C3 — buttonless):** the compact
    `ConnectionWidget`s are status dot + service name + short status +
    `›` chevron — NO action button. The WHOLE widget body (≥ 44 px tap
    target) opens the centered detail panel (the existing dialog
    recipe): MQTT detail = state + host:port + auth mode (username or
    `không xác thực`, never the password) + `Kiểm tra lại`/`Thử lại`
    (the real retry) + `Cấu hình` when unconfigured (→ setup Step 1);
    InfluxDB detail = status + the 4-field form (masked token) + the
    manual-probe hint + `Kiểm tra` — the quick actions moved INSIDE the
    panels (same `advanced-mqtt-retry` / `advanced-influx-check` IDs),
    resolving the mqtt/influx asymmetry without buttonless-widget
    ambiguity.
  - **Post-save seeding (Amendment 1, A3):** a successful save seeds the
    InfluxDB status card from the step-2 probe result (draft ===
    persisted at that instant; fingerprint-bound; NO extra network
    call), and the never-probed status reads `Chưa kiểm tra` instead of
    an em-dash. The explicit manual `Kiểm tra` contract is unchanged.
  - **MQTT status card (`MqttStatusCard`):** the REAL telemetry
    lifecycle (unchanged truthfulness contract — never a parallel
    client): Chưa cấu hình / Đang kết nối / Đã kết nối / Mất kết nối /
    Kết nối thất bại (+ friendly cause), with per-state actions
    (`Cấu hình` → setup Step 1; `Thử lại` / `Kiểm tra lại` → the wired
    retry; connecting → honest loading). Disabled actions stay readable
    (opacity floor).
  - **InfluxDB area (`InfluxDbStatusCard`):** `InfluxDB v2` + a small
    `CHỈ ĐỌC` badge; Chưa cấu hình / Đang kiểm tra / Kết nối thành công
    / Kết nối thất bại (the existing explicit probe + fingerprint
    staleness logic unchanged); `Cấu hình` opens a 4-field form
    (URL/org/bucket/token) in the centered-dialog recipe (D3 — mDNS
    usually prefilled the first three; edits go through the store
    actions, never auto-saved); `Kiểm tra` enabled only when the config
    is sufficient. Info box below the card: `Kiểm tra InfluxDB là thao
tác thủ công và không sử dụng dữ liệu demo.`
  - Web: the guided flow is hidden (user decision 2a — mDNS is
    native-only); the status cards remain visible once something is
    persisted; the probe service additionally refuses to run on web
    (typed transport error).

## mDNS discovery contract (`_smarthome._tcp` — two-sided, app ↔ server)

First-run step 1 (`settings-mdns-discovery` plan): the user taps
**Tìm máy chủ trong mạng** on the advanced settings screen → the app
browses mDNS (`_smarthome._tcp`, domain `local.`) for 10 seconds → found
servers are listed (name + `host:port`) → tapping one autofills the
NON-secret connection fields (MQTT host/port/prefix + Influx
url/org/bucket). The user then types only the 2 secrets (MQTT password +
InfluxDB token) and presses Lưu. Nobody has to know an IP.

### Advertisement (server side)

- **Service type:** `_smarthome._tcp` (domain `local`)
- **Instance name:** free-form display name (e.g. `Smart Home Server`)
- **Port** = the **MQTT WebSocket port** (9001) — one advertisement
  carries everything; the rest lives in the TXT records.
- **TXT records (ALL optional — the app uses a default or keep-current
  when missing):**
  | TXT key | Fills | Missing / garbage → |
  | --- | --- | --- |
  | `prefix` | `mqtt.prefix` | keep the current field value |
  | `influx_port` | port of `influx.url` | default **8086** |
  | `influx_org` | `influx.org` | keep the current field value |
  | `influx_bucket` | `influx.bucket` | keep the current field value |

### Fill rule (app side)

- ONLY non-secret fields are ever written. `mqtt.username`,
  `mqtt.password` and `influx.token` are NEVER touched.
- InfluxDB URL IPv6 rule: the URL built from a discovered host always
  brackets an IPv6 literal per RFC 3986 (`http://[fe80::1]:8086`, the
  MQTT host field stays the bare/original value). The same rule holds at
  the credentials-QR parser and the InfluxDB query adapter: an old,
  malformed unbracketed IPv6 URL of the known backend shape
  (`http://fe80::1:8086`) is repaired to the bracketed form at the
  parse/adapter boundaries; invalid non-http input is left for the
  settings validation to reject honestly.
- NO auto-save: the fill goes through the form's store actions
  (`updateMqtt` / `updateInflux`); the user reviews and presses Lưu as
  usual. mDNS is unauthenticated — trust-on-first-use inside the LAN,
  user review is the last line of defense.
- The scan ends after 10 s; nothing found is an honest empty result
  (plus the same-WiFi / server-running / avahi-advertising hint), never
  an error.
- Web: the whole block is hidden (zeroconf is a native module; the lazy
  getter never constructs it on the web path).

### Address selection contract (`mdnsDiscoveryService.pickHost` — `mdns-link-local-address-filter`)

An advertisement is only listed when one of its addresses survives the
selection contract; otherwise it is SKIPPED and the scan ends honestly
empty ("không tìm thấy") — never a typed error, never an autofill of an
unreachable address. There is NO hostname fallback (on Android NSD the
lib's `host` field is the reverse-DNS of the single OS-chosen address —
the fe80:: leak path; on DNSSD it is the service name; `.local` names are
not resolvable by RN sockets anyway).

- NEVER selected (filtered): IPv6 link-local `fe80::/10`; IPv6 loopback
  `::1`; IPv4 loopback `127/8`; IPv4 link-local `169.254/16`; Docker
  `172.16/12`; Tailscale CGNAT `100.64/10`. A trailing zone-id
  (`fe80::1%wlan0`) is stripped before classification; a v4-mapped
  `::ffff:a.b.c.d` unwraps to its IPv4 and follows the IPv4 filters. All
  other non-global IPv6 (ULA `fc00::/7`, multicast, …) is never selected
  by the tiers below.
- Priority tiers: (1) among the surviving IPv4s, the one sharing the most
  LEADING octets with the phone's own Wi-Fi IPv4 (0–4; ties keep
  advertisement order) — a /24 match is the expected real-world case;
  (2) any other surviving IPv4 (rank 0, same pass); (3) the first
  surviving IPv6 global-unicast (`2000::/3`).
- Subnet honesty: Android/JS exposes no subnet-mask API, so "same subnet"
  is the octet-prefix heuristic above, not a true mask compare. The phone
  IPv4 comes from `expo-network`'s `getIpAddressAsync()` (web → `null`
  without touching the native module; invalid/IPv6/garbage → `null`); a
  `null` phone IP degrades tier 1 to advertisement order. mDNS itself
  needs Wi-Fi multicast, so this only affects ordering, never
  correctness.
- Android impl (D-2): the scan and stop both dispatch the **DNSSD**
  impl (`ImplType.DNSSD`) — the NSD default delivers exactly ONE
  OS-chosen address (`NsdServiceImpl.serviceInfoToMap`), which is how a
  lone fe80:: reached the form; the embedded dnssd resolver delivers the
  FULL advertised A/AAAA list. DNSSD may emit `resolved` multiple times
  per service (progressive address accumulation); the per-event mapping
  plus `name|host|port` dedupe handles it — a rare transient partial
  list could surface an extra row, accepted. Known device risk: the
  embedded resolver's reliability on older Androids is unproven; if it
  proves flaky, reverting the impl argument to NSD keeps the filter +
  subnet tier correct (manual entry and the QR remain the escape
  hatches).
- Smoke note: `expo-network` is a NEW native module — the device smoke
  for discovery requires a NATIVE REBUILD (`npm run android`, or the
  offline gradlew release workaround + `adb install -r`); a Metro reload
  is NOT enough.

### Troubleshooting (Android)

- Symptom: the scan ALWAYS finds nothing and logcat shows
  `MulticastLock under-locked` (`NsdServiceImpl.stop`) — the
  `react-native-zeroconf@0.14.0` multicast-lock lifecycle crash (fixed by
  the bundled patch `patches/react-native-zeroconf+0.14.0.patch`, applied
  on install via `patch-package`; changing it requires a native rebuild —
  `npm run android`).

### Server config (avahi — copy as `/etc/avahi/services/smarthome.service`)

```xml
<!-- /etc/avahi/services/smarthome.service -->
<service-group>
  <name replace-wildcards="yes">Smart Home Server</name>
  <service>
    <type>_smarthome._tcp</type>
    <port>9001</port>
    <txt-record>prefix=smarthome</txt-record>
    <txt-record>influx_port=8086</txt-record>
    <txt-record>influx_org=smarthome</txt-record>
    <txt-record>influx_bucket=smarthome</txt-record>
  </service>
</service-group>
```

Restart avahi after dropping the file (`systemctl restart avahi-daemon`).
The app-side constants live in
`internal/domain/mdnsDiscoveryContract.ts` (`MDNS_SERVICE_TYPE_FULL`,
`DEFAULT_INFLUX_PORT`).

## Secrets QR contract (`kind: "credentials"` — two-sided, app ↔ server)

First-run step 2 (`settings-secrets-qr` plan): the server prints ONE
credentials QR for the owner to scan from the advanced settings screen
("Quét QR từ server") — zero-typing for the first machine. The app parses
it through `internal/domain/secretsQrContract.ts` and fills the three
secret fields AND (since `credentials-qr-nonsecret-fields` / M27b) the six
optional non-secret connection fields through the store actions; **nothing
is ever auto-saved** (the user still reviews and presses Lưu).

### Print command (server side — `server-init.sh`, M27a shape)

```bash
qrencode -t ANSIUTF8 '{"schemaVersion":1,"kind":"credentials","mqttUsername":"...","mqttPassword":"...","influxToken":"...","mqttHost":"192.168.x.x","mqttPort":9001,"mqttPrefix":"smarthome","influxUrl":"http://192.168.x.x:8086","influxOrg":"smarthome","influxBucket":"telemetry"}'
```

The QR is printed to the TERMINAL for the owner to scan directly —
`-t ANSIUTF8` renders it in block characters.

### Payload fields (zod schema `CredentialsQrSchema`)

| Field           | Type                             | Missing / empty →                                                       |
| --------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `schemaVersion` | literal `1` (pinned)             | wrong/missing version → honest "Phiên bản mã QR không hỗ trợ" error     |
| `kind`          | literal `"credentials"` (pinned) | unknown kind → honest "Loại QR không hỗ trợ" error, fields never parsed |
| `mqttUsername`  | optional string                  | keep the current form value (never overwritten with nothing)            |
| `mqttPassword`  | optional string                  | keep the current form value                                             |
| `influxToken`   | optional string                  | keep the current form value                                             |
| `mqttHost`      | optional string (non-secret)     | keep the current form value                                             |
| `mqttPort`      | optional NUMBER int 1–65535      | keep the current form value                                             |
| `mqttPrefix`    | optional string (non-secret)     | keep the current form value                                             |
| `influxUrl`     | optional string (non-secret)     | keep the current form value                                             |
| `influxOrg`     | optional string (non-secret)     | keep the current form value                                             |
| `influxBucket`  | optional string (non-secret)     | keep the current form value                                             |

- A QR where NO SECRET field has a value is rejected as "QR rỗng" — the
  non-secret fields never satisfy the emptiness check (the server always
  sends the secrets; a connection-only QR is not a credentials QR).
- The non-secret fields are per-field junk-tolerant (M27b): a wrong-typed
  value (e.g. `mqttPort` as a string), an out-of-range port, or a prefix
  failing the settings prefix rule drops ONLY that field — the rest of the
  QR still fills (same tolerance pattern as `mdnsDiscoveryContract.ts`).
- The server emits each non-secret field ONLY when non-empty (M27a); the
  app additionally treats empty strings as keep-current, so either side's
  "absent" semantics stay safe.
- Non-JSON garbage is rejected as "Mã QR không hợp lệ".
- Unknown extra fields are tolerated (zod strips) so server tooling can
  enrich the payload without breaking older app versions.
- Forward-compat: a future `kind: "system"` (full-system share — rooms +
  dashboard via QR) is a separate task; today it produces the honest
  unsupported-kind error above.

### Security: this QR IS the key

- The payload carries the broker password and the InfluxDB API token —
  treat the printed QR as a physical key. Print it ONLY on the server's
  own terminal (owner-controlled); do NOT hand the string to other tools
  or chat apps to "make a nicer QR".
- `server-init.sh` must NOT write the secret payload into any persistent
  log file (journal, `.log`, motd) — the terminal is the only output
  surface. Rotate the credentials if the QR ever leaks.

## Notes

- No `.env`: broker + InfluxDB credentials live on-device only.
- `settings:changed` events reconfigure telemetry / relay / history in the
  composition root (App.tsx), not here.

## Guideline (khung chung — tiếng Việt)

- **Mục đích:** sở hữu persist settings (broker/influx/theme) + discovery
  (mDNS), probe kết nối, QR credentials. Màn hình quản lý devices/
  dashboard nằm ở tab Settings nhưng DỮ LIỆU thuộc module kia.
- **Public API:** `SettingsService` (`load/save/onChanged`),
  `defaultSettings()`, `AppSettings`/`SettingsSnapshot` qua `api/`.
- **Mở rộng:** thêm field settings → sửa zod schema + form
  (`AdvancedSettingsScreen`) + probe tương ứng; discovery/QR chỉ trả
  field non-secret, secret giữ keep-current + fill-không-tự-save.
- **Test seam:** schema parse test, fake zeroconf + provider inject cho
  `MdnsDiscoveryService`, throwaway adapter cho probe (không đụng
  client/share dùng chung).
