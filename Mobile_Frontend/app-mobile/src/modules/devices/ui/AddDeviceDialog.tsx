/**
 * Add-device / add-room centered dialogs (devices-add-device-dialog plan).
 *
 * The `Phòng & thiết bị` screen no longer hosts inline add-form cards at the
 * bottom of its lists: creating a sensor, a relay, or a room happens inside a
 * small centered dialog (RN `Modal` + fade) over a scrim covering the content
 * behind.
 *
 * - `AddDeviceDialog`: contextual sensor or relay creation; the sensor body
 *   keeps the data-channel picker; the curated custom-metric
 *   creation (`CustomMetricForm`) is a dedicated secondary STEP inside the same
 *   dialog — entering it hides the main form (Tên, data-channel chips,
 *   footer), switches the title and offers a `‹ Quay lại` affordance that
 *   returns WITHOUT losing the main form's state. The relay body keeps the
 *   free room-scoped slot picker. The availability math (taken fields /
 *   free slots / room-full) moved here from the old section components —
 *   same inputs, same results.
 * - `AddRoomDialog`: name input only; the submit semantics (await the
 *   service → open the created room on success, banner + truthful error)
 *   stay owned by the screen via `onSubmitRoom`.
 *
 * Both dialogs share one shell recipe (scrim + centered smart card + header
 * ✕ + footer buttons) — the same recipe as the room-delete dialog in
 * `DevicesScreen`, deliberately duplicated instead of importing the
 * dashboard module's `ConfirmDialog` (module boundary law).
 *
 * Behavior contract (unchanged from the inline forms):
 * - submit callbacks flow down unchanged (`onAddDevice`, `onAddCapability`,
 *   the screen-owned room submit); success closes the dialog + banner,
 *   failure keeps it open with the truthful error inline.
 * - the parent mounts a dialog only while open → its state is fresh on
 *   every open; ✕ / scrim press / Android back close it with no side
 *   effects.
 */

import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';
import type {
  BoardInventoryEntry,
  CapabilityDef,
  Device,
  NewCapabilityInput,
  NewDeviceInput,
  Room,
} from '@modules/devices/api';
import { parseRelayChannel } from '@modules/relay/api';
import { ROOM_CODE_REGEX } from '../internal/domain/devices';
import {
  CAPABILITY_COLORS,
  CAPABILITY_ICON_GROUPS,
  type CapabilityPreset,
} from '../internal/domain/capabilityPresets';
import {
  CAPABILITY_KEY_REGEX,
  MAX_SENSORS_PER_ROOM,
  RELAY_CHANNELS,
  projectSensorRegistrations,
  relaySlotTakenInRoom,
  type RelayChannel,
} from '../internal/domain/devices';
import type {
  ActionOutcome,
  AddRoomOutcome,
  DevicesStyles,
} from './DevicesScreen';
import { sortBoardsOnlineFirst } from './BoardsScreen';

/** Map a wire `K<n>` channel label to its persisted numeric slot (or null). */
function parseRelayChannelValue(channel: string): RelayChannel | null {
  const parsed = parseRelayChannel(channel);
  return parsed.ok ? parsed.value : null;
}

interface DialogShellProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly closeTestID: string;
  readonly scrimTestID: string;
  readonly children: React.ReactNode;
  readonly footer: React.ReactNode;
  readonly styles: DevicesStyles;
}

/**
 * Shared centered-dialog shell (same recipe as the room-delete dialog in
 * `DevicesScreen`): Modal + fade over a scrim, centered smart card with a
 * header (title + ✕), a bounded scrollable body (the custom-metric
 * expansion can exceed small screens) and a fixed footer row. Android back
 * requests close it; the scrim Pressable sits UNDER the card so card taps
 * never close the dialog.
 */
function DialogShell({
  title,
  onClose,
  closeTestID,
  scrimTestID,
  children,
  footer,
  styles,
}: DialogShellProps) {
  const { tokens } = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalBackdrop}>
          {/* Scrim press closes; it sits UNDER the card (absolute fill), so
              taps on the card never close the dialog. Exposed to assistive
              tech as a labelled dismiss button (same label as the ✕). */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.devices.close}
            testID={scrimTestID}
          />
          <View
            style={[
              styles.modalCard,
              styles.dialogCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <View style={styles.dialogHeader}>
              <Text
                style={[
                  styles.modalTitle,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {title}
              </Text>
              <TouchableOpacity
                style={styles.dialogCloseButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={STRINGS.devices.close}
                testID={closeTestID}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={tokens.smart.colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.dialogScroll}
              contentContainerStyle={styles.dialogBody}
            >
              {children}
            </ScrollView>
            {/* The custom-metric step has no footer — the form owns its
                action (and the step's back affordance owns navigation). */}
            {footer ? <View style={styles.dialogFooter}>{footer}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface DialogFooterButtonProps {
  readonly label: string;
  /** Teal fill (Lưu) vs outline (Hủy). */
  readonly filled: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
  readonly styles: DevicesStyles;
}

/** Footer action: outline `Hủy` / teal-filled `Lưu`, side by side. */
function DialogFooterButton({
  label,
  filled,
  disabled = false,
  onPress,
  testID,
  styles,
}: DialogFooterButtonProps) {
  const { tokens } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.dialogFooterButton,
        filled
          ? {
              backgroundColor: tokens.primary,
              borderColor: tokens.primary,
            }
          : { borderColor: tokens.smart.colors.cardBorder },
        disabled && { opacity: 0.5 },
      ]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
    >
      <Text
        style={{
          color: filled ? tokens.onPrimary : tokens.smart.colors.textSecondary,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface AddDeviceDialogProps {
  readonly room: Room;
  readonly devices: readonly Device[];
  readonly capabilities: readonly CapabilityDef[];
  /**
   * Discovered boards (boards-topic-contract-v2): when the room is BOUND to
   * a board that has published a descriptor, the sensor metric choices come
   * from the descriptor fields and the relay slot choices from the
   * descriptor's K channels — descriptor-driven, never auto-creating
   * anything. Unbound rooms (and bound rooms without a descriptor yet) keep
   * the full catalog + slots 1..10 behavior. Optional.
   */
  readonly boards?: readonly BoardInventoryEntry[];
  /** The room-detail section that opened this contextual dialog. */
  readonly kind: 'sensor' | 'relay';
  /** Add a device (validated by the registry service) — unchanged. */
  readonly onAddDevice: (input: NewDeviceInput) => Promise<ActionOutcome>;
  /** Add a curated custom metric to the catalog — unchanged. */
  readonly onAddCapability: (
    input: NewCapabilityInput,
  ) => Promise<ActionOutcome>;
  readonly notifyOutcome: (outcome: ActionOutcome) => ActionOutcome;
  /** ✕ / scrim / Android back / successful submit. */
  readonly onClose: () => void;
  readonly styles: DevicesStyles;
}

/**
 * Contextual room-detail dialog for creating either one new sensor instance
 * or one new relay. The parent chooses the kind from the visible room
 * section, so this dialog never asks the user to choose sensor/relay again.
 * All add-form state lives HERE — the parent mounts it only while open, so
 * every open starts fresh.
 */
export function AddDeviceDialog({
  room,
  devices,
  capabilities,
  boards,
  kind,
  onAddDevice,
  onAddCapability,
  notifyOutcome,
  onClose,
  styles,
}: AddDeviceDialogProps) {
  const { tokens } = useTheme();
  // Sensor body state (moved from SensorsSection).
  const [name, setName] = useState('');
  const [field, setField] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showCustomMetric, setShowCustomMetric] = useState(false);
  const [customMetricKey, setCustomMetricKey] = useState<string | null>(null);
  const [sensorSubmitting, setSensorSubmitting] = useState(false);
  const sensorSubmittingRef = useRef(false);
  const relaySubmittingRef = useRef(false);

  // Relay body state (moved from ControlsSection). The slot is a typed
  // hardware channel (1..10) — no numeric assertions needed downstream.
  const [relayName, setRelayName] = useState('');
  const [slot, setSlot] = useState<RelayChannel | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [relaySubmitting, setRelaySubmitting] = useState(false);

  // Descriptor-driven choices (boards-topic-contract-v2): when the room is
  // bound to a board WITH a descriptor, the wire declares what exists.
  const boundDescriptor =
    room.code !== undefined
      ? boards?.find(board => board.code === room.code)?.descriptor
      : undefined;

  // Available metric choices: sensor-kind catalog fields not yet registered
  // in this room (duplicate/full choices are omitted with truthful copy).
  // For a descriptor-bound room the choices are the DESCRIPTOR's fields
  // (label from the capability catalog when the field matches, the raw
  // field name otherwise) filtered by the same not-taken rule — a declared
  // channel without data stays a valid choice, an undeclared field is
  // never offered.
  const registrations = projectSensorRegistrations(
    devices,
    capabilities,
  ).filter(registration => registration.roomId === room.id);
  const takenFields = new Set(registrations.map(entry => entry.field));
  const descriptorFields =
    boundDescriptor === undefined
      ? null
      : boundDescriptor.sensors
          .map(sensor => sensor.field)
          .filter((entry, index, all) => all.indexOf(entry) === index)
          .filter(entry => !takenFields.has(entry));
  const availableFields: readonly CapabilityDef[] =
    descriptorFields !== null
      ? descriptorFields.map(field => {
          const def = capabilities.find(
            candidate =>
              candidate.kind === 'sensor' && candidate.type === field,
          );
          return def ?? { type: field, label: field, kind: 'sensor' as const };
        })
      : capabilities
          .filter(def => def.kind === 'sensor')
          .filter(def => !takenFields.has(def.type));
  const roomFull = registrations.length >= MAX_SENSORS_PER_ROOM;

  // Free room-scoped relay channels (in-room take + global collision).
  const relays = devices.filter(
    device => device.roomId === room.id && device.binding.kind === 'relay',
  );
  const takenSlots = new Set<RelayChannel>(
    relays.flatMap(device =>
      device.binding.kind === 'relay' ? [device.binding.index] : [],
    ),
  );
  // Descriptor-declared K channels (∩ free slots) for a bound room; the
  // full 1..10 range otherwise (the persisted slot model stays 1..10).
  const declaredSlots: readonly RelayChannel[] | null =
    boundDescriptor === undefined
      ? null
      : boundDescriptor.relays
          .map(channel => parseRelayChannelValue(channel))
          .filter((slot): slot is RelayChannel => slot !== null);
  const slotPool: readonly RelayChannel[] = declaredSlots ?? RELAY_CHANNELS;
  const freeSlots: readonly RelayChannel[] = slotPool
    .filter(candidate => !takenSlots.has(candidate))
    .filter(candidate => !relaySlotTakenInRoom(devices, room.id, candidate));

  const submitSensor = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError(STRINGS.devices.sensorNameRequired);
      return;
    }
    if (!field) {
      setFormError(STRINGS.devices.requiredField);
      return;
    }
    if (sensorSubmittingRef.current) {
      return;
    }
    sensorSubmittingRef.current = true;
    setSensorSubmitting(true);
    setFormError(null);
    const result = await onAddDevice({
      name: trimmedName,
      roomId: room.id,
      type: 'sensor',
      capabilities: [field],
      binding: { kind: 'telemetry-sensor' },
    });
    if (!result.ok) {
      // Keep the dialog open; surface the truthful error inside it.
      sensorSubmittingRef.current = false;
      setSensorSubmitting(false);
      setFormError(result.message || 'Lỗi');
      notifyOutcome(result);
      return;
    }
    notifyOutcome({ ok: true, message: STRINGS.devices.sensorCreated });
    onClose();
  };

  const submitRelay = async () => {
    if (slot === null) {
      setRelayError(STRINGS.devices.requiredField);
      return;
    }
    if (relaySubmittingRef.current) {
      return;
    }
    relaySubmittingRef.current = true;
    setRelaySubmitting(true);
    setRelayError(null);
    const result = await onAddDevice({
      name: relayName.trim() || `Rơ le ${slot}`,
      roomId: room.id,
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: slot },
    });
    if (!result.ok) {
      relaySubmittingRef.current = false;
      setRelaySubmitting(false);
      setRelayError(result.message || 'Lỗi');
      notifyOutcome(result);
      return;
    }
    notifyOutcome({ ok: true, message: STRINGS.devices.addRelay });
    onClose();
  };

  const selectField = (selectedField: string) => {
    const hasCatalogMetadata = capabilities.some(
      candidate =>
        candidate.kind === 'sensor' && candidate.type === selectedField,
    );
    if (boundDescriptor !== undefined && !hasCatalogMetadata) {
      setCustomMetricKey(selectedField);
      setShowCustomMetric(true);
      return;
    }
    setField(selectedField);
  };

  return (
    <DialogShell
      title={
        showCustomMetric
          ? STRINGS.devices.customMetric
          : kind === 'sensor'
          ? STRINGS.devices.createSensor
          : STRINGS.devices.createRelay
      }
      onClose={onClose}
      closeTestID="devices-add-device-close"
      scrimTestID="devices-add-device-scrim"
      styles={styles}
      footer={
        showCustomMetric ? null : kind === 'sensor' ? (
          <>
            <DialogFooterButton
              label={STRINGS.devices.cancel}
              filled={false}
              onPress={onClose}
              styles={styles}
            />
            <DialogFooterButton
              label={STRINGS.devices.createSensor}
              filled
              disabled={
                roomFull ||
                !field ||
                name.trim().length === 0 ||
                sensorSubmitting
              }
              onPress={() => {
                void submitSensor();
              }}
              testID="devices-add-sensor-submit"
              styles={styles}
            />
          </>
        ) : (
          <>
            <DialogFooterButton
              label={STRINGS.devices.cancel}
              filled={false}
              onPress={onClose}
              styles={styles}
            />
            <DialogFooterButton
              label={STRINGS.devices.createRelay}
              filled
              disabled={slot === null || relaySubmitting}
              onPress={() => {
                void submitRelay();
              }}
              testID="devices-add-relay-submit"
              styles={styles}
            />
          </>
        )
      }
    >
      {showCustomMetric ? (
        <>
          {/* The curated creation is a STEP, not an inline expansion: the
              main add-device form (Tên, data-channel chips, footer) is hidden
              and the title switches (approved user-acceptance mockup). */}
          <TouchableOpacity
            onPress={() => setShowCustomMetric(false)}
            testID="devices-custom-metric-back"
          >
            <Text style={{ color: tokens.primary, marginBottom: 8 }}>
              {`‹ ${STRINGS.settings.back}`}
            </Text>
          </TouchableOpacity>
          <CustomMetricForm
            capabilities={capabilities}
            initialKey={customMetricKey ?? undefined}
            lockedKey={customMetricKey ?? undefined}
            styles={styles}
            onAdd={onAddCapability}
            onCreated={createdType => {
              setField(createdType);
              setCustomMetricKey(null);
              setShowCustomMetric(false);
            }}
          />
        </>
      ) : (
        <>
          {kind === 'sensor' ? (
            <>
              <Text
                style={[
                  styles.label,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.devices.sensorName}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: tokens.smart.colors.card,
                    borderColor: tokens.smart.colors.cardBorder,
                    color: tokens.smart.colors.textPrimary,
                  },
                ]}
                value={name}
                onChangeText={setName}
                placeholder={STRINGS.devices.sensorNamePlaceholder}
                placeholderTextColor={tokens.smart.colors.textSecondary}
                testID="devices-add-sensor-name"
              />
              <Text
                style={[
                  styles.label,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.devices.dataChannel}
              </Text>
              <Text
                style={[
                  styles.hint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.devices.dataChannelHint}
              </Text>
              {roomFull ? (
                <Text
                  style={[
                    styles.hint,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.devices.roomSensorFull}
                </Text>
              ) : availableFields.length === 0 ? (
                <Text
                  style={[
                    styles.hint,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.devices.noChannelAvailable}
                </Text>
              ) : (
                <View style={styles.pickerRow}>
                  {availableFields.map(def => (
                    <TouchableOpacity
                      key={def.type}
                      style={[
                        styles.pickerChip,
                        {
                          borderColor:
                            field === def.type
                              ? tokens.primary
                              : tokens.smart.colors.cardBorder,
                        },
                        field === def.type
                          ? { backgroundColor: tokens.smart.colors.tealTint }
                          : // Unselected chips dim (consistent with the
                            // custom-metric step's chips).
                            { opacity: 0.4 },
                      ]}
                      hitSlop={{ top: 4, bottom: 4 }}
                      onPress={() => selectField(def.type)}
                      testID={`devices-field-${def.type}`}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: tokens.smart.colors.textPrimary },
                        ]}
                      >
                        {def.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {formError ? (
                <Text style={[styles.errorText, { color: tokens.danger }]}>
                  {formError}
                </Text>
              ) : null}
              {/* Secondary curated custom-metric creation (NOT a primary tab):
              entering the dedicated step keeps this form's state alive. */}
              {boundDescriptor === undefined ? (
                <TouchableOpacity
                  onPress={() => {
                    setCustomMetricKey(null);
                    setShowCustomMetric(true);
                  }}
                  testID="devices-custom-metric-toggle"
                >
                  <Text style={{ color: tokens.primary, marginTop: 8 }}>
                    {STRINGS.devices.customMetric}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.label,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.devices.name}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: tokens.smart.colors.card,
                    borderColor: tokens.smart.colors.cardBorder,
                    color: tokens.smart.colors.textPrimary,
                  },
                ]}
                value={relayName}
                onChangeText={setRelayName}
                placeholder="Đèn"
                placeholderTextColor={tokens.smart.colors.textSecondary}
                testID="devices-add-relay-name"
              />
              <Text
                style={[
                  styles.label,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {STRINGS.devices.chooseSlot}
              </Text>
              <View style={styles.pickerRow}>
                {freeSlots.map(candidate => (
                  <TouchableOpacity
                    key={candidate}
                    style={[
                      styles.pickerChip,
                      {
                        borderColor:
                          slot === candidate
                            ? tokens.primary
                            : tokens.smart.colors.cardBorder,
                      },
                      slot === candidate
                        ? { backgroundColor: tokens.smart.colors.tealTint }
                        : // Unselected chips dim (consistent with the
                          // custom-metric step's chips).
                          { opacity: 0.4 },
                    ]}
                    hitSlop={{ top: 4, bottom: 4 }}
                    onPress={() => setSlot(candidate)}
                    testID={`devices-slot-${candidate}`}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: tokens.smart.colors.textPrimary },
                      ]}
                    >
                      {candidate}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {relayError ? (
                <Text style={[styles.errorText, { color: tokens.danger }]}>
                  {relayError}
                </Text>
              ) : null}
            </>
          )}
        </>
      )}
    </DialogShell>
  );
}

/**
 * The `Nhập mã khác` chip of the board-pick step: highlighted while the
 * manual input is open. Rendered UNCONDITIONALLY so the manual fallback
 * stays reachable with an empty inventory or all boards assigned (plan
 * item 11).
 */
function ManualCodeToggle({
  manualOpen,
  onOpen,
  styles,
}: {
  readonly manualOpen: boolean;
  readonly onOpen: () => void;
  readonly styles: DevicesStyles;
}) {
  const { tokens } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.pickerChip,
        {
          borderColor: manualOpen
            ? tokens.primary
            : tokens.smart.colors.cardBorder,
        },
      ]}
      onPress={onOpen}
      testID="devices-add-room-manual-toggle"
    >
      <Text
        style={[styles.chipText, { color: tokens.smart.colors.textPrimary }]}
      >
        {STRINGS.boards.manualCode}
      </Text>
    </TouchableOpacity>
  );
}

interface AddRoomDialogProps {
  /** Screen-owned submit (await → open created room on success). */
  readonly onSubmitRoom: (
    name: string,
    code?: string,
  ) => Promise<AddRoomOutcome>;
  /** Successful submit closes the dialog; failure keeps it open. */
  readonly onClose: () => void;
  readonly styles: DevicesStyles;
  /** All rooms (board-code availability checks for the manual entry). */
  readonly rooms?: readonly Room[];
  /**
   * Discovered boards (board-discovery-binding): the pick step lists the
   * UNASSIGNED ones (online first); picking one binds the created room to
   * it. Optional — when absent/empty the dialog stays name-only.
   */
  readonly boards?: readonly BoardInventoryEntry[];
}

/**
 * The `＋ Thêm phòng` dialog: name input + the board-pick step
 * (board-discovery-binding) — unassigned boards (online first) as
 * selectable chips, plus a `Nhập mã khác` manual entry validated against
 * the code format and the already-bound codes. Submitting without a
 * selection creates an unbound room (the exact pre-binding behavior).
 * Draft/error/saving state moved here from the screen; the outcome
 * semantics (success banner + open the created room, truthful failure)
 * stay in the screen's `onSubmitRoom`.
 */
export function AddRoomDialog({
  onSubmitRoom,
  onClose,
  styles,
  rooms = [],
  boards,
}: AddRoomDialogProps) {
  const { tokens } = useTheme();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Board-pick step state: a picked board's code OR a manually entered one.
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const takenCodes = new Set(
    rooms.flatMap(room => (room.code ? [room.code] : [])),
  );
  // Only boards no room is bound to are pickable (online first); the manual
  // entry accepts any valid code not already taken.
  const availableBoards = sortBoardsOnlineFirst(
    (boards ?? []).filter(board => !takenCodes.has(board.code)),
  );
  const trimmedManual = manualCode.trim();
  const manualFormatValid = ROOM_CODE_REGEX.test(trimmedManual);
  const manualTaken = takenCodes.has(trimmedManual);

  const pickBoard = (code: string) => {
    setSelectedCode(current => (current === code ? null : code));
    setManualOpen(false);
    setManualCode('');
  };

  const openManual = () => {
    setManualOpen(true);
    setSelectedCode(null);
  };

  const resolvedCode = (): string | undefined => {
    if (manualOpen) {
      return trimmedManual.length > 0 ? trimmedManual : undefined;
    }
    return selectedCode ?? undefined;
  };

  const submit = async () => {
    const name = draft.trim();
    if (!name || saving) {
      return;
    }
    const code = resolvedCode();
    if (manualOpen && trimmedManual.length > 0) {
      if (!manualFormatValid) {
        setError(STRINGS.boards.codeFormat);
        return;
      }
      if (manualTaken) {
        setError(STRINGS.boards.codeTaken);
        return;
      }
    }
    setError(null);
    setSaving(true);
    const result = await onSubmitRoom(name, code);
    setSaving(false);
    if (!result.ok) {
      // Keep the draft so the user can retry; surface the service error.
      setError(result.message);
      return;
    }
    onClose();
  };

  return (
    <DialogShell
      title={STRINGS.devices.addRoom}
      onClose={onClose}
      closeTestID="devices-add-room-close"
      scrimTestID="devices-add-room-scrim"
      styles={styles}
      footer={
        <>
          <DialogFooterButton
            label={STRINGS.devices.cancel}
            filled={false}
            onPress={onClose}
            disabled={saving}
            styles={styles}
          />
          <DialogFooterButton
            label={STRINGS.devices.save}
            filled
            disabled={
              !draft.trim() ||
              saving ||
              (manualOpen &&
                trimmedManual.length > 0 &&
                (!manualFormatValid || manualTaken))
            }
            onPress={() => {
              void submit();
            }}
            testID="devices-add-room-submit"
            styles={styles}
          />
        </>
      }
    >
      <Text
        style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
      >
        {STRINGS.devices.roomName}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: tokens.smart.colors.card,
            borderColor: tokens.smart.colors.cardBorder,
            color: tokens.smart.colors.textPrimary,
          },
        ]}
        value={draft}
        onChangeText={setDraft}
        placeholder={STRINGS.devices.roomName}
        placeholderTextColor={tokens.smart.colors.textSecondary}
        testID="devices-add-room-input"
      />

      {/* Board-pick step (board-discovery-binding): pick a discovered
          board, enter another code manually, or skip → unbound room.
          The manual fallback stays reachable even when the inventory is
          empty or every board is already assigned (plan item 11). */}
      <>
        <Text
          style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
        >
          {STRINGS.boards.pickLabel}
        </Text>
        {availableBoards.length > 0 ? (
          <View style={styles.pickerRow}>
            {availableBoards.map(board => (
              <TouchableOpacity
                key={board.code}
                style={[
                  styles.pickerChip,
                  {
                    borderColor:
                      selectedCode === board.code && !manualOpen
                        ? tokens.primary
                        : tokens.smart.colors.cardBorder,
                  },
                  selectedCode === board.code && !manualOpen
                    ? { backgroundColor: tokens.smart.colors.tealTint }
                    : null,
                ]}
                onPress={() => pickBoard(board.code)}
                testID={`devices-add-room-board-${board.code}`}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: tokens.smart.colors.textPrimary },
                  ]}
                >
                  {/* Friendly descriptor displayName when the board
                      published one; the stable wire code stays the testID
                      and the submit identity. */}
                  {board.descriptor?.displayName ?? board.code}
                </Text>
              </TouchableOpacity>
            ))}
            <ManualCodeToggle
              manualOpen={manualOpen}
              onOpen={openManual}
              styles={styles}
            />
          </View>
        ) : (
          <View style={styles.pickerRow}>
            <ManualCodeToggle
              manualOpen={manualOpen}
              onOpen={openManual}
              styles={styles}
            />
          </View>
        )}
        <Text
          style={[styles.hint, { color: tokens.smart.colors.textSecondary }]}
        >
          {STRINGS.boards.pickHint}
        </Text>
      </>
      {manualOpen ? (
        <>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor:
                  trimmedManual.length > 0 && !manualFormatValid
                    ? tokens.danger
                    : tokens.smart.colors.cardBorder,
                color: tokens.smart.colors.textPrimary,
              },
            ]}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder={STRINGS.boards.manualCodePlaceholder}
            placeholderTextColor={tokens.smart.colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            testID="devices-add-room-manual-input"
          />
          <Text
            style={[styles.hint, { color: tokens.smart.colors.textSecondary }]}
          >
            {manualTaken
              ? STRINGS.boards.codeTaken
              : STRINGS.boards.manualCodeHint}
          </Text>
        </>
      ) : null}

      {error ? (
        <Text style={[styles.errorText, { color: tokens.danger }]}>
          {error}
        </Text>
      ) : null}
    </DialogShell>
  );
}

/**
 * Curated custom-metric creation (machine key immutable after creation;
 * presets fill key/label/unit — approved CP-R4 behavior). Moved verbatim
 * from `DevicesScreen` (its only consumer is the sensor dialog body).
 */
function CustomMetricForm({
  capabilities,
  initialKey,
  lockedKey,
  styles,
  onAdd,
  onCreated,
}: {
  capabilities: readonly CapabilityDef[];
  initialKey?: string;
  lockedKey?: string;
  styles: DevicesStyles;
  onAdd: (input: NewCapabilityInput) => Promise<ActionOutcome>;
  onCreated: (type: string) => void;
}) {
  const { tokens } = useTheme();
  const [capLabel, setCapLabel] = useState('');
  const [capUnit, setCapUnit] = useState('');
  const [capType, setCapType] = useState(initialKey ?? '');
  const [capIcon, setCapIcon] = useState<string>(
    CAPABILITY_ICON_GROUPS[0]?.icon ?? 'pulse-outline',
  );
  const [capColor, setCapColor] = useState<string>(CAPABILITY_COLORS[0]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const trimmedKey = capType.trim();
  const keyFormatValid = CAPABILITY_KEY_REGEX.test(trimmedKey);
  const keyTaken =
    trimmedKey.length > 0 && capabilities.some(def => def.type === trimmedKey);

  const applyPreset = (preset: CapabilityPreset) => {
    setCapType(preset.key);
    setCapLabel(preset.label);
    setCapUnit(preset.unit ?? '');
    setCapError(null);
  };

  const submit = async () => {
    const label = capLabel.trim();
    const type = capType.trim();
    setCapError(null);
    if (!label || !type) {
      setCapError(STRINGS.devices.requiredField);
      return;
    }
    if (!CAPABILITY_KEY_REGEX.test(type)) {
      setCapError(STRINGS.devices.capabilityKeyFormat);
      return;
    }
    if (lockedKey !== undefined && type !== lockedKey) {
      setCapError(STRINGS.devices.capabilityKeyLocked);
      return;
    }
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    const result = await onAdd({
      type,
      label,
      kind: 'sensor',
      unit: capUnit.trim() ? capUnit.trim() : undefined,
      icon: capIcon,
      color: capColor,
    });
    if (!result.ok) {
      submittingRef.current = false;
      setCapError(result.message);
      return;
    }
    onCreated(type);
  };

  const presets =
    lockedKey === undefined
      ? CAPABILITY_ICON_GROUPS.find(group => group.icon === activeGroup)
          ?.presets ?? []
      : [];

  // The DialogShell card is the surface now — no card-in-card wrapper.
  return (
    <>
      <Text
        style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
      >
        {STRINGS.devices.capabilityKeyLabel}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: tokens.smart.colors.card,
            borderColor:
              !keyFormatValid && trimmedKey
                ? tokens.danger
                : tokens.smart.colors.cardBorder,
            color: tokens.smart.colors.textPrimary,
          },
        ]}
        value={capType}
        onChangeText={t => {
          if (lockedKey !== undefined) {
            return;
          }
          setCapType(t);
          if (capError) {
            setCapError(null);
          }
        }}
        placeholder="pressure"
        editable={lockedKey === undefined}
        placeholderTextColor={tokens.smart.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        testID="capability-key-input"
      />
      {lockedKey !== undefined ? (
        <Text
          style={[styles.hint, { color: tokens.smart.colors.textSecondary }]}
        >
          {STRINGS.devices.capabilityKeyLocked}
        </Text>
      ) : null}
      {trimmedKey && !keyFormatValid ? (
        <Text style={[styles.errorText, { color: tokens.danger }]}>
          {STRINGS.devices.capabilityKeyFormat}
        </Text>
      ) : null}
      {keyTaken ? (
        <Text style={[styles.errorText, { color: tokens.danger }]}>
          {STRINGS.devices.capabilityKeyTaken}
        </Text>
      ) : null}
      {!trimmedKey ? (
        <Text
          style={[styles.hint, { color: tokens.smart.colors.textSecondary }]}
        >
          {STRINGS.devices.capabilityKeyHint}
        </Text>
      ) : null}

      <Text
        style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
      >
        {STRINGS.settings.capabilityLabel}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: tokens.smart.colors.card,
            borderColor: tokens.smart.colors.cardBorder,
            color: tokens.smart.colors.textPrimary,
          },
        ]}
        value={capLabel}
        onChangeText={setCapLabel}
        placeholder="Áp suất"
        placeholderTextColor={tokens.smart.colors.textSecondary}
        testID="capability-label-input"
      />

      <Text
        style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
      >
        {STRINGS.settings.capabilityUnit}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: tokens.smart.colors.card,
            borderColor: tokens.smart.colors.cardBorder,
            color: tokens.smart.colors.textPrimary,
          },
        ]}
        value={capUnit}
        onChangeText={setCapUnit}
        placeholder="hPa"
        placeholderTextColor={tokens.smart.colors.textSecondary}
      />

      <Text
        style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
      >
        {STRINGS.settings.capabilityIcon}
      </Text>
      <View style={styles.pickerRow}>
        {CAPABILITY_ICON_GROUPS.map(group => (
          <TouchableOpacity
            key={group.icon}
            style={[
              styles.pickerChip,
              styles.iconChipHit,
              {
                borderColor:
                  capIcon === group.icon
                    ? tokens.primary
                    : tokens.smart.colors.cardBorder,
              },
              capIcon === group.icon
                ? { backgroundColor: tokens.smart.colors.tealTint }
                : // Unselected groups dim (user-acceptance: clear
                  // highlight-while-others-recede affordance).
                  { opacity: 0.4 },
            ]}
            onPress={() => {
              setCapIcon(group.icon);
              setActiveGroup(group.icon);
            }}
            testID={`capability-icon-${group.icon}`}
          >
            <Ionicons
              name={group.icon as keyof typeof Ionicons.glyphMap}
              size={22}
              color={tokens.primary}
            />
          </TouchableOpacity>
        ))}
      </View>
      {presets.length > 0 ? (
        <View style={styles.pickerRow}>
          {presets.map(preset => (
            <TouchableOpacity
              key={preset.key}
              style={[
                styles.pickerChip,
                { borderColor: tokens.smart.colors.cardBorder },
              ]}
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={() => applyPreset(preset)}
              testID={`capability-preset-${preset.key}`}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {`${preset.label}${preset.unit ? ` (${preset.unit})` : ''}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Text
        style={[styles.label, { color: tokens.smart.colors.textSecondary }]}
      >
        {STRINGS.settings.capabilityColor}
      </Text>
      <View style={styles.pickerRow}>
        {CAPABILITY_COLORS.map(color => (
          <TouchableOpacity
            key={color}
            style={styles.colorChipHit}
            onPress={() => setCapColor(color)}
            testID={`capability-color-${color}`}
          >
            <View
              style={[
                styles.colorChip,
                { backgroundColor: color },
                capColor === color
                  ? // Selected swatch: bigger-feeling 3pt teal ring…
                    { borderColor: tokens.primary, borderWidth: 3 }
                  : // …unselected swatches dim (one is always selected).
                    { opacity: 0.4 },
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>

      {capError ? (
        <Text style={[styles.errorText, { color: tokens.danger }]}>
          {capError}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[styles.primaryButton, { backgroundColor: tokens.primary }]}
        onPress={() => {
          void submit();
        }}
        testID="capability-add-submit"
      >
        <Text style={[styles.primaryButtonText, { color: tokens.onPrimary }]}>
          {STRINGS.devices.save}
        </Text>
      </TouchableOpacity>
    </>
  );
}
