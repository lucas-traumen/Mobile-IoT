/**
 * ServerDiscoveryStep — step 1 (Máy chủ) of the guided MQTT configuration
 * flow (advanced-config-stepper-redesign).
 *
 * The card is user-trimmed SLIM (approved wireframes): title
 * `Tìm máy chủ MQTT` + one description line + the primary
 * `Tìm máy chủ trong mạng` action — NO manual inputs, NO divider, NO
 * `Tiếp tục` in the default view.
 *
 * D1: the mDNS scan renders INLINE in this card (the centered modal of
 * advanced-mdns-modal-layout is retired). The scan lifecycle, the
 * {@link MdnsDiscoveryServiceLike} seam, the typed results and the honest
 * none-vs-error distinction of the crash-fix task carry over VERBATIM:
 * - idle → scanning (the button becomes the honest loading label;
 *   duplicate presses are disabled);
 * - results → one row per server (name, host:port) with a
 *   `Chọn máy chủ này` action → {@link ServerDiscoveryStepProps.onSelectServer}
 *   (the screen applies the existing `applyDiscoveredService` patch and
 *   auto-advances — never saves, never touches secrets);
 * - none (honest empty scan) vs error (typed scan failure) stay DISTINCT
 *   honest states, both offering `Thử lại` + the `Nhập tay địa chỉ`
 *   fallback link (user decision 1b);
 * - unmount stops the live session; no state update ever fires after
 *   teardown (the freeze-before-stop late-result guard).
 *
 * The manual fallback (hidden until the link is tapped) reveals exactly
 * three inputs — host / port (default 9001) / prefix (D5: the prefix lives
 * ONLY here; mDNS fills it automatically on select) — with `Quay lại tìm`
 * and a `Tiếp tục` gated by the settings schema's own host/port rules (zod
 * is the single validation authority). Edits go through
 * {@link ServerDiscoveryStepProps.onPatchMqtt} (the store draft) and never
 * save.
 *
 * Forward flow (advanced-settings-sequential-recovery; `ok` amendment):
 * a mDNS selection fills the draft and the SCREEN immediately advances
 * to step 2 — this component only emits `onSelectServer`; the step
 * transition is screen-owned. The explicit `Tiếp tục` (rendered
 * whenever the draft host/port is valid — e.g. when returning to this
 * step with a valid draft) remains the forward action out of the
 * default view, and the manual fallback's `Tiếp tục` keeps the same zod
 * gate.
 *
 * Web: the screen hides the whole flow (user decision 2a) and passes
 * `null` — this component renders nothing without a service (defense in
 * depth; the zeroconf lib is never constructed on the web path).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import type { DiscoveredServer } from '../../internal/domain/mdnsDiscoveryContract';
import { MqttSettingsSchema } from '../../internal/domain/settingsSchema';
import {
  type MdnsDiscoveryServiceLike,
  type MdnsScanSession,
} from '../../internal/services/mdnsDiscoveryService';
import { FieldRow } from './FieldRow';

export interface ServerDiscoveryStepProps {
  /**
   * mDNS discovery service (injected by the screen; `null` = web — the
   * component renders nothing there).
   */
  readonly discoveryService: MdnsDiscoveryServiceLike | null;
  /** Draft MQTT host (the manual fallback edits it). */
  readonly host: string;
  /** Draft MQTT WS port (the manual fallback edits it). */
  readonly port: number;
  /** Draft topic prefix (the manual fallback edits it — D5). */
  readonly prefix: string;
  /** Field errors keyed by dotted path (e.g. `mqtt.host`). */
  readonly errors?: Record<string, string>;
  /** Update MQTT fields in the store draft (never saves). */
  readonly onPatchMqtt: (patch: {
    host?: string;
    port?: number;
    prefix?: string;
  }) => void;
  /** A discovered server was chosen — the screen fills the draft and
   *  advances to step 2 (screen-owned; NO save, NO probe). */
  readonly onSelectServer: (server: DiscoveredServer) => void;
  /** `Tiếp tục` — the explicit forward gate; the screen advances to step 2. */
  readonly onContinue: () => void;
}

export function ServerDiscoveryStep({
  discoveryService,
  host,
  port,
  prefix,
  errors,
  onPatchMqtt,
  onSelectServer,
  onContinue,
}: ServerDiscoveryStepProps) {
  const { tokens } = useTheme();
  const [scanState, setScanState] = useState<
    'idle' | 'scanning' | 'results' | 'none' | 'error'
  >('idle');
  const [results, setResults] = useState<readonly DiscoveredServer[]>([]);
  // The hidden manual fallback (user decision 1b): revealed from the
  // none/error state's link, hidden again by `Quay lại tìm`.
  const [manualRevealed, setManualRevealed] = useState(false);
  const scanSessionRef = useRef<MdnsScanSession | null>(null);
  const scanAliveRef = useRef(false);

  // Unmount while a scan is live: end the session (the service cleans up
  // on every exit path) and freeze further state updates — the exact
  // lifecycle the screen owned for the modal, moved inline with the card.
  useEffect(() => {
    return () => {
      scanAliveRef.current = false;
      scanSessionRef.current?.stop();
      scanSessionRef.current = null;
    };
  }, []);

  if (!discoveryService) {
    return null; // web: the flow is hidden (user decision 2a)
  }

  const handleScan = () => {
    if (scanState === 'scanning') {
      return; // no scan spam — the button is also disabled
    }
    setScanState('scanning');
    setResults([]);
    scanAliveRef.current = true;
    scanSessionRef.current = discoveryService.startScan(result => {
      scanSessionRef.current = null;
      if (!scanAliveRef.current) {
        return; // unmounted mid-scan — never setState post-teardown
      }
      if (result.ok) {
        setResults(result.value);
        setScanState(result.value.length > 0 ? 'results' : 'none');
      } else {
        setResults([]);
        // Typed scan error ('transport' | 'unavailable') gets its OWN
        // honest state — a crashed scanner must not masquerade as an
        // honest empty scan (mdns-android-multicastlock-crash).
        setScanState('error');
      }
    });
  };

  // The forward gate — the settings schema is the single validation
  // authority (the same zod rules the save path enforces). Shared by the
  // default view's `Tiếp tục` (after a mDNS selection fills the draft, or
  // when returning with a valid draft) and the manual fallback's button.
  const hostValid =
    host.trim().length > 0 &&
    MqttSettingsSchema.shape.port.safeParse(port).success;

  const inputStyle = [
    styles.input,
    {
      backgroundColor: tokens.smart.colors.card,
      borderColor: tokens.smart.colors.cardBorder,
      color: tokens.smart.colors.textPrimary,
    },
  ];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
          borderRadius: tokens.smart.radius.card,
        },
        tokens.smart.cardShadow,
      ]}
      testID="advanced-step-server"
    >
      <Text
        style={[styles.cardTitle, { color: tokens.smart.colors.textPrimary }]}
      >
        {STRINGS.settings.findServerTitle}
      </Text>
      <Text
        style={[styles.cardDesc, { color: tokens.smart.colors.textSecondary }]}
      >
        {STRINGS.settings.findServerDescription}
      </Text>

      {!manualRevealed ? (
        <>
          {/* The single scan/retry action — disabled WITH the honest
              progress label while scanning; it turns into `Thử lại` in the
              none AND error states; hidden in the results state (the rows
              are the action there). */}
          {scanState !== 'results' ? (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: tokens.primary },
                scanState === 'scanning' && styles.buttonDisabled,
              ]}
              onPress={handleScan}
              disabled={scanState === 'scanning'}
              accessibilityRole="button"
              accessibilityLabel={
                scanState === 'none' || scanState === 'error'
                  ? STRINGS.settings.findServerRetry
                  : STRINGS.settings.findServer
              }
              testID="advanced-mdns-scan-start"
            >
              <Text
                style={[styles.primaryButtonText, { color: tokens.onPrimary }]}
              >
                {scanState === 'scanning'
                  ? STRINGS.settings.findServerScanning
                  : scanState === 'none' || scanState === 'error'
                  ? STRINGS.settings.findServerRetry
                  : STRINGS.settings.findServer}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Honest empty scan — plus the same-LAN checklist hint. */}
          {scanState === 'none' ? (
            <View testID="advanced-mdns-none">
              <Text
                style={[
                  styles.stateText,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.settings.findServerNone}
              </Text>
              <Text
                style={[
                  styles.stateText,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.settings.findServerNoneHint}
              </Text>
            </View>
          ) : null}

          {/* Typed scan error — DISTINCT from the empty scan above
              (mdns-android-multicastlock-crash). */}
          {scanState === 'error' ? (
            <View testID="advanced-mdns-error">
              <Text
                style={[
                  styles.stateText,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.settings.findServerErrorTitle}
              </Text>
              <Text
                style={[
                  styles.stateText,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.settings.findServerErrorHint}
              </Text>
            </View>
          ) : null}

          {/* Inline result rows: name + host:port + the choose action.
              Selecting applies the existing non-secret patch; the SCREEN
              then advances to step 2 (never a save, never a probe). */}
          {scanState === 'results' ? (
            <View>
              <Text
                style={[
                  styles.stateText,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.settings.findServerResultsLabel}
              </Text>
              {results.map((server, index) => (
                <View
                  key={`${server.name}|${server.host}|${server.port}`}
                  style={[
                    styles.resultRow,
                    { borderColor: tokens.smart.colors.cardBorder },
                  ]}
                  testID={`advanced-mdns-result-${index}`}
                >
                  <View style={styles.resultText}>
                    <Text
                      testID={`advanced-mdns-result-name-${index}`}
                      style={[
                        styles.resultName,
                        { color: tokens.smart.colors.textPrimary },
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {server.name}
                    </Text>
                    <Text
                      testID={`advanced-mdns-result-meta-${index}`}
                      style={[
                        styles.stateText,
                        { color: tokens.smart.colors.textSecondary },
                      ]}
                    >
                      {server.host}:{server.port}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.chooseButton,
                      { borderColor: tokens.primary },
                    ]}
                    onPress={() => onSelectServer(server)}
                    accessibilityRole="button"
                    accessibilityLabel={`${server.name}, ${server.host}:${server.port}, ${STRINGS.settings.chooseServer}`}
                    testID={`advanced-mdns-choose-${index}`}
                  >
                    <Text
                      style={[styles.chooseText, { color: tokens.primary }]}
                    >
                      {STRINGS.settings.chooseServer}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          {/* The explicit forward gate (AD-3): rendered whenever the draft
              host/port is valid — e.g. when returning to this step with a
              valid draft (a mDNS selection advances via the screen's own
              `goToStep`, so this gate mostly serves the return path).
              First run (empty host) keeps the approved slim card. */}
          {hostValid ? (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: tokens.primary },
              ]}
              onPress={onContinue}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.settings.continueManual}
              testID="setup-continue-server"
            >
              <Text
                style={[styles.primaryButtonText, { color: tokens.onPrimary }]}
              >
                {STRINGS.settings.continueManual}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* The hidden manual-address fallback (user decision 1b): an
              honest escape hatch when nothing is advertised — or when the
              scanner itself is broken. Never fills, never saves. */}
          {scanState === 'none' || scanState === 'error' ? (
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => setManualRevealed(true)}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.settings.setupManualAddressLink}
              testID="setup-manual-address-link"
            >
              <Text style={[styles.linkText, { color: tokens.primary }]}>
                {STRINGS.settings.setupManualAddressLink}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : (
        <View testID="setup-manual-address">
          <FieldRow
            label={STRINGS.settings.host}
            tokens={tokens}
            error={errors ? errors['mqtt.host'] : undefined}
          >
            <TextInput
              style={inputStyle}
              value={host}
              onChangeText={value => onPatchMqtt({ host: value })}
              placeholder="192.168.1.10"
              placeholderTextColor={tokens.smart.colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              testID="advanced-host-input"
            />
          </FieldRow>
          <FieldRow
            label={STRINGS.settings.port}
            tokens={tokens}
            error={errors ? errors['mqtt.port'] : undefined}
          >
            <TextInput
              style={inputStyle}
              value={String(port)}
              onChangeText={value => onPatchMqtt({ port: Number(value) || 0 })}
              placeholder="9001"
              placeholderTextColor={tokens.smart.colors.textSecondary}
              keyboardType="number-pad"
              testID="advanced-port-input"
            />
          </FieldRow>
          <FieldRow
            label={STRINGS.settings.prefix}
            tokens={tokens}
            error={errors ? errors['mqtt.prefix'] : undefined}
          >
            <TextInput
              style={inputStyle}
              value={prefix}
              onChangeText={value => onPatchMqtt({ prefix: value })}
              placeholder="home"
              placeholderTextColor={tokens.smart.colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              testID="advanced-prefix-input"
            />
          </FieldRow>
          <View style={styles.manualButtonsRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: tokens.primary }]}
              onPress={() => setManualRevealed(false)}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.settings.backToScan}
              testID="setup-back-to-scan"
            >
              <Text
                style={[styles.secondaryButtonText, { color: tokens.primary }]}
              >
                {STRINGS.settings.backToScan}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                styles.manualContinue,
                { backgroundColor: tokens.primary },
                !hostValid && styles.buttonDisabled,
              ]}
              onPress={onContinue}
              disabled={!hostValid}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.settings.continueManual}
              testID="setup-continue-manual"
            >
              <Text
                style={[styles.primaryButtonText, { color: tokens.onPrimary }]}
              >
                {STRINGS.settings.continueManual}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
    gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  cardDesc: { fontSize: 13, lineHeight: 18 },
  primaryButton: {
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  manualContinue: { flex: 1 },
  manualButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  stateText: { fontSize: 12, lineHeight: 17 },
  resultRow: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultText: { flex: 1, flexShrink: 1 },
  resultName: { fontSize: 14, fontWeight: '500' },
  chooseButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  chooseText: { fontSize: 13, fontWeight: '600' },
  linkButton: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  label: { fontSize: 13, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  error: { fontSize: 12, marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
});
