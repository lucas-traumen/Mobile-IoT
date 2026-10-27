/**
 * AdvancedSettingsScreen — the dedicated MQTT/InfluxDB configuration
 * screen, a THIN composition root over the `ui/advanced/` components.
 *
 * Approved model (advanced-settings-sequential-recovery): ONE flow with
 * two modes —
 *
 *   setup mode    1. Máy chủ → 2. Xác thực → 3. Xác nhận & Lưu
 *                    (the ConfigurationStepper: EXACTLY three official
 *                    levels; forward is sequential and gated; back/edit
 *                    is explicit and draft-preserving)
 *                        ↓ `Lưu cấu hình` SUCCEEDS
 *   status mode   Trạng thái — the post-save live-state mode
 *                    (informally "step 4" in product discussion, but
 *                    NEVER a fourth stepper level and NEVER a tab)
 *
 * - The old `Thiết lập | Trạng thái` selectable sub-tab split is retired:
 *   save success ENTERS status mode; `Cấu hình lại` is the only explicit
 *   path back to setup Step 1 (draft kept, nothing auto-saved).
 * - mDNS selection (user-approved `ok` amendment): fills the non-secret
 *   DRAFT and IMMEDIATELY advances to step 2 — the screen owns that
 *   transition (never a save, never a probe). An accepted credentials QR
 *   still fills the DRAFT only (no auto-probe, no advance); a SUCCESSFUL
 *   `Kiểm tra kết nối` probe gates step 3, and the InfluxDB half of the
 *   probe stays honest/non-blocking.
 * - Recovery is NON-DESTRUCTIVE (AD-4): the old automatic fallback — jump
 *   to Step 1 on `failed`, the 60 s sustained-reconnecting timer, the tab
 *   yank — is fully retired. A runtime MQTT failure renders the
 *   {@link RuntimeRecoveryNotice} at the CURRENT official step (setup) or
 *   the failed status card (status mode); `Thử lại` (the REAL telemetry
 *   lifecycle) and `Cấu hình lại` are the only moves, both user-pressed.
 *   A save failure keeps the user on step 3 with the draft, a primary
 *   `Thử lại`, and explicit `Chỉnh sửa xác thực`/`Chỉnh sửa máy chủ`
 *   actions (AD-2) — never an automatic backward navigation.
 * - Async results are draft-bound (AD-5): every draft mutation, no-auth
 *   toggle, and user step transition bumps the probe epoch; a probe that
 *   settles against a stale epoch drops its result entirely (a late
 *   success can never unlock step 3 or overwrite a current error), and
 *   probe cleanup stays mandatory on every exit path.
 * - Runtime truth stays separate (AD-6): the status widgets describe the
 *   PERSISTED config; the wizard describes the draft candidate.
 *
 * Approved truthfulness contracts (unchanged):
 * - The MQTT status card mirrors the REAL telemetry connection lifecycle
 *   (the shared client's live state, driven by the PERSISTED config) —
 *   this screen never creates a parallel persistent MQTT client. The
 *   retry/check-again action goes through the wired composition-root
 *   callback (stop → start of the real service).
 * - The one-shot `Kiểm tra kết nối` probe (D4) is a THROWAWAY client in
 *   {@link MqttProbeServiceLike} — isolated from the telemetry client,
 *   always cleaned up; success merely ADVANCES the flow (fill-never-save).
 * - The InfluxDB status describes ONLY the last explicit probe, bound to
 *   the EXACT persisted configuration it tested via a typed fingerprint
 *   — editing/saving keeps it gray until a fresh probe succeeds.
 * - Fill-never-save everywhere: mDNS select, QR fill (secretsQrContract),
 *   Influx form edits and probe success only touch the store draft; the
 *   single save path is `Lưu cấu hình` (the existing handleSave).
 * - Secrets stay verbatim on-device with reveal toggles; the QR scanner
 *   (`QrScannerModal` + `secretsQrContract`) fills username/password
 *   (and influxToken → the influx draft) and re-arms on rejection.
 *
 * Mode resolution: the session-scoped wizard store (`wizardSessionStore`)
 * carries `currentStep` + `mode` + `savedOk` across remounts within the
 * app session. The INITIAL position resolves once at mount: a stored
 * position/mode wins; otherwise a valid persisted configuration opens
 * status mode and a first run opens setup Step 1 (host-valid → step 2).
 * NO broker-loss override exists — a lost runtime never decides the
 * user's position.
 *
 * Web (user decision 2a, kept): the guided flow (mDNS is native-only) is
 * hidden behind a short hint; the status cards remain visible once
 * something is persisted. The probe service additionally refuses to run
 * on web (typed transport error — defense in depth).
 *
 * Visual language (settings-smart-home-sync): the ambient Smart Home wash
 * background, smart cards/inputs, and the SHARED connection/health color
 * contract (D3) through `ConnectionStatusBadge`. Tokens-only colors.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import type { AppErrorCode } from '@core/errors';
import type { ConnectionState } from '@core/events';
import { errorLabel, STRINGS } from '@core/i18n';
import { useStore } from 'zustand';
import { useTheme } from '@core/theme';
import {
  OperationBanner,
  useOperationFeedback,
} from '@core/ui/OperationBanner';
import { QrScannerModal } from '@core/ui/QrScannerModal';
import type { AppSettings } from '@modules/settings/api';

import { applyDiscoveredService } from '../internal/domain/mdnsDiscoveryContract';
import {
  parseCredentialsQr,
  type SecretsQrParseError,
} from '../internal/domain/secretsQrContract';
import { influxConfigFingerprint } from '../internal/domain/influxFingerprint';
import {
  getMdnsDiscoveryService,
  type MdnsDiscoveryServiceLike,
} from '../internal/services/mdnsDiscoveryService';
import {
  getMqttProbeService,
  type MqttProbeError,
  type MqttProbeServiceLike,
} from '../internal/services/mqttProbeService';
import {
  getWizardSessionStore,
  type WizardMode,
  type WizardStep,
} from '../internal/ui/wizardSessionStore';
import {
  getInfluxProbeService,
  type InfluxProbeError,
  type InfluxProbeResult,
  type InfluxProbeServiceLike,
} from '../internal/services/influxProbeService';
import { AuthenticationStep } from './advanced/AuthenticationStep';
import {
  ConfigurationStepper,
  type StepperStepState,
} from './advanced/ConfigurationStepper';
import { CompletionStep } from './advanced/CompletionStep';
import type { ServiceDotStatus } from './advanced/ConnectionStatusBadge';
import { InfluxDbStatusCard } from './advanced/InfluxDbStatusCard';
import { MqttStatusCard, type MqttCardState } from './advanced/MqttStatusCard';
import { RuntimeRecoveryNotice } from './advanced/RuntimeRecoveryNotice';
import { ServerDiscoveryStep } from './advanced/ServerDiscoveryStep';

/**
 * How long the amber "in progress" action flag stays lit after a MQTT
 * retry tap (the status dot itself keeps following the LIVE connection
 * state). Exported for timer-lifecycle tests.
 */
export const RETRY_FLAG_RESET_MS = 1500;

interface AdvancedSettingsScreenProps {
  /** Navigate back to the Settings root. */
  readonly onBack: () => void;
  /** Current draft settings (from the store). */
  readonly settings: AppSettings;
  /**
   * The last-PERSISTED MQTT configuration — what the live telemetry
   * client actually connects to (the MQTT status card describes THIS,
   * never the draft). Falls back to the draft when absent (compatibility
   * for callers that predate the visibility rule).
   */
  readonly persistedMqtt?: AppSettings['mqtt'];
  /**
   * The last-PERSISTED InfluxDB configuration — the exact target the raw
   * history adapter (and therefore the explicit probe) queries. Probe
   * results are fingerprinted against this config (fix cycle 2).
   */
  readonly persistedInflux: AppSettings['influx'];
  /** Field errors keyed by dotted path (e.g. `mqtt.host`). */
  readonly errors?: Record<string, string>;
  /** Update MQTT fields in the store (marks the MQTT status stale). */
  readonly onUpdateMqtt?: (patch: Partial<AppSettings['mqtt']>) => void;
  /** Update InfluxDB fields in the store (marks the Influx probe stale). */
  readonly onUpdateInflux?: (patch: Partial<AppSettings['influx']>) => void;
  /** Validate + persist the draft (forms stay open on failure). */
  readonly onSave: (
    settings: AppSettings,
  ) => Promise<{ ok: boolean; message: string }>;
  /** Live MQTT connection state (the real telemetry lifecycle). */
  readonly connectionState?: ConnectionState;
  /** Friendly cause of the last failed MQTT connection. */
  readonly lastErrorCode?: AppErrorCode | null;
  /** True when the MQTT draft differs from the persisted settings. */
  readonly mqttDirty: boolean;
  /** True when the Influx draft differs from the persisted settings. */
  readonly influxDirty: boolean;
  /** Retry the MQTT connection through the real service lifecycle. */
  readonly onMqttRetry?: () => void;
  /** Run the explicit one-shot Influx probe against the raw adapter. */
  readonly onCheckInflux?: () => Promise<'ok' | 'fail'>;
  /**
   * mDNS discovery service (settings-mdns-discovery): injected (tests) or
   * the real lazy singleton. Never used on web — the whole guided flow
   * is hidden there (Platform gate), so the zeroconf lib is never
   * constructed on the web path (AD-4).
   */
  readonly discoveryService?: MdnsDiscoveryServiceLike;
  /**
   * The one-shot MQTT probe service (D4): injected (tests) or the real
   * lazy singleton. The probe NEVER touches the shared telemetry client.
   */
  readonly mqttProbeService?: MqttProbeServiceLike;
  /**
   * The one-shot InfluxDB probe service (Amendment 1, A3): injected
   * (tests) or the real lazy singleton. Probes the DRAFT config via a
   * throwaway adapter — never the shared historyAdapter.
   */
  readonly influxProbeService?: InfluxProbeServiceLike;
}

/** Honest error string for a rejected credentials QR (keep verbatim). */
function qrErrorString(reason: SecretsQrParseError): string {
  switch (reason) {
    case 'unsupportedKind':
      return STRINGS.settings.qrErrorKind;
    case 'unsupportedVersion':
      return STRINGS.settings.qrErrorVersion;
    case 'empty':
      return STRINGS.settings.qrErrorEmpty;
    case 'malformed':
      return STRINGS.settings.qrErrorMalformed;
  }
}

/**
 * Friendly Vietnamese copy for a typed probe failure cause — shared by
 * BOTH probe halves (MQTT D4 / InfluxDB A3; the code unions align).
 */
function probeCauseString(
  code: 'auth' | 'timeout' | 'network' | 'transport',
): string {
  switch (code) {
    case 'auth':
      return STRINGS.settings.probeFailedAuth;
    case 'timeout':
      return STRINGS.settings.probeFailedTimeout;
    case 'network':
    case 'transport':
      return STRINGS.settings.probeFailedNetwork;
  }
}

/**
 * Sufficient InfluxDB target (branding… Amendment 3): all four fields
 * present. Takes the influx SECTION so it can gate on both the draft
 * (`settings.influx`) and the persisted target (`persistedInflux`) with
 * the same semantics.
 */
function influxConfigured(influx: AppSettings['influx']): boolean {
  return (
    influx.url.trim().length > 0 &&
    influx.org.trim().length > 0 &&
    influx.bucket.trim().length > 0 &&
    influx.token.trim().length > 0
  );
}

/**
 * The post-save status mode's `Chia sẻ cấu hình` payload
 * (dashboard-history-board-touch-share, AD-3): the PERSISTED MQTT broker
 * (host, WebSocket port, username, password) AND the persisted InfluxDB
 * target (URL, org, bucket, token). Unlike the board card's config share,
 * THIS one carries the Influx token — the user's explicit choice. The
 * text goes ONLY into the platform share sheet; it is never logged and
 * never rendered as screen text (the token in particular has no UI
 * surface). Empty optional fields stay empty — never substituted.
 */
export function buildStatusShareText(
  mqtt: AppSettings['mqtt'],
  influx: AppSettings['influx'],
): string {
  const lines = [
    STRINGS.settings.shareConfigMqttHost.replace('{host}', mqtt.host),
    STRINGS.settings.shareConfigMqttPort.replace('{port}', String(mqtt.port)),
  ];
  if (mqtt.username) {
    lines.push(
      STRINGS.settings.shareConfigMqttUsername.replace(
        '{username}',
        mqtt.username,
      ),
    );
  }
  if (mqtt.password) {
    lines.push(
      STRINGS.settings.shareConfigMqttPassword.replace(
        '{password}',
        mqtt.password,
      ),
    );
  }
  lines.push(
    STRINGS.settings.shareConfigInfluxUrl.replace('{url}', influx.url),
    STRINGS.settings.shareConfigInfluxOrg.replace('{org}', influx.org),
    STRINGS.settings.shareConfigInfluxBucket.replace('{bucket}', influx.bucket),
    STRINGS.settings.shareConfigInfluxToken.replace('{token}', influx.token),
  );
  return lines.join('\n');
}

/**
 * The dedicated advanced configuration screen (MQTT + InfluxDB) — a thin
 * composition of the `ui/advanced/` components.
 */
export function AdvancedSettingsScreen({
  onBack,
  settings,
  persistedMqtt,
  persistedInflux,
  errors,
  onUpdateMqtt,
  onUpdateInflux,
  onSave,
  connectionState,
  lastErrorCode,
  mqttDirty,
  influxDirty,
  onMqttRetry,
  onCheckInflux,
  discoveryService,
  mqttProbeService,
  influxProbeService: influxProbeServiceProp,
}: AdvancedSettingsScreenProps) {
  const { tokens } = useTheme();
  const { feedback, exiting, show, clear } = useOperationFeedback();

  // Guided flow POSITION + MODE (advanced-settings-sequential-recovery):
  // `currentStep` + `savedOk` + `mode` live in the session-scoped wizard
  // store (module scope — they survive screen unmount/remount within the
  // app session; NOT persisted — an app restart resets to the
  // mount-resolve). The INITIAL position resolves once at mount: a stored
  // position/mode wins; otherwise a valid PERSISTED configuration opens
  // the post-save status mode and a first run opens setup (step by host
  // validity). There is deliberately NO broker-loss override — a runtime
  // failure never decides where the user is; it only surfaces recovery
  // actions. Afterwards the flow alone moves the position — every
  // transition writes the store.
  const [mountResolved] = useState<{
    step: WizardStep;
    mode: WizardMode;
  }>(() => {
    const persistedNow =
      (persistedMqtt ?? settings.mqtt).host.trim().length > 0 ||
      persistedInflux.url.trim().length > 0;
    const hostResolved: WizardStep =
      settings.mqtt.host.trim().length > 0 &&
      settings.mqtt.port >= 1 &&
      settings.mqtt.port <= 65535
        ? 2
        : 1;
    const stored = getWizardSessionStore().getState();
    if (stored.currentStep !== null || stored.mode !== null) {
      return {
        step: stored.currentStep ?? hostResolved,
        mode: stored.mode ?? (persistedNow ? 'status' : 'setup'),
      };
    }
    return {
      step: hostResolved,
      mode: persistedNow ? 'status' : 'setup',
    };
  });
  const storedStep = useStore(getWizardSessionStore(), s => s.currentStep);
  const savedOk = useStore(getWizardSessionStore(), s => s.savedOk);
  const storedMode = useStore(getWizardSessionStore(), s => s.mode);
  const currentStep = storedStep ?? mountResolved.step;
  const mode = storedMode ?? mountResolved.mode;
  const setStep = (step: WizardStep) => {
    getWizardSessionStore().getState().setStep(step);
  };
  const setSavedOk = (saved: boolean) => {
    getWizardSessionStore().getState().setSavedOk(saved);
  };
  const setMode = (nextMode: WizardMode) => {
    getWizardSessionStore().getState().setMode(nextMode);
  };
  const [saving, setSaving] = useState(false);
  /**
   * The LAST failed save's message (approved step-3 policy): rendered
   * near the save action, the primary button becomes `Thử lại`, and the
   * user stays on step 3 — never navigated backward by a failure.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  // The dual probe (D4 + Amendment 1 A3): loading, the typed MQTT
  // failure, the "broker needs no authentication" option, and the
  // InfluxDB half's honest state ('idle' = nothing to show yet).
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<MqttProbeError | null>(null);
  const [noAuth, setNoAuth] = useState(false);
  const [influxProbeState, setInfluxProbeState] = useState<
    'idle' | 'skipped' | 'checking' | 'ok' | 'failed'
  >('idle');
  const [influxProbeError, setInfluxProbeError] =
    useState<InfluxProbeError | null>(null);
  // The credentials QR scanner modal (settings-secrets-qr) + its
  // screen-owned display-only error.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [mqttChecking, setMqttChecking] = useState(false);
  /**
   * Last explicit Influx probe, bound to the exact configuration it tested
   * (fix cycle 2): `null` = never probed this session; the fingerprint is
   * captured from the persisted config when the probe STARTS, so a result
   * completing after an edit/save can never validate the new config.
   */
  const [influxProbe, setInfluxProbe] = useState<{
    result: 'ok' | 'fail';
    /** Fingerprint of the persisted Influx config the probe tested. */
    fingerprint: string;
  } | null>(null);
  const [influxChecking, setInfluxChecking] = useState(false);
  // Lifecycle-safe retry flag timer (fix cycle 1): the handle is stored and
  // cleared on retrigger AND on unmount so no state update can ever fire
  // after the screen is gone.
  const mqttCheckingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mount-alive guard (Amendment 3): the status auto-probe can be in
  // flight when the user leaves the Settings tab (ADR-018 unmount) — no
  // post-await state update may fire after teardown.
  const screenAliveRef = useRef(true);
  // AD-5 race guard: every probe START and every draft mutation / no-auth
  // toggle / user step transition bumps the epoch; a probe that settles
  // with a stale epoch DROPS its presentation entirely — a late success
  // can never unlock step 3 and a late failure can never overwrite the
  // current state. Probe cleanup stays mandatory on every exit path.
  const probeEpochRef = useRef(0);

  useEffect(() => {
    // Reset (not just initialize) so a StrictMode-style simulated
    // remount re-arms the guard.
    screenAliveRef.current = true;
    return () => {
      screenAliveRef.current = false;
      if (mqttCheckingTimer.current) {
        clearTimeout(mqttCheckingTimer.current);
        mqttCheckingTimer.current = null;
      }
    };
  }, []);

  // ---- Flow navigation (explicit only — never failure-driven) ----------
  // AD-5: any user transition or draft mutation invalidates in-flight and
  // settled probe presentation — the next forward gate must be earned
  // against the CURRENT draft.
  const invalidateProbes = () => {
    probeEpochRef.current += 1;
    setProbing(false);
    setProbeError(null);
    setInfluxProbeState('idle');
    setInfluxProbeError(null);
  };
  // The user-initiated step move (Tiếp tục, Quay lại, Chỉnh sửa xác
  // thực / máy chủ). Probe results are dropped and the step-3 save error
  // clears when leaving step 3 — re-entering step 3 always requires a
  // fresh successful probe.
  const goToStep = (step: WizardStep) => {
    invalidateProbes();
    setSaveError(null);
    setStep(step);
  };
  // `Cấu hình lại` — the ONLY path from status mode back to setup, and it
  // runs strictly on the user's press (also the unconfigured MQTT card's
  // `Cấu hình` action). Draft preserved; nothing auto-saved; the seal
  // unseals and all probe gates re-arm (returning to step 1 invalidates
  // the dependent probe results per AD-2/AD-5).
  const reconfigure = () => {
    invalidateProbes();
    setSaveError(null);
    setSavedOk(false);
    setStep(1);
    setMode('setup');
  };

  // Status-mode share (dashboard-history-board-touch-share): the
  // PERSISTED MQTT + InfluxDB values (including the token) go to the
  // platform share sheet. Never logged; cancel/failure changes nothing;
  // the payload is never rendered as screen text.
  const handleShareConfig = () => {
    void Share.share({
      message: buildStatusShareText(liveMqtt, persistedInflux),
    }).catch(() => undefined);
  };

  // Draft mutations (AD-5): any field edit invalidates probe results —
  // mDNS fill, QR fill, credential/host/prefix edits, no-auth-adjacent
  // influx edits all flow through these wrappers.
  const setMqtt = (patch: Partial<AppSettings['mqtt']>) => {
    probeEpochRef.current += 1;
    if (onUpdateMqtt) {
      onUpdateMqtt(patch);
    }
  };
  const setInflux = (patch: Partial<AppSettings['influx']>) => {
    probeEpochRef.current += 1;
    if (onUpdateInflux) {
      onUpdateInflux(patch);
    }
  };

  // mDNS discovery (settings-mdns-discovery): native-only. The service is
  // resolved once per mount; on web `discovery` stays null and the whole
  // guided flow is hidden — the zeroconf lib is never constructed there.
  const discovery = useMemo(
    () =>
      Platform.OS === 'web'
        ? null
        : discoveryService ?? getMdnsDiscoveryService(),
    [discoveryService],
  );
  // The one-shot MQTT probe service (D4): injected (tests) or the real
  // lazy singleton. The probe is one-shot and isolated from the telemetry
  // client; on web it refuses to run (typed transport error) — the flow
  // is hidden there anyway.
  const probeService = useMemo(
    () => mqttProbeService ?? getMqttProbeService(),
    [mqttProbeService],
  );
  // The one-shot InfluxDB probe service (A3): injected (tests) or the
  // real lazy singleton — a throwaway adapter per probe against the
  // DRAFT config; the shared historyAdapter is never touched.
  const influxProbeService = useMemo(
    () => influxProbeServiceProp ?? getInfluxProbeService(),
    [influxProbeServiceProp],
  );

  // ---- Visibility (mode model — supersedes the C1 tab rule) ------------
  // The status widgets live ONLY in the post-save status mode; the setup
  // mode NEVER renders them. Status content renders ⟺ the mode is
  // `status` AND a configuration has been PERSISTED (from the persisted
  // config props, NOT the dirty flags). First run (nothing persisted)
  // opens setup. Web (`discovery === null`) renders only the status
  // content (no wizard, no mode chrome).
  const liveMqtt = persistedMqtt ?? settings.mqtt;
  const hasPersistedConfig =
    liveMqtt.host.trim().length > 0 || persistedInflux.url.trim().length > 0;

  // ---- Save (the EXISTING path — the only save in the flow) ------------
  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await onSave(settings);
    setSaving(false);
    if (result.ok) {
      setSavedOk(true);
      // Mode transition (AD-7): a successful save ENTERS the post-save
      // status mode — no tab press, no fourth stepper level. The official
      // stepper keeps exactly three levels; the flow records all three
      // steps complete via the seal.
      setMode('status');
      // A3 post-save seeding: the step-2 dual probe's settled InfluxDB
      // result becomes the status card's last probe for THIS config —
      // draft === persisted at this instant, so the fingerprint matches
      // and the card shows the outcome instead of `Chưa kiểm tra`. NO
      // extra network call; the explicit manual `Kiểm tra` contract is
      // unchanged (the info box stays true).
      if (influxConfigured(settings.influx) && influxProbeState !== 'idle') {
        setInfluxProbe({
          result: influxProbeState === 'ok' ? 'ok' : 'fail',
          fingerprint: influxConfigFingerprint(settings.influx),
        });
      }
    } else {
      // Approved step-3 save-failure policy: STAY on step 3, keep the
      // candidate draft and validation errors, never navigate backward.
      // The retryable error renders near the save action (the primary
      // button becomes `Thử lại`); explicit `Chỉnh sửa xác thực` /
      // `Chỉnh sửa máy chủ` are the only manual ways back.
      setSaveError(result.message);
    }
    show({
      severity: result.ok ? 'success' : 'error',
      message: result.message,
    });
  };

  // ---- Dual probe (D4 MQTT gate + A3 InfluxDB half) --------------------
  const runDualProbe = async (): Promise<void> => {
    if (probing) {
      return; // no double-press
    }
    const epoch = ++probeEpochRef.current;
    const checkInflux = influxConfigured(settings.influx);
    setProbing(true);
    setProbeError(null);
    setInfluxProbeError(null);
    setInfluxProbeState(checkInflux ? 'checking' : 'skipped');
    const mqttPending = probeService.probe({
      host: settings.mqtt.host,
      port: settings.mqtt.port,
      // "Broker không yêu cầu xác thực" → connect WITHOUT credentials;
      // otherwise the draft's secrets, verbatim.
      ...(noAuth
        ? {}
        : {
            ...(settings.mqtt.username
              ? { username: settings.mqtt.username }
              : {}),
            ...(settings.mqtt.password
              ? { password: settings.mqtt.password }
              : {}),
          }),
    });
    // The InfluxDB half runs CONCURRENTLY against the DRAFT config (its
    // own throwaway adapter); `null` = insufficient draft → honest skip.
    const influxPending: Promise<InfluxProbeResult | null> = checkInflux
      ? influxProbeService.probe({
          url: settings.influx.url,
          org: settings.influx.org,
          bucket: settings.influx.bucket,
          token: settings.influx.token,
        })
      : Promise.resolve(null);
    const [mqttResult, influxResult] = await Promise.all([
      mqttPending,
      influxPending,
    ]);
    if (epoch !== probeEpochRef.current) {
      // Invalidated mid-flight (AD-5 — a draft edit, no-auth toggle, or
      // user step transition moved underneath us): the presentation is
      // DROPPED entirely. A late success can never unlock step 3 and a
      // late failure can never overwrite the current error state; the
      // loading flag still releases so the button never sticks.
      setProbing(false);
      return;
    }
    setProbing(false);
    // MQTT alone gates the auto-advance (unchanged); influx is
    // non-blocking and its settled result carries into step 3.
    if (mqttResult.ok) {
      setStep(3);
    } else {
      setProbeError(mqttResult.error);
    }
    if (influxResult === null) {
      setInfluxProbeState('skipped');
    } else if (influxResult.ok) {
      setInfluxProbeState('ok');
      setInfluxProbeError(null);
    } else {
      setInfluxProbeState('failed');
      setInfluxProbeError(influxResult.error);
    }
  };
  // Ref-mirror pattern (lint-clean): sync the LATEST probe closure in an
  // effect — refs are never written during render.
  const runDualProbeRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    runDualProbeRef.current = runDualProbe;
  });

  // ---- Real MQTT retry (status card + recovery notice) -----------------
  const handleMqttRetry = () => {
    if (!onMqttRetry || mqttChecking) {
      return;
    }
    // Real lifecycle only: the wired callback stops/starts the actual
    // telemetry service (shared client). The status dot follows the live
    // connection state (amber while reconnecting).
    setMqttChecking(true);
    onMqttRetry();
    // The connection state resolves asynchronously; release the amber
    // "in progress" flag after a short action window — the dot keeps
    // following the live state afterwards. The handle is stored (retrigger
    // + unmount clear it) so no setState can ever fire post-teardown.
    if (mqttCheckingTimer.current) {
      clearTimeout(mqttCheckingTimer.current);
    }
    mqttCheckingTimer.current = setTimeout(() => {
      mqttCheckingTimer.current = null;
      setMqttChecking(false);
    }, RETRY_FLAG_RESET_MS);
  };

  // ---- Explicit Influx probe (unchanged contract) ----------------------
  const handleInfluxCheck = async () => {
    if (!onCheckInflux || influxChecking) {
      return;
    }
    // Capture the target identity BEFORE the await: the raw adapter queries
    // the persisted config, so this is the exact configuration being
    // tested — an async completion after an edit/save stays attributed to
    // it (and therefore stale for any new config).
    const probedFingerprint = influxConfigFingerprint(persistedInflux);
    setInfluxChecking(true);
    setInfluxProbe(null);
    try {
      const outcome = await onCheckInflux();
      // Unmount guard (Amendment 3): the auto-probe (or a manual check)
      // may still be in flight when the screen tears down — drop the
      // presentation instead of setting state after unmount.
      if (!screenAliveRef.current) {
        return;
      }
      setInfluxProbe({ result: outcome, fingerprint: probedFingerprint });
      show({
        severity: outcome === 'ok' ? 'success' : 'error',
        message:
          outcome === 'ok'
            ? 'InfluxDB: kiểm tra thành công'
            : 'InfluxDB: kiểm tra thất bại',
      });
    } finally {
      if (screenAliveRef.current) {
        setInfluxChecking(false);
      }
    }
  };

  // ---- Status re-entry auto-probe (Amendment 3) ------------------------
  // A persisted world mounts in STATUS mode, and per ADR-018 leaving the
  // Settings tab unmounts this screen — so screen re-entry == a fresh
  // mount. When the persisted InfluxDB target is sufficient and no fresh
  // result exists for its fingerprint, the EXISTING `handleInfluxCheck`
  // runs EXACTLY ONCE per mount: the card no longer resets to `Chưa kiểm
  // tra` after tab navigation. The setup wizard never auto-probes here
  // (the step-2 dual probe owns that flow); the manual `Kiểm tra` button
  // contract is unchanged; post-save seeding (A3) is untouched.
  // Ref-mirror (lint-clean, same pattern as runDualProbeRef): the LATEST
  // mount-probe starter is synced every render and never invoked during
  // render — the mount-only effect below defers the call into a timer
  // callback (setState never runs synchronously in the effect body), and
  // the cleanup clears a STILL-PENDING timer (a scheduled auto-probe
  // never fires after teardown; the once-guard re-arms only when the
  // timer had not fired, so a StrictMode double-mount still probes once).
  const startStatusAutoProbeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    startStatusAutoProbeRef.current = () => {
      if (mode !== 'status' || !hasPersistedConfig) {
        return;
      }
      if (!influxConfigured(persistedInflux)) {
        return;
      }
      if (
        influxProbe !== null &&
        influxProbe.fingerprint === influxConfigFingerprint(persistedInflux)
      ) {
        return;
      }
      void handleInfluxCheck();
    };
  });
  const statusAutoProbeFiredRef = useRef(false);
  const statusAutoProbeTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    if (statusAutoProbeFiredRef.current) {
      return;
    }
    statusAutoProbeFiredRef.current = true;
    statusAutoProbeTimer.current = setTimeout(() => {
      statusAutoProbeTimer.current = null;
      startStatusAutoProbeRef.current();
    }, 0);
    return () => {
      if (statusAutoProbeTimer.current) {
        clearTimeout(statusAutoProbeTimer.current);
        statusAutoProbeTimer.current = null;
        statusAutoProbeFiredRef.current = false;
      }
    };
  }, []);

  // ---- Credentials QR fill (settings-secrets-qr, verbatim contract) ----
  const handleQrScanned = (raw: string): boolean => {
    const result = parseCredentialsQr(raw);
    if (!result.ok) {
      setQrError(qrErrorString(result.reason));
      return false;
    }
    const { credentials } = result;
    // Secrets (verbatim) + the six optional non-secret connection fields
    // (credentials-qr-nonsecret-fields / M27b) — all dispatched through
    // the EXISTING setMqtt/setInflux wrappers (which already invalidate
    // stale probes). Fill-never-save; absent/junk fields are structurally
    // absent from the patch, so they keep the current form values.
    if (credentials.mqttUsername !== undefined) {
      setMqtt({ username: credentials.mqttUsername });
    }
    if (credentials.mqttPassword !== undefined) {
      setMqtt({ password: credentials.mqttPassword });
    }
    if (credentials.influxToken !== undefined) {
      setInflux({ token: credentials.influxToken });
    }
    if (credentials.mqttHost !== undefined) {
      setMqtt({ host: credentials.mqttHost });
    }
    if (credentials.mqttPort !== undefined) {
      setMqtt({ port: credentials.mqttPort });
    }
    if (credentials.mqttPrefix !== undefined) {
      setMqtt({ prefix: credentials.mqttPrefix });
    }
    if (credentials.influxUrl !== undefined) {
      setInflux({ url: credentials.influxUrl });
    }
    if (credentials.influxOrg !== undefined) {
      setInflux({ org: credentials.influxOrg });
    }
    if (credentials.influxBucket !== undefined) {
      setInflux({ bucket: credentials.influxBucket });
    }
    setQrError(null);
    setScannerOpen(false);
    // Fill-never-save, no auto-probe, no auto-advance (AD-3): an accepted
    // QR ONLY fills the draft — the user stays on step 2 and the explicit
    // `Kiểm tra kết nối` gate remains the sole path to step 3.
    return true;
  };

  // ---- Stepper statuses (flow-driven, NOT freely switchable) -----------
  const step3Complete =
    currentStep === 3 && savedOk && !mqttDirty && !influxDirty;
  const stepStatuses: [StepperStepState, StepperStepState, StepperStepState] = [
    currentStep === 1 ? 'current' : 'completed',
    currentStep === 2 ? 'current' : currentStep > 2 ? 'completed' : 'upcoming',
    step3Complete ? 'completed' : currentStep === 3 ? 'current' : 'upcoming',
  ];

  // ---- MQTT status card (the REAL lifecycle, persisted target) ---------
  const mqttConfigured = liveMqtt.host.trim().length > 0;
  const mqttCardState: MqttCardState = !mqttConfigured
    ? 'unconfigured'
    : mqttChecking ||
      connectionState === 'connecting' ||
      connectionState === 'reconnecting'
    ? 'connecting'
    : connectionState === 'connected'
    ? 'connected'
    : connectionState === 'failed'
    ? 'failed'
    : // The live client is not connected to a configured broker (stopped /
      // backgrounded) — an honest "lost" state.
      'lost';
  const mqttDescription = !mqttConfigured
    ? STRINGS.settings.mqttNotConfigured
    : mqttCardState === 'connected'
    ? STRINGS.settings.mqttConnectedDesc
        .replace('{host}', liveMqtt.host)
        .replace('{port}', String(liveMqtt.port))
    : mqttCardState === 'connecting'
    ? STRINGS.settings.mqttConnectingDesc
        .replace('{host}', liveMqtt.host)
        .replace('{port}', String(liveMqtt.port))
    : mqttCardState === 'failed'
    ? lastErrorCode
      ? STRINGS.settings.mqttFailedDesc.replace(
          '{reason}',
          errorLabel(lastErrorCode),
        )
      : STRINGS.settings.mqttFailedDescNoReason
    : STRINGS.settings.mqttLostDesc;

  // ---- Setup-mode recovery notice (replaces the old auto-fallback) -----
  // A lost/degraded PERSISTED runtime connection is reported AT the
  // user's current official step — it NEVER resets the step/mode/draft
  // and never uses a timer to move the user (AD-4). Status mode reports
  // the same truth through the failed status card itself.
  const runtimeNotice: 'failed' | 'reconnecting' | null =
    mode === 'setup' &&
    hasPersistedConfig &&
    (connectionState === 'failed' || connectionState === 'reconnecting')
      ? connectionState
      : null;

  // Contextual step-3 edit (approved plan): `Chỉnh sửa máy chủ` is offered
  // only when the candidate server fields need changing — a save flagged a
  // server-field validation error. `Chỉnh sửa xác thực` is always offered.
  const serverNeedsEdit = Boolean(
    errors?.['mqtt.host'] || errors?.['mqtt.port'] || errors?.['mqtt.prefix'],
  );

  // ---- Influx status (last explicit probe only — unchanged) ------------
  const influxConfiguredFlag = influxConfigured(settings.influx);
  const probeFresh =
    influxProbe !== null &&
    influxProbe.fingerprint === influxConfigFingerprint(persistedInflux);
  const influxDot: ServiceDotStatus = influxChecking
    ? 'progress'
    : !influxConfiguredFlag
    ? 'gray'
    : influxDirty
    ? 'gray'
    : probeFresh && influxProbe.result === 'ok'
    ? 'healthy'
    : probeFresh && influxProbe.result === 'fail'
    ? 'failed'
    : 'gray';
  const influxStatusText = influxChecking
    ? STRINGS.settings.checking
    : !influxConfiguredFlag
    ? STRINGS.settings.influxNotConfigured
    : influxDirty
    ? STRINGS.settings.statusStale
    : probeFresh && influxProbe.result === 'ok'
    ? STRINGS.settings.success
    : probeFresh && influxProbe.result === 'fail'
    ? STRINGS.settings.failed
    : STRINGS.settings.statusUnknown;

  return (
    // The ambient Smart Home wash — same recipe as the Settings root.
    <LinearGradient
      colors={[
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.flex}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          {/* Title bar: back arrow + screen title (NO `Quay lại` text). */}
          <View style={styles.titleBar} testID="advanced-title-bar">
            <TouchableOpacity
              style={styles.backButton}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.settings.back}
              testID="advanced-settings-back"
            >
              <Ionicons name="arrow-back" size={22} color={tokens.primary} />
            </TouchableOpacity>
            <Text
              style={[
                styles.screenTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {STRINGS.settings.advancedTitle}
            </Text>
          </View>

          {discovery ? (
            mode === 'status' && hasPersistedConfig ? (
              <>
                {/* Trạng thái MODE (post-save; informally "step 4" in
                    product shorthand — NEVER a fourth stepper level and
                    NEVER a selectable tab): the two live widgets plus the
                    explicit `Cấu hình lại` entry. Entered by a successful
                    save or a persisted-config mount; left ONLY by the
                    user's press (draft kept, nothing auto-saved). */}
                <MqttStatusCard
                  state={mqttCardState}
                  description={mqttDescription}
                  authLabel={
                    (liveMqtt.username ?? '').length > 0
                      ? liveMqtt.username ?? ''
                      : STRINGS.settings.summaryNoAuth
                  }
                  onConfigure={
                    discovery
                      ? () => {
                          // The unconfigured card's `Cấu hình` action —
                          // an explicit setup entry (Step 1, draft kept).
                          reconfigure();
                        }
                      : undefined
                  }
                  onRetry={handleMqttRetry}
                />
                <Text
                  style={[
                    styles.groupTitle,
                    { color: tokens.smart.colors.textPrimary },
                  ]}
                  testID="advanced-influx-group-title"
                >
                  {STRINGS.settings.influxGroupTitle}
                </Text>
                <InfluxDbStatusCard
                  dot={influxDot}
                  statusText={influxStatusText}
                  configured={influxConfiguredFlag}
                  checking={influxChecking}
                  onCheck={() => {
                    void handleInfluxCheck();
                  }}
                  influx={settings.influx}
                  onPatch={setInflux}
                  errors={errors}
                />
                <TouchableOpacity
                  style={[
                    styles.shareConfigButton,
                    { borderColor: tokens.primary },
                  ]}
                  onPress={handleShareConfig}
                  accessibilityRole="button"
                  accessibilityLabel={STRINGS.settings.shareConfigAction}
                  testID="status-share-config"
                >
                  <Text
                    style={[styles.editConfigText, { color: tokens.primary }]}
                  >
                    {STRINGS.settings.shareConfigAction}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.editConfigButton,
                    { borderColor: tokens.primary },
                  ]}
                  onPress={reconfigure}
                  accessibilityRole="button"
                  accessibilityLabel={STRINGS.settings.reconfigureAction}
                  testID="status-edit-config"
                >
                  <Text
                    style={[styles.editConfigText, { color: tokens.primary }]}
                  >
                    {STRINGS.settings.reconfigureAction}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Setup MODE: the official three-step stepper — exactly
                    three levels, the only source of step truth. A degraded
                    PERSISTED runtime surfaces the recovery notice AT the
                    current step; it never moves the user (AD-4). */}
                {runtimeNotice ? (
                  <RuntimeRecoveryNotice
                    severity={runtimeNotice}
                    onRetry={handleMqttRetry}
                    onReconfigure={reconfigure}
                  />
                ) : null}
                {/* The MQTT progress stepper — flow-driven; step 3
                        turns teal only after a successful save. */}
                <ConfigurationStepper
                  steps={[
                    {
                      label: STRINGS.settings.stepServer,
                      state: stepStatuses[0],
                    },
                    {
                      label: STRINGS.settings.stepAuth,
                      state: stepStatuses[1],
                    },
                    {
                      label: STRINGS.settings.stepDone,
                      state: stepStatuses[2],
                    },
                  ]}
                />

                {/* The current step card (the wizard tab NEVER shows
                        the status widgets — C1 supersedes A4's position
                        rule). */}
                {currentStep === 1 ? (
                  <ServerDiscoveryStep
                    discoveryService={discovery}
                    host={settings.mqtt.host}
                    port={settings.mqtt.port}
                    prefix={settings.mqtt.prefix}
                    errors={errors}
                    onPatchMqtt={setMqtt}
                    onSelectServer={server => {
                      // Fill + advance (user-approved `ok` amendment):
                      // the non-secret mDNS patch reaches the draft
                      // (secrets are not part of the patch at all —
                      // contract type), then the flow IMMEDIATELY moves
                      // to Xác thực. Never saves, never probes;
                      // `goToStep` keeps its draft-invalidation
                      // behavior.
                      const patch = applyDiscoveredService(settings, server);
                      setMqtt(patch.mqtt);
                      setInflux(patch.influx);
                      goToStep(2);
                    }}
                    onContinue={() => goToStep(2)}
                  />
                ) : null}
                {currentStep === 2 ? (
                  <AuthenticationStep
                    username={settings.mqtt.username ?? ''}
                    password={settings.mqtt.password ?? ''}
                    hostValid={
                      settings.mqtt.host.trim().length > 0 &&
                      settings.mqtt.port >= 1 &&
                      settings.mqtt.port <= 65535
                    }
                    probing={probing}
                    probeErrorText={
                      probeError === null
                        ? null
                        : probeCauseString(probeError.code)
                    }
                    influxState={
                      influxProbeState === 'idle' ? 'skipped' : influxProbeState
                    }
                    influxResultText={
                      influxProbeState === 'idle'
                        ? null
                        : influxProbeState === 'skipped'
                        ? STRINGS.settings.influxProbeSkipped
                        : influxProbeState === 'checking'
                        ? STRINGS.settings.influxProbeChecking
                        : influxProbeState === 'ok'
                        ? STRINGS.settings.influxProbeOk
                        : influxProbeError === null
                        ? STRINGS.settings.influxProbeFailed
                        : `${
                            STRINGS.settings.influxProbeFailed
                          } — ${probeCauseString(influxProbeError.code)}`
                    }
                    noAuth={noAuth}
                    onToggleNoAuth={value => {
                      // A probe-relevant intent change (AD-5): invalidates
                      // any in-flight or settled probe result.
                      probeEpochRef.current += 1;
                      setNoAuth(value);
                    }}
                    onPatchMqtt={setMqtt}
                    // The InfluxDB DRAFT section (user request): the same
                    // draft the dual probe checks when sufficient; edits
                    // bump the probe epoch via setInflux (AD-5) and never
                    // save.
                    influx={settings.influx}
                    onPatchInflux={setInflux}
                    errors={errors}
                    onBack={() => goToStep(1)}
                    onProbe={() => {
                      void runDualProbe();
                    }}
                    onScanQr={() => setScannerOpen(true)}
                  />
                ) : null}
                {currentStep === 3 ? (
                  <CompletionStep
                    host={settings.mqtt.host}
                    port={settings.mqtt.port}
                    username={settings.mqtt.username ?? ''}
                    saving={saving}
                    influxState={
                      // Step 3 is only reachable after BOTH probes
                      // settled; the mapping is defensive (checking ≠
                      // possible here).
                      influxProbeState === 'ok'
                        ? 'ok'
                        : influxProbeState === 'failed'
                        ? 'failed'
                        : 'skipped'
                    }
                    saveError={saveError}
                    onSave={() => {
                      void handleSave();
                    }}
                    onEditAuth={() => {
                      // Explicit contextual edit (AD-2): returns to Step 2
                      // with the draft kept; the probe gate re-arms — a
                      // fresh successful `Kiểm tra kết nối` is required
                      // before Step 3 opens again. NEVER automatic.
                      goToStep(2);
                    }}
                    onEditServer={
                      // Contextual (approved plan): offered when the
                      // candidate server fields need changing — a save
                      // flagged a server-field validation error.
                      serverNeedsEdit
                        ? () => {
                            goToStep(1);
                          }
                        : undefined
                    }
                  />
                ) : null}
              </>
            )
          ) : (
            <>
              {/* Web (user decision 2a, C1 relocation): no wizard, no
                  segmented row — only the Trạng thái content. */}
              <Text
                style={[
                  styles.webHint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
                testID="setup-web-hint"
              >
                {STRINGS.settings.setupWebHint}
              </Text>
              {hasPersistedConfig ? (
                <>
                  <MqttStatusCard
                    state={mqttCardState}
                    description={mqttDescription}
                    authLabel={
                      (liveMqtt.username ?? '').length > 0
                        ? liveMqtt.username ?? ''
                        : STRINGS.settings.summaryNoAuth
                    }
                    onConfigure={undefined}
                    onRetry={handleMqttRetry}
                  />
                  <Text
                    style={[
                      styles.groupTitle,
                      { color: tokens.smart.colors.textPrimary },
                    ]}
                    testID="advanced-influx-group-title"
                  >
                    {STRINGS.settings.influxGroupTitle}
                  </Text>
                  <InfluxDbStatusCard
                    dot={influxDot}
                    statusText={influxStatusText}
                    configured={influxConfiguredFlag}
                    checking={influxChecking}
                    onCheck={() => {
                      void handleInfluxCheck();
                    }}
                    influx={settings.influx}
                    onPatch={setInflux}
                    errors={errors}
                  />
                </>
              ) : null}
            </>
          )}
        </ScrollView>

        {/* Credentials QR scanner (settings-secrets-qr, AD-3): the generic
            core/ui camera shell. The screen validates through
            `secretsQrContract` inside `onScanned` (true = accepted →
            fields filled, modal closed; false = rejected → camera stays
            live + the raw diagnostic shows in the modal). */}
        <QrScannerModal
          visible={scannerOpen}
          title={STRINGS.settings.qrScannerTitle}
          hint={STRINGS.settings.qrScannerHint}
          onClose={() => {
            setScannerOpen(false);
            setQrError(null);
          }}
          onScanned={handleQrScanned}
          lastError={qrError}
        />

        {/* Top-center operation feedback (field errors stay inline). */}
        <OperationBanner
          feedback={feedback}
          exiting={exiting}
          onDismiss={clear}
        />
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  groupTitle: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  // C2: the Trạng thái mode's reconfigure entry (`Cấu hình lại`).
  editConfigButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
  },
  // dashboard-history-board-touch-share: the status mode's additive
  // share entry — ≥44pt tall, same bordered style as `Cấu hình lại`.
  shareConfigButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
  },
  editConfigText: { fontSize: 14, fontWeight: '600' },
  webHint: { fontSize: 12, marginTop: 8, lineHeight: 18 },
});
