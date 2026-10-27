/**
 * BleProvisioningModal — the BLE provisioning surface v2
 * (`ble-provisioning-v2-broker-push`): a display shell + form. ALL BLE
 * logic lives in `bleWifiProvisioningService.ts` — the modal consumes the
 * {@link BleWifiProvisioningServiceLike} seam (type-only import of the
 * service module, erased at runtime) and NEVER imports
 * react-native-ble-plx (BoardsScannerModal's thin-shell pattern, AD-5).
 * Web gating happens in BoardsScreen (`Platform.OS !== 'web'`) — this
 * modal is mounted on native only.
 *
 * Two phases:
 * - scanning (Phase A): the live list of advertising boards
 *   (`IoTBoard-{boardId}` from the service's service-UUID-filtered scan,
 *   one row per device — deduped by deviceId, RSSI shown), the R4 honest
 *   hint ("cắm điện lại board — board chỉ phát Bluetooth khi chưa có
 *   WiFi") and the scan-problem hint (BT off / permission / unavailable).
 *   When a scanned board's boardId matches `initialBoardId` (the QR
 *   label's id) it is auto-selected ONCE — the scan stops and Phase B
 *   opens for that board; the user can still tap "Đổi board" and pick
 *   another (the one-shot guard prevents an auto-select trap on the
 *   restarted scan).
 * - configuring (Phase B): three field groups — WiFi (the SSID prefilled
 *   from the service's remembered last SSID + the password with a
 *   show/hide toggle), Broker (`host:port`, REQUIRED — Send stays
 *   disabled while empty) and MQTT (username + password; empty = an
 *   anonymous broker). The Broker/MQTT groups arrive PREFILLED through
 *   the `prefill` prop (BoardsScreen owns the settings read through the
 *   settings module facade — the modal stays a display shell and never
 *   touches storage; AD-v2-6). The byte-accurate validation gate
 *   (`validateWifiCredentials` + `validateBrokerAddress` +
 *   `validateMqttCredentials` — Send disabled while invalid) guards the
 *   provision run: Send → service.provision with onStatus progress
 *   (IDLE/CONNECTING lines) → CONNECTED = success state (v2: WiFi AND
 *   broker connected) + Đóng; FAILED:* / transport / validation failure =
 *   typed reason mapped to an honest message with the form left editable
 *   for an immediate retry (AD: the chars stay writable after a firmware
 *   failure).
 *
 * testIDs: `boards-ble-modal` (root), `boards-ble-close`,
 * `boards-ble-scan-problem`, `boards-ble-scan-hint` (R4 hint),
 * `boards-ble-board-{boardId}` (list row),
 * `boards-ble-selected-board` (selected-board line),
 * `boards-ble-ssid-input`, `boards-ble-password-input`,
 * `boards-ble-toggle-password`, `boards-ble-broker-input`,
 * `boards-ble-mqtt-username-input`, `boards-ble-mqtt-password-input`,
 * `boards-ble-prefill-hint`, `boards-ble-validation`,
 * `boards-ble-send`, `boards-ble-change-board`, `boards-ble-status`,
 * `boards-ble-error`, `boards-ble-success`.
 *
 * Visual language: the shared Smart Home wash + `tokens.smart` — the
 * centered-dialog recipe of the devices module. All labels come from
 * `STRINGS.boards.ble`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme, type ThemeTokens } from '@core/theme';

import {
  validateBrokerAddress,
  validateMqttCredentials,
  validateWifiCredentials,
  toBleProvisionErrorReason,
  type BleProvisionErrorReason,
  type BleProvisionStatus,
} from '../internal/domain/bleProvisioningContract';
import type {
  BleScanProblem,
  BleScannedBoard,
  BleScanSession,
  BleWifiProvisioningServiceLike,
} from '../internal/services/bleWifiProvisioningService';

/**
 * The Broker + MQTT prefill values (BoardsScreen derives them from the
 * persisted settings through the settings module facade). Any field may be
 * empty — an empty broker means the user types one (derivation is
 * best-effort and never blocks the flow).
 */
export interface BleProvisionPrefill {
  /** Broker address `host[:port]` (empty = type manually). */
  readonly broker: string;
  /** MQTT username from settings (empty = anonymous broker). */
  readonly mqttUsername: string;
  /** MQTT password from settings (empty = none). */
  readonly mqttPassword: string;
}

interface BleProvisioningModalProps {
  /** Open state (BoardsScreen owns the lifecycle). */
  readonly visible: boolean;
  /** Close request (back button + the Đóng buttons). */
  readonly onClose: () => void;
  /**
   * The boardId parsed from the QR label (the not-found sheet's handoff):
   * the first scanned board matching it is auto-selected. `null` = plain
   * scan, no auto-select.
   */
  readonly initialBoardId: string | null;
  /**
   * The Broker + MQTT prefill from BoardsScreen's settings read
   * (AD-v2-6). Optional — without it the fields start empty.
   */
  readonly prefill?: BleProvisionPrefill;
  /** Called after the board accepted the WiFi/MQTT configuration. */
  readonly onProvisioned?: (boardId: string) => void;
  /**
   * The provisioning service seam (DI): BoardsScreen passes the real
   * service; tests inject fakes. The modal never constructs BLE objects.
   */
  readonly service: BleWifiProvisioningServiceLike;
}

/** The modal's phase. */
type BleModalPhase = 'scanning' | 'configuring';

/** The provision run state (idle → provisioning → success | failed). */
type ProvisionState = 'idle' | 'provisioning' | 'success' | 'failed';

/** Map a typed provision failure to its honest message. */
function failureText(reason: BleProvisionErrorReason): string {
  switch (reason) {
    case 'BAD_AUTH':
      return STRINGS.boards.ble.failedBadAuth;
    case 'NO_SSID':
      return STRINGS.boards.ble.failedNoSsid;
    case 'BAD_BROKER':
      return STRINGS.boards.ble.failedBadBroker;
    case 'TIMEOUT':
      return STRINGS.boards.ble.failedTimeout;
    case 'ERROR':
      return STRINGS.boards.ble.failedError;
    case 'VALIDATION':
      return STRINGS.boards.ble.validationFailed;
    case 'TRANSPORT':
      return STRINGS.boards.ble.errorTransport;
  }
}

/** Map a scan problem to its honest hint. */
function problemText(problem: BleScanProblem): string {
  switch (problem) {
    case 'bluetoothOff':
      return STRINGS.boards.ble.errorBluetoothOff;
    case 'permissionDenied':
      return STRINGS.boards.ble.errorPermission;
    case 'unavailable':
      return STRINGS.boards.ble.errorUnavailable;
  }
}

/** The live Status notification → the progress line (or null to hide). */
function progressText(status: BleProvisionStatus | null): string | null {
  if (status === null || status.kind === 'failed') {
    return null;
  }
  return status.kind === 'connecting'
    ? STRINGS.boards.ble.statusConnecting
    : STRINGS.boards.ble.statusIdle;
}

/**
 * The BLE provisioning modal: scan list → credentials form → provision.
 */
export function BleProvisioningModal({
  visible,
  onClose,
  initialBoardId,
  prefill,
  onProvisioned,
  service,
}: BleProvisioningModalProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const [phase, setPhase] = useState<BleModalPhase>('scanning');
  const [boards, setBoards] = useState<readonly BleScannedBoard[]>([]);
  const [problem, setProblem] = useState<BleScanProblem | null>(null);
  const [selected, setSelected] = useState<BleScannedBoard | null>(null);

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Contract v2 groups: broker (required) + MQTT credentials (optional —
  // empty = anonymous). The prefill is consumed at MOUNT (lazy state init):
  // BoardsScreen mounts a fresh modal per open and loads the settings at
  // screen mount, so the values are stable for the modal's whole life —
  // and a "Đổi board" restart never clobbers the user's edits.
  const [broker, setBroker] = useState(() => prefill?.broker ?? '');
  const [mqttUsername, setMqttUsername] = useState(
    () => prefill?.mqttUsername ?? '',
  );
  const [mqttPassword, setMqttPassword] = useState(
    () => prefill?.mqttPassword ?? '',
  );

  const [provisionState, setProvisionState] = useState<ProvisionState>('idle');
  const [progress, setProgress] = useState<BleProvisionStatus | null>(null);
  const [failureReason, setFailureReason] =
    useState<BleProvisionErrorReason | null>(null);

  // Scan lifecycle: the session lives in a ref (tap handlers stop it
  // without a re-render); `scanEpoch` restarts the scan for "Đổi board".
  const sessionRef = useRef<BleScanSession | null>(null);
  const [scanEpoch, setScanEpoch] = useState(0);
  // One-shot auto-select (AD: the QR boardId selects the first matching
  // advertisement once — a "Đổi board" must not re-trap the user). The
  // guard resets only on a FRESH OPEN (visible false → true), never on a
  // scan restart.
  const autoSelectDoneRef = useRef(false);
  const wasVisibleRef = useRef(false);

  const stopScan = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return undefined;
    }
    let cancelled = false;
    if (!wasVisibleRef.current) {
      // Fresh open: one-shot auto-select re-armed.
      autoSelectDoneRef.current = false;
      wasVisibleRef.current = true;
    }
    // Fresh open: empty state + remembered SSID (never the password —
    // the service has no API for one) + a live scan.
    void service.loadLastSsid().then(lastSsid => {
      if (!cancelled && lastSsid !== null) {
        setSsid(lastSsid);
      }
    });
    sessionRef.current = service.startScan(
      board => {
        if (cancelled) {
          return;
        }
        setBoards(previous =>
          previous.some(item => item.deviceId === board.deviceId)
            ? previous
            : [...previous, board],
        );
        if (
          !autoSelectDoneRef.current &&
          initialBoardId !== null &&
          board.boardId === initialBoardId
        ) {
          // The QR board is advertising: select it and open the form.
          autoSelectDoneRef.current = true;
          stopScan();
          setSelected(board);
          setPhase('configuring');
        }
      },
      scanProblem => {
        if (!cancelled) {
          setProblem(scanProblem);
        }
      },
    );
    return () => {
      cancelled = true;
      stopScan();
    };
  }, [visible, service, initialBoardId, scanEpoch, stopScan]);

  const pickBoard = (board: BleScannedBoard) => {
    stopScan();
    setSelected(board);
    setPhase('configuring');
  };

  const changeBoard = () => {
    // Back to Phase A: a fresh scan (the one-shot auto-select stays
    // consumed so the QR board cannot re-trap the user).
    setSelected(null);
    setProvisionState('idle');
    setProgress(null);
    setFailureReason(null);
    setProblem(null);
    setBoards([]);
    setPhase('scanning');
    setScanEpoch(epoch => epoch + 1);
  };

  const validation = validateWifiCredentials(ssid, password);
  const brokerValidation = validateBrokerAddress(broker);
  const mqttValidation = validateMqttCredentials(mqttUsername, mqttPassword);
  const sendDisabled =
    selected === null ||
    provisionState === 'provisioning' ||
    !validation.ok ||
    !brokerValidation.ok ||
    !mqttValidation.ok;

  const sendProvision = async () => {
    if (
      selected === null ||
      !validation.ok ||
      !brokerValidation.ok ||
      !mqttValidation.ok ||
      provisionState === 'provisioning'
    ) {
      return;
    }
    setProvisionState('provisioning');
    setProgress(null);
    setFailureReason(null);
    try {
      await service.provision({
        deviceId: selected.deviceId,
        ssid,
        password,
        broker,
        mqttUsername,
        mqttPassword,
        onStatus: setProgress,
      });
      setProvisionState('success');
      onProvisioned?.(selected.boardId);
      // AD-4: remember the SSID of a SUCCESSFUL send only — never the
      // WiFi password and never the MQTT credentials (the service has no
      // API that would accept one).
      await service.saveLastSsid(ssid);
    } catch (error: unknown) {
      setFailureReason(toBleProvisionErrorReason(error));
      setProvisionState('failed');
    }
  };

  const validationText = ((): string | null => {
    // Pristine form (nothing typed anywhere) — the disabled button says
    // enough; no validation noise on open.
    if (
      ssid.length === 0 &&
      password.length === 0 &&
      broker.length === 0 &&
      mqttUsername.length === 0 &&
      mqttPassword.length === 0
    ) {
      return null;
    }
    if (!validation.ok) {
      switch (validation.error) {
        case 'ssidRequired':
          return STRINGS.boards.ble.ssidRequired;
        case 'ssidTooLong':
          return STRINGS.boards.ble.ssidTooLong;
        case 'passwordTooLong':
          return STRINGS.boards.ble.passwordTooLong;
      }
    }
    if (!brokerValidation.ok) {
      switch (brokerValidation.error) {
        case 'brokerRequired':
          return STRINGS.boards.ble.brokerRequired;
        case 'brokerTooLong':
          return STRINGS.boards.ble.brokerTooLong;
        case 'brokerInvalid':
          return STRINGS.boards.ble.brokerInvalid;
      }
    }
    if (!mqttValidation.ok) {
      return mqttValidation.error === 'usernameTooLong'
        ? STRINGS.boards.ble.mqttUsernameTooLong
        : STRINGS.boards.ble.mqttPasswordTooLong;
    }
    return null;
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="boards-ble-modal"
    >
      <View style={styles.modalBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.boards.ble.close}
          testID="boards-ble-scrim"
        />
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: tokens.smart.colors.card,
              borderColor: tokens.smart.colors.cardBorder,
            },
            tokens.smart.cardShadow,
          ]}
        >
          <Text
            style={[
              styles.modalTitle,
              { color: tokens.smart.colors.textPrimary },
            ]}
          >
            {STRINGS.boards.ble.title}
          </Text>

          {phase === 'scanning' ? (
            <>
              <Text
                style={[
                  styles.hint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.boards.ble.scanHint}
              </Text>
              {problem !== null ? (
                <Text
                  style={[styles.errorText, { color: tokens.danger }]}
                  testID="boards-ble-scan-problem"
                >
                  {problemText(problem)}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.listLabel,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.boards.ble.listLabel}
              </Text>
              {boards.map(board => (
                <TouchableOpacity
                  key={board.deviceId}
                  style={[
                    styles.boardRow,
                    { borderColor: tokens.smart.colors.cardBorder },
                  ]}
                  onPress={() => pickBoard(board)}
                  testID={`boards-ble-board-${board.boardId}`}
                >
                  <Text
                    style={[
                      styles.boardIdText,
                      { color: tokens.smart.colors.textPrimary },
                    ]}
                  >
                    {board.boardId}
                  </Text>
                  <Text
                    style={[
                      styles.rssiText,
                      { color: tokens.smart.colors.textSecondary },
                    ]}
                  >
                    {board.rssi === null ? '' : `${board.rssi} dBm`}
                  </Text>
                </TouchableOpacity>
              ))}
              <Text
                style={[
                  styles.hint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
                testID="boards-ble-scan-hint"
              >
                {STRINGS.boards.ble.scanEmptyHint}
              </Text>
            </>
          ) : (
            <>
              {selected !== null ? (
                <Text
                  style={[
                    styles.selectedBoard,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                  testID="boards-ble-selected-board"
                >
                  {selected.boardId}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.fieldLabel,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.boards.ble.ssidLabel}
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    borderColor: tokens.smart.colors.cardBorder,
                    color: tokens.smart.colors.textPrimary,
                  },
                ]}
                value={ssid}
                onChangeText={setSsid}
                autoCapitalize="none"
                autoCorrect={false}
                editable={provisionState !== 'provisioning'}
                testID="boards-ble-ssid-input"
              />
              <Text
                style={[
                  styles.fieldLabel,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.boards.ble.passwordLabel}
              </Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[
                    styles.textInput,
                    styles.passwordInput,
                    {
                      borderColor: tokens.smart.colors.cardBorder,
                      color: tokens.smart.colors.textPrimary,
                    },
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={provisionState !== 'provisioning'}
                  testID="boards-ble-password-input"
                />
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    { borderColor: tokens.smart.colors.cardBorder },
                  ]}
                  onPress={() => setShowPassword(shows => !shows)}
                  accessibilityLabel={
                    showPassword
                      ? STRINGS.boards.ble.hide
                      : STRINGS.boards.ble.show
                  }
                  testID="boards-ble-toggle-password"
                >
                  <Text style={{ color: tokens.smart.colors.textSecondary }}>
                    {showPassword
                      ? STRINGS.boards.ble.hide
                      : STRINGS.boards.ble.show}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Broker group (contract v2, AD-v2-2): REQUIRED host:port
                  for the board's MQTT-TCP connection — prefilled from the
                  settings-derived host + the firmware default port 1883
                  (never the app's WebSocket port), still editable. */}
              <Text
                style={[
                  styles.fieldLabel,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.boards.ble.brokerLabel}
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    borderColor: tokens.smart.colors.cardBorder,
                    color: tokens.smart.colors.textPrimary,
                  },
                ]}
                value={broker}
                onChangeText={setBroker}
                placeholder={STRINGS.boards.ble.brokerPlaceholder}
                placeholderTextColor={tokens.smart.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                editable={provisionState !== 'provisioning'}
                testID="boards-ble-broker-input"
              />

              {/* MQTT group (contract v2): credentials for the board's
                  broker login — both optional (empty = anonymous broker /
                  no password), prefilled verbatim from the settings. The
                  password renders secure (no toggle — keep the group
                  compact; the WiFi toggle stays the show/hide affordance). */}
              <Text
                style={[
                  styles.fieldLabel,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.boards.ble.mqttUsernameLabel}
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    borderColor: tokens.smart.colors.cardBorder,
                    color: tokens.smart.colors.textPrimary,
                  },
                ]}
                value={mqttUsername}
                onChangeText={setMqttUsername}
                autoCapitalize="none"
                autoCorrect={false}
                editable={provisionState !== 'provisioning'}
                testID="boards-ble-mqtt-username-input"
              />
              <Text
                style={[
                  styles.fieldLabel,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.boards.ble.mqttPasswordLabel}
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    borderColor: tokens.smart.colors.cardBorder,
                    color: tokens.smart.colors.textPrimary,
                  },
                ]}
                value={mqttPassword}
                onChangeText={setMqttPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={provisionState !== 'provisioning'}
                testID="boards-ble-mqtt-password-input"
              />
              <Text
                style={[
                  styles.hint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
                testID="boards-ble-prefill-hint"
              >
                {STRINGS.boards.ble.prefillHint}
              </Text>
              {validationText !== null ? (
                <Text
                  style={[styles.errorText, { color: tokens.danger }]}
                  testID="boards-ble-validation"
                >
                  {validationText}
                </Text>
              ) : null}

              {provisionState === 'success' ? (
                <Text
                  style={[
                    styles.successText,
                    { color: tokens.smart.colors.teal },
                  ]}
                  testID="boards-ble-success"
                >
                  {STRINGS.boards.ble.success}
                </Text>
              ) : null}
              {provisionState === 'failed' && failureReason !== null ? (
                <Text
                  style={[styles.errorText, { color: tokens.danger }]}
                  testID="boards-ble-error"
                >
                  {failureText(failureReason)}
                </Text>
              ) : null}
              {provisionState !== 'success' && provisionState !== 'failed' ? (
                <Text
                  style={[
                    styles.hint,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                  testID="boards-ble-status"
                >
                  {progressText(progress) ?? STRINGS.boards.ble.statusIdle}
                </Text>
              ) : null}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    { borderColor: tokens.smart.colors.cardBorder },
                  ]}
                  onPress={changeBoard}
                  disabled={provisionState === 'provisioning'}
                  testID="boards-ble-change-board"
                >
                  <Text style={{ color: tokens.smart.colors.textSecondary }}>
                    {STRINGS.boards.ble.changeBoard}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    {
                      backgroundColor: tokens.primary,
                      borderColor: tokens.primary,
                    },
                    sendDisabled && { opacity: 0.5 },
                  ]}
                  disabled={sendDisabled}
                  onPress={() => {
                    void sendProvision();
                  }}
                  testID="boards-ble-send"
                >
                  <Text style={{ color: tokens.onPrimary }}>
                    {STRINGS.boards.ble.send}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <TouchableOpacity
            style={[
              styles.modalButton,
              styles.closeButton,
              { borderColor: tokens.smart.colors.cardBorder },
            ]}
            onPress={onClose}
            testID="boards-ble-close"
          >
            <Text style={{ color: tokens.smart.colors.textSecondary }}>
              {STRINGS.boards.ble.close}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    // Centered-dialog recipe (the devices module standard).
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 420,
      borderWidth: 1,
      borderRadius: tokens.smart.radius.card,
      padding: 16,
      gap: 8,
    },
    modalTitle: { fontSize: 16, fontWeight: '700' },
    hint: { fontSize: 12, lineHeight: 16 },
    listLabel: { fontSize: 13, fontWeight: '600' },
    boardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    boardIdText: { fontSize: 14, fontWeight: '600' },
    rssiText: { fontSize: 12 },
    selectedBoard: { fontSize: 12 },
    fieldLabel: { fontSize: 13, fontWeight: '600' },
    textInput: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
    },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    passwordInput: { flex: 1 },
    toggleButton: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    successText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
    errorText: { fontSize: 12, lineHeight: 16, marginTop: 4 },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
      marginTop: 8,
    },
    modalButton: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    closeButton: { alignSelf: 'flex-end', marginTop: 4 },
  });
}
