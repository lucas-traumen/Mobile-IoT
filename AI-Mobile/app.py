"""
app.py — Validate model nhận diện cử chỉ tay qua webcam laptop.
(Bước 4 trong kế hoạch: validate offline TRƯỚC khi tích hợp ESP32-CAM)

Cài đặt trước khi chạy (máy laptop, không phải Kaggle):
    pip install mediapipe opencv-python numpy tensorflow paho-mqtt

File cần có SẴN trong cùng thư mục với app.py này (tải từ /kaggle/working/
sau khi train xong ở CELL 9):
    - keypoint_classifier.tflite
    - keypoint_classifier_label.csv
(hand_landmarker.task sẽ tự động tải lần chạy đầu nếu chưa có)

Chạy:
    python app.py
Nhấn 'q' để thoát cửa sổ webcam.

Các điểm chống nhầm lẫn so với bản trước:
  1. Ngưỡng tin cậy THEO TỪNG LỚP (palm/fist khắt khe nhất vì là lệnh bật/tắt thật).
  2. Lọc trung vị (median) xác suất 3 frame gần nhất rồi mới so ngưỡng -> loại
     frame nhiễu đơn lẻ (landmark giật) mà không làm chậm phản ứng.
  3. Thời gian giữ cử chỉ RIÊNG cho từng loại (like_toggle giữ lâu hơn).
  4. Timeout: chế độ nhận diện tự tắt nếu không có lệnh; thiết bị đã chọn hết
     hiệu lực sau một lúc -> cái xòe tay vô tình về sau không bật nhầm thiết bị.
  5. Mất tay thoáng qua (< HAND_LOST_GRACE_SEC) không làm reset trạng thái.
Phần logic (GestureStateMachine) không phụ thuộc OpenCV/MediaPipe/TensorFlow
nên có thể test riêng.
"""

import collections
import copy
import csv
import itertools
import os
import time
import urllib.request

import numpy as np


# ============================================================
# CẤU HÌNH
# ============================================================
MODEL_TFLITE_PATH = "keypoint_classifier.tflite"
LABEL_CSV_PATH = "keypoint_classifier_label.csv"
HAND_LANDMARKER_PATH = "hand_landmarker.task"

# Ngưỡng tin cậy theo từng lớp — PHẢI KHỚP với CLASS_THRESHOLD trong CELL 8
# của notebook (để số liệu đánh giá phản ánh đúng những gì app làm).
# Lớp không có trong bảng (no_gesture) luôn được chấp nhận.
CLASS_THRESHOLD = {
    "palm_on": 0.90, "fist_off": 0.90,       # lệnh BẬT/TẮT thật -> khắt khe nhất
    "like_toggle": 0.85,                     # bật/tắt cả hệ thống
    "one_led": 0.80, "two_fan": 0.80, "three_buzzer": 0.80,   # chỉ chọn thiết bị
}

SMOOTH_FRAMES = 3           # số frame gần nhất để lọc trung vị xác suất (nên là số lẻ)
DEBOUNCE_RATIO = 0.8        # >=80% frame trong cửa sổ giữ phải cùng 1 nhãn

DEFAULT_HOLD_SEC = 1.0      # thời gian giữ cử chỉ để được xác nhận
HOLD_SEC = {                # giữ riêng cho từng loại (giây)
    "like_toggle": 1.5,     # bật/tắt cả hệ thống -> giữ lâu nhất (nắm tay hở ngón cái dễ thành like)
    "palm_on": 1.2,
    "fist_off": 1.2,
    "no_gesture": 0.4,      # chỉ cần "nghỉ" ngắn để cho phép lặp lại cùng 1 lệnh
}
HAND_LOST_GRACE_SEC = 0.5   # mất tay ngắn hơn mức này -> KHÔNG reset
ACTIVE_TIMEOUT_SEC = 20     # không có lệnh nào trong chừng này giây -> tự tắt chế độ nhận diện
SELECT_TIMEOUT_SEC = 10     # chọn thiết bị xong phải BẬT/TẮT trong chừng này giây

CAM_INDEX = 0
# Cố gắng khớp tỉ lệ 16:9 giống lúc train (HaGRID chủ yếu là ảnh FullHD).
# Nếu webcam chỉ hỗ trợ 4:3 thì vẫn chạy được (toạ độ tính theo pixel thật).
CAM_WIDTH = 1280
CAM_HEIGHT = 720

GESTURE_NO = "no_gesture"
GESTURE_TOGGLE = "like_toggle"   # nắm tay, ngón cái giơ lên (đổi từ "four" vì lẫn với "palm")
GESTURE_ONE = "one_led"
GESTURE_TWO = "two_fan"
GESTURE_THREE = "three_buzzer"
GESTURE_PALM = "palm_on"
GESTURE_FIST = "fist_off"

DEVICE_BY_GESTURE = {
    GESTURE_ONE: "led",
    GESTURE_TWO: "fan",
    GESTURE_THREE: "buzzer",
}
DEVICE_LABEL_VI = {"led": "DEN", "fan": "QUAT", "buzzer": "COI", None: "(chua chon)"}

MAX_HOLD_SEC = max(list(HOLD_SEC.values()) + [DEFAULT_HOLD_SEC])


def publish_device(device, is_on):
    """Fallback khi không có MQTT — chỉ in log, dùng để validate model offline.

    Khi nối phần cứng thật, `main()` thay hàm này bằng `MqttBridge.publish`
    (mqtt_bridge.py) — publish thẳng vào broker, backend không đứng giữa.
    """
    print(f"[LOCAL] {device} -> {'ON' if is_on else 'OFF'} (khong co MQTT)")


def create_bridge(sm, on_state):
    """Dựng cầu MQTT gắn vào state machine. Trả về None nếu thiếu cấu hình/broker."""
    if os.environ.get("GESTURE_MQTT", "on").strip().lower() in ("off", "0", "false", "no"):
        print("[MQTT] GESTURE_MQTT=off -> chay che do offline, khong dieu khien that")
        return None

    try:
        from mqtt_bridge import MqttBridge, load_env_file
    except ImportError as exc:
        print(f"[MQTT] Thieu module ({exc}) -> chay offline; pip install paho-mqtt")
        return None

    load_env_file(os.environ.get("MQTT_ENV_FILE", "../Mobile_Backend/.env"))

    try:
        bridge = MqttBridge(on_state=on_state)
    except Exception as exc:                      # thiếu mật khẩu, sai host, paho lỗi...
        print(f"[MQTT] Khong khoi dong duoc ({exc.__class__.__name__}: {exc})")
        print("[MQTT] -> chay offline; dat MQTT_ENV_FILE hoac GESTURE_MQTT_PASSWORD roi chay lai")
        return None

    sm.publish = bridge.publish                  # lệnh cử chỉ đi thẳng ra broker
    return bridge


# ============================================================
# TIỀN XỬ LÝ LANDMARK — GIỐNG HỆT lúc trích dữ liệu train (CELL 4)
# ============================================================
def calc_landmark_list(image_width, image_height, hand_landmarks):
    return [[lm.x * image_width, lm.y * image_height] for lm in hand_landmarks]


def pre_process_landmark(landmark_list):
    temp_landmark_list = copy.deepcopy(landmark_list)

    base_x, base_y = 0, 0
    for index, point in enumerate(temp_landmark_list):
        if index == 0:
            base_x, base_y = point[0], point[1]
        temp_landmark_list[index][0] -= base_x
        temp_landmark_list[index][1] -= base_y

    temp_landmark_list = list(itertools.chain.from_iterable(temp_landmark_list))
    max_value = max(list(map(abs, temp_landmark_list))) or 1

    return [n / max_value for n in temp_landmark_list]


# ============================================================
# MODEL PHÂN LOẠI (TFLite) — trả về vector xác suất 7 lớp
# ============================================================
class TFLiteClassifier:
    def __init__(self, model_path, label_path):
        try:                                    # ưu tiên LiteRT (TF mới đã bỏ tf.lite.Interpreter)
            from ai_edge_litert.interpreter import Interpreter
        except ImportError:
            import tensorflow as tf
            Interpreter = tf.lite.Interpreter

        self.interpreter = Interpreter(model_path=model_path)
        self.interpreter.allocate_tensors()
        self.input_details = self.interpreter.get_input_details()
        self.output_details = self.interpreter.get_output_details()

        with open(label_path, "r", encoding="utf-8-sig") as f:
            self.label_names = [row[0] for row in csv.reader(f) if row]

        n_out = int(self.output_details[0]["shape"][-1])
        if n_out != len(self.label_names):
            raise ValueError(
                f"Model có {n_out} đầu ra nhưng file nhãn có {len(self.label_names)} dòng — "
                "kiểm tra lại keypoint_classifier.tflite và keypoint_classifier_label.csv"
            )
        missing = {GESTURE_NO, GESTURE_TOGGLE, GESTURE_ONE, GESTURE_TWO,
                   GESTURE_THREE, GESTURE_PALM, GESTURE_FIST} - set(self.label_names)
        if missing:
            raise ValueError(f"File nhãn thiếu các lớp: {sorted(missing)}")
        print("Nhãn:", self.label_names)

    def predict(self, processed_landmark):
        x = np.array([processed_landmark], dtype=np.float32)
        self.interpreter.set_tensor(self.input_details[0]["index"], x)
        self.interpreter.invoke()
        return self.interpreter.get_tensor(self.output_details[0]["index"])[0].copy()


# ============================================================
# STATE MACHINE 2 TẦNG (đúng theo cuchi.jpg):
#   like_toggle -> BẬT/TẮT chế độ nhận diện
#   one/two/three (khi đã kích hoạt) -> chọn thiết bị
#   palm_on (khi đã kích hoạt + đã chọn thiết bị) -> BẬT thiết bị
#   fist_off (khi đã kích hoạt + đã chọn thiết bị) -> TẮT thiết bị
# ============================================================
class GestureStateMachine:
    def __init__(self, label_names, publish=publish_device):
        self.label_names = label_names
        self.publish = publish

        self.prob_buffer = collections.deque(maxlen=SMOOTH_FRAMES)
        self.history = collections.deque()      # (nhãn frame, thời điểm)
        self.last_confirmed = GESTURE_NO        # tránh 1 cử chỉ giữ nguyên bị kích hoạt lặp lại
        self.lost_since = None                  # thời điểm bắt đầu mất tay

        self.is_activated = False
        self.selected_device = None
        self.selected_at = 0.0
        self.last_activity = 0.0
        self.device_state = {"led": False, "fan": False, "buzzer": False}

    # ---------- xử lý từng frame có tay ----------
    def process(self, probs, now):
        """probs: vector xác suất của frame hiện tại. Trả về dict để hiển thị."""
        self.lost_since = None

        # 1) lọc trung vị: 1 frame nhiễu đơn lẻ bị "bỏ phiếu" loại, không kéo cả cửa sổ xuống
        self.prob_buffer.append(np.asarray(probs, dtype=np.float32))
        smooth = np.median(self.prob_buffer, axis=0)
        cid = int(np.argmax(smooth))
        label, conf = self.label_names[cid], float(smooth[cid])

        # 2) ngưỡng theo lớp: dưới ngưỡng -> coi như không có cử chỉ rõ ràng
        if label == GESTURE_NO or conf < CLASS_THRESHOLD.get(label, 1.0):
            frame_label = GESTURE_NO
        else:
            frame_label = label

        # 3) giữ đủ lâu + ổn định mới xác nhận
        confirmed = self._debounce(frame_label, now)
        if confirmed is not None:
            self._handle(confirmed, now)

        return {"label": label, "conf": conf, "frame_label": frame_label, "confirmed": confirmed}

    # ---------- không thấy tay ----------
    def hand_missing(self, now):
        if self.lost_since is None:
            self.lost_since = now
        # chỉ reset khi mất tay đủ lâu, tránh 1-2 frame detect hụt làm lệnh bị lặp lại
        if now - self.lost_since >= HAND_LOST_GRACE_SEC:
            self.prob_buffer.clear()
            self.history.clear()
            self.last_confirmed = GESTURE_NO

    # ---------- timeout (gọi MỖI frame, có tay hay không) ----------
    def tick(self, now):
        if self.is_activated and now - self.last_activity > ACTIVE_TIMEOUT_SEC:
            self.is_activated = False
            self.selected_device = None
            print("[TIMEOUT] Het thoi gian cho -> he thong TAT che do nhan dien")
        if self.selected_device is not None and now - self.selected_at > SELECT_TIMEOUT_SEC:
            print(f"[TIMEOUT] Bo chon thiet bi {DEVICE_LABEL_VI[self.selected_device]}")
            self.selected_device = None

    # ---------- nội bộ ----------
    def _debounce(self, label, now):
        self.history.append((label, now))
        while self.history and now - self.history[0][1] > MAX_HOLD_SEC:
            self.history.popleft()

        hold = HOLD_SEC.get(label, DEFAULT_HOLD_SEC)
        if now - self.history[0][1] < hold * 0.85:
            return None                          # lịch sử chưa đủ dài
        window = [lbl for lbl, t in self.history if now - t <= hold]
        if window and sum(1 for lbl in window if lbl == label) / len(window) >= DEBOUNCE_RATIO:
            return label
        return None

    def _touch(self, now):
        self.last_activity = now

    def _handle(self, gesture, now):
        if gesture == self.last_confirmed:
            return                               # đang giữ nguyên cử chỉ vừa xử lý -> bỏ qua
        self.last_confirmed = gesture

        if gesture == GESTURE_NO:
            return                               # "nghỉ" -> chỉ để cho phép lặp lại lệnh

        if gesture == GESTURE_TOGGLE:
            self.is_activated = not self.is_activated
            self.selected_device = None
            self._touch(now)
            print(f"[TOGGLE] He thong {'BAT' if self.is_activated else 'TAT'} che do nhan dien")
            return

        if not self.is_activated:
            return                               # chưa kích hoạt -> bỏ qua mọi lệnh khác

        if gesture in DEVICE_BY_GESTURE:
            self.selected_device = DEVICE_BY_GESTURE[gesture]
            self.selected_at = now
            self._touch(now)
            print(f"[CHON] Thiet bi dang chon: {DEVICE_LABEL_VI[self.selected_device]}")

        elif gesture in (GESTURE_PALM, GESTURE_FIST):
            if self.selected_device is None:
                print("[BO QUA] Chua chon thiet bi (hoac da het han) -> khong thuc hien lenh")
                return
            turn_on = gesture == GESTURE_PALM
            self.device_state[self.selected_device] = turn_on
            self.selected_at = now               # cho phép BẬT/TẮT liên tiếp cùng thiết bị
            self._touch(now)
            print(f"[{'BAT' if turn_on else 'TAT'}] {DEVICE_LABEL_VI[self.selected_device]} "
                  f"-> {'ON' if turn_on else 'OFF'}")
            self.publish(self.selected_device, turn_on)


# ============================================================
# VẼ KHUNG XƯƠNG BÀN TAY (nối khớp bằng đường, 21 điểm chuẩn MediaPipe)
# ============================================================
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),          # ngon cai
    (0, 5), (5, 6), (6, 7), (7, 8),          # ngon tro
    (5, 9), (9, 10), (10, 11), (11, 12),     # ngon giua
    (9, 13), (13, 14), (14, 15), (15, 16),   # ngon ap ut
    (13, 17), (17, 18), (18, 19), (19, 20),  # ngon ut
    (0, 17),                                  # co tay - goc ut
]


def draw_hand_skeleton(frame, hand_landmarks, w, h):
    import cv2

    points = [(int(lm.x * w), int(lm.y * h)) for lm in hand_landmarks]

    for a, b in HAND_CONNECTIONS:
        cv2.line(frame, points[a], points[b], (0, 0, 0), 4)
        cv2.line(frame, points[a], points[b], (255, 255, 255), 2)

    FINGER_TIPS = {4, 8, 12, 16, 20}
    for i, (cx, cy) in enumerate(points):
        radius = 6 if i in FINGER_TIPS else 4
        cv2.circle(frame, (cx, cy), radius, (255, 255, 255), -1)
        cv2.circle(frame, (cx, cy), radius, (0, 0, 0), 1)

    cv2.circle(frame, points[0], 7, (0, 0, 255), -1)   # cổ tay nổi bật màu đỏ


# ============================================================
# VÒNG LẶP WEBCAM
# ============================================================
def main():
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    # --- Hand Landmarker (MediaPipe Tasks API — giống lúc trích landmark train) ---
    if not os.path.exists(HAND_LANDMARKER_PATH):
        print("Đang tải hand_landmarker.task (chỉ 1 lần)...")
        urllib.request.urlretrieve(
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
            "hand_landmarker/float16/latest/hand_landmarker.task",
            HAND_LANDMARKER_PATH,
        )
    landmarker = mp_vision.HandLandmarker.create_from_options(
        mp_vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=HAND_LANDMARKER_PATH),
            running_mode=mp_vision.RunningMode.VIDEO,
            num_hands=1,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )

    classifier = TFLiteClassifier(MODEL_TFLITE_PATH, LABEL_CSV_PATH)
    sm = GestureStateMachine(classifier.label_names)

    # Trạng thái board là nguồn thật (topic `.../state` retained) — overlay hiển thị
    # theo nó, không theo suy đoán của state machine. `confirmed` cho biết giá trị
    # này board đã xác nhận hay chỉ là optimistic lúc vừa gửi lệnh.
    board_confirmed = {"led": None, "fan": None, "buzzer": None}

    def sync_from_board(device, is_on, confirmed):
        sm.device_state[device] = is_on
        board_confirmed[device] = confirmed

    bridge = create_bridge(sm, sync_from_board)

    cap = cv2.VideoCapture(CAM_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT)
    print(f"Webcam thực tế: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
          f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}")

    print("Nhấn 'q' để thoát.")
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        frame = cv2.flip(frame, 1)  # lật gương, điều khiển trực quan hơn
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

        now = time.time()
        result = landmarker.detect_for_video(mp_image, int(now * 1000))
        info = None

        if result.hand_landmarks:
            hand = result.hand_landmarks[0]
            h, w = frame.shape[:2]
            processed = pre_process_landmark(calc_landmark_list(w, h, hand))
            info = sm.process(classifier.predict(processed), now)
            draw_hand_skeleton(frame, hand, w, h)
        else:
            sm.hand_missing(now)

        sm.tick(now)
        if bridge is not None:
            bridge.tick()                        # lệnh quá hạn không được board xác nhận -> hoàn tác

        # --- Overlay trạng thái (không dấu vì cv2.putText không vẽ được tiếng Việt) ---
        status_color = (0, 255, 0) if sm.is_activated else (0, 0, 255)
        cv2.putText(frame, f"He thong: {'DANG BAT' if sm.is_activated else 'DANG TAT'}",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, status_color, 2)
        cv2.putText(frame, f"Dang chon: {DEVICE_LABEL_VI[sm.selected_device]}",
                    (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2)

        if info is not None:
            cv2.putText(frame, f"{info['label']} ({info['conf']:.2f}) -> {info['frame_label']}",
                        (10, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)

        y0 = 130
        for dev in ("led", "fan", "buzzer"):
            on = sm.device_state[dev]
            # "?": đã gửi lệnh nhưng board chưa xác nhận (optimistic) hoặc chưa rõ state
            text = f"{DEVICE_LABEL_VI[dev]}: {'ON' if on else 'OFF'}"
            if bridge is not None and board_confirmed[dev] is False:
                text += " (?)"
            cv2.putText(frame, text, (10, y0),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0) if on else (128, 128, 128), 2)
            y0 += 30

        if bridge is None:
            cv2.putText(frame, "MQTT: OFFLINE (chi in log)", (10, y0),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
        else:
            broker = "OK" if bridge.connected else "DISCONNECTED"
            board = bridge.board_id or "?"
            if bridge.connected and bridge.board_online is False:
                board += " (offline)"
            cv2.putText(frame, f"MQTT: {broker} | Board: {board}", (10, y0),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (0, 255, 0) if bridge.connected else (0, 0, 255), 2)
        y0 += 30

        if sm.is_activated:
            left = max(0, ACTIVE_TIMEOUT_SEC - (now - sm.last_activity))
            cv2.putText(frame, f"Tu tat sau: {left:0.0f}s", (10, y0 + 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)

        cv2.imshow("Gesture Control - webcam validation", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()
    if bridge is not None:
        bridge.close()


if __name__ == "__main__":
    main()
