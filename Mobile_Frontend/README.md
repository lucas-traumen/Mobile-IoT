# IoT Dashboard — Ứng dụng Di động Nhà Thông Minh (v1.0)

**IoT Dashboard** (`com.example.iot`) là ứng dụng di động (Android-first) xây dựng trên nền tảng **Expo SDK 57 (React Native + TypeScript strict)**, dùng để giám sát cảm biến thời gian thực, điều khiển rơ-le theo phòng, tra cứu biểu đồ lịch sử từ InfluxDB v2 và quản lý phần cứng ESP32 trong mạng nội bộ.

Tài liệu kỹ thuật chi tiết của gói ứng dụng và từng phân hệ nằm tại [`app-mobile/README.md`](app-mobile/README.md).

---

## 1. Giới thiệu sản phẩm

Ứng dụng đóng vai trò giao diện điều khiển trung tâm cho hệ thống IoT nhà thông minh tự triển khai (Self-hosted Smart Home), kết nối trực tiếp với **MQTT Broker (qua WebSocket)** và **InfluxDB v2 (qua HTTP Flux API)**:

- **Ngôn ngữ & Giao diện**: Tiếng Việt hoàn chỉnh, thiết kế theo ngôn ngữ *Smart Home* hiện đại với 2 chế độ giao diện tường minh **Sáng (Light)** và **Tối (Dark)**.
- **Kiến trúc dữ liệu**: Tách biệt rõ giữa **Phòng vật lý & Thiết bị (Devices)**, **Bố cục hiển thị (Dashboard Templates)** và **Giao thức phần cứng (MQTT Board Protocol v2)**. Widget trên màn hình chỉ liên kết với định danh thiết bị và khả năng (`deviceId + capability`), không phụ thuộc cứng vào chuỗi topic MQTT.
- **An toàn & Riêng tư**: Toàn bộ thông tin nhạy cảm (mật khẩu MQTT, token InfluxDB) chỉ lưu cục bộ trên thiết bị qua `AsyncStorage`, không lưu trong mã nguồn hay biến môi trường `.env`.

---

## 2. Tính năng chính

### 2.1. Bảng điều khiển trực tiếp (Tab Dashboard)
- **Chế độ chỉ xem (View-only) an toàn**: Tránh thao tác chạm nhầm làm xô lệch bố cục khi sử dụng hàng ngày.
- **Lưới 2 cột chuẩn WYSIWYG**: Hiển thị đồng nhất với trình chỉnh sửa trên mọi kích thước màn hình, tự động chia theo 2 nhóm **Môi trường** (cảm biến) và **Thiết bị** (công tắc rơ-le).
- **Cập nhật thời gian thực & Điều khiển tức thì**:
  - Nhận dữ liệu cảm biến trực tiếp qua MQTT với cơ chế chỉ vẽ lại đúng thẻ có giá trị thay đổi.
  - Công tắc rơ-le phản hồi tức thì (Optimistic UI), tự động đối chiếu phản hồi từ mạch trong **3 giây**; nếu quá hạn không có xác nhận, ứng dụng tự hoàn tác trạng thái và hiển thị cảnh báo lỗi ngay trên thẻ.

### 2.2. Biểu đồ lịch sử thông minh (Tab Lịch sử)
- **Đồng bộ theo bố cục Dashboard**: Tự động hiển thị biểu đồ cho đúng các cảm biến đang được đặt trên bố cục đã lưu của phòng trong mẫu (Template) đang dùng.
- **Truy vấn tối ưu từ InfluxDB v2**: Hỗ trợ 3 khung thời gian (`1 giờ`, `24 giờ`, `7 ngày`), tự động gom nhóm trung bình (`aggregateWindow`: `1m`, `15m`, `1h`) giúp tải nhanh và mượt.
- **Hiển thị trực quan**: Thống kê **Thấp nhất / Cao nhất / Trung bình** kèm đơn vị đo, trục tung (Y-axis) tự động co giãn theo dải giá trị thực tế, hỗ trợ chạm giữ để xem chi tiết từng điểm đo (Tooltip).

### 2.3. Quản lý phần cứng & Onboarding mạch ESP32
- **Tự động phát hiện (Descriptor-driven Discovery)**: Nhận diện mạch phần cứng qua bản tin `descriptor` và `status` trên MQTT, hiển thị rõ mã loại mạch (`boardType`), mã định danh (`Id`), trạng thái Online/Offline cùng danh sách kênh cảm biến (`S1..Sn`) và kênh rơ-le (`K1..K10`).
- **Quét mã QR nhãn mạch**: Quét QR dán trên vỏ thiết bị để định vị nhanh thẻ mạch trong danh sách, khôi phục thẻ đã ẩn hoặc mở ngay luồng cài đặt cho mạch mới.
- **Cấp cấu hình qua Bluetooth (BLE Provisioning v2)**: Đẩy trực tiếp toàn bộ cấu hình **WiFi (SSID/Password) + Địa chỉ MQTT Broker (`host:1883`) + Tài khoản MQTT** xuống mạch ESP32 mới qua BLE mà không cần nạp lại firmware.
- **Gán mạch vào phòng nguyên tử**: Liên kết hoặc chuyển đổi mạch phần cứng giữa các phòng an toàn, giữ nguyên toàn bộ thiết bị và bố cục widget của phòng.

### 2.4. Quản lý Phòng, Thiết bị & Bố cục (Templates)
- **Phòng & Thiết bị (`Cài đặt → Phòng & thiết bị`)**:
  - Hỗ trợ tối đa **10 cảm biến** và **10 rơ-le** (kênh `1..10`) trên mỗi phòng vật lý.
  - Khi phòng đã gán mạch phần cứng, danh sách thêm cảm biến/rơ-le tự động lọc theo đúng các kênh thực tế mà mạch đó hỗ trợ.
  - Cho phép tạo thêm **loại chỉ số đo tùy chỉnh** (tên hiển thị, mã trường MQTT/InfluxDB, đơn vị, biểu tượng, màu sắc).
- **Quản lý Dashboard theo Mẫu (`Cài đặt → Quản lý Dashboard`)**:
  - Tạo nhiều hồ sơ bố cục (**Templates**) khác nhau trên cùng một ngôi nhà vật lý.
  - Sắp xếp thứ tự phòng bằng thao tác nhấn giữ và kéo thả.
  - **Trình chỉnh sửa bố cục theo bản nháp (Draft Editor)**: Kéo thả vị trí, đổi kích thước thẻ (`1x1`, `2x1`, `1x2`, `2x2`), đổi tên, nhân bản hoặc di chuyển widget sang phòng khác. Mọi thay đổi chỉ áp dụng khi bấm **Lưu**; bấm **Hủy** hoặc thoát sẽ khôi phục nguyên trạng.

### 2.5. Cấu hình kết nối 3 bước (Guided Setup)
- **Bước 1 — Máy chủ**: Tự động quét tìm máy chủ trong mạng LAN qua **mDNS (`_smarthome._tcp`)** để điền sẵn địa chỉ MQTT và InfluxDB, hoặc nhập tay.
- **Bước 2 — Xác thực & Kiểm tra**: Hỗ trợ **quét mã QR từ máy chủ** để điền nhanh tài khoản MQTT và InfluxDB Token; tích hợp nút **Kiểm tra kết nối** thực hiện kiểm tra thật (Dual Probe) tới cả MQTT Broker và InfluxDB trước khi lưu.
- **Bước 3 — Hoàn tất & Trạng thái**: Tóm tắt cấu hình, lưu bền vững và cung cấp bảng theo dõi trạng thái kết nối trực tiếp, kèm tính năng chia sẻ nhanh thông tin cấu hình.

---

## 3. Hướng dẫn sử dụng (User Guideline)

### Luồng 1: Thiết lập kết nối máy chủ lần đầu
1. Mở ứng dụng, chuyển sang tab **Cài đặt** → chọn **Cấu hình nâng cao**.
2. **Tại Bước 1 (Máy chủ)**:
   - Bấm **Tìm máy chủ trong mạng** để ứng dụng tự quét mDNS trong 10 giây và chọn máy chủ tìm thấy; **hoặc**
   - Bấm **Nhập tay địa chỉ**, điền IP máy chủ MQTT (cổng WebSocket mặc định `9001`, tiền tố `smarthome`), sau đó bấm **Tiếp tục**.
3. **Tại Bước 2 (Xác thực)**:
   - Bấm **Quét QR từ server** để điền tự động thông tin đăng nhập MQTT và InfluxDB; hoặc nhập trực tiếp trên biểu mẫu (có thể chọn *Broker không yêu cầu xác thực* nếu dùng broker ẩn danh).
   - Bấm **Kiểm tra kết nối** để xác nhận điện thoại kết nối thành công tới Broker và InfluxDB.
4. **Tại Bước 3 (Hoàn tất)**: Kiểm tra lại thông tin tóm tắt và bấm **Lưu cấu hình**.

### Luồng 2: Cài đặt mạng cho mạch ESP32 mới & Gán vào phòng
1. Vào **Cài đặt** → **Thiết bị phần cứng** → bấm nút **Quét QR** và hướng camera vào nhãn QR trên vỏ mạch.
2. Nếu mạch mới chưa có WiFi (chưa xuất hiện trên Broker), chọn **Cấu hình WiFi qua Bluetooth** trên bảng hiện ra:
   - Chọn mạch `IoTBoard-<mã>` trong danh sách quét BLE.
   - Nhập tên WiFi (SSID) và mật khẩu WiFi (địa chỉ Broker TCP `:1883` và tài khoản MQTT đã được điền sẵn từ cài đặt).
   - Bấm gửi cấu hình và đợi mạch báo trạng thái **Đã kết nối (`CONNECTED`)**.
3. Khi thẻ mạch đã hiện trong **Thiết bị phần cứng**, bấm **Gán vào phòng** trên chân thẻ để liên kết mạch với phòng tương ứng.

### Luồng 3: Tạo phòng, thêm thiết bị và thiết kế Dashboard
1. **Tạo phòng & Thiết bị**:
   - Vào **Cài đặt** → **Phòng & thiết bị**.
   - Bấm **＋ Thêm phòng** để tạo phòng vật lý (có thể chọn gán luôn mạch đang online).
   - Chạm vào phòng vừa tạo → bấm **＋ Thêm thiết bị** tại mục *Cảm biến* hoặc *Điều khiển* để đăng ký các kênh cảm biến và rơ-le cho phòng.
2. **Đưa phòng lên Dashboard & Sắp xếp thẻ**:
   - Vào **Cài đặt** → **Quản lý Dashboard** → chọn mẫu (Template) đang dùng.
   - Nếu phòng chưa có trong mẫu, bấm **＋ Thêm phòng** để chọn phòng vật lý đưa vào mẫu.
   - Chạm vào phòng → bấm **Chỉnh sửa**:
     - Bấm nút **＋** để thêm nhanh thẻ cảm biến hoặc công tắc rơ-le lên lưới.
     - Nhấn giữ thẻ để kéo đổi vị trí, mở menu trên thẻ để đổi kích thước (`1x1`, `2x1`, `1x2`, `2x2`), đổi tên hoặc xóa (`-`).
     - Bấm **Lưu** ở góc trên bên phải để áp dụng bố cục.

### Luồng 4: Giám sát và vận hành hàng ngày
- **Tại tab Dashboard**: Bấm nút menu phòng (`☰`) ở góc trên bên trái để chuyển đổi giữa các phòng, theo dõi chỉ số nhiệt độ/độ ẩm trực tiếp và bật/tắt các công tắc thiết bị.
- **Tại tab Lịch sử**: Chọn phòng và khoảng thời gian (`1 giờ`, `24 giờ`, `7 ngày`) để xem biểu đồ biến thiên và các chỉ số thống kê của những cảm biến đang hiển thị trên Dashboard.
- **Đổi giao diện Sáng / Tối**: Vào tab **Cài đặt** → mục **Giao diện**, chọn **Sáng** hoặc **Tối** để áp dụng tức thì.

---

## 4. Hướng dẫn cài đặt & Phát triển (Developer Guide)

### 4.1. Yêu cầu môi trường
- **Node.js**: `>= 22.11.0`
- **Thiết bị/Máy ảo**: Android Studio Emulator hoặc thiết bị Android thật (khuyến nghị dùng bản build native khi kiểm thử Camera QR, BLE và mDNS).

### 4.2. Cài đặt và chạy ứng dụng
Toàn bộ lệnh phát triển được thực thi bên trong thư mục `app-mobile/`:

```bash
cd app-mobile
npm install          # Cài đặt dependencies (tự động chạy patch-package)
npm start            # Khởi động Metro bundler
npm run android      # Build native và cài đặt lên thiết bị/máy ảo Android
```

### 4.3. Các lệnh kiểm tra chất lượng mã nguồn (Verification)
```bash
npm test             # Chạy toàn bộ unit & integration tests (Jest / jest-expo)
npm run typecheck    # Kiểm tra kiểu TypeScript nghiêm ngặt (tsc --noEmit)
npm run lint         # Kiểm tra ESLint và luật ranh giới module (eslint-plugin-boundaries)
npm run format:check # Kiểm tra định dạng Prettier
```

> **Lưu ý khi chạy Prettier**: Nếu thư mục `app-mobile/android/` đã được sinh ra sau khi chạy `prebuild`, hãy kiểm tra định dạng giới hạn trong mã nguồn bằng lệnh:
> `npx prettier --check 'src/**/*.ts*' App.tsx` (chạy từ bên trong `app-mobile/`).

### 4.4. Cấu trúc thư mục & Kiến trúc
Dự án áp dụng kiến trúc **Modular Monolith kết hợp Hexagonal (Ports & Adapters)**:

```text
app-mobile/
  App.tsx                  # Bootstrap ứng dụng, quản lý vòng đời và đồng bộ sự kiện
  src/
    core/                  # Hạ tầng dùng chung: EventBus, DI Container, Result, Clock, Logger, Theme, i18n
    modules/               # Các phân hệ nghiệp vụ độc lập (mỗi module gồm api/, internal/, ui/)
      settings/            # Cấu hình MQTT/InfluxDB/Theme, mDNS discovery, QR credentials, Dual Probe
      telemetry/           # MQTT WebSocket client, xác thực payload cảm biến, bộ đệm descriptor
      relay/               # Điều khiển rơ-le, cơ chế Optimistic UI và hoàn tác sau 3s timeout
      history/             # Truy vấn Flux InfluxDB v2, thống kê chuỗi thời gian và biểu đồ
      devices/             # Registry Phòng/Thiết bị/Capability, khám phá mạch, BLE Provisioning v2
      widgets/             # Widget Registry và các thẻ hiển thị (sensor-value, switch)
      dashboard/           # Engine bố cục lưới 2 cột theo phòng, quản lý Template và trình sửa nháp
    app/                   # Composition Root (wiring/container.ts), thanh điều hướng 3 tab và Settings Stack
```

**Quy tắc kiến trúc cốt lõi**:
1. **Ranh giới module nghiêm ngặt**: Một module chỉ được phép import từ `@core/*` và `@modules/<tên>/api`. Tuyệt đối không import trực tiếp vào `internal/` của module khác (được kiểm soát tự động bởi `eslint-plugin-boundaries`).
2. **Giao tiếp liên phân hệ**: Thực hiện qua `EventBus` định kiểu chặt (`src/core/events.ts`) và các facade công khai tại `api/index.ts`. Việc khởi tạo và tiêm phụ thuộc (DI) chỉ diễn ra tại `src/app/wiring/container.ts`.
3. **Xác thực dữ liệu biên**: Mọi dữ liệu từ bên ngoài (bản tin MQTT, phản hồi CSV từ InfluxDB, mã QR, bản ghi mDNS, dữ liệu lưu trữ) đều được xác thực bằng `zod` trước khi đưa vào tầng nghiệp vụ.

---

## 5. Tài liệu tham khảo chi tiết

- [Tài liệu kỹ thuật tổng thể & Giao thức MQTT/BLE/InfluxDB (`app-mobile/README.md`)](app-mobile/README.md)
- [Hạ tầng lõi (`src/core/README.md`)](app-mobile/src/core/README.md)
- [Phân hệ Dashboard (`src/modules/dashboard/README.md`)](app-mobile/src/modules/dashboard/README.md)
- [Phân hệ Thiết bị & BLE Provisioning (`src/modules/devices/README.md`)](app-mobile/src/modules/devices/README.md)
- [Phân hệ Lịch sử InfluxDB (`src/modules/history/README.md`)](app-mobile/src/modules/history/README.md)
- [Phân hệ Cài đặt, mDNS & QR (`src/modules/settings/README.md`)](app-mobile/src/modules/settings/README.md)
- [Phân hệ Telemetry MQTT (`src/modules/telemetry/README.md`)](app-mobile/src/modules/telemetry/README.md)
- [Phân hệ Điều khiển Rơ-le (`src/modules/relay/README.md`)](app-mobile/src/modules/relay/README.md)
- [Phân hệ Widgets (`src/modules/widgets/README.md`)](app-mobile/src/modules/widgets/README.md)
