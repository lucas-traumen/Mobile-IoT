# AI-Mobile — điều khiển thiết bị bằng cử chỉ tay

Runtime Python nhận diện cử chỉ tay từ webcam và gửi lệnh bật/tắt trực tiếp tới broker MQTT của hệ thống **Mobile-IoT**. Đây là công cụ chạy trên laptop/edge có webcam, không phải ứng dụng di động.

## Thành phần

| File | Vai trò |
|---|---|
| `app.py` | Pipeline webcam → MediaPipe → TFLite → state machine → MQTT; vẽ overlay |
| `mqtt_bridge.py` | Kết nối broker, publish lệnh rơ-le, đồng bộ state/status/descriptor |
| `hand_landmarker.task` | Model MediaPipe Hand Landmarker (21 điểm) |
| `keypoint_classifier.tflite` | Model phân loại 7 lớp cử chỉ |
| `keypoint_classifier_label.csv` | Nhãn tương ứng với output của model |

## Yêu cầu

- Python 3.12 (đã kiểm thử).
- Webcam hoạt động.
- Các gói: `mediapipe`, `opencv-python`, `numpy`, `tensorflow` (hoặc `ai-edge-litert`), `paho-mqtt`.
- Broker MQTT của `Mobile_Backend` đang chạy và có tài khoản `app`.

## Cài đặt và chạy

```bash
cd AI-Mobile
python3 -m venv .venv
source .venv/bin/activate
pip install mediapipe opencv-python numpy tensorflow paho-mqtt
python app.py
```

Nhấn `q` để thoát cửa sổ webcam.

Chạy offline, chỉ in lệnh ra log:

```bash
GESTURE_MQTT=off python app.py
```

## Cấu hình

AI-Mobile đọc biến môi trường, có thể nạp từ file `.env` của backend:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MQTT_ENV_FILE` | `../Mobile_Backend/.env` | File `.env` chứa `MQTT_APP_PASSWORD` |
| `MQTT_HOST` | `127.0.0.1` | IP broker MQTT TCP |
| `MQTT_PORT` | `1883` | Port MQTT TCP |
| `TOPIC_PREFIX` | `smarthome` | Prefix topic |
| `BOARD_ID` | tự dò | Board đích; để trống thì lấy từ descriptor retained |
| `GESTURE_MQTT_USER` | `app` | User MQTT |
| `GESTURE_MQTT_PASSWORD` | `MQTT_APP_PASSWORD` | Mật khẩu MQTT |
| `RELAY_MAP` | `led=K1,fan=K2,buzzer=K3` | Map thiết bị → kênh rơ-le |
| `GESTURE_MQTT` | `on` | Đặt `off` để chạy offline |

Ví dụ:

```bash
MQTT_HOST=192.168.1.50 \
MQTT_ENV_FILE=../Mobile_Backend/.env \
python app.py
```

## Cử chỉ

| Cử chỉ | Nhãn | Tác dụng | Giữ |
|---|---|---|---|
| Nắm tay, giơ ngón cái | `like_toggle` | Bật/tắt chế độ nhận diện | 1.5 s |
| Một ngón | `one_led` | Chọn LED | 1.0 s |
| Hai ngón | `two_fan` | Chọn quạt | 1.0 s |
| Ba ngón | `three_buzzer` | Chọn còi | 1.0 s |
| Xòe tay | `palm_on` | Bật thiết bị đang chọn | 1.2 s |
| Nắm tay | `fist_off` | Tắt thiết bị đang chọn | 1.2 s |
| Không có cử chỉ | `no_gesture` | Nghỉ, cho phép lặp lệnh | 0.4 s |

Logic hai tầng:

1. `like_toggle` bật/tắt chế độ nhận diện.
2. Khi đã bật, `one/two/three` chọn thiết bị.
3. `palm_on`/`fist_off` bật/tắt thiết bị đã chọn.

## Chống nhầm lẫn

- Ngưỡng tin cậy theo lớp: `palm_on`/`fist_off` 0.90, `like_toggle` 0.85, lệnh chọn thiết bị 0.80.
- Lọc trung vị 3 frame trước khi so ngưỡng.
- Debounce: ít nhất 80% frame trong cửa sổ giữ phải cùng nhãn.
- Tự tắt chế độ nhận diện sau 20 giây không có lệnh.
- Bỏ chọn thiết bị sau 10 giây.
- Mất tay dưới 0.5 giây không reset trạng thái.
- Lệnh MQTT không được board xác nhận trong 3 giây → coi như thất bại và hoàn tác trạng thái optimistic.

## MQTT contract

AI-Mobile dùng đúng contract của firmware, không đi qua backend:

```text
publish   {prefix}/boards/{boardId}/relays/{K}/set     ON | OFF   QoS 1, không retained
subscribe {prefix}/boards/{boardId}/relays/{K}/state   ON | OFF   QoS 1, retained
subscribe {prefix}/boards/{boardId}/status             online | offline
subscribe {prefix}/boards/+/descriptor                 JSON, retained
```

- `boardId` lấy từ descriptor retained nếu `BOARD_ID` để trống.
- Kênh rơ-le mặc định: `led=K1`, `fan=K2`, `buzzer=K3`; đổi qua `RELAY_MAP`.
- Không có topic báo lỗi; bridge gửi `set` rồi chờ `state` thay đổi.

## Model và huấn luyện

Phần huấn luyện/đánh giá model nằm ở repo [Hand-gesture](https://github.com/lucas-traumen/Hand-gesture) (pipeline HaGRID: MediaPipe landmarks → TFLite MLP, cùng các nhánh MobileNetV3/YOLOv8n để tham khảo). Thư mục này chỉ chứa runtime và model đã xuất.

Nếu thiếu `hand_landmarker.task`, `app.py` tự tải model MediaPipe về lần chạy đầu.

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Thiếu mật khẩu MQTT` | Đặt `MQTT_ENV_FILE` trỏ đúng `.env` của backend, hoặc đặt `GESTURE_MQTT_PASSWORD` |
| `Chua biet boardId` | Kiểm tra board đã online và đã publish descriptor; hoặc đặt `BOARD_ID` |
| Lệnh gửi nhưng board không đổi | Kiểm tra `RELAY_MAP` có khớp kênh trong descriptor; xem log broker |
| Không mở được webcam | Đổi `CAM_INDEX` trong `app.py` hoặc kiểm tra quyền truy cập camera |
| Nhận diện kém | Tăng ánh sáng, giữ tay trong khung, giữ cử chỉ đủ lâu; kiểm tra phiên bản model/nhãn khớp nhau |
