/**
 * QrScannerModal — the GENERIC full-screen QR camera scanner primitive
 * (settings-secrets-qr, AD-3): a shared `core/ui` shell any screen can
 * mount for a scan-a-payload flow, modeled on the devices module'
 * `BoardsScannerModal` (boards-qr-scan, AD-4/AD-5). The boards modal stays
 * where it is — migrating it onto this primitive is recorded backlog.
 *
 * Deliberately a THIN camera shell: the modal never parses or interprets
 * payloads. On a barcode hit it forwards the raw string through the narrow
 * `onScanned` seam; the SCREEN owns all matching logic (zod contract
 * parse → accept / reject). The screen talks back through two channels:
 * the boolean RETURN of `onScanned` (`false` = rejected → the modal re-arms
 * the scan lock so the camera stays live for the immediate re-scan) and the
 * display-only `lastError` prop (the inline error text).
 *
 * Generic additions over the boards pattern:
 * - `title` / `hint` props instead of hard-coded boards labels — the
 *   caller names the flow. v1 pragmatism: the modal itself consumes TWO
 *   generic labels from `STRINGS.settings.*` (the camera-denied hint and
 *   the Đóng button); per-flow label props are future hardening for when
 *   a second consumer adopts the primitive.
 * - the RAW rejected payload diagnostic is modal-owned: on a rejection the
 *   modal captures the scanned string itself and shows it truncated to 80
 *   characters (mono, one line, `…` tail) so a mis-scan is self-diagnosing
 *   without the caller tracking raw payloads. It resets when the modal
 *   closes.
 *
 * Behaviour:
 * - opened → `Camera.requestCameraPermissionsAsync()` (re-requested per
 *   open — an already-granted/denied permission resolves instantly);
 * - denied (or the request failing, e.g. unsupported web camera) → the
 *   honest hint, NO camera view (the user re-enables from OS settings);
 * - granted → a QR-only `CameraView` with the scan-frame visual + hint;
 * - single-scan lock: the FIRST `onBarcodeScanned` callback wins; the
 *   camera keeps firing while the same code sits in frame, so later
 *   duplicate callbacks are ignored until the modal is closed and
 *   reopened (the lock resets when `visible` turns false). A REJECTED
 *   scan re-arms the lock synchronously — the rejection signal arrives
 *   through `onScanned`'s return value, so it works for consecutive
 *   rejections too.
 * - web-safe: the camera stack works on web (verified live with the boards
 *   scanner); an unsupported/broken camera degrades to the denied hint
 *   instead of crashing.
 *
 * Visual language: app-surface elements (title, denied card, close button)
 * stay on `tokens.smart`; only the viewfinder chrome itself (backdrop
 * wash, frame border, hint text over live video) uses the hardcoded-neutral
 * precedent of the existing `rgba(0,0,0,0.9)` modal backdrop.
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
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Camera, CameraView, type BarcodeScanningResult } from 'expo-camera';

import { STRINGS } from '@core/i18n';
import { useTheme, type ThemeTokens } from '@core/theme';

/** Mono-ish font for the diagnostic raw line (the BoardsScreen idiom). */
const monoFontFamily = Platform.select({
  ios: 'Menlo',
  default: 'monospace',
});

/** Characters of the raw payload shown before the ellipsis. */
const RAW_MAX_CHARS = 80;

/**
 * Pure truncation for the diagnostic raw line: the first
 * {@link RAW_MAX_CHARS} characters of the scanned string, `…` appended
 * when it was longer. An empty string yields `null` (nothing worth
 * showing).
 */
function truncateRawScanned(raw: string): string | null {
  if (raw === '') {
    return null;
  }
  return raw.length <= RAW_MAX_CHARS ? raw : `${raw.slice(0, RAW_MAX_CHARS)}…`;
}

interface QrScannerModalProps {
  /** Open state (the screen owns the lifecycle). */
  readonly visible: boolean;
  /** Flow title shown at the top of the scanner (caller's STRINGS label). */
  readonly title: string;
  /** Hint shown over the live camera (what to aim at). */
  readonly hint: string;
  /** Close request (back button + the Đóng button). */
  readonly onClose: () => void;
  /**
   * The raw scanned string — unparsed; the screen validates. Returns
   * whether the scan was ACCEPTED (a valid payload the screen consumed):
   * `false` = rejected → the modal re-arms the scan lock so the next
   * barcode callback is processed and shows the raw-payload diagnostic.
   */
  readonly onScanned: (raw: string) => boolean;
  /**
   * Display-only inline error: the screen sets it when a scan is not a
   * valid payload and clears it on the next accepted scan / close. The
   * modal never generates it.
   */
  readonly lastError?: string | null;
}

/** Permission resolution rendered as a minimal local state machine. */
type CameraPermissionState = 'pending' | 'granted' | 'denied';

/**
 * The generic QR scanner modal: camera shell + permission flow +
 * single-scan lock + raw-payload diagnostic.
 */
export function QrScannerModal({
  visible,
  title,
  hint,
  onClose,
  onScanned,
  lastError = null,
}: QrScannerModalProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [permission, setPermission] =
    useState<CameraPermissionState>('pending');
  // The raw payload of the LAST REJECTED scan in THIS open session
  // (modal-owned diagnostic), shown truncated so a mis-scan is
  // self-diagnosing. The reset on close is DERIVED during render (the
  // React "adjust state when a prop changes" pattern — no effect): a
  // fresh open never shows the previous session's diagnostic.
  const [diagnostic, setDiagnostic] = useState<{
    open: boolean;
    raw: string | null;
  }>({ open: visible, raw: null });
  if (diagnostic.open !== visible) {
    setDiagnostic({ open: visible, raw: null });
  }
  const lastRawScanned = visible && diagnostic.open ? diagnostic.raw : null;
  // Single-scan lock: ref, not state — it gates callbacks without
  // re-rendering and resets when the modal closes.
  const scanLockRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      // Single-scan lock reset on close. The permission state is
      // deliberately NOT reset here: every open re-requests below and the
      // resolution overwrites it (an already-granted/denied permission
      // resolves instantly, so no stale state is actionable).
      scanLockRef.current = false;
      return;
    }
    let cancelled = false;
    void Camera.requestCameraPermissionsAsync()
      .then(response => {
        if (!cancelled) {
          setPermission(response.granted ? 'granted' : 'denied');
        }
      })
      .catch(() => {
        // Unsupported/broken camera stack (web best-effort): degrade to
        // the denied hint instead of crashing.
        if (!cancelled) {
          setPermission('denied');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      // Single-scan lock: duplicate camera callbacks for ONE physical
      // scan are ignored — the first callback consumes the lock.
      if (scanLockRef.current) {
        return;
      }
      scanLockRef.current = true;
      const accepted = onScanned(result.data);
      if (!accepted) {
        // The screen REJECTED the payload: capture the raw diagnostic and
        // re-arm immediately so the camera stays live for the re-scan —
        // including consecutive rejections. Synchronous ref write, no
        // effect needed.
        setDiagnostic({ open: true, raw: result.data });
        scanLockRef.current = false;
      }
    },
    [onScanned],
  );

  // The diagnostic raw line (settings-secrets-qr): shown only alongside a
  // rejection — WHAT the camera actually delivered, so the user can tell a
  // wrong QR from a mangled scan without any tooling. An empty payload has
  // nothing worth showing (the pill renders only for a non-empty raw).
  const rawScannedLine =
    lastRawScanned !== null ? truncateRawScanned(lastRawScanned) : null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      testID="qr-scanner-modal"
    >
      <View style={styles.backdrop}>
        {permission === 'granted' ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ) : null}
        {permission === 'denied' ? (
          <View
            style={[
              styles.deniedCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
            ]}
            testID="qr-scanner-denied"
          >
            <Text
              style={[
                styles.deniedText,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.settings.qrScannerCameraDenied}
            </Text>
          </View>
        ) : null}
        {permission === 'granted' ? (
          <>
            {/* The scan-frame visual: a fixed frame the user aims the QR
                at. No testID — pure chrome, not a flow anchor. */}
            <View style={styles.scanFrame} pointerEvents="none" />
            <View style={styles.titlePill} pointerEvents="none">
              <Text style={styles.titleText} testID="qr-scanner-title">
                {title}
              </Text>
            </View>
            <View style={styles.hintPill} pointerEvents="none">
              <Text style={styles.hintText} testID="qr-scanner-hint">
                {hint}
              </Text>
            </View>
          </>
        ) : null}
        {lastError ? (
          <View style={styles.errorPill} pointerEvents="none">
            <Text
              style={[styles.errorText, { color: tokens.danger }]}
              testID="qr-scanner-error"
            >
              {lastError}
            </Text>
          </View>
        ) : null}
        {rawScannedLine ? (
          <View style={styles.rawPill} pointerEvents="none">
            <Text
              style={[
                styles.rawScannedText,
                { color: tokens.smart.colors.textSecondary },
              ]}
              numberOfLines={1}
              testID="qr-scanner-raw"
            >
              {rawScannedLine}
            </Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={[
            styles.closeButton,
            {
              backgroundColor: tokens.smart.colors.card,
              borderColor: tokens.smart.colors.cardBorder,
            },
          ]}
          onPress={onClose}
          accessibilityLabel={STRINGS.settings.qrScannerClose}
          testID="qr-scanner-close"
        >
          <Text
            style={[
              styles.closeText,
              { color: tokens.smart.colors.textPrimary },
            ]}
          >
            {STRINGS.settings.qrScannerClose}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    // Camera chrome (backdrop wash / frame border / pills over the live
    // video) sits on the live video feed — hardcoded neutrals, the same
    // precedent as the screens' hardcoded `rgba(0,0,0,0.9)` modal backdrop.
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
    camera: StyleSheet.absoluteFill,
    scanFrame: {
      position: 'absolute',
      top: '22%',
      alignSelf: 'center',
      width: 248,
      height: 248,
      borderWidth: 2,
      borderRadius: 24,
      borderColor: 'rgba(255,255,255,0.85)',
    },
    titlePill: {
      position: 'absolute',
      top: 48,
      alignSelf: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    titleText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
    hintPill: {
      position: 'absolute',
      bottom: 128,
      alignSelf: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    hintText: { fontSize: 14, color: '#FFFFFF' },
    // Inline invalid-payload error (screen-authored, display-only).
    errorPill: {
      position: 'absolute',
      bottom: 92,
      alignSelf: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    errorText: { fontSize: 13, fontWeight: '600' },
    // The diagnostic raw scanned line: small mono secondary text, one line
    // with the tail ellipsis (numberOfLines).
    rawPill: {
      position: 'absolute',
      bottom: 64,
      alignSelf: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
      maxWidth: '90%',
    },
    rawScannedText: {
      fontSize: 11,
      fontFamily: monoFontFamily,
    },
    // Denied hint card: an app-surface card — token-driven.
    deniedCard: {
      position: 'absolute',
      top: '30%',
      alignSelf: 'center',
      borderWidth: 1,
      borderRadius: tokens.smart.radius.card,
      padding: 16,
      maxWidth: 320,
    },
    deniedText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
    closeButton: {
      position: 'absolute',
      bottom: 24,
      alignSelf: 'center',
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    closeText: { fontSize: 14, fontWeight: '600' },
  });
}
