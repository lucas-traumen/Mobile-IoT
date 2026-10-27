# Mobile-IoT — Hệ sinh thái nhà thông minh tự triển khai

**Mobile-IoT** hợp nhất ba dự án của một hệ thống smart home chạy hoàn toàn trong mạng LAN, không phụ thuộc cloud:

- **Mobile_Frontend** — ứng dụng di động **IoT Dashboard** (Expo / React Native) để xem cảm biến, điều khiển rơ-le, tra cứu lịch sử và quản lý phòng/thiết bị.
- **Mobile_Backend** — máy chủ self-hosted (Docker: amqtt + Node.js/TypeScript + InfluxDB v2) và **firmware ESP32** (ESP-IDF) cho các board đo nhiệt độ/độ ẩm, điều khiển rơ-le.
- **AI-Mobile** — bộ điều khiển bằng **cử chỉ tay** qua webcam (MediaPipe + TFLite), gửi lệnh trực tiếp tới cùng broker MQTT. Đây là ứng dụng Python chạy trên laptop/edge, không phải app di động.

Điểm chung của cả ba: dùng chung **MQTT topic contract** `{prefix}/boards/{boardId}/...`, chung broker và chung mô hình dữ liệu board — nhờ vậy app, firmware và AI có thể phối hợp mà không cần một lớp API trung gian.

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Kiến trúc và luồng dữ liệu](#2-kiến-trúc-và-luồng-dữ-liệu)
3. [Chạy nhanh](#3-chạy-nhanh)
4. [Mobile_Frontend — IoT Dashboard](#4-mobile_frontend--iot-dashboard)
5. [Mobile_Backend — server + firmware ESP32](#5-mobile_backend--server--firmware-esp32)
6. [AI-Mobile — điều khiển bằng cử chỉ tay](#6-ai-mobile--điều-khiển-bằng-cử-chỉ-tay)
7. [Luồng end-to-end](#7-luồng-end-to-end)
8. [Cấu trúc kho](#8-cấu-trúc-kho)
9. [Yêu cầu môi trường](#9-yêu-cầu-môi-trường)
10. [Bảo mật và giới hạn](#10-bảo-mật-và-giới-hạn)
11. [Tài liệu và repo gốc](#11-tài-liệu-và-repo-gốc)

## 1. Tổng quan

| Thư mục | Vai trò | Công nghệ chính | Điểm vào |
|---|---|---|---|
| `Mobile_Frontend/` | Giao diện người dùng: dashboard realtime, lịch sử, quản lý phòng/thiết bị, onboarding board | Expo SDK 57, React Native 0.86, React 19, TypeScript strict, Zustand, Zod, MQTT.js, Victory Native | `app-mobile/App.tsx` |
| `Mobile_Backend/` | Broker MQTT, ingest telemetry vào InfluxDB, deploy server, firmware ESP32 | Node.js 24, TypeScript ESM, amqtt 0.12.1, InfluxDB 2.7.10, Docker Compose, ESP-IDF 6.0.1 (C/FreeRTOS) | `src/main.ts`, `firmware/esp32-telemetry/main/main.c` |
| `AI-Mobile/` | Nhận diện cử chỉ tay từ webcam và publish lệnh bật/tắt thiết bị | Python 3.12, MediaPipe Hand Landmarker, TFLite, OpenCV, paho-mqtt | `app.py` |

### Thành phần vật lý

- **Board ESP32** gắn cảm biến **SHT30/SHT31** (nhiệt độ, độ ẩm) và các kênh rơ-le `K1..Kn` (mặc định firmware: `K1`, `K2`, `K3`).
- **Server** chạy Docker Compose với ba service: `amqtt`, `influxdb`, `backend`.
- **Điện thoại Android** cài app IoT Dashboard.
- **Laptop có webcam** (tùy chọn) chạy AI-Mobile để điều khiển bằng cử chỉ.

## 2. Kiến trúc và luồng dữ liệu

### 2.1 Sơ đồ thành phần

```text
┌──────────────────────────────┐
│ Mobile_Frontend              │
│ IoT Dashboard (Expo/RN)      │
└───────┬───────────────┬──────┘
        │ MQTT/WS 9001  │ HTTP 8086 (Flux, read-only)
        ▼               ▼
┌───────────────┐   ┌─────────────────┐
│ amqtt broker  │   │ InfluxDB v2     │
│ 1883 / 9001   │   │ bucket telemetry│
└───┬───────┬───┘   └───────▲─────────┘
    │       │               │ ghi telemetry
    │       │        ┌──────┴─────────┐
    │       └───────►│ Mobile_Backend │
    │  MQTT/TCP 1883 │ Node.js/TS     │
    │                └────────────────┘
    │
    ├── MQTT/TCP 1883 ──► ESP32 boards (SHT3x + relay)
    │        ▲
    │        └── BLE provisioning (Wi-Fi + broker + MQTT account)
    │
    └── MQTT/TCP 1883 ──► AI-Mobile (webcam + MediaPipe + TFLite)
```

- App dùng **MQTT over WebSocket** (port `9001`) cho dữ liệu realtime.
- Firmware và AI-Mobile dùng **MQTT TCP** (port `1883`).
- App đọc lịch sử **trực tiếp từ InfluxDB** qua Flux API (port `8086`) bằng token **read-only**.
- Backend **chỉ ingest telemetry** vào InfluxDB; backend không đứng giữa app/AI và firmware khi điều khiển rơ-le.

### 2.2 Các luồng chính

1. **Telemetry**: ESP32 đọc SHT3x mỗi chu kỳ (mặc định 5 giây) → publish `.../telemetry` → backend validate bằng Zod và ghi vào InfluxDB; đồng thời firmware publish giá trị cảm biến dạng retained `.../sensors/S1/state`, `.../sensors/S2/state` để app hiển thị ngay.
2. **Điều khiển rơ-le**: app (hoặc AI-Mobile) publish `.../relays/K1/set` với payload `ON`/`OFF` → firmware nhận lệnh, đóng/ngắt rơ-le và publish lại `.../relays/K1/state` (retained). App dùng **Optimistic UI** và tự hoàn tác nếu không nhận được xác nhận trong **3 giây**.
3. **Lịch sử**: app query InfluxDB v2 bằng Flux cho 1 giờ / 24 giờ / 7 ngày, tự gom nhóm bằng `aggregateWindow` (`1m`, `15m`, `1h`) và hiển thị biểu đồ kèm min/max/avg.
4. **Phát hiện và cấu hình board**: board publish descriptor + status retained; app nhận diện board, quét QR để định vị, rồi đẩy cấu hình Wi-Fi + broker + tài khoản MQTT xuống board qua **BLE provisioning**. Server tự quảng bá `_smarthome._tcp` để app tìm thấy trong LAN.

### 2.3 MQTT topic contract

`{prefix}` mặc định là `smarthome`; `{boardId}` do firmware sinh từ MAC hoặc cấu hình qua `DEVICE_ID`.

| Hướng | Topic | Payload | QoS | Retained |
|---|---|---|---|---|
| Board → app/backend | `{prefix}/boards/{boardId}/descriptor` | JSON mô tả board, cảm biến, rơ-le | 1 | Có |
| Board → backend | `{prefix}/boards/{boardId}/telemetry` | JSON telemetry v2 | 1 | Không |
| Board → app | `{prefix}/boards/{boardId}/sensors/{S}/state` | Số thuần, ví dụ `25.74` | 1 | Có |
| Board → app | `{prefix}/boards/{boardId}/relays/{K}/state` | `ON` / `OFF` | 1 | Có |
| Board → app | `{prefix}/boards/{boardId}/status` | `online` / `offline` (LWT + heartbeat) | 1 | Có |
| App/AI → board | `{prefix}/boards/{boardId}/relays/{K}/set` | `ON` / `OFF` | 1 | Không |

Descriptor là **nguồn chân lý** về phần cứng: tên kênh, trường dữ liệu, đơn vị. Backend map telemetry theo descriptor (data-driven), nên thêm cảm biến/kênh mới không phải sửa logic ingest.

## 3. Chạy nhanh

Thứ tự hợp lý: **server → app → board → AI (tùy chọn)**.

### 3.1. Server

Trên máy chủ Linux **x86-64** đã cài Docker Engine + Docker Compose v2:

```bash
cd Mobile_Backend
bash scripts/smarthome-deploy.sh init
bash scripts/smarthome-deploy.sh status
bash scripts/smarthome-deploy.sh credentials-qr
```

`init` tạo thư mục `~/smarthome`, sinh mật khẩu ngẫu nhiên, pull ba image và khởi động stack; `credentials-qr` in mã QR chứa tài khoản MQTT + token InfluxDB cho app.

> Trên server thật chỉ cần duy nhất file `scripts/smarthome-deploy.sh`, không cần clone cả repo. Khi phát triển từ source, dùng `bash scripts/smarthome.sh init` và `docker compose up -d --build`.

### 3.2. App

```bash
cd Mobile_Frontend/app-mobile
npm install
npm start            # Metro bundler
npm run android      # build native và cài lên thiết bị/máy ảo Android
```

Trong app: mở **Cài đặt → Cấu hình nâng cao**, quét QR vừa tạo (hoặc tìm server qua mDNS), kiểm tra kết nối rồi lưu. App cần chạy trên thiết bị Android thật để kiểm thử đầy đủ QR, BLE và mDNS.

### 3.3. AI-Mobile (tùy chọn)

```bash
cd AI-Mobile
python3 -m venv .venv
source .venv/bin/activate
pip install mediapipe opencv-python numpy tensorflow paho-mqtt
python app.py
```

AI-Mobile tự đọc `../Mobile_Backend/.env` để lấy mật khẩu MQTT. Nếu ba thư mục không nằm cạnh nhau, đặt biến `MQTT_ENV_FILE` trỏ tới file `.env` tương ứng.

## 4. Mobile_Frontend — IoT Dashboard

### 4.1. Vai trò

Ứng dụng **Android-first** (có thể chạy web để mô phỏng) đóng vai trò giao diện điều khiển trung tâm cho hệ thống. Toàn bộ giao diện bằng tiếng Việt, có hai theme **Sáng/Tối**.

### 4.2. Tính năng

- **Dashboard realtime**: nhận telemetry qua MQTT WebSocket; chỉ vẽ lại thẻ có giá trị thay đổi. Công tắc rơ-le phản hồi tức thì (Optimistic UI) và tự hoàn tác sau 3 giây nếu board không xác nhận.
- **Lịch sử**: biểu đồ nhiệt độ/độ ẩm từ InfluxDB v2 theo 1 giờ, 24 giờ, 7 ngày; thống kê thấp nhất/cao nhất/trung bình; tooltip khi chạm.
- **Quản lý phòng và thiết bị**: tối đa 10 cảm biến và 10 rơ-le mỗi phòng; hỗ trợ loại chỉ số đo tùy chỉnh (tên, mã trường MQTT/InfluxDB, đơn vị, biểu tượng, màu).
- **Dashboard Templates**: nhiều bố cục dashboard trên cùng một ngôi nhà; sắp xếp phòng bằng kéo-thả; trình chỉnh sửa bản nháp (draft) với các kích thước thẻ `1x1`, `2x1`, `1x2`, `2x2`; chỉ áp dụng khi bấm **Lưu**.
- **Onboarding board ESP32**: phát hiện board qua descriptor/status, quét QR trên vỏ board, cấu hình Wi-Fi + broker + tài khoản MQTT qua **BLE provisioning v2**, gán board vào phòng.
- **Cấu hình 3 bước**: tìm server qua mDNS (`_smarthome._tcp`), quét QR credentials hoặc nhập tay, kiểm tra kết nối thật (Dual Probe) tới MQTT broker và InfluxDB trước khi lưu.

### 4.3. Kiến trúc

Mô hình **Modular Monolith + Hexagonal (Ports & Adapters)**:

```text
app-mobile/
  App.tsx                    # bootstrap, vòng đời, shell 3 tab
  src/
    core/                    # EventBus, DI, Result, Clock, Logger, Theme, i18n
    modules/
      settings/              # MQTT/InfluxDB/theme, mDNS, QR, Dual Probe
      telemetry/             # MQTT client, validate payload, store
      relay/                 # lệnh rơ-le, Optimistic UI, timeout 3s
      history/               # Flux query, thống kê chuỗi thời gian
      devices/               # Room/Device/Capability, discovery, BLE
      widgets/               # widget registry, sensor/switch cards
      dashboard/             # lưới 2 cột, Templates, draft editor
    app/                     # composition root + navigation + settings stack
```

Quy tắc chính:

- Module chỉ import `@core/*` và `api/` công khai của module khác; `eslint-plugin-boundaries` kiểm tra tự động.
- Giao tiếp liên module qua EventBus có kiểu và facade `api/`.
- Mọi dữ liệu biên (MQTT payload, CSV InfluxDB, QR, mDNS, AsyncStorage) đều được validate bằng Zod.
- Không có secret trong repo; mật khẩu MQTT và token InfluxDB chỉ lưu trên thiết bị qua `AsyncStorage`.

### 4.4. Công nghệ và lệnh

| Thành phần | Phiên bản / lựa chọn |
|---|---|
| Expo SDK | 57 |
| React Native | 0.86.3 |
| React | 19.2.3 |
| TypeScript | 6.0.3, strict |
| State | Zustand |
| Validation | Zod |
| MQTT | `mqtt` v5 (WebSocket) |
| Biểu đồ | `react-native-svg` + Victory Native |
| Native | `expo-camera`, `react-native-ble-plx`, `react-native-zeroconf` |
| Node.js | `>= 22.11.0` |

```bash
cd Mobile_Frontend/app-mobile
npm install
npm start
npm run android
npm test
npm run typecheck
npm run lint
npm run format:check
```

## 5. Mobile_Backend — server + firmware ESP32

### 5.1. Vai trò

Dự án gồm hai phần gắn chặt với nhau:

- **Server self-hosted**: broker MQTT có xác thực, backend ingest telemetry, InfluxDB lưu trữ, mDNS quảng bá, script deploy một chạm.
- **Firmware ESP32**: đọc cảm biến, điều khiển rơ-le, provisioning qua BLE, giao tiếp MQTT theo contract boards.

### 5.2. Thành phần server

| Service | Image / công nghệ | Vai trò | Port host |
|---|---|---|---|
| `amqtt` | amqtt 0.12.1 + persistence SQLite | MQTT broker cho TCP và WebSocket, chặn anonymous, xác thực argon2 | `1883` (TCP), `9001` (WS) |
| `backend` | Node.js 24 + TypeScript, image `trilucas/app_smarthome:backend-latest` | Subscribe descriptor/telemetry, validate Zod, ghi InfluxDB | không mở |
| `influxdb` | InfluxDB 2.7.10 | Lưu telemetry, phục vụ query Flux | `8086` |

Backend có các thành phần chính:

- `src/mqtt/` — một kết nối MQTT, route descriptor và telemetry.
- `src/boards/` — registry `boardId → descriptor`, ingest telemetry v2 theo descriptor.
- `src/telemetry/` — schema Zod và validate payload.
- `src/influx/` — writer có retry/backoff, queue 1000 điểm, bỏ điểm cũ nhất khi đầy.
- `src/query/` — CLI truy vấn latest/history.

Backend **không có HTTP API và không có UI**; app query InfluxDB trực tiếp. Đây là quyết định thiết kế có chủ đích để giảm thành phần trung gian.

### 5.3. Firmware ESP32

- **ESP-IDF v6.0.1**, C/CMake/FreeRTOS.
- **Cảm biến**: SHT30/SHT31 qua I2C, driver có CRC-8; có `SENSOR_FAKE_MODE` để tạo dữ liệu demo khi chưa gắn cảm biến.
- **Wi-Fi**: station event-driven, retry có backoff, phân loại lý do ngắt kết nối.
- **BLE provisioning**: NimBLE GATT 9 UUID, Just Works + bond, lưu credentials vào NVS; board chưa cấu hình tự quảng bá `IoTBoard-{boardId}`.
- **MQTT**: `esp-mqtt`, QoS 1, publish descriptor + telemetry + sensor state + relay state + status; LWT `offline`, heartbeat `online` mỗi 60 giây (mặc định), outbox có giới hạn.
- **boardId**: sinh từ MAC, hoặc đặt qua `DEVICE_ID`; `boardId` cũng là `deviceId` trên toàn bộ topic.
- **Rơ-le**: mặc định `K1`, `K2`, `K3` với GPIO cấu hình qua menuconfig; protocol cho phép mở rộng `K4+`.

### 5.4. Triển khai và vận hành

- `scripts/smarthome-deploy.sh` là bản **image-only**, dùng cho server thật: không cần clone repo, không cần Node/npm/ESP-IDF, không build image.
- Hỗ trợ các lệnh: `init`, `status`, `logs`, `update`, `stop`, `start`, `credentials-qr`, `pairing-code`, `board-qr`.
- `init` idempotent: không ghi đè `.env` và dữ liệu; tự sinh secret; cấu hình avahi để quảng bá `_smarthome._tcp`.
- Chỉ hỗ trợ image **linux/amd64**; server ARM/Raspberry Pi sẽ pull thất bại.
- Không chạy `docker compose down -v` trên server thật vì sẽ xóa volume dữ liệu.

### 5.5. Lệnh phát triển

```bash
cd Mobile_Backend
cp .env.example .env
docker compose up -d --build
docker compose ps
npm install
npm run typecheck
npm test
```

Với server đã cài bằng script:

```bash
bash scripts/smarthome-deploy.sh status
bash scripts/smarthome-deploy.sh logs -f
bash scripts/smarthome-deploy.sh update
```

## 6. AI-Mobile — điều khiển bằng cử chỉ tay

### 6.1. Vai trò

AI-Mobile là **runtime nhận diện cử chỉ** chạy trên laptop có webcam. Nó không thay thế app di động; nó là một cách điều khiển rảnh tay, phù hợp demo hoặc các tình huống không tiện chạm điện thoại.

### 6.2. Pipeline

```text
Webcam → MediaPipe Hand Landmarker (21 điểm) → chuẩn hóa landmark
       → TFLite classifier (7 lớp) → lọc trung vị + debounce
       → GestureStateMachine → MQTT publish → ESP32 → relay state
```

- Model landmark: `hand_landmarker.task` (MediaPipe).
- Model phân loại: `keypoint_classifier.tflite` + `keypoint_classifier_label.csv`.
- Nếu thiếu `hand_landmarker.task`, chương trình tự tải lần chạy đầu.
- Có chế độ offline (`GESTURE_MQTT=off` hoặc không cấu hình được broker): chỉ in lệnh ra log, không điều khiển thật.

### 6.3. Bảng cử chỉ

| Cử chỉ | Nhãn | Tác dụng | Thời gian giữ |
|---|---|---|---|
| Nắm tay, giơ ngón cái | `like_toggle` | Bật/tắt chế độ nhận diện | 1.5 s |
| Một ngón | `one_led` | Chọn LED | 1.0 s |
| Hai ngón | `two_fan` | Chọn quạt | 1.0 s |
| Ba ngón | `three_buzzer` | Chọn còi | 1.0 s |
| Xòe tay | `palm_on` | Bật thiết bị đang chọn | 1.2 s |
| Nắm tay | `fist_off` | Tắt thiết bị đang chọn | 1.2 s |
| Không có cử chỉ | `no_gesture` | Nghỉ, cho phép lặp lệnh | 0.4 s |

Logic hai tầng: `like_toggle` bật/tắt toàn bộ chế độ; sau khi bật, cử chỉ `one/two/three` chọn thiết bị; `palm_on`/`fist_off` mới thực sự bật/tắt thiết bị đã chọn.

### 6.4. Cơ chế chống nhầm lẫn

- Ngưỡng tin cậy **theo từng lớp**: `palm_on`/`fist_off` 0.90, `like_toggle` 0.85, các lệnh chọn thiết bị 0.80.
- Lọc **trung vị 3 frame** trước khi so ngưỡng, loại frame nhiễu đơn lẻ.
- **Debounce**: ít nhất 80% frame trong cửa sổ giữ phải cùng nhãn.
- **Timeout**: tự tắt chế độ nhận diện sau 20 giây không có lệnh; bỏ chọn thiết bị sau 10 giây.
- **Hand-lost grace** 0.5 giây: mất tay thoáng qua không reset trạng thái.
- **ACK timeout** 3 giây: gửi lệnh rơ-le mà board không phản hồi thì coi như thất bại và hoàn tác trạng thái optimistic.

### 6.5. MQTT bridge

`mqtt_bridge.py` kết nối trực tiếp broker và dùng đúng contract boards:

- Publish `{prefix}/boards/{boardId}/relays/{K}/set` với `ON`/`OFF`, QoS 1, không retained.
- Subscribe `.../relays/+/state`, `.../status`, `.../descriptor`.
- Tự dò `boardId` từ descriptor retained nếu `BOARD_ID` để trống.
- Map thiết bị → kênh rơ-le qua `RELAY_MAP` (mặc định `led=K1,fan=K2,buzzer=K3`).
- Không có topic báo lỗi: gửi `set` rồi chờ `state` thay đổi; quá 3 giây thì thất bại.

Cấu hình qua biến môi trường:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MQTT_ENV_FILE` | `../Mobile_Backend/.env` | File `.env` của backend để lấy mật khẩu |
| `MQTT_HOST` | `127.0.0.1` | IP broker (TCP 1883) |
| `MQTT_PORT` | `1883` | Port MQTT TCP |
| `TOPIC_PREFIX` | `smarthome` | Prefix topic |
| `BOARD_ID` | tự dò | Board đích |
| `GESTURE_MQTT_USER` | `app` | User MQTT |
| `GESTURE_MQTT_PASSWORD` | `MQTT_APP_PASSWORD` | Mật khẩu MQTT |
| `RELAY_MAP` | `led=K1,fan=K2,buzzer=K3` | Map thiết bị → kênh |
| `GESTURE_MQTT` | `on` | Đặt `off` để chạy offline |

### 6.6. Huấn luyện model

Phần huấn luyện/đánh giá model nằm ở repo **Hand-gesture** (pipeline HaGRID: MediaPipe landmarks → TFLite MLP, cùng các nhánh MobileNetV3/YOLOv8n để tham khảo). `AI-Mobile` chỉ chứa runtime và model đã xuất để chạy webcam.

## 7. Luồng end-to-end

1. **Cài server**: chạy `smarthome-deploy.sh init` trên máy x86-64 → ba container healthy → server quảng bá `_smarthome._tcp`.
2. **Ghép app**: mở app, tìm server qua mDNS hoặc quét QR credentials → kiểm tra kết nối → lưu cấu hình vào AsyncStorage.
3. **Nạp firmware**: build/flash firmware ESP32 bằng ESP-IDF; board chưa có Wi-Fi tự bật BLE provisioning.
4. **Cấu hình board**: quét QR board trong app → kết nối BLE → nhập Wi-Fi → app đẩy broker URI + tài khoản MQTT → board lưu NVS và vào mạng.
5. **Nhận board**: board publish descriptor + status retained → app hiện thẻ board; gán board vào phòng.
6. **Tạo phòng/thiết bị**: thêm cảm biến, rơ-le, đặt widget lên dashboard, lưu template.
7. **Vận hành**: telemetry chảy về app và InfluxDB; bật/tắt rơ-le từ app hoặc bằng cử chỉ tay; xem lịch sử trong tab History.

## 8. Cấu trúc kho

Cấu trúc hợp nhất (giữ nguyên tên thư mục để các đường dẫn tương đối hoạt động):

```text
Mobile-IoT/
├── README.md
├── Mobile_Frontend/              # Expo/React Native app
│   ├── README.md
│   └── app-mobile/
│       ├── App.tsx
│       └── src/
├── Mobile_Backend/               # server + firmware
│   ├── README.md
│   ├── docker-compose.yml
│   ├── src/
│   ├── firmware/esp32-telemetry/
│   └── scripts/
└── AI-Mobile/                    # Python gesture runtime
    ├── README.md
    ├── app.py
    ├── mqtt_bridge.py
    ├── keypoint_classifier.tflite
    ├── keypoint_classifier_label.csv
    └── hand_landmarker.task
```

> `AI-Mobile` mặc định đọc `../Mobile_Backend/.env`, nên hai thư mục cần nằm cạnh nhau. Nếu đặt ở vị trí khác, dùng `MQTT_ENV_FILE`.

## 9. Yêu cầu môi trường

| Thành phần | Yêu cầu |
|---|---|
| Server | Linux x86-64, Docker Engine + Docker Compose v2, `openssl`, `python3`, `avahi-daemon`, `avahi-utils`, `qrencode` (hai gói cuối chỉ cần cho mDNS/QR) |
| App | Node.js `>= 22.11.0`, Android Studio/emulator hoặc thiết bị Android thật; thiết bị thật khuyến nghị cho QR/BLE/mDNS |
| Firmware | ESP-IDF v6.0.1, board ESP32, cảm biến SHT30/SHT31 (hoặc bật chế độ dữ liệu giả) |
| AI-Mobile | Python 3.12, webcam; `mediapipe`, `opencv-python`, `numpy`, `tensorflow` (hoặc `ai-edge-litert`), `paho-mqtt` |
| Mạng | Server, điện thoại, board và laptop AI phải cùng LAN/Wi-Fi; mDNS cần mạng cho phép multicast |

## 10. Bảo mật và giới hạn

- **Chỉ dùng trong LAN**: MQTT và InfluxDB hiện chạy plaintext (`ws://`, `http://`), chưa có TLS. Không mở trực tiếp các port `1883`, `9001`, `8086` ra Internet.
- **Secret không nằm trong repo**: mật khẩu MQTT, token InfluxDB, `.env` chỉ tồn tại trên server/thiết bị. File `~/smarthome/.env` trên server là chìa khóa của cả hệ thống.
- **QR credentials chứa secret**: chỉ hiển thị khi ghép nối, không chụp màn hình hay chia sẻ. QR board chỉ chứa `boardId`, không chứa mật khẩu.
- **Token InfluxDB cho app là read-only**, không dùng token admin.
- **Backend không có HTTP API** và không đứng giữa đường điều khiển rơ-le; đây là kiến trúc có chủ đích, không phải thiếu sót.
- **Image server chỉ build cho linux/amd64**; ARM/Raspberry Pi chưa hỗ trợ.
- **App Android-first**: các tính năng native (QR, BLE, mDNS) nên kiểm thử trên thiết bị thật; web chỉ phù hợp mô phỏng dashboard.
- **AI-Mobile không phải app di động**: cần laptop/edge có webcam và Python; chất lượng nhận diện phụ thuộc ánh sáng, góc tay và khoảng cách camera.

## 11. Tài liệu và repo gốc

| Dự án | Repo gốc | Tài liệu chính |
|---|---|---|
| Mobile_Frontend | https://github.com/lucas-traumen/Mobile-AI-IoT | [Mobile_Frontend/README.md](Mobile_Frontend/README.md), [app-mobile/README.md](Mobile_Frontend/app-mobile/README.md) |
| Mobile_Backend | https://github.com/lucas-traumen/Mobile-Backend-Firmware | [Mobile_Backend/README.md](Mobile_Backend/README.md), [developer-guide.md](Mobile_Backend/docs/developer-guide.md) |
| AI-Mobile | Chưa có repo riêng (mã nguồn trong thư mục `AI-Mobile/`) | [AI-Mobile/README.md](AI-Mobile/README.md) |
| Huấn luyện gesture | https://github.com/lucas-traumen/Hand-gesture | `README.md` (pipeline HaGRID) |

Tài liệu chuyên sâu nên đọc theo thứ tự:

1. [Mobile_Backend/docs/developer-guide.md](Mobile_Backend/docs/developer-guide.md) — kiến trúc server, firmware, MQTT contract, vận hành InfluxDB, sao lưu.
2. [Mobile_Backend/docs/frontend-setup.md](Mobile_Backend/docs/frontend-setup.md) — thông số kết nối cho app/web theo từng môi trường.
3. [Mobile_Frontend/app-mobile/README.md](Mobile_Frontend/app-mobile/README.md) — kiến trúc module, protocol, BLE/mDNS/QR, hướng dẫn contributor.
4. [AI-Mobile/README.md](AI-Mobile/README.md) — cài đặt, cấu hình MQTT, state machine, ngưỡng cử chỉ và pipeline inference.

---

Các dự án ban đầu được phát triển như ba repo/thư mục riêng; kho này hợp nhất chúng để tiện theo dõi toàn bộ hệ thống trong một nơi.
