/**
 * Vietnamese UI strings — the single place where screen text lives.
 *
 * Screens import {@link STRINGS} instead of hard-coding labels so the whole
 * UI stays consistent. Keep the shape flat-ish and stable: CP tasks reference
 * these keys by name (`tabs`, `dashboard`, `devices`, `history`, `settings`,
 * `widgets`).
 */

/** Tab titles (shown in the tab bar). */
export const STRINGS = {
  tabs: {
    dashboard: 'Dashboard',
    history: 'Lịch sử',
    settings: 'Cài đặt',
  },
  dashboard: {
    environment: 'Môi trường',
    devices: 'Thiết bị',
    temperature: 'Nhiệt độ',
    humidity: 'Độ ẩm',
    edit: 'Sửa',
    addWidget: 'Thêm widget',
    mqttOnline: 'MQTT Online',
    mqttOffline: 'MQTT Offline',
    mqttConnecting: 'Đang kết nối…',
    mqttReconnecting: 'Đang kết nối lại…',
    noWidgets: 'Chưa có widget nào — thêm widget trong Cài đặt.',
    noWidgetsEditor: 'Phòng này chưa có widget nào — nhấn "Thêm widget".',
    noRooms: 'Chưa có phòng nào — tạo phòng trong Cài đặt.',
    // View-only Dashboard tab: the ACTIVE Template references no room.
    noTemplateRooms:
      'Template này chưa có phòng nào — mở tab Cài đặt để thêm phòng.',
    selectDashboard: 'Chọn dashboard',
    removeDashboard: 'Xóa dashboard',
    removeDashboardConfirm:
      'Xóa dashboard "{name}"? Toàn bộ widget của dashboard này sẽ bị xóa và không thể hoàn tác.',
    addDashboard: 'Dashboard mới',
    toggle: 'Bật/tắt',
    loading: 'Đang tải…',
    deleteWidget: 'Xóa widget',
    resize: 'Đổi kích thước',
    unsupportedWidget: 'Widget không được hỗ trợ',
    currentRoom: 'Phòng hiện tại',
    allRooms: 'Tất cả',
    // Room selector (Phase 1 layout): expandable full room list.
    roomList: 'Danh sách phòng',
    close: 'Đóng',
    addRoom: 'Thêm phòng',
    editTitle: 'Chỉnh sửa dashboard',
    saveLayout: 'Lưu bố cục',
    editHint: 'Kéo thả để sắp xếp lại widget.',
    editorRoom: 'Phòng đang chỉnh sửa',
    lostBinding: 'Thiết bị không còn tồn tại',
    rebind: 'Chọn lại thiết bị',
    // CP6: sensor card delta caption ("↑ 0.6 °C so với 1 giờ trước").
    deltaVsHourAgo: 'so với 1 giờ trước',
    // Smart Home header connection chip (short labels; the legacy
    // mqttOnline/mqttOffline stay for Settings/TemplateList consumers).
    connConnected: 'Đã kết nối',
    connFailed: 'Mất kết nối',
    connConnecting: 'Đang kết nối…',
    connReconnecting: 'Đang kết nối lại…',
    // Smart Home sensor card status line: the newest observation's
    // wall-clock time — no invented thresholds; truthful no-data fallback.
    sensorUpdated: 'Đã cập nhật {time}',
    sensorNoData: 'Chưa có dữ liệu',
    // Save/exit race gate (amendment-2 item 9): the save SUCCEEDED but the
    // user edited while it was pending — the editor stays with the newer
    // unsaved edits (nothing is silently discarded; the user can save
    // again).
    savedDraftStale:
      'Đã lưu — vẫn còn thay đổi mới chưa lưu, hãy nhấn Lưu lần nữa.',
    // Resize rejection honesty (dashboard-widget-resize-not-persisted):
    // the editor resize seam returns false when the layout engine rejects
    // the new size — the badge alone must never imply success.
    resizeRejected: 'Không đổi được kích thước widget này — bố cục giữ nguyên.',
  },
  /**
   * Template → Room → Widget management hierarchy: opened from ONE
   * management entry on the Settings root screen and hosted by the
   * Settings tab's native stack. The Dashboard tab is the view-only
   * surface (room strip + widgets of the ACTIVE Template only).
   */
  templates: {
    title: 'Dashboard',
    subtitle: 'Các mẫu bố cục của nhà',
    createTemplate: 'Tạo Template mới',
    templateName: 'Tên Template',
    newTemplateName: 'Template mới',
    newTemplateHint: 'Tạo một mẫu bố cục riêng cho cùng ngôi nhà.',
    renameTemplate: 'Đổi tên Template',
    duplicateTemplate: 'Nhân bản Template',
    deleteTemplate: 'Xóa Template',
    deleteTemplateConfirm:
      'Xóa Template "{name}"? Chỉ Template này bị xóa — phòng, thiết bị và lịch sử vẫn giữ nguyên. Không thể hoàn tác.',
    lastTemplate: 'Phải luôn còn ít nhất một Template.',
    roomCount: '{n} phòng',
    updated: 'Cập nhật {time}',
    updatedNever: 'Chưa cập nhật',
    openTemplate: 'Mở Template',
    createTemplateAction: '+ Tạo Template mới',
    backToTemplates: 'Danh sách Template',
    addRoomAction: '+ Thêm phòng',
    noRoomsYet:
      'Template này chưa có phòng nào — thêm phòng để bắt đầu bố cục.',
    renameRoom: 'Đổi tên phòng',
    renameRoomHint:
      'Đổi tên phòng vật lý — mọi Template dùng chung phòng này đều thấy tên mới.',
    duplicateRoom: 'Nhân bản sang Template khác',
    removeRoom: 'Xóa khỏi Template',
    removeRoomConfirm:
      'Gỡ phòng "{name}" khỏi Template này? Phòng, thiết bị và dữ liệu lịch sử vẫn còn — chỉ tham chiếu và bố cục trong Template này bị gỡ.',
    chooseTargetTemplate: 'Chọn Template đích',
    duplicateIntoTemplate: 'Nhân bản vào "{name}"',
    devicesCount: '{n} thiết bị',
    // Room-card meta line (user decision 2026-09-05): one composable line
    // `X cảm biến · Y thiết bị` — measurement-only devices vs switch/relay
    // devices (a device with both counts once, as control); a zero category
    // is omitted, zero of both falls back to the neutral truthful hint.
    metaSensors: '{n} cảm biến',
    metaDevices: '{n} thiết bị',
    summaryUnknown: 'Chưa có dữ liệu đo',
    createRoomTitle: 'Thêm phòng vào Template',
    createRoomExisting: 'Chọn phòng hiện có',
    createRoomExistingHint: 'Phòng chưa có trong Template này.',
    noRoomAvailable:
      'Không còn phòng nào để thêm. Nếu cần phòng mới, tạo tại Cài đặt → Phòng & thiết bị.',
    roomAdded: 'Đã thêm phòng vào Template',
    editRoom: 'Chỉnh sửa',
    savedLayout: 'Đã lưu bố cục',
    noDraft: 'Không có bản nháp nào đang mở',
    renameWidget: 'Đổi tên widget',
    renameWidgetTitle: 'Tên widget (tùy chọn)',
    configureWidget: 'Cấu hình widget',
    duplicateWidget: 'Nhân bản sang phòng khác',
    moveWidget: 'Chuyển sang phòng khác',
    chooseTargetRoom: 'Chọn phòng đích',
    noCompatibleRoom: 'Không có phòng đích khả dụng.',
    discardChanges: 'Bỏ thay đổi chưa lưu?',
    discardKeepEditing: 'Tiếp tục chỉnh sửa',
    discardConfirm: 'Bỏ thay đổi',
    widgetMenu: 'Tùy chọn widget',
    templateMenu: 'Tùy chọn Template',
    roomMenu: 'Tùy chọn phòng',
    cancel: 'Hủy',
    save: 'Lưu',
    close: 'Đóng',
    add: 'Thêm',
    delete: 'Xóa',
    deleteConfirm: 'Xóa',
  },
  devices: {
    title: 'Thiết bị',
    rooms: 'Phòng',
    addRoom: 'Thêm phòng',
    roomName: 'Tên phòng',
    devicesTitle: 'Thiết bị',
    addDevice: 'Thêm thiết bị',
    name: 'Tên',
    type: 'Loại',
    room: 'Phòng',
    capabilities: 'Capabilities',
    save: 'Lưu',
    delete: 'Xóa',
    cancel: 'Hủy',
    // Centered-dialog dismiss actions (✕ close button + scrim) in the
    // devices screens (devices-add-device-dialog).
    close: 'Đóng',
    edit: 'Sửa',
    editDevice: 'Sửa thiết bị',
    editRoom: 'Sửa phòng',
    // Room action menu (devices-room-actions-modal): the row affordance
    // opens a centered per-room menu; rename reuses the centered dialog.
    roomActions: 'Tùy chọn phòng',
    renameRoom: 'Đổi tên phòng',
    noRoom: 'Chưa xếp phòng',
    chooseRoom: 'Chọn phòng',
    noDevices: 'Chưa có thiết bị nào.',
    temperature: 'Nhiệt độ',
    humidity: 'Độ ẩm',
    switch: 'Công tắc',
    sensor: 'Cảm biến',
    relay: 'Rơ le',
    sensorName: 'Tên cảm biến mới',
    sensorNamePlaceholder: 'Ví dụ: Cảm biến nhiệt độ phòng khách',
    sensorNameRequired: 'Hãy nhập tên cho cảm biến mới.',
    createSensor: 'Tạo cảm biến',
    createRelay: 'Tạo điều khiển',
    sensorCreated: 'Đã tạo cảm biến mới',
    deviceDeleted: 'Đã xóa thiết bị',
    duplicateName: 'Tên đã tồn tại',
    requiredField: 'Trường này là bắt buộc',
    capabilityHelper: 'Chọn các khả năng của thiết bị',
    deviceType: 'Loại thiết bị',
    deleteConfirm: 'Xóa thiết bị này?',
    removeRoom: 'Xóa phòng',
    // CP-R2/CP-R4 device editor labels.
    bindingKind: 'Kiểu kết nối',
    bindingTelemetry: 'Cảm biến (telemetry)',
    bindingRelay: 'Rơ le (relay)',
    relayIndex: 'Kênh rơ le',
    noCapability: 'Chọn ít nhất một thông số',
    saveFailed: 'Không lưu được: ',
    // Device-management subviews (Phòng / Thiệt bị / Loại dữ liệu).
    subviewRooms: 'Phòng',
    subviewDevices: 'Thiết bị',
    subviewData: 'Loại dữ liệu',
    filterAll: 'Tất cả',
    filterSensors: 'Cảm biến',
    filterRelays: 'Rơ le',
    roomRequired: 'Chọn phòng cho thiết bị mới',
    quotaRoomSummary:
      'Cảm biến {sensors}/{sensorMax} · Rơ le {relays}/{relayMax}',
    devicesCount: '{shown}/{total} thiết bị',
    // Room-first device management (approved room-sensor rework).
    addRoomAction: '+ Thêm phòng',
    roomCreated: 'Đã tạo phòng',
    sensorsSection: 'Cảm biến',
    controlsSection: 'Điều khiển',
    quotaSensors: 'Cảm biến {count}/10',
    quotaRelays: 'Điều khiển {count}/10',
    addSensor: 'Thêm cảm biến',
    addRelay: 'Thêm rơ le',
    selectField: 'Chọn một loại thông số',
    dataChannel: 'Kênh dữ liệu',
    dataChannelHint:
      'Kênh dữ liệu chỉ định nguồn MQTT/InfluxDB cho cảm biến mới; đây không phải cảm biến đã có.',
    roomSensorFull: 'Phòng đã đủ số lượng cảm biến cho phép.',
    noChannelAvailable: 'Không còn kênh dữ liệu trống trong phòng này.',
    noFieldAvailable: 'Không còn kênh dữ liệu trống trong phòng này.',
    customMetric: 'Tạo loại thông số mới',
    capabilityKeyLocked:
      'Mã này do board khai báo và phải khớp với kênh dữ liệu đã chọn.',
    chooseSlot: 'Vị trí rơ le (1–10)',
    slotTaken: 'Vị trí đã được dùng trong phòng này',
    roomlessLegacy: 'Thiết bị chưa xếp phòng (bản ghi cũ)',
    assignRoom: 'Chuyển vào phòng',
    sensorMetricRemoved: 'Đã xóa thông số',
    // Capability form (machine key is the immutable MQTT/InfluxDB field id).
    capabilityKeyLabel: 'Mã trường dữ liệu (MQTT/InfluxDB)',
    capabilityKeyHint:
      'Khóa máy bất biến — khớp trường trong payload MQTT và trường _field trong InfluxDB. Chỉ chữ thường không dấu, số và _, bắt đầu bằng chữ cái.',
    capabilityKeyFormat:
      'Chỉ chữ thường không dấu, số và _, bắt đầu bằng chữ cái (ví dụ: pressure)',
    capabilityKeyTaken: 'Mã này đã tồn tại trong danh mục',
    presetsLabel: 'Gợi ý thông số',
  },
  /**
   * Board discovery + room↔board binding (board-discovery-binding plan):
   * the hardware-boards screen (Settings root entry) and the AddRoomDialog
   * board-pick step. Every board card label lives here — no hardcoded
   * Vietnamese in the components.
   */
  boards: {
    title: 'Thiết bị phần cứng',
    online: 'Online',
    offline: 'Offline',
    seen: 'Đã thấy descriptor',
    fieldsLabel: 'Đang đo',
    noFields: 'Chưa có dữ liệu đo',
    relaySlots: 'Rơ le: {n} kênh',
    boardTypeLabel: 'Loại board',
    relayChannels: 'Rơ le: {channels}',
    noDescriptor:
      'Chưa nhận được descriptor — board sẽ hiển thị kênh khi board phát.',
    roomLabel: 'Phòng: {name}',
    roomUnassigned: 'Chưa gán phòng',
    assign: 'Gán vào phòng',
    reassign: 'Gán vào phòng khác',
    unassign: 'Gỡ gán',
    assignTitle: 'Gán board vào phòng',
    assignConfirm: 'Gán board "{code}" vào phòng "{room}"?',
    deleteTitle: 'Xóa board',
    deleteConfirm: 'Xóa board "{code}" khỏi ứng dụng?',
    noRoomAvailable: 'Không còn phòng nào để gán.',
    empty:
      'Chưa thấy board nào — hãy bật board và kiểm tra cấu hình broker ở Cấu hình nâng cao.',
    // AddRoomDialog board-pick step.
    pickLabel: 'Board (tùy chọn)',
    pickHint: 'Chọn board đang chạy để gán phòng này, hoặc bỏ trống.',
    manualCode: 'Nhập mã khác',
    manualCodePlaceholder: 'Ví dụ: board-1',
    manualCodeHint:
      'Mã board trên broker — 1–32 ký tự: chữ cái, số, _ hoặc - (ví dụ: board-1).',
    codeFormat: 'Mã không hợp lệ: chỉ chữ cái, số, _ hoặc - (1–32 ký tự).',
    codeTaken: 'Mã này đã được gán cho phòng khác.',
    // boards-card-layout-search: search bar + `Board {code}` title fallback +
    // offline stale note + footer action sheet (AD-1/AD-2/AD-4).
    searchPlaceholder: 'Tìm kiếm board…',
    searchNoResults: 'Không tìm thấy board phù hợp',
    boardFallback: 'Board {code}',
    // boards-display-by-type (AD-2): the labeled code line on descriptor
    // boards — `Id: {code}` replaces the bare mono code secondary (a
    // descriptor-less board hides the line: its fallback title already
    // contains the code).
    idLabel: 'Id: {code}',
    offlineStaleNote: 'Dữ liệu từ lần cuối board phát',
    actionsTitle: 'Hành động board',
    assignAction: 'Gán vào phòng',
    assignActionDesc:
      'Phòng được chọn sẽ nhận dữ liệu đo và điều khiển rơ le của board này. Gán vào phòng đã có board sẽ thay board cũ.',
    deleteAction: 'Xóa board',
    deleteActionDesc:
      'Board sẽ chỉ bị ẩn khỏi giao diện ứng dụng. Phòng, liên kết, thiết bị logic, widget và lịch sử vẫn được giữ nguyên.',
    unassignedHint: 'Chưa gán phòng — nhấn để gán',
    // dashboard-history-board-touch-share: the footer's PRIMARY assign
    // button (≥44pt) + the action sheet's WiFi setup row. boards-reassign-
    // layout-remove-sharing (2026-09-26) removed the board share rows and
    // their payload lines (`shareCode*` / `shareConfigMqtt*`) — the
    // `STRINGS.settings.share*` block is a DIFFERENT feature (Advanced
    // Settings status sharing) and stays.
    reassignFooter: 'Đổi phòng',
    wifiAction: 'Cấu hình WiFi',
    // boards-qr-scan: the QR scanner flow — scan button + scanner modal
    // (hint / invalid-label error / camera-denied) + the not-found sheet
    // (the scanned board never published on this broker). `{code}` is the
    // boardId from the QR label.
    scanAction: 'Quét mã board',
    scanHint: 'Hướng mã QR vào khung',
    scanInvalid: 'Không phải nhãn board',
    scanRestoreFailed: 'Không thể khôi phục board. Hãy thử quét lại.',
    scanCameraDenied: 'Cần cấp quyền camera để quét mã.',
    scanUnknownTitle: 'Board chưa thấy trên broker',
    scanUnknownHint:
      'Board "{code}" chưa từng phát trên broker — kiểm tra board đã bật và broker đã cấu hình.',
    scanClose: 'Đóng',
    // boards-ble-wifi-provisioning: the BLE onboarding entry — the
    // not-found sheet gains the handoff button; `ble` namespaces the whole
    // provisioning modal's labels (scan / form / statuses / honest errors).
    bleAction: 'Cấu hình WiFi qua Bluetooth',
    ble: {
      title: 'Cấu hình WiFi qua Bluetooth',
      scanHint: 'Đang tìm board phát Bluetooth…',
      scanEmptyHint:
        'Không thấy board? Cắm điện lại board — board chỉ phát Bluetooth khi chưa có WiFi.',
      listLabel: 'Board đang phát Bluetooth',
      ssidLabel: 'Tên mạng WiFi (SSID)',
      passwordLabel: 'Mật khẩu WiFi (bỏ trống nếu mạng mở)',
      show: 'Hiện',
      hide: 'Ẩn',
      // ble-provisioning-v2-broker-push: the Broker + MQTT field groups —
      // prefilled from Settings (broker host derived from the settings
      // broker URL, MQTT credentials taken verbatim). The firmware speaks
      // raw MQTT-TCP, so a missing port means 1883 on the board — never
      // the app's WebSocket port.
      brokerLabel: 'Địa chỉ broker (host:port)',
      brokerPlaceholder: '192.168.100.3:1883',
      mqttUsernameLabel: 'MQTT username (bỏ trống nếu broker ẩn danh)',
      mqttPasswordLabel: 'MQTT password (bỏ trống nếu không có)',
      prefillHint:
        'Broker và tài khoản MQTT lấy từ Cài đặt — kiểm tra rồi gửi.',
      send: 'Gửi cấu hình',
      changeBoard: 'Đổi board',
      statusIdle: 'Board đã sẵn sàng — nhấn Gửi cấu hình',
      statusConnecting: 'Board đang nối WiFi…',
      // v2: CONNECTED means the board has an IP AND its broker MQTT
      // connection is already up (the firmware connects the broker before
      // reporting success — no more "sẽ tự nối").
      success: 'Thành công! Board đã nối WiFi và broker.',
      ssidRequired: 'Nhập tên mạng WiFi (SSID).',
      ssidTooLong: 'Tên mạng quá dài (tối đa 32 byte UTF-8).',
      passwordTooLong: 'Mật khẩu quá dài (tối đa 63 byte UTF-8).',
      brokerRequired: 'Nhập địa chỉ broker (host:port).',
      brokerTooLong: 'Địa chỉ broker quá dài (tối đa 128 byte UTF-8).',
      brokerInvalid:
        'Địa chỉ broker không đúng dạng host:port (không khoảng trắng).',
      mqttUsernameTooLong: 'MQTT username quá dài (tối đa 64 byte UTF-8).',
      mqttPasswordTooLong: 'MQTT password quá dài (tối đa 128 byte UTF-8).',
      failedBadAuth: 'Sai mật khẩu — kiểm tra rồi gửi lại.',
      failedNoSsid: 'Board chưa nhận được tên mạng — gửi lại.',
      // v2: broker URI/format/connect or MQTT-auth failure — distinct from
      // the WiFi FAILED:BAD_AUTH so the user knows WHICH secret is wrong.
      failedBadBroker:
        'Broker sai hoặc không nối được — kiểm tra địa chỉ broker và tài khoản MQTT rồi gửi lại.',
      failedTimeout: 'Board không phản hồi kịp — gửi lại.',
      failedError: 'Board báo lỗi — thử lại hoặc khởi động lại board.',
      validationFailed: 'Cấu hình chưa hợp lệ — kiểm tra lại các trường.',
      errorTransport: 'Không nối được board qua Bluetooth — thử lại.',
      errorBluetoothOff: 'Bluetooth đang tắt — bật Bluetooth rồi thử lại.',
      errorPermission:
        'Chưa cấp quyền Bluetooth/vị trí — cấp quyền trong cài đặt hệ thống.',
      errorUnavailable: 'Bluetooth không khả dụng trên thiết bị này.',
      close: 'Đóng',
    },
  },
  history: {
    title: 'Lịch sử',
    // Legacy gel stats labels (kept for any pre-redesign consumer; the
    // Smart Home chart cards use statMin/statMax/statAvg below).
    min: 'Min',
    max: 'Max',
    avg: 'Trung bình',
    average: 'Trung bình',
    averageLabel: 'Trung bình: ',
    empty: 'Chưa có dữ liệu cho khoảng thời gian này.',
    noData: 'Chưa có dữ liệu',
    temperature: 'Nhiệt độ',
    humidity: 'Độ ẩm',
    loading: 'Đang tải…',
    error: 'Không thể tải dữ liệu lịch sử',
    allRooms: 'Tất cả',
    noSensorForRoom:
      'Chưa chọn cảm biến trong bố cục Dashboard đang dùng. Mở Cài đặt → Quản lý Dashboard để thêm cảm biến vào phòng và lưu.',
    // Smart Home redesign (history-smart-home-redesign): dropdown filters.
    // The range dropdown values stay the HistoryRange keys ('1h'|'24h'|'7d');
    // these are the Vietnamese LABELS only.
    roomPlaceholder: 'Chọn phòng',
    rangePlaceholder: 'Chọn khoảng thời gian',
    // The header ☰ button re-opens the shared full room list (a11y label).
    roomMenu: 'Danh sách phòng',
    // Chart-card statistic labels (spec wording; the legacy min/max/avg
    // keys stay untouched for other consumers).
    statMin: 'Thấp nhất',
    statMax: 'Cao nhất',
    statAvg: 'Trung bình',
    ranges: {
      '1h': '1 giờ',
      '24h': '24 giờ',
      '7d': '7 ngày',
    },
  },
  settings: {
    title: 'Cài đặt',
    // Theme has exactly two explicit choices (`light` / `dark`) — the
    // removed `system` option no longer has a string.
    interface: 'Giao diện',
    dark: 'Tối',
    light: 'Sáng',
    checkConnection: 'Kiểm tra kết nối',
    checking: 'Đang kiểm tra…',
    success: 'Thành công',
    failed: 'Thất bại',
    show: 'Hiện',
    hide: 'Ẩn',
    save: 'Lưu cài đặt',
    saving: 'Đang lưu…',
    saved: 'Đã lưu cài đặt',
    reset: 'Đặt lại',
    mqttBroker: 'MQTT broker (WebSocket)',
    host: 'Địa chỉ máy chủ',
    port: 'Cổng (WS listener)',
    username: 'Tên đăng nhập (tùy chọn)',
    password: 'Mật khẩu (tùy chọn)',
    prefix: 'Tiền tố topic',
    url: 'URL',
    org: 'Tổ chức',
    bucket: 'Bucket',
    token: 'Token',
    hint: 'Cài đặt được lưu trên thiết bị. Token không bao giờ được đưa vào mã nguồn.',
    // CP5 sections + room / capability management + connection status.
    roomsSection: 'Quản lý phòng',
    capabilitiesSection: 'Thông số giám sát',
    connectionSection: 'Kết nối',
    advancedSection: 'Nâng cao',
    advancedHint: 'Cài đặt kết nối MQTT / InfluxDB.',
    cloudHint:
      'Chỉ dữ liệu cảm biến được gửi lên cloud (InfluxDB). Cài đặt kết nối nằm trong mục Nâng cao.',
    // CP-R2 navigation rows into the nested management screens.
    manageSection: 'Quản lý',
    // Management entry into the Template → Room → Widget hierarchy
    // (view-only Dashboard tab stays mutation-free).
    manageDashboard: 'Quản lý Dashboard',
    manageDashboardDesc: 'Template, phòng và widget của dashboard.',
    manageDevices: 'Phòng & thiết bị',
    manageDevicesDesc: 'Phòng, thiết bị và thông số giám sát.',
    // Board discovery entry (board-discovery-binding) — sits right below
    // the Dashboard-management row.
    manageBoards: 'Thiết bị phần cứng',
    manageBoardsDesc: 'Board đang chạy trên broker và phòng đã gán.',
    // Dedicated advanced-configuration screen (connection diagnostics).
    advancedTitle: 'Cấu hình nâng cao',
    advancedDesc: 'MQTT, InfluxDB và chẩn đoán kết nối.',
    connectionWarning:
      'Một dịch vụ kết nối đang gặp sự cố — mở Cấu hình nâng cao để xem chi tiết.',
    // branding-and-settings-version: the informational version footer at the
    // bottom of the Settings root scroll content. `{version}` is filled from
    // the `APP_VERSION` core constant — never parsed from `app.json`.
    versionLabel: 'Phiên bản {version}',
    statusNotConfigured: 'Chưa cấu hình',
    statusStale: 'Đã chỉnh sửa — hãy kiểm tra lại',
    checkNow: 'Kiểm tra',
    retry: 'Thử lại',
    mqttNotConfigured: 'Chưa cấu hình địa chỉ máy chủ',
    influxNotConfigured: 'Chưa cấu hình InfluxDB',
    // Demo history toggle (in-memory only — resets to OFF on restart).
    demoHistory: 'Dữ liệu demo (lịch sử)',
    demoHistoryHint:
      'Dùng dữ liệu giả lập cho tab Lịch sử, không cần InfluxDB. Không lưu — tắt khi khởi động lại ứng dụng.',
    rename: 'Đổi tên',
    remove: 'Xóa',
    back: 'Quay lại',
    confirm: 'Xác nhận',
    cancel: 'Hủy',
    roomHasDevices: 'Phòng này đang có {n} thiết bị.',
    migrationMove: 'Chuyển sang phòng khác',
    migrationUnassign: 'Bỏ phân loại',
    chooseTargetRoom: 'Chọn phòng đích',
    removeRoomConfirm: 'Xóa phòng này?',
    builtinLocked: 'Thông số mặc định, không thể xóa',
    addCapability: 'Thêm thông số',
    capabilityLabel: 'Tên thông số',
    capabilityUnit: 'Đơn vị (tùy chọn)',
    capabilityIcon: 'Biểu tượng',
    capabilityColor: 'Màu',
    mqtt: 'MQTT',
    influx: 'InfluxDB',
    // Amendment 1 (A3): the never-probed state reads as a sentence, not
    // an em-dash (the original visual complaint).
    statusUnknown: 'Chưa kiểm tra',
    // settings-mdns-discovery: "Tìm máy chủ trong mạng" (Bước 1 lần đầu
    // cài app) — mDNS `_smarthome._tcp` browse; chỉ tự điền các trường
    // KHÔNG bảo mật, user tự nhập 2 secret và bấm Lưu.
    findServer: 'Tìm máy chủ trong mạng',
    findServerScanning: 'Đang quét mạng LAN…',
    findServerResultsLabel: 'Máy chủ tìm thấy trong mạng',
    findServerNone: 'Không thấy server trong mạng',
    findServerNoneHint:
      'Kiểm tra: điện thoại và server cùng mạng WiFi? Server đã chạy? avahi đã advertise _smarthome._tcp?',
    // mdns-android-multicastlock-crash: typed scan error ('transport' /
    // 'unavailable') gets its OWN honest state — a crashed scanner must
    // not masquerade as an honest empty network.
    findServerErrorTitle: 'Không quét được trên thiết bị này',
    findServerErrorHint:
      'Bộ quét mDNS gặp lỗi. Thử quét lại, hoặc nhập tay địa chỉ server.',
    findServerRetry: 'Thử lại',
    findServerClose: 'Đóng',
    // advanced-config-stepper-redesign: the setup area is a guided 3-step
    // flow (Máy chủ → Xác thực → Hoàn tất) — NOT freely-switchable tabs;
    // navigation is driven by the flow (mDNS select / manual Tiếp tục →
    // step 2; probe success → step 3; Chỉnh sửa → step 1). The mDNS scan
    // renders INLINE in the step-1 card (modal retired) and `Kiểm tra kết
    // nối` runs a REAL one-shot MQTT probe (mqttProbeService, throwaway
    // client, ~8 s, never the shared telemetry client). The MQTT status
    // card sits BELOW the stepper; the MQTT card AND the whole InfluxDB
    // area stay HIDDEN until a configuration has been persisted (first
    // run = title + stepper + step card only).
    stepServer: 'Máy chủ',
    stepAuth: 'Xác thực',
    stepDone: 'Hoàn tất',
    findServerTitle: 'Tìm máy chủ MQTT',
    findServerDescription:
      'Tự động tìm máy chủ trong cùng mạng Wi-Fi qua mDNS hoặc nhập địa chỉ thủ công.',
    chooseServer: 'Chọn máy chủ này',
    backToScan: 'Quay lại tìm',
    continueManual: 'Tiếp tục',
    authTitle: 'Xác thực MQTT',
    noAuthOption: 'Broker không yêu cầu xác thực',
    probeFailedAuth:
      'Sai tên đăng nhập hoặc mật khẩu. Kiểm tra lại thông tin xác thực.',
    probeFailedTimeout:
      'Không nhận được phản hồi từ máy chủ. Kiểm tra lại địa chỉ và cổng.',
    probeFailedNetwork:
      'Không kết nối được tới máy chủ. Kiểm tra lại địa chỉ và cổng.',
    completionTitle: 'Kết nối thành công',
    summaryAddress: 'Địa chỉ',
    summaryPort: 'Cổng WS',
    summaryAuth: 'Xác thực',
    summaryNoAuth: 'không xác thực',
    summaryVerified: 'đã kiểm tra',
    saveConfig: 'Lưu cấu hình',
    editAuthAction: 'Chỉnh sửa xác thực',
    editServerAction: 'Chỉnh sửa máy chủ',
    mqttCardTitle: 'Máy chủ MQTT',
    mqttStateConnecting: 'Đang kết nối',
    mqttStateConnected: 'Đã kết nối',
    mqttStateLost: 'Mất kết nối',
    mqttStateFailed: 'Kết nối thất bại',
    mqttConnectedDesc: 'Đã kết nối đến {host}:{port}.',
    mqttConnectingDesc: 'Đang thiết lập kết nối đến {host}:{port}…',
    mqttLostDesc: 'Kết nối với máy chủ MQTT đã bị mất.',
    mqttFailedDesc: 'Không thể kết nối: {reason}.',
    mqttFailedDescNoReason: 'Không thể kết nối đến máy chủ MQTT.',
    configAction: 'Cấu hình',
    checkAgain: 'Kiểm tra lại',
    connectingAction: 'Đang kết nối…',
    influxGroupTitle: 'Cơ sở dữ liệu',
    influxCardTitle: 'InfluxDB v2',
    readOnlyBadge: 'CHỈ ĐỌC',
    influxCardDesc: 'Dùng để đọc dữ liệu cảm biến trực tiếp từ InfluxDB.',
    influxProbeInfo:
      'Kiểm tra InfluxDB là thao tác thủ công và không sử dụng dữ liệu demo.',
    // advanced-settings-sequential-recovery: the OLD automatic fallback
    // (immediate on `failed`, 60 s sustained-reconnecting timer, tab
    // yank) is retired. A runtime MQTT failure now surfaces this
    // persistent notice AT the current official step (setup mode) or as
    // the failed status card (status mode) — it never resets the flow,
    // never navigates backward, and never touches the draft. `Cấu hình
    // lại` is the only explicit path back to setup Step 1 (status mode →
    // setup); `Thử lại` drives the real telemetry stop/start lifecycle.
    runtimeLostNotice:
      'Mất kết nối với máy chủ MQTT (cấu hình đã lưu). Bản nháp của bạn không bị thay đổi.',
    runtimeReconnectingNotice:
      'Máy chủ MQTT (cấu hình đã lưu) đang thử kết nối lại…',
    reconfigureAction: 'Cấu hình lại',
    // dashboard-history-board-touch-share: the post-save status mode's
    // additive share button (MQTT + InfluxDB persisted values; the token
    // exists ONLY inside the share payload — never rendered on screen).
    shareConfigAction: 'Chia sẻ cấu hình',
    shareConfigMqttHost: 'MQTT host: {host}',
    shareConfigMqttPort: 'MQTT WebSocket port: {port}',
    shareConfigMqttUsername: 'MQTT username: {username}',
    shareConfigMqttPassword: 'MQTT password: {password}',
    shareConfigInfluxUrl: 'InfluxDB URL: {url}',
    shareConfigInfluxOrg: 'InfluxDB org: {org}',
    shareConfigInfluxBucket: 'InfluxDB bucket: {bucket}',
    shareConfigInfluxToken: 'InfluxDB token: {token}',
    // Amendment 1 (A3): the step-2 dual probe's InfluxDB half (draft
    // config, one-shot) — states are honest and non-secret; failure is
    // non-blocking.
    influxProbeChecking: 'Đang kiểm tra InfluxDB…',
    influxProbeOk: 'InfluxDB: kết nối thành công',
    influxProbeFailed: 'InfluxDB: kiểm tra thất bại',
    influxProbeSkipped: 'InfluxDB chưa cấu hình — bỏ qua kiểm tra.',
    summaryInfluxSkipped: 'chưa cấu hình — bỏ qua',
    // advanced-settings-sequential-recovery: the `Thiết lập | Trạng thái`
    // selectable sub-tab split is RETIRED — one flow with a setup mode
    // (the official three-step stepper) and a post-save status mode
    // (informally "step 4", never a stepper level, never a tab). The
    // former setupTab/statusTab/editFullConfig keys are removed with it.
    // advanced-config-stepper-redesign keeps the QR fill affordance as a
    // compact secondary action on step 2 (same QrScannerModal +
    // secretsQrContract flow, fill-never-save), plus the `Nhập tay địa
    // chỉ` fallback link and the web hint (user decision 2a — the setup
    // flow is phone-only).
    stepScanQr: 'Quét QR từ server',
    setupManualAddressLink: 'Nhập tay địa chỉ',
    setupWebHint:
      'Thiết lập kết nối được thực hiện trong ứng dụng trên điện thoại.',
    qrScannerTitle: 'Quét QR từ server',
    qrScannerHint: 'Hướng mã QR do server in vào khung',
    qrScannerCameraDenied: 'Cần cấp quyền camera để quét mã.',
    qrScannerClose: 'Đóng',
    qrErrorKind: 'Loại QR không hỗ trợ',
    qrErrorVersion: 'Phiên bản mã QR không hỗ trợ',
    qrErrorEmpty: 'QR rỗng — không có thông tin nào',
    qrErrorMalformed: 'Mã QR không hợp lệ',
  },
  widgets: {
    sensorValue: 'Giá trị cảm biến',
    switch: 'Công tắc',
    historyChart: 'Biểu đồ lịch sử',
    sensorValueDesc: 'Hiện giá trị trực tiếp của cảm biến (nhiệt độ, độ ẩm…)',
    switchDesc: 'Bật / tắt rơ le qua công tắc.',
    historyChartDesc: 'Biểu đồ giá trị cảm biến theo thời gian.',
    devicesByRoom: 'Thiết bị trong phòng: ',
    // Switch card status captions (approved device card anatomy).
    on: 'Đang bật',
    off: 'Đang tắt',
    // Smart Home UNKNOWN switch state (no feedback yet): the accessible
    // value states the unknown status so it never reads as plain OFF.
    stateUnknown: 'Trạng thái chưa xác định',
    // Smart Home switch-card captions (scope amendment 2, user-approved):
    // the OFFLINE lock caption (MQTT not connected — the switch is
    // disabled) and the VISIBLE unknown-state caption (no confirmed relay
    // state — plain text, never rendered as OFF).
    offlineCaption: 'Không thể điều khiển',
    unknownCaption: 'Chưa rõ trạng thái',
    chooseWidget: 'Chọn widget',
    chooseDevice: 'Chọn thiết bị',
    chooseCapability: 'Chọn capability',
    chooseRoom: 'Chọn phòng',
    chooseSize: 'Chọn kích thước',
    add: 'Thêm',
    cancel: 'Hủy',
    disabled: 'Không có thiết bị nào khả dụng.',
    // Add-widget flow empty states (reviewer fix cycle 2): a room with NO
    // devices guides the user to the Devices tab; a room whose sources are
    // ALL already displayed gets the truthful "everything is placed" copy.
    emptyNoDevices: 'Phòng này chưa có thiết bị',
    emptyAddDeviceHint: 'Thêm thiết bị vào phòng này trong tab Thiết bị trước.',
    emptyAllDisplayed: 'Tất cả thiết bị trong phòng đã có widget',
    emptyAllDisplayedHint:
      'Bạn có thể sửa hoặc xóa widget hiện có, hoặc thêm thiết bị mới cho phòng này.',
    // Binding swap (fix cycle 7 G): picking a source another widget in the
    // same room already holds offers an explicit swap instead of a save
    // failure.
    swapBindingTitle: 'Nguồn đã có widget sử dụng',
    swapBindingConfirm:
      '"{name}" đang dùng nguồn này. Hoán đổi nguồn giữa hai widget?',
    swapBindingAction: 'Hoán đổi',
    error: 'Lỗi: ',
    categoryAll: 'Tất cả',
    categorySensor: 'Cảm biến',
    categoryControl: 'Điều khiển',
    categoryHistory: 'Lịch sử',
    categorySystem: 'Hệ thống',
  },
} as const;

export type Strings = typeof STRINGS;
