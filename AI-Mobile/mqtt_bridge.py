"""
mqtt_bridge.py — cầu nối MQTT giữa app cử chỉ tay và board ESP32.

Contract (Mobile_Backend, docs/frontend-setup.md mục 3):
    publish   {prefix}/boards/{boardId}/relays/{K}/set    ON|OFF thuần, QoS 1, không retained
    subscribe {prefix}/boards/{boardId}/relays/{K}/state  ON|OFF thuần, QoS 1, retained
    subscribe {prefix}/boards/{boardId}/status            online|offline, retained (LWT)
    subscribe {prefix}/boards/+/descriptor                JSON, retained (tự tìm boardId)

Backend Node.js KHÔNG đứng giữa lệnh điều khiển — app publish thẳng vào broker.
Không có topic báo lỗi: gửi `set` rồi chờ `state` đổi trong ACK_TIMEOUT_SEC,
quá hạn thì coi như thất bại và hoàn tác trạng thái optimistic.

Cấu hình qua biến môi trường (KHÔNG hardcode secret vào repo):
    MQTT_ENV_FILE            đường dẫn file .env của Mobile_Backend (tuỳ chọn)
    MQTT_HOST                mặc định 127.0.0.1 (Python nối TCP 1883, không phải WS 9001)
    MQTT_PORT                mặc định 1883
    TOPIC_PREFIX             mặc định smarthome
    BOARD_ID                 để trống thì tự dò từ descriptor retained
    GESTURE_MQTT_USER        mặc định app
    GESTURE_MQTT_PASSWORD    mặc định lấy MQTT_APP_PASSWORD
    RELAY_MAP                ví dụ "led=K1,fan=K2,buzzer=K3"

Chạy nhanh không cần phần cứng:
    MQTT_ENV_FILE=../Mobile_Backend/.env python app.py
"""

import json
import os
import threading
import time
import uuid

import paho.mqtt.client as mqtt

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 1883
DEFAULT_PREFIX = "smarthome"
DEFAULT_USER = "app"
DEFAULT_KEEPALIVE = 45
ACK_TIMEOUT_SEC = 3.0
DEVICE_CHANNEL_DEFAULT = {"led": "K1", "fan": "K2", "buzzer": "K3"}

PAYLOAD_ON = "ON"
PAYLOAD_OFF = "OFF"
STATUS_ONLINE = "online"


def load_env_file(path):
    """Nạp file .env kiểu KEY=VALUE vào os.environ, không ghi đè biến đã có."""
    if not path or not os.path.isfile(path):
        return False
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return True


def parse_relay_map(spec):
    """'led=K1,fan=K2' -> {'led': 'K1', 'fan': 'K2'}."""
    mapping = {}
    for item in (spec or "").split(","):
        if "=" not in item:
            continue
        device, _, channel = item.partition("=")
        device, channel = device.strip(), channel.strip()
        if device and channel:
            mapping[device] = channel
    return mapping


class MqttBridge:
    """Publish lệnh bật/tắt và đồng bộ trạng thái thật từ board về app."""

    def __init__(self, on_state=None, on_command_failed=None):
        self._on_state = on_state
        self._on_command_failed = on_command_failed

        self._lock = threading.Lock()
        self._pending = {}
        self._last_state = {}
        self._descriptor_channels = set()
        self._descriptor_logged = None
        self._closing = False

        self.connected = False
        self.board_online = None
        self.board_id = os.environ.get("BOARD_ID", "").strip()

        self.prefix = (os.environ.get("TOPIC_PREFIX") or DEFAULT_PREFIX).strip("/")
        self.device_channel = dict(DEVICE_CHANNEL_DEFAULT)
        self.device_channel.update(parse_relay_map(os.environ.get("RELAY_MAP")))

        host = os.environ.get("MQTT_HOST") or DEFAULT_HOST
        port = int(os.environ.get("MQTT_PORT") or DEFAULT_PORT)
        user = os.environ.get("GESTURE_MQTT_USER") or DEFAULT_USER
        password = os.environ.get("GESTURE_MQTT_PASSWORD") or os.environ.get("MQTT_APP_PASSWORD") or ""

        if not password:
            raise RuntimeError(
                "Thiếu mật khẩu MQTT: đặt GESTURE_MQTT_PASSWORD (hoặc MQTT_APP_PASSWORD), "
                "hoặc trỏ MQTT_ENV_FILE tới file .env của Mobile_Backend."
            )

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"gesture-{uuid.uuid4().hex[:8]}",
            clean_session=True,
        )
        self._client.username_pw_set(user, password)
        self._client.reconnect_delay_set(min_delay=1, max_delay=10)
        self._client.on_connect = self._handle_connect
        self._client.on_disconnect = self._handle_disconnect
        self._client.on_message = self._handle_message

        self._host, self._port, self._user = host, port, user
        self._client.connect_async(host, port, keepalive=DEFAULT_KEEPALIVE)
        self._client.loop_start()

    # ---------- vòng đời ----------
    def start(self):
        return self

    def close(self):
        self._closing = True                     # không in "mất kết nối" khi chủ động tắt
        try:
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:
            pass

    # ---------- gửi lệnh ----------
    def publish(self, device, is_on):
        """GestureStateMachine gọi hàm này khi xác nhận cử chỉ palm_on / fist_off."""
        channel = self.device_channel.get(device)
        if channel is None:
            print(f"[MQTT] {device} chưa map kênh relay (RELAY_MAP) -> bo qua")
            return

        if not self.board_id:
            print(f"[MQTT] Chua biet boardId (chua thay descriptor) -> lenh {device} bi bo")
            return

        with self._lock:
            known = self._descriptor_channels
            if known and channel not in known:
                print(f"[MQTT] Canh bao: board {self.board_id} khong khai bao kenh {channel} "
                      f"(descriptor co: {sorted(known)})")

        topic = f"{self.prefix}/boards/{self.board_id}/relays/{channel}/set"
        info = self._client.publish(topic, PAYLOAD_ON if is_on else PAYLOAD_OFF, qos=1, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            print(f"[MQTT] Publish that bai ({mqtt.error_string(info.rc)}): {topic}")
            return

        deadline = time.monotonic() + ACK_TIMEOUT_SEC
        with self._lock:
            self._pending[device] = (bool(is_on), deadline)
        self._notify_state(device, bool(is_on), confirmed=False)

    def tick(self):
        """Gọi mỗi frame: kiểm tra lệnh đã gửi quá hạn mà board không phản hồi."""
        now = time.monotonic()
        expired = []
        with self._lock:
            for device, (is_on, deadline) in list(self._pending.items()):
                if now >= deadline:
                    expired.append((device, is_on))
                    del self._pending[device]

        for device, is_on in expired:
            print(f"[MQTT] TIMEOUT {ACK_TIMEOUT_SEC:.0f}s khong nhan state cho {device} "
                  f"({'ON' if is_on else 'OFF'}) -> board offline hoac khong co kenh nay")
            with self._lock:
                fallback = self._last_state.get(device)
            if self._on_command_failed:
                self._on_command_failed(device, is_on)
            if fallback is not None:
                self._notify_state(device, fallback, confirmed=True)

    # ---------- callback paho (chay o thread mang) ----------
    def _handle_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            print(f"[MQTT] Ket noi that bai toi {self._host}:{self._port} — {reason_code}")
            return
        self.connected = True
        print(f"[MQTT] Da noi {self._host}:{self._port} (user '{self._user}')")
        client.subscribe(f"{self.prefix}/boards/+/descriptor", qos=1)
        if self.board_id:
            self._subscribe_board(client, self.board_id)

    def _handle_disconnect(self, client, userdata, flags, reason_code, properties):
        if self.connected and not self._closing:
            print(f"[MQTT] Mat ket noi broker ({reason_code}) — tu dong noi lai...")
        self.connected = False
        if not self._closing:
            self.board_online = None

    def _subscribe_board(self, client, board_id):
        base = f"{self.prefix}/boards/{board_id}"
        client.subscribe([(f"{base}/relays/+/state", 1), (f"{base}/status", 1)])

    def _handle_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload.decode("utf-8", errors="replace").strip()
        parts = topic.split("/")

        if topic.endswith("/descriptor"):
            self._handle_descriptor(payload)
            return

        if len(parts) >= 4 and parts[1] == "boards":
            board_id = parts[2]
            if board_id != self.board_id:
                return

        if topic.endswith("/status"):
            online = payload == STATUS_ONLINE
            if self.board_online != online:
                print(f"[MQTT] Board {self.board_id} -> {payload or '(trong)'}")
            self.board_online = online
            return

        if "/relays/" in topic and topic.endswith("/state"):
            self._handle_relay_state(parts, payload)

    def _handle_descriptor(self, payload):
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return
        board_id = str(data.get("boardId") or "")
        if not board_id:
            return

        channels = {str(r.get("channel")) for r in data.get("relays", []) if r.get("channel")}
        if self.board_id and board_id != self.board_id:
            return

        if not self.board_id:
            self.board_id = board_id
            self._subscribe_board(self._client, board_id)

        with self._lock:
            self._descriptor_channels = channels

        # Broker gửi lại descriptor retained nhiều lần (mỗi subscribe/reconnect).
        # Chỉ in khi nội dung thực sự đổi để không spam log.
        signature = (board_id, tuple(sorted(channels)))
        if signature != self._descriptor_logged:
            self._descriptor_logged = signature
            unknown = sorted(c for c in self.device_channel.values()
                             if channels and c not in channels)
            print(f"[MQTT] Board '{board_id}' co relay: {sorted(channels)}"
                  + (f" — kenh map khong ton tai: {unknown}" if unknown else ""))

    def _handle_relay_state(self, parts, payload):
        try:
            channel = parts[-2]
        except IndexError:
            return
        device = next((d for d, c in self.device_channel.items() if c == channel), None)
        if device is None or payload not in (PAYLOAD_ON, PAYLOAD_OFF):
            return

        is_on = payload == PAYLOAD_ON
        with self._lock:
            changed = self._last_state.get(device) != is_on
            self._last_state[device] = is_on
            # state từ board (kể cả retained) luôn là nguồn thật -> xoá pending
            self._pending.pop(device, None)

        if changed:
            print(f"[MQTT] State {device} ({channel}) -> {payload}")
        self._notify_state(device, is_on, confirmed=True)

    def _notify_state(self, device, is_on, confirmed):
        if self._on_state:
            self._on_state(device, is_on, confirmed)
