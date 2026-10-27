/**
 * BLE provisioning contract tests (boards-ble-wifi-provisioning +
 * `ble-provisioning-v2-broker-push`): the pure GATT vocabulary — UUID
 * constants pinned to the contract table (v1 6 + v2 3), Status-notify
 * parsing (exact values incl. `FAILED:BAD_BROKER`, garbage → null),
 * byte-accurate WiFi / broker-address / MQTT-credential validation, the
 * `IoTBoard-{boardId}` local-name grammar, the DeviceInfo JSON parse
 * (QR-label shape) and the Base64/UTF-8 codecs the service layer writes
 * with.
 */

import {
  BLE_BOARD_NAME_PREFIX,
  BLE_BROKER_DEFAULT_PORT,
  BLE_BROKER_MAX_BYTES,
  BLE_BROKER_UUID,
  BLE_COMMAND_UUID,
  BLE_DEVICE_INFO_UUID,
  BLE_MQTT_PASSWORD_MAX_BYTES,
  BLE_MQTT_PASSWORD_UUID,
  BLE_MQTT_USERNAME_MAX_BYTES,
  BLE_MQTT_USERNAME_UUID,
  BLE_PASSWORD_MAX_BYTES,
  BLE_PASSWORD_UUID,
  BLE_PROVISION_TIMEOUT_MS,
  BLE_SERVICE_UUID,
  BLE_SSID_MAX_BYTES,
  BLE_SSID_UUID,
  BLE_STATUS_UUID,
  PROVISION_COMMAND,
  base64ToUtf8,
  boardIdFromLocalName,
  parseBleDeviceInfo,
  parseBleStatus,
  toBleProvisionErrorReason,
  utf8ByteLength,
  utf8ToBase64,
  validateBrokerAddress,
  validateMqttCredentials,
  validateWifiCredentials,
} from './bleProvisioningContract';

describe('BLE GATT UUID constants (plan contract table, verbatim)', () => {
  it('pins every UUID of the provisioning service', () => {
    expect(BLE_SERVICE_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a01');
    expect(BLE_DEVICE_INFO_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a05');
    expect(BLE_SSID_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a02');
    expect(BLE_PASSWORD_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a03');
    expect(BLE_COMMAND_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a04');
    expect(BLE_STATUS_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a06');
  });

  it('pins the command, the advertise prefix and the firmware limits', () => {
    expect(PROVISION_COMMAND).toBe('PROVISION');
    expect(BLE_BOARD_NAME_PREFIX).toBe('IoTBoard-');
    expect(BLE_SSID_MAX_BYTES).toBe(32);
    expect(BLE_PASSWORD_MAX_BYTES).toBe(63);
    expect(BLE_PROVISION_TIMEOUT_MS).toBe(30_000);
  });

  it('pins the v2 broker/MQTT characteristic UUIDs (contract table …3a07..09)', () => {
    expect(BLE_BROKER_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a07');
    expect(BLE_MQTT_USERNAME_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a08');
    expect(BLE_MQTT_PASSWORD_UUID).toBe('e5f4a3b2-1c0d-4e2f-9a8b-7c6d5e4f3a09');
  });

  it('pins the v2 broker/MQTT byte limits and the firmware default port', () => {
    expect(BLE_BROKER_MAX_BYTES).toBe(128);
    expect(BLE_MQTT_USERNAME_MAX_BYTES).toBe(64);
    expect(BLE_MQTT_PASSWORD_MAX_BYTES).toBe(128);
    // 1883 = MQTT-TCP — deliberately NOT the app's WebSocket port 9001
    // (AD-v2-2: the firmware speaks raw TCP, the app speaks WS).
    expect(BLE_BROKER_DEFAULT_PORT).toBe(1883);
  });
});

describe('parseBleStatus', () => {
  it('parses the non-terminal statuses exactly', () => {
    expect(parseBleStatus('IDLE')).toEqual({ kind: 'idle' });
    expect(parseBleStatus('CONNECTING')).toEqual({ kind: 'connecting' });
    expect(parseBleStatus('CONNECTED')).toEqual({ kind: 'connected' });
  });

  it('parses every FAILED:{reason} contract value', () => {
    expect(parseBleStatus('FAILED:BAD_AUTH')).toEqual({
      kind: 'failed',
      reason: 'BAD_AUTH',
    });
    expect(parseBleStatus('FAILED:NO_SSID')).toEqual({
      kind: 'failed',
      reason: 'NO_SSID',
    });
    expect(parseBleStatus('FAILED:TIMEOUT')).toEqual({
      kind: 'failed',
      reason: 'TIMEOUT',
    });
    expect(parseBleStatus('FAILED:ERROR')).toEqual({
      kind: 'failed',
      reason: 'ERROR',
    });
  });

  it('parses FAILED:BAD_BROKER (v2: broker format/connect or MQTT-auth failure)', () => {
    expect(parseBleStatus('FAILED:BAD_BROKER')).toEqual({
      kind: 'failed',
      reason: 'BAD_BROKER',
    });
    // Whitespace padding tolerance applies to the v2 value too.
    expect(parseBleStatus(' FAILED:BAD_BROKER ')).toEqual({
      kind: 'failed',
      reason: 'BAD_BROKER',
    });
  });

  it('tolerates surrounding whitespace (notify padding)', () => {
    expect(parseBleStatus('  CONNECTED\n')).toEqual({ kind: 'connected' });
  });

  it('returns null for garbage and unknown values', () => {
    expect(parseBleStatus('')).toBeNull();
    expect(parseBleStatus('connected')).toBeNull(); // case-sensitive ASCII
    expect(parseBleStatus('CONNECT')).toBeNull();
    expect(parseBleStatus('OK')).toBeNull();
    expect(parseBleStatus('FAILED')).toBeNull();
    expect(parseBleStatus('FAILED:WIFI_DOWN')).toBeNull(); // unknown suffix
    expect(parseBleStatus('IDLE CONNECTED')).toBeNull();
    expect(parseBleStatus('BDQ9+/==')).toBeNull();
  });
});

describe('validateWifiCredentials (byte-accurate firmware limits)', () => {
  it('accepts a plain SSID with an empty password (open network)', () => {
    expect(validateWifiCredentials('MyWiFi', '')).toEqual({ ok: true });
  });

  it('accepts an SSID with password', () => {
    expect(validateWifiCredentials('MyWiFi', 'hunter2')).toEqual({ ok: true });
  });

  it('rejects an empty or whitespace-only SSID', () => {
    expect(validateWifiCredentials('', 'pass')).toEqual({
      ok: false,
      error: 'ssidRequired',
    });
    expect(validateWifiCredentials('   ', 'pass')).toEqual({
      ok: false,
      error: 'ssidRequired',
    });
  });

  it('counts UTF-8 bytes, not characters, for the SSID limit', () => {
    // 32 bytes exactly (ascii) → OK; 33 → too long.
    expect(validateWifiCredentials('a'.repeat(32), '')).toEqual({ ok: true });
    expect(validateWifiCredentials('a'.repeat(33), '')).toEqual({
      ok: false,
      error: 'ssidTooLong',
    });
    // Vietnamese: 'Bộ' is 4 bytes (B + ô[2 bytes]). 10 × 'Bộ' = 40 bytes → over.
    expect(utf8ByteLength('Bộ')).toBe(4);
    expect(validateWifiCredentials('Bộ'.repeat(10), '')).toEqual({
      ok: false,
      error: 'ssidTooLong',
    });
    // But 8 × 'Bộ' = 32 bytes exactly → still inside the limit.
    expect(validateWifiCredentials('Bộ'.repeat(8), '')).toEqual({ ok: true });
    // An emoji is 4 bytes; 8 × 🛜 = 32 bytes → OK, 9 → over.
    expect(utf8ByteLength('🛜')).toBe(4);
    expect(validateWifiCredentials('🛜'.repeat(8), '')).toEqual({ ok: true });
    expect(validateWifiCredentials('🛜'.repeat(9), '')).toEqual({
      ok: false,
      error: 'ssidTooLong',
    });
  });

  it('allows at most 63 UTF-8 bytes of password (empty allowed)', () => {
    expect(validateWifiCredentials('net', 'p'.repeat(63))).toEqual({
      ok: true,
    });
    expect(validateWifiCredentials('net', 'p'.repeat(64))).toEqual({
      ok: false,
      error: 'passwordTooLong',
    });
  });

  it('pins the UTF-8 byte length of the diacritics used above', () => {
    // 'ộ' (U+1ED9) is 3 bytes in UTF-8; a 4-byte emoji; 'Bộ' = 1 + 3 = 4.
    expect(utf8ByteLength('ộ')).toBe(3);
    expect(utf8ByteLength('Bộ')).toBe(4);
    expect(utf8ByteLength('🛜')).toBe(4);
    // 21 × 3 = 63 bytes → OK; 22 × 3 = 66 → over.
    expect(validateWifiCredentials('net', 'ộ'.repeat(21))).toEqual({
      ok: true,
    });
    expect(validateWifiCredentials('net', 'ộ'.repeat(22))).toEqual({
      ok: false,
      error: 'passwordTooLong',
    });
  });
});

describe('validateBrokerAddress (v2, byte-accurate host[:port] grammar)', () => {
  it('accepts a plain host (firmware assumes the default port)', () => {
    expect(validateBrokerAddress('192.168.100.3')).toEqual({ ok: true });
    expect(validateBrokerAddress('broker.local')).toEqual({ ok: true });
    expect(validateBrokerAddress('my-broker.example.com')).toEqual({
      ok: true,
    });
  });

  it('accepts host:port with a numeric port in 1..65535', () => {
    expect(validateBrokerAddress('192.168.100.3:1883')).toEqual({ ok: true });
    expect(validateBrokerAddress('broker.local:8883')).toEqual({ ok: true });
    expect(validateBrokerAddress('10.0.0.1:65535')).toEqual({ ok: true });
    expect(validateBrokerAddress('10.0.0.1:1')).toEqual({ ok: true });
  });

  it('rejects an empty or whitespace-only address', () => {
    expect(validateBrokerAddress('')).toEqual({
      ok: false,
      error: 'brokerRequired',
    });
    expect(validateBrokerAddress('   ')).toEqual({
      ok: false,
      error: 'brokerRequired',
    });
  });

  it('rejects whitespace anywhere in the address', () => {
    expect(validateBrokerAddress('192.168.100.3 :1883')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
    expect(validateBrokerAddress('my broker:1883')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
  });

  it('allows at most 128 UTF-8 bytes (counted, not characters)', () => {
    expect(validateBrokerAddress('a'.repeat(128))).toEqual({ ok: true });
    expect(validateBrokerAddress('a'.repeat(129))).toEqual({
      ok: false,
      error: 'brokerTooLong',
    });
    // A multi-byte character counts its BYTES: 43 × 'ộ' (3 bytes) = 129.
    expect(utf8ByteLength('ộ')).toBe(3);
    expect(validateBrokerAddress(`${'ộ'.repeat(43)}:1883`)).toEqual({
      ok: false,
      error: 'brokerTooLong',
    });
  });

  it('rejects malformed ports (non-numeric, out of range, bare colon)', () => {
    expect(validateBrokerAddress('192.168.100.3:abc')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
    // ':abc' is not a port suffix → the whole value becomes the host →
    // the colon fails the host grammar.
    expect(validateBrokerAddress('192.168.100.3:')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
    expect(validateBrokerAddress('192.168.100.3:0')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
    expect(validateBrokerAddress('192.168.100.3:65536')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
  });

  it('rejects URL characters and IPv6-style multi-colon hosts (documented limitation)', () => {
    expect(validateBrokerAddress('mqtt://192.168.100.3:1883')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
    expect(validateBrokerAddress('192.168.100.3/path')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
    expect(validateBrokerAddress('fe80::1')).toEqual({
      ok: false,
      error: 'brokerInvalid',
    });
  });
});

describe('validateMqttCredentials (v2, both optional — anonymous allowed)', () => {
  it('accepts empty credentials (anonymous broker / no password)', () => {
    expect(validateMqttCredentials('', '')).toEqual({ ok: true });
  });

  it('accepts credentials at the byte boundaries', () => {
    expect(validateMqttCredentials('u'.repeat(64), 'p'.repeat(128))).toEqual({
      ok: true,
    });
    // Vietnamese diacritics count BYTES: 'ộ' is 3 bytes — 21 × 3 = 63 ≤ 64.
    expect(validateMqttCredentials('ộ'.repeat(21), '')).toEqual({ ok: true });
    expect(validateMqttCredentials('ộ'.repeat(22), '')).toEqual({
      ok: false,
      error: 'usernameTooLong',
    });
    expect(validateMqttCredentials('', 'ộ'.repeat(42))).toEqual({ ok: true });
    expect(validateMqttCredentials('', 'ộ'.repeat(43))).toEqual({
      ok: false,
      error: 'mqttPasswordTooLong',
    });
  });

  it('rejects over-limit username and password independently', () => {
    expect(validateMqttCredentials('u'.repeat(65), '')).toEqual({
      ok: false,
      error: 'usernameTooLong',
    });
    expect(validateMqttCredentials('', 'p'.repeat(129))).toEqual({
      ok: false,
      error: 'mqttPasswordTooLong',
    });
    // The username error wins when both exceed (deterministic order).
    expect(validateMqttCredentials('u'.repeat(65), 'p'.repeat(129))).toEqual({
      ok: false,
      error: 'usernameTooLong',
    });
  });
});

describe('boardIdFromLocalName (IoTBoard-{boardId} advertise grammar)', () => {
  it('extracts the boardId from a contract-shaped local name', () => {
    expect(boardIdFromLocalName('IoTBoard-0')).toBe('0');
    expect(boardIdFromLocalName('IoTBoard-board-7')).toBe('board-7');
    expect(boardIdFromLocalName('IoTBoard-' + 'a'.repeat(32))).toBe(
      'a'.repeat(32),
    );
  });

  it('returns null for foreign names and grammar violations', () => {
    expect(boardIdFromLocalName(null)).toBeNull();
    expect(boardIdFromLocalName('')).toBeNull();
    expect(boardIdFromLocalName('IoTBoard-')).toBeNull(); // empty id
    expect(boardIdFromLocalName('ESP32 Setup')).toBeNull(); // no prefix
    expect(boardIdFromLocalName('iotboard-0')).toBeNull(); // case-sensitive
    expect(boardIdFromLocalName('IoTBoard-board 1')).toBeNull(); // space
    expect(boardIdFromLocalName('IoTBoard-' + 'a'.repeat(33))).toBeNull();
  });
});

describe('parseBleDeviceInfo (DeviceInfo READ — QR label shape)', () => {
  const VALID = JSON.stringify({
    schemaVersion: 1,
    boardId: '0',
    boardType: 'IoT_ESP32-S2R3',
  });

  it('parses the contract payload (identical shape to the QR label)', () => {
    expect(parseBleDeviceInfo(VALID)).toEqual({
      schemaVersion: 1,
      boardId: '0',
      boardType: 'IoT_ESP32-S2R3',
    });
  });

  it('returns null for garbage / non-object JSON', () => {
    expect(parseBleDeviceInfo('not json')).toBeNull();
    expect(parseBleDeviceInfo('42')).toBeNull();
    expect(parseBleDeviceInfo('null')).toBeNull();
    expect(parseBleDeviceInfo('')).toBeNull();
  });

  it('returns null for a wrong schemaVersion or missing fields', () => {
    expect(
      parseBleDeviceInfo(
        JSON.stringify({ schemaVersion: 2, boardId: '0', boardType: 't' }),
      ),
    ).toBeNull();
    expect(
      parseBleDeviceInfo(JSON.stringify({ boardId: '0', boardType: 't' })),
    ).toBeNull();
    expect(
      parseBleDeviceInfo(JSON.stringify({ schemaVersion: 1, boardId: '0' })),
    ).toBeNull();
  });

  it('returns null for boardId grammar violations and empty boardType', () => {
    expect(
      parseBleDeviceInfo(
        JSON.stringify({
          schemaVersion: 1,
          boardId: 'board 1',
          boardType: 't',
        }),
      ),
    ).toBeNull();
    expect(
      parseBleDeviceInfo(
        JSON.stringify({ schemaVersion: 1, boardId: '0', boardType: '' }),
      ),
    ).toBeNull();
  });

  it('tolerates extra fields (stripped)', () => {
    const parsed = parseBleDeviceInfo(
      JSON.stringify({
        schemaVersion: 1,
        boardId: '0',
        boardType: 'IoT_ESP32-S2R3',
        fw: '1.2.3',
      }),
    );
    expect(parsed).toEqual({
      schemaVersion: 1,
      boardId: '0',
      boardType: 'IoT_ESP32-S2R3',
    });
  });
});

describe('toBleProvisionErrorReason', () => {
  it('returns the reason of an error-like value', () => {
    expect(toBleProvisionErrorReason({ reason: 'BAD_AUTH' })).toBe('BAD_AUTH');
    expect(toBleProvisionErrorReason({ reason: 'TIMEOUT' })).toBe('TIMEOUT');
  });

  it('maps the v2 reasons (BAD_BROKER firmware / VALIDATION app-side)', () => {
    expect(toBleProvisionErrorReason({ reason: 'BAD_BROKER' })).toBe(
      'BAD_BROKER',
    );
    expect(toBleProvisionErrorReason({ reason: 'VALIDATION' })).toBe(
      'VALIDATION',
    );
  });

  it('falls back to TRANSPORT for anything else', () => {
    expect(toBleProvisionErrorReason(undefined)).toBe('TRANSPORT');
    expect(toBleProvisionErrorReason(null)).toBe('TRANSPORT');
    expect(toBleProvisionErrorReason('boom')).toBe('TRANSPORT');
    expect(toBleProvisionErrorReason(new Error('boom'))).toBe('TRANSPORT');
    expect(toBleProvisionErrorReason({ reason: 42 })).toBe('TRANSPORT');
    expect(toBleProvisionErrorReason({ reason: 'NOT_A_REASON' })).toBe(
      'TRANSPORT',
    );
  });
});

describe('UTF-8 / Base64 codecs (write-path encoding)', () => {
  it('round-trips ASCII, Vietnamese and emoji payloads', () => {
    for (const text of [
      PROVISION_COMMAND,
      'MyWiFi',
      'Mạng nhà Bộ Đôi 🛜',
      'p@ss w0rd ộộộ',
      '',
    ]) {
      expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
    }
  });

  it('matches well-known Base64 reference vectors', () => {
    expect(utf8ToBase64('PROVISION')).toBe('UFJPVklTSU9O');
    expect(utf8ToBase64('MyWiFi')).toBe('TXlXaUZp');
    // 'Bộ' = 4 bytes UTF-8 (B + ộ[3]) → one padded group.
    expect(utf8ToBase64('Bộ')).toBe('QuG7mQ==');
    expect(utf8ToBase64('')).toBe('');
  });

  it('decodes unpadded and whitespace-padded input identically', () => {
    const padded = utf8ToBase64('CONNECTED');
    expect(padded.endsWith('=') || padded.length % 4 === 0).toBe(true);
    expect(base64ToUtf8(padded)).toBe('CONNECTED');
    expect(base64ToUtf8(padded.replace(/=/g, ''))).toBe('CONNECTED');
    expect(base64ToUtf8(` ${padded}\n`)).toBe('CONNECTED');
  });

  it('decodes an empty value to an empty string (open-network password write)', () => {
    expect(utf8ToBase64('')).toBe('');
    expect(base64ToUtf8('')).toBe('');
  });
});
