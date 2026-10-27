/**
 * DeviceManagementScreen — ROOM-FIRST device management (approved
 * room-sensor-derived-history-layout-rework plan, slice A).
 *
 * The user chooses a room ONCE; every child list and creation form inherits
 * it:
 *
 * ```text
 * Room list (＋ Thêm phòng dialog)
 * └── Room detail
 *     ├── Cảm biến (n)   (one row per PROJECTED sensor metric)
 *     ├── Điều khiển (n) (one row per relay)
 *     ├── ＋ Thêm cảm biến (sensor creation → centered dialog)
 *     └── ＋ Thêm điều khiển (relay creation → centered dialog)
 * ```
 *
 * - There is NO `Tất cả` view, global device filter matrix, repeated room
 *   picker, or binding-kind choice — all rejected semantics are removed.
 * - Room rows carry NO persistent edit/delete icons
 *   (devices-room-actions-modal): ONE overflow affordance per row opens a
 *   centered action menu for exactly that room (`Đổi tên phòng` / `Xóa
 *   phòng` / `Hủy`); the card body still opens the room's detail. Selecting
 *   an action closes the menu BEFORE the target flow opens: rename in a
 *   centered, keyboard-safe dialog prefilled with the existing name, delete
 *   in the existing migration-aware confirmation. No silent deletion.
 * - A user-facing sensor is ONE metric/field (`{roomId, field}` unique,
 *   max 10 per room): a legacy multi-capability board projects as separate
 *   temperature/humidity rows and counters (`2/10`).
 * - All creation forms live in centered dialogs (`AddDeviceDialog` /
 *   `AddRoomDialog`, devices-add-device-dialog plan): each room section
 *   opens its contextual creation form directly. The sensor body requires a
 *   name and exactly one data channel or curated custom metric; the relay body
 *   asks for name + free room-scoped slot 1..10. The `＋ Thêm phòng` pill
 *   opens the room-name dialog. Dialogs close on
 *   ✕ / scrim / Android back with no side effects.
 * - Creating a room AWAITS the service result and opens the created room
 *   immediately; failures keep the dialog open with truthful feedback.
 * - Legacy roomless records stay manageable through a dedicated section on
 *   the room-list screen (assign/delete) — never a global `Tất cả` filter.
 */

import React, { useMemo, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';

import { STRINGS } from '@core/i18n';
import { useTheme, type ThemeTokens } from '@core/theme';
import {
  OperationBanner,
  useOperationFeedback,
  type OperationFeedback,
} from '@core/ui/OperationBanner';
import type {
  BoardInventoryEntry,
  CapabilityDef,
  Device,
  NewCapabilityInput,
  NewDeviceInput,
  Room,
  RoomMigrationTarget,
} from '@modules/devices/api';
import type { DevicePatch } from '../internal/services/deviceRegistryService';
import {
  MAX_RELAYS_PER_ROOM,
  MAX_SENSORS_PER_ROOM,
  countRoomSensors,
  projectSensorRegistrations,
} from '../internal/domain/devices';
import { AddDeviceDialog, AddRoomDialog } from './AddDeviceDialog';

/** Generic action outcome surfaced through the top-center banner. */
export interface ActionOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/** Room creation outcome: carries the created room id (opened on success). */
export type AddRoomOutcome = ActionOutcome & { readonly roomId?: string };

/** The shared screen style sheet handed to every child (dialogs included). */
export type DevicesStyles = ReturnType<typeof makeStyles>;

interface DeviceManagementScreenProps {
  /** Navigate back to the Settings root (explicit, always available). */
  readonly onBack: () => void;
  /** All rooms (room list + rename/delete). */
  readonly rooms: readonly Room[];
  /** All devices (projected counters + room detail + legacy section). */
  readonly devices: readonly Device[];
  /** Capability catalog (metric choices + custom metric creation). */
  readonly capabilities: readonly CapabilityDef[];
  /**
   * Discovered boards (board-discovery-binding): feeds the AddRoomDialog
   * board-pick step. Optional — when absent/empty the dialog stays
   * name-only (the exact pre-binding behavior).
   */
  readonly boards?: readonly BoardInventoryEntry[];
  /** Add a room (with the optional board code); the outcome carries the
   *  created room id. The form stays open on failure and the error is
   *  shown. */
  readonly onAddRoom: (name: string, code?: string) => Promise<AddRoomOutcome>;
  /** Inline room rename. The row stays open on failure. */
  readonly onRenameRoom: (
    roomId: string,
    name: string,
  ) => Promise<ActionOutcome>;
  /** Room removal with an explicit device/widget migration. The dialog
   *  stays open on failure and the error is shown inside it. */
  readonly onRemoveRoom: (
    roomId: string,
    target: RoomMigrationTarget,
  ) => Promise<ActionOutcome>;
  /** Add a device (validated by the registry service). */
  readonly onAddDevice: (input: NewDeviceInput) => Promise<ActionOutcome>;
  /** Update a device (partial patch; validated by the registry service). */
  readonly onUpdateDevice: (
    id: string,
    patch: DevicePatch,
  ) => Promise<ActionOutcome>;
  /** Remove a device (cascade handled by the app root). The card stays on
   *  failure and the error is shown on it. */
  readonly onRemoveDevice: (id: string) => Promise<ActionOutcome>;
  /** Add a curated custom metric to the catalog (strict machine key). */
  readonly onAddCapability: (
    input: NewCapabilityInput,
  ) => Promise<ActionOutcome>;
  /** Remove ONE projected sensor metric (binding-level cascade). */
  readonly onRemoveDeviceCapability: (
    deviceId: string,
    field: string,
  ) => Promise<ActionOutcome>;
}

/**
 * Device management screen (room list → room detail).
 */
export function DeviceManagementScreen({
  onBack,
  rooms,
  devices,
  capabilities,
  boards,
  onAddRoom,
  onRenameRoom,
  onRemoveRoom,
  onAddDevice,
  onUpdateDevice,
  onRemoveDevice,
  onAddCapability,
  onRemoveDeviceCapability,
}: DeviceManagementScreenProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const { feedback, exiting, show, clear } = useOperationFeedback();

  // Room-first navigation: the room LIST or one room's DETAIL. The selected
  // room is inherited by every child list and creation form.
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);

  // Room rename state (devices-room-actions-modal: the rename UI is the
  // centered dialog, opened from the room action menu).
  const [renamingRoomId, setRenamingRoomId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // Room delete + migration dialog state (CP5 behavior preserved).
  const [removingRoom, setRemovingRoom] = useState<Room | null>(null);
  const [migrationKind, setMigrationKind] =
    useState<RoomMigrationTarget['kind']>('move');
  const [migrationTarget, setMigrationTarget] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  /** Map an action outcome to the top-center banner (general feedback). */
  const notifyOutcome = (outcome: ActionOutcome): ActionOutcome => {
    const severity: OperationFeedback['severity'] = outcome.ok
      ? outcome.message
        ? 'info'
        : 'success'
      : 'error';
    show({
      severity,
      message:
        outcome.message ||
        (outcome.ok ? 'Thao tác thành công' : 'Thao tác thất bại'),
    });
    return outcome;
  };

  /**
   * Room creation (the user-reported broken flow — now a regression-tested
   * contract): await the service, open the CREATED room on success, banner
   * the outcome. The draft/error/saving state lives in `AddRoomDialog`,
   * which keeps itself open (with the error) on failure.
   */
  const submitRoom = async (
    name: string,
    code?: string,
  ): Promise<AddRoomOutcome> => {
    const result = await onAddRoom(name, code);
    if (!result.ok) {
      notifyOutcome(result);
      return result;
    }
    notifyOutcome({ ok: true, message: STRINGS.devices.roomCreated });
    if (result.roomId) {
      setOpenRoomId(result.roomId);
    }
    return result;
  };

  const submitRenameRoom = async (roomId: string) => {
    const name = renameValue.trim();
    if (!name) {
      return;
    }
    const result = await onRenameRoom(roomId, name);
    if (!result.ok) {
      // Keep the rename dialog open on failure (truthful error inside).
      setRenameError(result.message || 'Không đổi được tên phòng');
      notifyOutcome(result);
      return;
    }
    setRenamingRoomId(null);
    setRenameError(null);
    notifyOutcome({ ok: true, message: 'Đã đổi tên phòng' });
  };

  const startRemoveRoom = (room: Room) => {
    setRemovingRoom(room);
    setMigrationError(null);
    const firstOther = rooms.find(candidate => candidate.id !== room.id);
    setMigrationKind(firstOther ? 'move' : 'unassign');
    setMigrationTarget(firstOther ? firstOther.id : null);
  };

  const confirmRemoveRoom = async () => {
    if (!removingRoom) {
      return;
    }
    const target: RoomMigrationTarget =
      migrationKind === 'move' && migrationTarget
        ? { kind: 'move', roomId: migrationTarget }
        : { kind: 'unassign' };
    setMigrationError(null);
    const result = await onRemoveRoom(removingRoom.id, target);
    if (!result.ok) {
      // Keep the dialog open so the user can pick a different target.
      setMigrationError(result.message);
      return;
    }
    if (openRoomId === removingRoom.id) {
      setOpenRoomId(null);
    }
    setRemovingRoom(null);
    notifyOutcome({ ok: true, message: 'Đã xóa phòng' });
  };

  const openRoom = rooms.find(room => room.id === openRoomId) ?? null;

  return (
    // The ambient Smart Home wash — same recipe as the Settings root
    // (settings-smart-home-sync).
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
          {openRoom ? (
            <TouchableOpacity
              style={styles.backRow}
              accessibilityLabel={STRINGS.settings.back}
              testID="devices-room-back"
              onPress={() => setOpenRoomId(null)}
            >
              <Ionicons name="arrow-back" size={18} color={tokens.primary} />
              <Text style={[styles.backText, { color: tokens.primary }]}>
                {STRINGS.settings.back}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.backRow}
              accessibilityLabel={STRINGS.settings.back}
              testID="device-management-back"
              onPress={onBack}
            >
              <Ionicons name="arrow-back" size={18} color={tokens.primary} />
              <Text style={[styles.backText, { color: tokens.primary }]}>
                {STRINGS.settings.back}
              </Text>
            </TouchableOpacity>
          )}
          <Text
            style={[
              styles.screenTitle,
              { color: tokens.smart.colors.textPrimary },
            ]}
          >
            {openRoom ? openRoom.name : STRINGS.settings.manageDevices}
          </Text>

          {openRoom ? (
            <RoomDetailView
              room={openRoom}
              rooms={rooms}
              devices={devices}
              capabilities={capabilities}
              boards={boards}
              onAddDevice={onAddDevice}
              onUpdateDevice={onUpdateDevice}
              onRemoveDevice={onRemoveDevice}
              onAddCapability={onAddCapability}
              onRemoveDeviceCapability={onRemoveDeviceCapability}
              notifyOutcome={notifyOutcome}
              styles={styles}
            />
          ) : (
            <RoomsView
              rooms={rooms}
              devices={devices}
              capabilities={capabilities}
              renamingRoomId={renamingRoomId}
              renameValue={renameValue}
              renameError={renameError}
              onRenameValueChange={setRenameValue}
              onOpenRoom={setOpenRoomId}
              onStartRename={roomId => {
                setRenamingRoomId(roomId);
                setRenameError(null);
                const room = rooms.find(candidate => candidate.id === roomId);
                setRenameValue(room?.name ?? '');
              }}
              onCancelRename={() => {
                setRenamingRoomId(null);
                setRenameError(null);
              }}
              onSubmitRename={submitRenameRoom}
              onSubmitRoom={submitRoom}
              boards={boards}
              onStartRemoveRoom={startRemoveRoom}
              onRemoveDevice={onRemoveDevice}
              onUpdateDevice={onUpdateDevice}
              notifyOutcome={notifyOutcome}
              styles={styles}
            />
          )}
        </ScrollView>

        {/* Room delete + migration dialog (CP5 behavior preserved). */}
        <Modal
          visible={removingRoom !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setRemovingRoom(null)}
        >
          <View style={styles.modalBackdrop}>
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
                {STRINGS.devices.removeRoom}: {removingRoom?.name ?? ''}
              </Text>
              <Text
                style={[
                  styles.hint,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {'Thiết bị của phòng này sẽ được chuyển đi hoặc bỏ xếp phòng.'}
              </Text>
              {rooms
                .filter(candidate => candidate.id !== removingRoom?.id)
                .map(candidate => (
                  <Pressable
                    key={candidate.id}
                    style={[
                      styles.pickerChip,
                      {
                        borderColor:
                          migrationKind === 'move' &&
                          migrationTarget === candidate.id
                            ? tokens.primary
                            : tokens.smart.colors.cardBorder,
                      },
                    ]}
                    onPress={() => {
                      setMigrationKind('move');
                      setMigrationTarget(candidate.id);
                    }}
                  >
                    <Text style={{ color: tokens.smart.colors.textPrimary }}>
                      {`Chuyển vào ${candidate.name}`}
                    </Text>
                  </Pressable>
                ))}
              <Pressable
                style={[
                  styles.pickerChip,
                  {
                    borderColor:
                      migrationKind === 'unassign'
                        ? tokens.primary
                        : tokens.smart.colors.cardBorder,
                  },
                ]}
                onPress={() => setMigrationKind('unassign')}
              >
                <Text style={{ color: tokens.smart.colors.textPrimary }}>
                  {'Bỏ xếp phòng (bản ghi cũ)'}
                </Text>
              </Pressable>
              {migrationError ? (
                <Text style={[styles.errorText, { color: tokens.danger }]}>
                  {migrationError}
                </Text>
              ) : null}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    { borderColor: tokens.smart.colors.cardBorder },
                  ]}
                  onPress={() => setRemovingRoom(null)}
                >
                  <Text style={{ color: tokens.smart.colors.textSecondary }}>
                    {STRINGS.devices.cancel}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    {
                      backgroundColor: tokens.danger,
                      borderColor: tokens.danger,
                    },
                  ]}
                  onPress={() => {
                    void confirmRemoveRoom();
                  }}
                >
                  <Text style={{ color: tokens.onPrimary }}>
                    {STRINGS.devices.delete}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

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

interface RoomsViewProps {
  readonly rooms: readonly Room[];
  readonly devices: readonly Device[];
  readonly capabilities: readonly CapabilityDef[];
  /** Discovered boards for the AddRoomDialog pick step (optional). */
  readonly boards?: readonly BoardInventoryEntry[];
  readonly renamingRoomId: string | null;
  readonly renameValue: string;
  /** Truthful rename failure, shown INSIDE the centered rename dialog. */
  readonly renameError: string | null;
  readonly onRenameValueChange: (value: string) => void;
  readonly onOpenRoom: (roomId: string) => void;
  readonly onStartRename: (roomId: string) => void;
  readonly onCancelRename: () => void;
  readonly onSubmitRename: (roomId: string) => void;
  /** Screen-owned room submit (await → open created room on success). */
  readonly onSubmitRoom: (
    name: string,
    code?: string,
  ) => Promise<AddRoomOutcome>;
  readonly onStartRemoveRoom: (room: Room) => void;
  readonly onRemoveDevice: (id: string) => Promise<ActionOutcome>;
  readonly onUpdateDevice: (
    id: string,
    patch: DevicePatch,
  ) => Promise<ActionOutcome>;
  readonly notifyOutcome: (outcome: ActionOutcome) => ActionOutcome;
  readonly styles: ReturnType<typeof makeStyles>;
}

/**
 * The room list: one row per room with truthful projected counters, the
 * `＋ Thêm phòng` action pill (opens the centered add-room dialog) and the
 * legacy roomless-records section. Rows expose NO persistent edit/delete
 * controls (devices-room-actions-modal): the body opens the room's detail
 * and ONE overflow affordance opens the centered per-room action menu.
 */
function RoomsView({
  rooms,
  devices,
  capabilities,
  boards,
  renamingRoomId,
  renameValue,
  renameError,
  onRenameValueChange,
  onOpenRoom,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onSubmitRoom,
  onStartRemoveRoom,
  onRemoveDevice,
  onUpdateDevice,
  notifyOutcome,
  styles,
}: RoomsViewProps) {
  const { tokens } = useTheme();
  const roomless = devices.filter(device => !device.roomId);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  // The selected room's action menu (devices-room-actions-modal): local
  // presentation state — selecting an action routes to the existing
  // screen-owned rename/delete flows.
  const [menuRoomId, setMenuRoomId] = useState<string | null>(null);
  const menuRoom = rooms.find(room => room.id === menuRoomId) ?? null;
  const renamingRoom = rooms.find(room => room.id === renamingRoomId) ?? null;

  return (
    <View>
      {/* Room rows (projected metric/relay counters mirror the service). */}
      {rooms.map(room => {
        const sensors = countRoomSensors(devices, capabilities, room.id);
        const relayCount = devices.filter(
          device =>
            device.roomId === room.id && device.binding.kind === 'relay',
        ).length;
        return (
          <View
            key={room.id}
            style={[
              styles.rowCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
            ]}
          >
            {/* Card BODY: opens the room detail — never the action menu. */}
            <Pressable
              style={styles.rowMain}
              onPress={() => onOpenRoom(room.id)}
              accessibilityRole="button"
              testID={`devices-room-row-${room.id}`}
            >
              <Text
                style={[
                  styles.rowTitle,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {room.name}
              </Text>
              <Text
                style={[
                  styles.rowMeta,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {`${STRINGS.devices.sensorsSection} ${sensors}/${MAX_SENSORS_PER_ROOM} · ${STRINGS.devices.controlsSection} ${relayCount}/${MAX_RELAYS_PER_ROOM}`}
              </Text>
            </Pressable>
            {/* The single overflow affordance (sibling of the body — taps
                never navigate): opens the centered menu for THIS room. */}
            <TouchableOpacity
              style={styles.roomActionsButton}
              onPress={() => setMenuRoomId(room.id)}
              accessibilityLabel={STRINGS.devices.roomActions}
              testID={`devices-room-actions-${room.id}`}
            >
              <Ionicons
                name="ellipsis-vertical"
                size={18}
                color={tokens.smart.colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        );
      })}

      {/* Explicit room creation: the pill opens the centered dialog; the
          dialog awaits the service → the screen opens the CREATED room on
          success, failure keeps the dialog open with the error. */}
      <TouchableOpacity
        style={[styles.primaryButton, { backgroundColor: tokens.primary }]}
        onPress={() => setRoomDialogOpen(true)}
        testID="devices-add-room-toggle"
      >
        <Text style={[styles.primaryButtonText, { color: tokens.onPrimary }]}>
          {`＋ ${STRINGS.devices.addRoom}`}
        </Text>
      </TouchableOpacity>
      {roomDialogOpen ? (
        <AddRoomDialog
          onSubmitRoom={onSubmitRoom}
          onClose={() => setRoomDialogOpen(false)}
          styles={styles}
          rooms={rooms}
          boards={boards}
        />
      ) : null}

      {/* The selected room's centered action menu
          (devices-room-actions-modal): opened for exactly ONE room; each
          selection closes the menu BEFORE the target flow opens. Scrim
          press cancels (it sits UNDER the card, same recipe as the
          dialogs); Android back cancels with no side effects. */}
      {menuRoom ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setMenuRoomId(null)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setMenuRoomId(null)}
              accessibilityRole="button"
              accessibilityLabel={STRINGS.devices.close}
              testID="devices-room-menu-scrim"
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
                {menuRoom.name}
              </Text>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuRoomId(null);
                  onStartRename(menuRoom.id);
                }}
                testID={`devices-room-menu-rename-${menuRoom.id}`}
              >
                <Text style={{ color: tokens.smart.colors.textPrimary }}>
                  {STRINGS.devices.renameRoom}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuRoomId(null);
                  onStartRemoveRoom(menuRoom);
                }}
                testID={`devices-room-menu-delete-${menuRoom.id}`}
              >
                <Text style={{ color: tokens.danger }}>
                  {STRINGS.devices.removeRoom}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => setMenuRoomId(null)}
                testID="devices-room-menu-cancel"
              >
                <Text style={{ color: tokens.smart.colors.textSecondary }}>
                  {STRINGS.devices.cancel}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* The centered rename dialog: opened from the room action menu with
          the EXISTING name; a failure keeps it open with the truthful error
          and the draft preserved (same semantics as the previous inline
          row editor). Keyboard-safe on iOS via the shared KAV recipe. */}
      {renamingRoom ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={onCancelRename}
        >
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.modalBackdrop}>
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
                  {STRINGS.devices.renameRoom}
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
                  value={renameValue}
                  onChangeText={onRenameValueChange}
                  autoFocus
                  testID="devices-room-rename-input"
                />
                {renameError ? (
                  <Text style={[styles.errorText, { color: tokens.danger }]}>
                    {renameError}
                  </Text>
                ) : null}
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      { borderColor: tokens.smart.colors.cardBorder },
                    ]}
                    onPress={onCancelRename}
                  >
                    <Text style={{ color: tokens.smart.colors.textSecondary }}>
                      {STRINGS.devices.cancel}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      {
                        backgroundColor: tokens.primary,
                        borderColor: tokens.primary,
                      },
                    ]}
                    onPress={() => onSubmitRename(renamingRoom.id)}
                    testID={`devices-room-rename-save-${renamingRoom.id}`}
                  >
                    <Text style={{ color: tokens.onPrimary }}>
                      {STRINGS.devices.save}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}

      {/* Legacy roomless records: manageable WITHOUT a global Tất cả view. */}
      {roomless.length > 0 ? (
        <View style={styles.sectionBlock}>
          <Text
            style={[
              styles.sectionTitle,
              { color: tokens.smart.colors.textPrimary },
            ]}
          >
            {STRINGS.devices.roomlessLegacy} ({roomless.length})
          </Text>
          {roomless.map(device => (
            <View
              key={device.id}
              style={[
                styles.rowCard,
                {
                  backgroundColor: tokens.smart.colors.card,
                  borderColor: tokens.smart.colors.cardBorder,
                },
              ]}
            >
              <View style={styles.rowMain}>
                <Text
                  style={[
                    styles.rowTitle,
                    { color: tokens.smart.colors.textPrimary },
                  ]}
                >
                  {device.name}
                </Text>
                <Text
                  style={[
                    styles.rowMeta,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {device.type}
                </Text>
              </View>
              <View style={styles.rowActions}>
                {assigningId === device.id ? (
                  <>
                    {rooms.map(room => (
                      <TouchableOpacity
                        key={room.id}
                        onPress={() => setAssignTarget(room.id)}
                        style={[
                          styles.pickerChip,
                          {
                            borderColor:
                              assignTarget === room.id
                                ? tokens.primary
                                : tokens.smart.colors.cardBorder,
                          },
                        ]}
                      >
                        <Text
                          style={{ color: tokens.smart.colors.textPrimary }}
                        >
                          {room.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      onPress={() => {
                        void (async () => {
                          if (!assignTarget) {
                            return;
                          }
                          const result = await onUpdateDevice(device.id, {
                            roomId: assignTarget,
                          });
                          setLegacyError(
                            result.ok ? null : result.message || 'Lỗi',
                          );
                          if (result.ok) {
                            setAssigningId(null);
                            setAssignTarget(null);
                          }
                        })();
                      }}
                    >
                      <Text style={{ color: tokens.primary }}>
                        {STRINGS.devices.assignRoom}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={() => {
                        setAssigningId(device.id);
                        setLegacyError(null);
                      }}
                    >
                      <Text style={{ color: tokens.primary }}>
                        {STRINGS.devices.assignRoom}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        void (async () => {
                          const result = await onRemoveDevice(device.id);
                          if (!result.ok) {
                            setLegacyError(result.message || 'Lỗi');
                          }
                        })();
                      }}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={tokens.danger}
                      />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          ))}
          {legacyError ? (
            <Text style={[styles.errorText, { color: tokens.danger }]}>
              {legacyError}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

interface RoomDetailViewProps {
  readonly room: Room;
  readonly rooms: readonly Room[];
  readonly devices: readonly Device[];
  readonly capabilities: readonly CapabilityDef[];
  /**
   * Discovered boards (boards-topic-contract-v2): feeds the add-device
   * dialog's descriptor-driven metric/slot choices for a board-bound room.
   */
  readonly boards?: readonly BoardInventoryEntry[];
  readonly onAddDevice: (input: NewDeviceInput) => Promise<ActionOutcome>;
  readonly onUpdateDevice: (
    id: string,
    patch: DevicePatch,
  ) => Promise<ActionOutcome>;
  readonly onRemoveDevice: (id: string) => Promise<ActionOutcome>;
  readonly onAddCapability: (
    input: NewCapabilityInput,
  ) => Promise<ActionOutcome>;
  readonly onRemoveDeviceCapability: (
    deviceId: string,
    field: string,
  ) => Promise<ActionOutcome>;
  readonly notifyOutcome: (outcome: ActionOutcome) => ActionOutcome;
  readonly styles: ReturnType<typeof makeStyles>;
}

/**
 * One room's detail: the `Cảm biến (n)` and `Điều khiển (n)` compact tab
 * pills plus one contextual action for the visible section. The room is
 * inherited — no room picker and no repeated sensor/relay choice.
 * Full-room quota counters (`n/10`) remain on the room-list rows only.
 */
function RoomDetailView({
  room,
  devices,
  capabilities,
  boards,
  onAddDevice,
  onUpdateDevice,
  onRemoveDevice,
  onAddCapability,
  onRemoveDeviceCapability,
  notifyOutcome,
  styles,
}: RoomDetailViewProps) {
  const { tokens } = useTheme();
  const [section, setSection] = useState<'sensors' | 'controls'>('sensors');
  const [addDialogKind, setAddDialogKind] = useState<'sensor' | 'relay' | null>(
    null,
  );
  const sensorCount = countRoomSensors(devices, capabilities, room.id);
  const relayCount = devices.filter(
    device => device.roomId === room.id && device.binding.kind === 'relay',
  ).length;

  return (
    <View>
      {/* Truthful section tabs (the room is already chosen) plus a
          section-specific creation action. */}
      <View style={styles.sectionTabs}>
        <TouchableOpacity
          style={[
            styles.sectionTab,
            { borderColor: tokens.smart.colors.cardBorder },
            section === 'sensors' && {
              backgroundColor: tokens.primary,
              borderColor: tokens.primary,
            },
          ]}
          onPress={() => setSection('sensors')}
          testID="devices-section-sensors"
        >
          <Text
            style={{
              color:
                section === 'sensors'
                  ? tokens.onPrimary
                  : tokens.smart.colors.textPrimary,
            }}
          >
            {`${STRINGS.devices.sensorsSection} (${sensorCount})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sectionTab,
            { borderColor: tokens.smart.colors.cardBorder },
            section === 'controls' && {
              backgroundColor: tokens.primary,
              borderColor: tokens.primary,
            },
          ]}
          onPress={() => setSection('controls')}
          testID="devices-section-controls"
        >
          <Text
            style={{
              color:
                section === 'controls'
                  ? tokens.onPrimary
                  : tokens.smart.colors.textPrimary,
            }}
          >
            {`${STRINGS.devices.controlsSection} (${relayCount})`}
          </Text>
        </TouchableOpacity>
        {section === 'sensors' ? (
          <TouchableOpacity
            style={[styles.sectionTab, styles.addActionPill]}
            onPress={() => setAddDialogKind('sensor')}
            testID="devices-add-sensor-tab"
          >
            <Text style={{ color: tokens.primary }}>
              {`＋ ${STRINGS.devices.addSensor}`}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sectionTab, styles.addActionPill]}
            onPress={() => setAddDialogKind('relay')}
            testID="devices-add-relay-tab"
          >
            <Text style={{ color: tokens.primary }}>
              {`＋ ${STRINGS.devices.addRelay}`}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {section === 'sensors' ? (
        <SensorsSection
          room={room}
          devices={devices}
          capabilities={capabilities}
          onRemoveDeviceCapability={onRemoveDeviceCapability}
          notifyOutcome={notifyOutcome}
          styles={styles}
        />
      ) : (
        <ControlsSection
          room={room}
          devices={devices}
          onUpdateDevice={onUpdateDevice}
          onRemoveDevice={onRemoveDevice}
          notifyOutcome={notifyOutcome}
          styles={styles}
        />
      )}

      {/* The centered contextual dialog: mounted only while open (fresh
          state on every open); closing has no side effects. */}
      {addDialogKind !== null ? (
        <AddDeviceDialog
          room={room}
          devices={devices}
          capabilities={capabilities}
          boards={boards}
          kind={addDialogKind}
          onAddDevice={onAddDevice}
          onAddCapability={onAddCapability}
          notifyOutcome={notifyOutcome}
          onClose={() => setAddDialogKind(null)}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

interface SensorsSectionProps {
  readonly room: Room;
  readonly devices: readonly Device[];
  readonly capabilities: readonly CapabilityDef[];
  readonly onRemoveDeviceCapability: (
    deviceId: string,
    field: string,
  ) => Promise<ActionOutcome>;
  readonly notifyOutcome: (outcome: ActionOutcome) => ActionOutcome;
  readonly styles: ReturnType<typeof makeStyles>;
}

/**
 * The room's sensor section: one row per PROJECTED metric registration.
 * Deleting a row removes exactly that metric (legacy siblings survive).
 * The add form lives in the centered `AddDeviceDialog` (action pill).
 */
function SensorsSection({
  room,
  devices,
  capabilities,
  onRemoveDeviceCapability,
  notifyOutcome,
  styles,
}: SensorsSectionProps) {
  const { tokens } = useTheme();
  const [rowError, setRowError] = useState<string | null>(null);

  const registrations = projectSensorRegistrations(
    devices,
    capabilities,
  ).filter(registration => registration.roomId === room.id);

  return (
    <View>
      {registrations.map(registration => {
        const def = capabilities.find(
          candidate => candidate.type === registration.field,
        );
        const label = def?.label ?? registration.field;
        return (
          <View
            key={`${registration.deviceId}:${registration.field}`}
            style={[
              styles.rowCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
            ]}
            testID={`devices-sensor-row-${registration.deviceId}-${registration.field}`}
          >
            <View style={styles.rowMain}>
              <Text
                style={[
                  styles.rowTitle,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {label}
              </Text>
              <Text
                style={[
                  styles.rowMeta,
                  { color: tokens.smart.colors.textSecondary },
                ]}
              >
                {registration.deviceName}
              </Text>
            </View>
            <View style={styles.rowActions}>
              <TouchableOpacity
                onPress={() => {
                  void (async () => {
                    const result = await onRemoveDeviceCapability(
                      registration.deviceId,
                      registration.field,
                    );
                    if (!result.ok) {
                      setRowError(result.message || 'Lỗi');
                      notifyOutcome(result);
                      return;
                    }
                    setRowError(null);
                    notifyOutcome({
                      ok: true,
                      message: STRINGS.devices.sensorMetricRemoved,
                    });
                  })();
                }}
                accessibilityLabel={STRINGS.devices.delete}
                testID={`devices-sensor-delete-${registration.deviceId}-${registration.field}`}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={tokens.danger}
                />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
      {rowError ? (
        <Text style={[styles.errorText, { color: tokens.danger }]}>
          {rowError}
        </Text>
      ) : null}
    </View>
  );
}

interface ControlsSectionProps {
  readonly room: Room;
  readonly devices: readonly Device[];
  readonly onUpdateDevice: (
    id: string,
    patch: DevicePatch,
  ) => Promise<ActionOutcome>;
  readonly onRemoveDevice: (id: string) => Promise<ActionOutcome>;
  readonly notifyOutcome: (outcome: ActionOutcome) => ActionOutcome;
  readonly styles: ReturnType<typeof makeStyles>;
}

/**
 * The room's relay section: one row per relay with inline rename + removal.
 * The name + free room-scoped slot 1..10 form lives in the centered
 * `AddDeviceDialog` (relay kind); the room and the switch capability are
 * inherited, never asked again.
 */
function ControlsSection({
  room,
  devices,
  onUpdateDevice,
  onRemoveDevice,
  notifyOutcome,
  styles,
}: ControlsSectionProps) {
  const { tokens } = useTheme();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  const relays = devices.filter(
    device => device.roomId === room.id && device.binding.kind === 'relay',
  );

  return (
    <View>
      {relays.map(device => (
        <View
          key={device.id}
          style={[
            styles.rowCard,
            {
              backgroundColor: tokens.smart.colors.card,
              borderColor: tokens.smart.colors.cardBorder,
            },
          ]}
          testID={`devices-relay-row-${device.id}`}
        >
          {renamingId === device.id ? (
            <View style={styles.rowMain}>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: tokens.smart.colors.card,
                    borderColor: tokens.smart.colors.cardBorder,
                    color: tokens.smart.colors.textPrimary,
                  },
                ]}
                value={renameValue}
                onChangeText={setRenameValue}
                autoFocus
              />
              <View style={styles.rowActions}>
                <TouchableOpacity
                  onPress={() => {
                    void (async () => {
                      const result = await onUpdateDevice(device.id, {
                        name: renameValue.trim() || device.name,
                      });
                      if (!result.ok) {
                        setRowError(result.message || 'Lỗi');
                        return;
                      }
                      setRenamingId(null);
                    })();
                  }}
                >
                  <Text style={{ color: tokens.primary }}>
                    {STRINGS.devices.save}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRenamingId(null)}>
                  <Text style={{ color: tokens.smart.colors.textSecondary }}>
                    {STRINGS.devices.cancel}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.rowMain}>
                <Text
                  style={[
                    styles.rowTitle,
                    { color: tokens.smart.colors.textPrimary },
                  ]}
                >
                  {device.name}
                </Text>
                <Text
                  style={[
                    styles.rowMeta,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.devices.chooseSlot}:{' '}
                  {device.binding.kind === 'relay' ? device.binding.index : ''}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  onPress={() => {
                    setRenamingId(device.id);
                    setRenameValue(device.name);
                  }}
                  accessibilityLabel={STRINGS.devices.edit}
                >
                  <Ionicons
                    name="pencil-outline"
                    size={18}
                    color={tokens.smart.colors.textSecondary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    void (async () => {
                      const result = await onRemoveDevice(device.id);
                      if (!result.ok) {
                        setRowError(result.message || 'Lỗi');
                      }
                    })();
                  }}
                  accessibilityLabel={STRINGS.devices.delete}
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={tokens.danger}
                  />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ))}
      {rowError ? (
        <Text style={[styles.errorText, { color: tokens.danger }]}>
          {rowError}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: 16, paddingBottom: 48 },
    screenTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      // 44pt hit target (dashboard-history-board-touch-share): the back
      // row grows to the minimum height around the arrow+label.
      minHeight: 44,
      paddingVertical: 8,
      paddingRight: 12,
    },
    // Room overflow affordance (dashboard-history-board-touch-share):
    // explicit ≥44×44 hit bounds (was hitSlop 8 only).
    roomActionsButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: { fontSize: 14, fontWeight: '500' },
    // Responsive tab row (reviewer fix cycle): the two content tabs + the
    // contextual creation action cannot fit one row on 320–360dp devices —
    // the row wraps (pills stay centered) instead of clipping.
    sectionTabs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 12,
    },
    sectionTab: {
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    // Contextual creation action: teal-tinted + teal border so it never reads
    // as a third content tab.
    addActionPill: {
      backgroundColor: tokens.smart.colors.tealTint,
      borderColor: tokens.primary,
    },
    // Centered add-device / add-room dialogs (devices-add-device-dialog).
    // Shell reuse: modalBackdrop/modalCard from the room-delete dialog +
    // a maxHeight cap; the body scrolls when the custom-metric form or the
    // keyboard expands past small screens.
    dialogCard: { maxHeight: '85%' },
    dialogHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    dialogScroll: { flexGrow: 0, flexShrink: 1 },
    dialogBody: { paddingBottom: 4 },
    dialogFooter: { flexDirection: 'row', gap: 12, marginTop: 12 },
    dialogFooterButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 8,
      paddingVertical: 10,
    },
    segmentRow: { flexDirection: 'row', gap: 8 },
    segmentButton: {
      flex: 1,
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 999,
      paddingVertical: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginTop: 20,
      marginBottom: 8,
    },
    sectionBlock: { marginTop: 8 },
    label: { fontSize: 13, marginTop: 12, marginBottom: 4 },
    input: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: tokens.smart.radius.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      gap: 8,
      ...tokens.smart.cardShadow,
    },
    rowMain: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '600' },
    rowMeta: { fontSize: 12, marginTop: 2 },
    rowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    primaryButton: {
      alignSelf: 'center',
      borderRadius: 999,
      paddingHorizontal: 24,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 12,
    },
    primaryButtonText: { fontSize: 15, fontWeight: '600' },
    pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    pickerChip: {
      borderWidth: 1,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    // Chip label size (user-acceptance fix: bigger, readable chip text).
    chipText: { fontSize: 15 },
    // Bigger color swatch (36) + a 3pt teal ring when selected (applied in
    // AddDeviceDialog); unselected swatches dim via opacity there.
    colorChip: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    // 44pt hit target (dashboard-history-board-touch-share): the color
    // swatch keeps its 36×36 painted size inside an explicit ≥44×44
    // pressable (was hitSlop 4 only).
    colorChipHit: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 44pt hit target: the custom-metric icon-group chips (icon-only)
    // get explicit bounds (was hitSlop 4 only).
    iconChipHit: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 44pt hit target: the shared dialog-shell ✕ close (was hitSlop 10).
    dialogCloseButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorText: { fontSize: 12, marginTop: 4 },
    hint: { fontSize: 12, marginTop: 4, lineHeight: 16 },
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
    // Room action-menu item (devices-room-actions-modal): a full-width row
    // inside the centered menu card.
    menuItem: {
      paddingVertical: 12,
      alignItems: 'flex-start',
    },
  });
}
