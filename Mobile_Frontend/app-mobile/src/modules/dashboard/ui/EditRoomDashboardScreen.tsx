/**
 * EditRoomDashboardScreen — the room-scoped draft editor (official
 * hierarchy, deepest level): ONE draft owns exactly ONE Template-room
 * layout. Header actions are `Hủy` (discard) and `Lưu` (atomic save); card
 * controls provide drag (a drop onto an occupied same-section cell SWAPS
 * the two positions — fix cycle 8 L; free cells move as before), resize
 * (chrome bar) and an overflow menu that is LAYOUT-ONLY for healthy
 * widgets (rename, duplicate-to-room, move-to-room, delete); the
 * configure/rebind entry appears ONLY when the widget's binding is lost
 * (AD5 repair lifeline — the app's only rebind/swap path); `+
 * Thêm widget` opens the room-authoritative add flow.
 *
 * Visual language (scope amendment 1, user-approved): the editor adopts
 * the Smart Home ambience — the same diagonal teal→page→amber wash as the
 * Dashboard view, smart card surfaces (`cardAppearance="smart"`) and the
 * small secondary section labels. This is VISUAL ONLY: the editor still
 * runs the persisted `computeGridMetrics` math with its EXACT-SLOT
 * contract (uniform rows, slot clipping, section rebases, snap/drag
 * validation) — edit mode never applies the view-mode floors or the flow
 * presentations, and every affordance (drag, `•••`, resize, highlight,
 * add/remove/rename/rebind, Hủy/Lưu, discard dialog) is unchanged.
 *
 * Draft semantics (atomic Save/Cancel):
 * - the draft is a working copy of the Template's widgets; the editor
 *   renders/edits only the selected room's scope (`filterWidgetsForRoom`),
 * - `Lưu` commits the WHOLE draft end-state (the edited room PLUS any
 *   cross-room duplicate/move destinations) through
 *   `DashboardService.applyTemplateLayouts` in ONE atomic multi-room save —
 *   authoritative about uniqueness, bindings and layout; unlisted rooms
 *   stay byte-equivalent,
 * - Save/exit race gate (amendment-2 item 9, reviewer-4 M1): the save is
 *   asynchronous and the editor stays interactive while it is pending, so
 *   a successful save exits ONLY when the outcome reports the open draft
 *   still equals the saved revision (`draftCurrent !== false`). A draft
 *   that diverged during the pending window STAYS with the newer edits
 *   intact — nothing is silently discarded (the user can save again);
 * - `Hủy`, Android/native back (with an explicit discard confirmation when
 *   the draft is dirty) and tab leave never persist the draft — Cancel
 *   restores the exact pre-edit layout, unknown custom fields included.
 *
 * Reuse: the grid/widget modules (`DashboardGrid`, `WidgetRenderer`,
 * `AddWidgetFlow`) and the pure layout engine are shared with the view
 * screen; this screen adds NO persistence logic of its own.
 */

import React, { useMemo, useState } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme, type ThemeTokens } from '@core/theme';
import {
  OperationBanner,
  useOperationFeedback,
} from '@core/ui/OperationBanner';

import {
  computeGridMetrics,
  resolveCanvasWidth,
  SMART_VIEW_MAX_CONTENT_WIDTH,
} from '../internal/domain/gridMetrics';
import {
  filterWidgetsForRoom,
  widgetsMatchAfterRoomOrdering,
} from '../internal/domain/roomFilter';
import {
  groupWidgets,
  sectionBaseY,
  sectionContentHeight,
} from '../internal/domain/sectionGroups';
import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import type { AddWidgetInput } from '../internal/services/dashboardService';
import type {
  CapabilityDef,
  CapabilityType,
  Device,
  Room,
} from '@modules/devices/api';
import type {
  WidgetConfig,
  WidgetRegistry,
  WidgetServices,
  WidgetSize,
} from '@modules/widgets/api';
import {
  effectiveCapabilities,
  WidgetServicesProvider,
} from '@modules/widgets/api';
import { useEffect } from 'react';

import { AddWidgetFlow } from './AddWidgetFlow';
import { ConfirmDialog, type ActionOutcome } from './ConfirmDialog';
import { DashboardGrid } from './DashboardGrid';

/**
 * The editor's Save outcome: the route's `saveDraft` result extended with
 * the race-gate signal. `draftCurrent === false` means the live draft
 * diverged from the saved revision while the atomic save was pending —
 * the editor must STAY so the newer edits are not silently lost. Absent
 * or `true` (the plain {@link ActionOutcome} shape) keeps the
 * exit-on-success behavior.
 */
export type EditSaveOutcome = ActionOutcome & {
  readonly draftCurrent?: boolean;
};

interface EditRoomDashboardScreenProps {
  /** The Template owning the room reference. */
  readonly template: DashboardTemplate | undefined;
  /** The referenced physical room id. */
  readonly roomId: string;
  /** All physical rooms (header name + candidate filtering). */
  readonly rooms: readonly Room[];
  readonly devices: readonly Device[];
  /** Capability catalog (binding candidates + labels). */
  readonly capabilities?: readonly CapabilityDef[];
  /** The widget registry (resolves components + rules). */
  readonly registry: WidgetRegistry;
  /** Runtime widget services (live widgets render inside the editor). */
  readonly services: WidgetServices;
  /** True while a draft is open (store editMode). */
  readonly editMode: boolean;
  /** The open draft (ALL widgets of the Template, other rooms included). */
  readonly draftWidgets: readonly WidgetConfig[] | null;
  /** Open the draft (enterEdit) — called by the navigator on mount. */
  readonly onOpenDraft: () => void;
  /** Hủy: discard the draft + leave the editor (single discard flow).
   * Also the exit path of a SUCCESSFUL Lưu (amendment-2 fix): after the
   * atomic commit the draft equals the persisted end-state, so leaving
   * loses nothing and pops cleanly (no discard prompt). Invoked ONLY when
   * the save's race gate confirms the open draft is exactly the saved
   * revision (see {@link EditSaveOutcome}). */
  readonly onCancel: () => void;
  /** Lưu: commit the whole draft end-state atomically. On success the
   * editor EXITS (back to the room dashboard) unless the outcome reports
   * `draftCurrent: false` (the draft diverged during the pending save —
   * the editor STAYS with the newer edits); on failure the editor stays
   * open with the error visible. */
  readonly onSave: () => Promise<EditSaveOutcome>;
  /** Draft move (sync; `false` → card snaps back). */
  readonly onDraftMove: (widgetId: string, x: number, y: number) => boolean;
  /**
   * Draft position SWAP between two same-section widgets (fix cycle 8 L —
   * drag-to-swap): dropping a card onto an occupied cell exchanges the two
   * positions in the DRAFT. `false` → rejected (both cards snap back).
   */
  readonly onDraftSwapPositions: (
    widgetIdA: string,
    widgetIdB: string,
  ) => boolean;
  /** Draft resize (sync; `false` → size stays). */
  readonly onDraftResize: (widgetId: string, size: WidgetSize) => boolean;
  /** Draft remove. */
  readonly onDraftRemove: (widgetId: string) => void;
  /** Draft rename (title). */
  readonly onDraftRename: (widgetId: string, title: string) => void;
  /** Draft rebind (device + capability). */
  readonly onDraftRebind: (
    widgetId: string,
    deviceId: string,
    capability: CapabilityType,
  ) => void;
  /**
   * Draft binding SWAP between two same-room widgets (fix cycle 7 G): the
   * explicit resolution for the room's one-source-per-room uniqueness
   * rule. `false` → the swap was rejected (draft untouched).
   */
  readonly onDraftSwapBindings: (
    widgetIdA: string,
    widgetIdB: string,
  ) => boolean;
  /** Add a widget to the draft (service assembles + places it). */
  readonly onAddWidget: (input: AddWidgetInput) => Promise<ActionOutcome>;
  /** Duplicate a draft widget into another room of this Template. */
  readonly onDuplicateWidget: (
    widgetId: string,
    targetRoomId: string,
  ) => Promise<ActionOutcome>;
  /** Move a draft widget to another room of this Template (atomic). */
  readonly onMoveWidget: (
    widgetId: string,
    targetRoomId: string,
  ) => Promise<ActionOutcome>;
}

/**
 * The room-scoped edit screen.
 *
 * @param props - see {@link EditRoomDashboardScreenProps}.
 */
export function EditRoomDashboardScreen({
  template,
  roomId,
  rooms,
  devices,
  capabilities = [],
  registry,
  services,
  editMode,
  draftWidgets,
  onOpenDraft,
  onCancel,
  onSave,
  onDraftMove,
  onDraftSwapPositions,
  onDraftResize,
  onDraftRemove,
  onDraftRename,
  onDraftRebind,
  onDraftSwapBindings,
  onAddWidget,
  onDuplicateWidget,
  onMoveWidget,
}: EditRoomDashboardScreenProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const { feedback, exiting, show, clear } = useOperationFeedback();

  const [canvasWidth, setCanvasWidth] = useState<number | null>(null);
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configTitle, setConfigTitle] = useState('');
  // Swap-confirm state (fix cycle 7 G): set when the user picks a source
  // ANOTHER widget in the room already holds — confirming exchanges the
  // two widgets' bindings (draft-level; Save persists atomically).
  const [swapPending, setSwapPending] = useState<{
    readonly holderId: string;
    readonly holderName: string;
  } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [pickingRoomFor, setPickingRoomFor] = useState<{
    readonly widgetId: string;
    readonly mode: 'duplicate' | 'move';
  } | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);

  const roomName = rooms.find(room => room.id === roomId)?.name ?? roomId;

  // The edited scope: draft widgets of THIS room (globals cannot exist in
  // the Template model — every placement lives in a room reference).
  const roomWidgets = useMemo(
    () =>
      (editMode && draftWidgets
        ? filterWidgetsForRoom(draftWidgets, roomId)
        : []
      ).filter(widget => widget.roomId === roomId),
    [editMode, draftWidgets, roomId],
  );

  // Dirty check: the FULL draft vs the Template's persisted widget set —
  // SEMANTIC equality after the store's own regrouping
  // (`widgetsMatchAfterRoomOrdering`): a cross-room duplicate/move
  // appends at the end of the FLAT draft while the Save regroups per
  // room, so the flat orders legitimately differ on a semantically-saved
  // draft. Unknown custom fields still count (JSON comparison) and the
  // draft spans the whole Template — a cross-room change makes OTHER
  // rooms' slices dirty while this room's slice may stay identical, so
  // the exit guards (Android back here, beforeRemove on the route) must
  // compare the whole draft end-state, not just the edited room's slice.
  const dirty = useMemo(() => {
    if (!editMode || !draftWidgets || !template) {
      return false;
    }
    const persisted = template.rooms.flatMap(room => room.widgets);
    return !widgetsMatchAfterRoomOrdering(
      draftWidgets,
      persisted,
      template.rooms,
    );
  }, [editMode, draftWidgets, template]);

  const metrics = useMemo(
    () => computeGridMetrics(resolveCanvasWidth(canvasWidth, 720)),
    [canvasWidth],
  );
  // Section-aware editor layout (fix cycle 7 H — WYSIWYG): the editor
  // renders the SAME two sections as the view screens ("Môi trường" =
  // sensor-value, "Thiết bị" = switch + others) with the SAME
  // section-local row rebase (layoutYOffset = sectionBaseY). Persisted
  // coordinates stay dashboard-absolute and canonical — the rebase is
  // presentation-only, exactly like view mode. A widget's section is
  // decided by its TYPE, so a widget can never visually cross sections.
  const sections = useMemo(() => groupWidgets(roomWidgets), [roomWidgets]);
  const envBaseY = useMemo(
    () => sectionBaseY(sections.environment),
    [sections.environment],
  );
  const deviceBaseY = useMemo(
    () => sectionBaseY(sections.devices),
    [sections.devices],
  );
  const envHeight = useMemo(
    () => sectionContentHeight(sections.environment, metrics),
    [sections.environment, metrics],
  );
  const deviceHeight = useMemo(
    () => sectionContentHeight(sections.devices, metrics),
    [sections.devices, metrics],
  );
  const gridShellHeight = useMemo(() => {
    // Each non-empty section reserves its rebased content extent + the
    // section label row; empty sections render nothing (as in view mode).
    let height = 0;
    if (sections.environment.length > 0) {
      height += envHeight + SECTION_LABEL_ROW;
    }
    if (sections.devices.length > 0) {
      height += deviceHeight + SECTION_LABEL_ROW;
    }
    return Math.max(height, 320);
  }, [sections, envHeight, deviceHeight]);

  // Open the draft exactly once per editor visit (the screen owns one
  // Template-room draft for its lifetime).
  useEffect(() => {
    if (!editMode) {
      onOpenDraft();
    }
  }, [editMode, onOpenDraft]);

  const leaveEditor = () => {
    onCancel();
  };

  // Android/native back during an unsaved edit: request explicit discard
  // confirmation when dirty; otherwise cancel silently (never persist).
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (dirty) {
          setDiscardConfirm(true);
          return true;
        }
        leaveEditor();
        return true;
      },
    );
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const handleSave = async () => {
    const result = await onSave();
    if (result.ok) {
      // Scope amendment 2 bug fix ("Lưu" did not exit the editor) +
      // reviewer-4 M1 race gate: a SUCCESSFUL atomic commit leaves the
      // editor via the single existing exit path ONLY when the open
      // draft still equals the saved revision — the route compares the
      // CURRENT draft against its save-start snapshot, so edits made
      // while the save was pending keep the editor OPEN with the draft
      // intact (the snapshot is persisted; the user can save again).
      // The discard guards are never bypassed. A FAILED save stays here
      // with the error visible (unchanged).
      if (result.draftCurrent !== false) {
        leaveEditor();
        return;
      }
      show({ severity: 'info', message: STRINGS.dashboard.savedDraftStale });
      return;
    }
    show({ severity: 'error', message: result.message });
  };

  const handleAddWidget = async (input: AddWidgetInput) => {
    const result = await onAddWidget(input);
    if (!result.ok) {
      show({ severity: 'error', message: result.message });
      return;
    }
    setShowAddFlow(false);
  };

  /**
   * Resize rejection honesty (dashboard-widget-resize-not-persisted): the
   * draft resize is synchronous and CAN be rejected (no free spot for the
   * new size — the layout engine leaves the draft untouched). The grid
   * badges always display the NEXT cycled size, so a silently ignored
   * `false` looks exactly like success: the user believes the size was
   * set, saves, and the unchanged 1x1 layout persists. Both editor chrome
   * call sites route through THIS handler — a rejection shows the
   * operation banner (the screen's existing messaging seam), never a
   * fake-success badge.
   */
  const handleDraftResize = (widgetId: string, size: WidgetSize): boolean => {
    const resized = onDraftResize(widgetId, size);
    if (!resized) {
      show({ severity: 'error', message: STRINGS.dashboard.resizeRejected });
    }
    return resized;
  };

  const menuWidget = roomWidgets.find(w => w.id === menuFor) ?? null;

  /**
   * AD5 repair lifeline (reviewer fix cycle 1 M2 — definition-aware): the
   * widget's binding is LOST only when its definition REQUIRES a binding
   * (it accepts at least one capability — the exact authority
   * `WidgetRenderer`'s lost-binding frame uses) AND the binding is missing
   * or the bound device no longer exists in the devices list. A definition
   * with no bindable capabilities (e.g. `supportedCapabilities: []`) is
   * healthy unbound, and an UNKNOWN/custom type has no registry rules to
   * configure (the configure dialog would have no candidates) — neither
   * counts as lost. Only a genuinely lost binding shows "Cấu hình widget":
   * for a healthy widget the edit tab is layout-only (a binding configure
   * changes the widget's CORE source and stays out of the menu), but the
   * configure dialog is the app's ONLY binding-repair + binding-swap path
   * (the view screens render no repair picker), so it remains reachable
   * exactly when repair is needed. Nothing is deleted — the row is gated,
   * not removed.
   */
  const bindingLost = (widget: WidgetConfig | null): boolean => {
    if (!widget) {
      return false;
    }
    const definition = registry.get(widget.type);
    if (!definition) {
      return false;
    }
    const bindingRequired =
      effectiveCapabilities(definition, capabilities).length > 0;
    if (!bindingRequired) {
      return false;
    }
    if (!widget.binding) {
      return true;
    }
    return !devices.some(device => device.id === widget.binding?.deviceId);
  };

  const showConfigureRow = bindingLost(menuWidget);

  /** Other room references of this Template (duplicate/move destinations). */
  const targetRooms = (widget: WidgetConfig | null): readonly string[] => {
    if (!template || !widget) {
      return [];
    }
    return template.rooms
      .filter(room => room.roomId !== roomId)
      .map(room => room.roomId)
      .filter(targetRoomId => {
        if (!widget.binding) {
          // Unbound (no binding) — compatible with every room.
          return true;
        }
        const boundDevice = devices.find(
          device => device.id === widget.binding?.deviceId,
        );
        // Unknown device (lost binding) → let the user choose; the service
        // remains the authoritative validation seam.
        return !boundDevice || boundDevice.roomId === targetRoomId;
      });
  };

  const pickRoom = async (targetRoomId: string) => {
    if (!pickingRoomFor) {
      return;
    }
    const { widgetId, mode } = pickingRoomFor;
    setPickingRoomFor(null);
    const result =
      mode === 'duplicate'
        ? await onDuplicateWidget(widgetId, targetRoomId)
        : await onMoveWidget(widgetId, targetRoomId);
    if (!result.ok) {
      show({ severity: 'error', message: result.message });
    }
  };

  const submitRename = () => {
    if (!renaming) {
      return;
    }
    onDraftRename(renaming, renameValue);
    setRenaming(null);
  };

  const submitConfigure = () => {
    if (!configuring) {
      return;
    }
    onDraftRename(configuring, configTitle);
    closeConfigureDialog();
  };

  const configureCandidateList = useMemo(
    () =>
      configureCandidates(
        configuring,
        roomWidgets,
        devices,
        capabilities,
        registry,
      ),
    [configuring, roomWidgets, devices, capabilities, registry],
  );

  /**
   * The OTHER widget of this room currently holding the candidate source
   * (room-level uniqueness rule: one widget per source) — `null` when the
   * source is free (or held by the configured widget itself).
   */
  const bindingHolderFor = (
    deviceId: string,
    capability: string,
  ): WidgetConfig | null => {
    if (!configuring) {
      return null;
    }
    return (
      roomWidgets.find(
        widget =>
          widget.id !== configuring &&
          widget.binding?.deviceId === deviceId &&
          widget.binding?.capability === capability,
      ) ?? null
    );
  };

  const closeConfigureDialog = () => {
    setConfiguring(null);
    setSwapPending(null);
  };

  if (!template) {
    return (
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
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={onCancel}
            testID="room-edit-back"
          >
            <Ionicons name="arrow-back" size={20} color={tokens.primary} />
          </Pressable>
          <Text style={styles.title}>{STRINGS.templates.backToTemplates}</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    // The ambient Smart Home wash — same recipe as the Dashboard view
    // (visual language only; every affordance below is unchanged).
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
      <OperationBanner
        feedback={feedback}
        exiting={exiting}
        onDismiss={clear}
      />
      {/* Header: Hủy | title | Lưu (specified actions). */}
      <View style={styles.header}>
        <Pressable
          style={styles.headerAction}
          onPress={leaveEditor}
          testID="room-edit-cancel"
          accessibilityRole="button"
        >
          <Text style={[styles.headerActionText, { color: tokens.danger }]}>
            {STRINGS.templates.cancel}
          </Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {roomName}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {STRINGS.dashboard.editTitle} · {template.name}
          </Text>
        </View>
        <Pressable
          style={styles.headerAction}
          onPress={() => {
            void handleSave();
          }}
          testID="room-edit-save"
          accessibilityRole="button"
        >
          <Text style={[styles.headerActionText, { color: tokens.primary }]}>
            {STRINGS.templates.save}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <WidgetServicesProvider services={services}>
          <View
            style={[styles.gridShell, { height: gridShellHeight }]}
            onLayout={event => {
              setCanvasWidth(event.nativeEvent.layout.width);
            }}
          >
            {roomWidgets.length === 0 ? (
              <Text style={styles.emptyHint}>
                {STRINGS.dashboard.noWidgetsEditor}
              </Text>
            ) : (
              <>
                {/* "Môi trường" (sensor-value) — the SAME section split +
                    section-local rebase as the view screens (WYSIWYG):
                    persisted coords stay dashboard-absolute, the grid
                    rebases section-local drag rows back to absolute. */}
                {sections.environment.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>
                      {STRINGS.dashboard.environment}
                    </Text>
                    <View style={{ height: envHeight }}>
                      <DashboardGrid
                        widgets={sections.environment}
                        registry={registry}
                        editMode
                        metrics={metrics}
                        layoutYOffset={envBaseY}
                        cardAppearance="smart"
                        onMoveWidget={onDraftMove}
                        onSwapWidgets={onDraftSwapPositions}
                        onResizeWidget={handleDraftResize}
                        onRemoveWidget={onDraftRemove}
                        editorChrome
                        onWidgetMenu={widgetId => {
                          setMenuFor(widgetId);
                        }}
                      />
                    </View>
                  </>
                ) : null}
                {/* "Thiết bị" (switch + others). */}
                {sections.devices.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>
                      {STRINGS.dashboard.devices}
                    </Text>
                    <View style={{ height: deviceHeight }}>
                      <DashboardGrid
                        widgets={sections.devices}
                        registry={registry}
                        editMode
                        metrics={metrics}
                        layoutYOffset={deviceBaseY}
                        cardAppearance="smart"
                        onMoveWidget={onDraftMove}
                        onSwapWidgets={onDraftSwapPositions}
                        onResizeWidget={handleDraftResize}
                        onRemoveWidget={onDraftRemove}
                        editorChrome
                        onWidgetMenu={widgetId => {
                          setMenuFor(widgetId);
                        }}
                      />
                    </View>
                  </>
                ) : null}
              </>
            )}
          </View>
        </WidgetServicesProvider>

        <Pressable
          style={[styles.addWidgetButton, { backgroundColor: tokens.primary }]}
          onPress={() => setShowAddFlow(true)}
          testID="room-edit-add-widget"
          accessibilityRole="button"
          accessibilityLabel={STRINGS.dashboard.addWidget}
        >
          <Text style={[styles.addWidgetText, { color: tokens.onPrimary }]}>
            + {STRINGS.dashboard.addWidget}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Add-widget flow (editor-room authoritative, one tap) — hosted in
          a full-screen Modal. The flow owns its OPAQUE base (fix cycle 5:
          RN-web Modals never occlude what is behind them — the occlusion
          comes from the flow's own root View), so the Modal stays
          transparent like the other editor overlays. */}
      <Modal
        visible={showAddFlow && editMode}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddFlow(false)}
      >
        <AddWidgetFlow
          editorRoomId={roomId}
          editorRoomName={roomName}
          devices={devices}
          capabilities={capabilities}
          widgets={draftWidgets ?? []}
          onAdd={input => {
            void handleAddWidget(input);
          }}
          onCancel={() => setShowAddFlow(false)}
        />
      </Modal>

      {/* Widget overflow menu (rename/configure/duplicate/move/delete). */}
      <Modal
        visible={menuFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View
            style={[
              styles.menuCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
                borderRadius: tokens.smart.radius.card,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.menuTitle,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {menuWidget?.title ?? menuWidget?.type ?? ''}
            </Text>
            <Pressable
              style={styles.menuRow}
              testID="widget-menu-rename"
              onPress={() => {
                setRenameValue(menuWidget?.title ?? '');
                setRenaming(menuFor);
                setMenuFor(null);
              }}
            >
              <Ionicons
                name="pencil-outline"
                size={16}
                color={tokens.smart.colors.textPrimary}
              />
              <Text
                style={[
                  styles.menuRowText,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.templates.renameWidget}
              </Text>
            </Pressable>
            {/* Repair lifeline (AD5): the configure entry is HIDDEN for
                healthy widgets (layout-only menu) and shown ONLY when the
                binding is lost — it is the app's only binding-repair +
                binding-swap path. The warning color marks the repair
                affordance; the dialog itself is unchanged. */}
            {showConfigureRow ? (
              <Pressable
                style={styles.menuRow}
                testID="widget-menu-configure"
                onPress={() => {
                  setConfigTitle(menuWidget?.title ?? '');
                  setConfiguring(menuFor);
                  setMenuFor(null);
                }}
              >
                <Ionicons
                  name="settings-outline"
                  size={16}
                  color={tokens.warning}
                />
                <Text style={[styles.menuRowText, { color: tokens.warning }]}>
                  {STRINGS.templates.configureWidget}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.menuRow}
              testID="widget-menu-duplicate"
              onPress={() => {
                if (menuFor) {
                  setPickingRoomFor({ widgetId: menuFor, mode: 'duplicate' });
                }
                setMenuFor(null);
              }}
            >
              <Ionicons
                name="copy-outline"
                size={16}
                color={tokens.smart.colors.textPrimary}
              />
              <Text
                style={[
                  styles.menuRowText,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.templates.duplicateWidget}
              </Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              testID="widget-menu-move"
              onPress={() => {
                if (menuFor) {
                  setPickingRoomFor({ widgetId: menuFor, mode: 'move' });
                }
                setMenuFor(null);
              }}
            >
              <Ionicons
                name="swap-horizontal-outline"
                size={16}
                color={tokens.smart.colors.textPrimary}
              />
              <Text
                style={[
                  styles.menuRowText,
                  { color: tokens.smart.colors.textPrimary },
                ]}
              >
                {STRINGS.templates.moveWidget}
              </Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              testID="widget-menu-delete"
              onPress={() => {
                setConfirmingDelete(menuFor);
                setMenuFor(null);
              }}
            >
              <Ionicons name="trash-outline" size={16} color={tokens.danger} />
              <Text style={[styles.menuRowText, { color: tokens.danger }]}>
                {STRINGS.dashboard.deleteWidget}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Rename dialog (draft-only; persisted at Save). */}
      <Modal
        visible={renaming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <View style={styles.menuBackdrop}>
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
                borderRadius: tokens.smart.radius.card,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.dialogTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.templates.renameWidget}
            </Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={STRINGS.templates.renameWidgetTitle}
              placeholderTextColor={tokens.smart.colors.textSecondary}
              autoFocus
              testID="widget-rename-input"
            />
            <View style={styles.dialogActions}>
              <Pressable
                style={[
                  styles.dialogButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={() => setRenaming(null)}
              >
                <Text
                  style={[
                    styles.dialogButtonText,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.templates.cancel}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.dialogButton,
                  {
                    backgroundColor: tokens.primary,
                    borderColor: tokens.primary,
                  },
                ]}
                testID="widget-rename-submit"
                onPress={submitRename}
              >
                <Text
                  style={[styles.dialogButtonText, { color: tokens.onPrimary }]}
                >
                  {STRINGS.templates.save}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Configure dialog: title + room-compatible binding picker. A pick
          whose source another widget holds offers an explicit SWAP instead
          of a guaranteed save failure (uniqueness stays authoritative). */}
      <Modal
        visible={configuring !== null}
        transparent
        animationType="fade"
        onRequestClose={closeConfigureDialog}
      >
        <View style={styles.menuBackdrop}>
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
                borderRadius: tokens.smart.radius.card,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.dialogTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.templates.configureWidget}
            </Text>
            <TextInput
              style={styles.input}
              value={configTitle}
              onChangeText={setConfigTitle}
              placeholder={STRINGS.templates.renameWidgetTitle}
              placeholderTextColor={tokens.smart.colors.textSecondary}
              testID="widget-config-title"
            />
            <Text
              style={[
                styles.dialogHint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.widgets.chooseDevice} · {roomName}
            </Text>
            <ScrollView style={styles.pickerList}>
              {configureCandidateList.map(candidate => (
                <View key={candidate.device.id} style={styles.pickerDeviceRow}>
                  <Text
                    style={[
                      styles.pickerDeviceName,
                      { color: tokens.smart.colors.textPrimary },
                    ]}
                  >
                    {candidate.device.name}
                  </Text>
                  <View style={styles.pickerCapRow}>
                    {candidate.capabilities.map(capability => {
                      const holder = bindingHolderFor(
                        candidate.device.id,
                        capability,
                      );
                      return (
                        <Pressable
                          key={capability}
                          style={[
                            styles.capChip,
                            holder
                              ? { borderColor: tokens.primary }
                              : { borderColor: tokens.smart.colors.cardBorder },
                          ]}
                          testID={`widget-config-bind-${candidate.device.id}-${capability}`}
                          accessibilityLabel={
                            holder
                              ? `${capabilityLabel(
                                  capability,
                                  capabilities,
                                )} — ${STRINGS.widgets.swapBindingAction}`
                              : capabilityLabel(capability, capabilities)
                          }
                          onPress={() => {
                            if (!configuring) {
                              return;
                            }
                            if (holder) {
                              setSwapPending({
                                holderId: holder.id,
                                holderName:
                                  holder.title ??
                                  capabilityLabel(
                                    holder.binding?.capability ?? capability,
                                    capabilities,
                                  ),
                              });
                              return;
                            }
                            onDraftRebind(
                              configuring,
                              candidate.device.id,
                              capability,
                            );
                          }}
                        >
                          <Text
                            style={[
                              styles.capChipText,
                              { color: tokens.smart.colors.textPrimary },
                            ]}
                          >
                            {capabilityLabel(capability, capabilities)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              {configuring !== null && configureCandidateList.length === 0 ? (
                <Text
                  style={{
                    color: tokens.smart.colors.textSecondary,
                    fontSize: 13,
                  }}
                >
                  {STRINGS.widgets.disabled}
                </Text>
              ) : null}
            </ScrollView>
            {/* Swap confirmation: the picked source is held by another
                widget — Hoán đổi exchanges the two bindings (titles and
                positions unchanged); the uniqueness rule stays the
                authority and the swap is its explicit resolution. */}
            {swapPending ? (
              <View
                style={[
                  styles.swapConfirmCard,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                testID="widget-config-swap"
              >
                <Text
                  style={[
                    styles.dialogHint,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.widgets.swapBindingTitle} ·{' '}
                  {STRINGS.widgets.swapBindingConfirm.replace(
                    '{name}',
                    swapPending.holderName,
                  )}
                </Text>
                <View style={styles.dialogActions}>
                  <Pressable
                    style={[
                      styles.dialogButton,
                      { borderColor: tokens.smart.colors.cardBorder },
                    ]}
                    testID="widget-config-swap-dismiss"
                    onPress={() => setSwapPending(null)}
                  >
                    <Text
                      style={[
                        styles.dialogButtonText,
                        { color: tokens.smart.colors.textSecondary },
                      ]}
                    >
                      {STRINGS.templates.cancel}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.dialogButton,
                      {
                        backgroundColor: tokens.primary,
                        borderColor: tokens.primary,
                      },
                    ]}
                    testID="widget-config-swap-confirm"
                    onPress={() => {
                      if (configuring) {
                        onDraftSwapBindings(configuring, swapPending.holderId);
                      }
                      setSwapPending(null);
                    }}
                  >
                    <Text
                      style={[
                        styles.dialogButtonText,
                        { color: tokens.onPrimary },
                      ]}
                    >
                      {STRINGS.widgets.swapBindingAction}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <View style={styles.dialogActions}>
              <Pressable
                style={[
                  styles.dialogButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={closeConfigureDialog}
              >
                <Text
                  style={[
                    styles.dialogButtonText,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.templates.close}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.dialogButton,
                  {
                    backgroundColor: tokens.primary,
                    borderColor: tokens.primary,
                  },
                ]}
                testID="widget-config-submit"
                onPress={submitConfigure}
              >
                <Text
                  style={[styles.dialogButtonText, { color: tokens.onPrimary }]}
                >
                  {STRINGS.templates.save}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Duplicate/move destination picker (compatible rooms only). */}
      <Modal
        visible={pickingRoomFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickingRoomFor(null)}
      >
        <View style={styles.menuBackdrop}>
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
                borderRadius: tokens.smart.radius.card,
              },
              tokens.smart.cardShadow,
            ]}
          >
            <Text
              style={[
                styles.dialogTitle,
                { color: tokens.smart.colors.textPrimary },
              ]}
            >
              {STRINGS.templates.chooseTargetRoom}
            </Text>
            {pickingRoomFor !== null &&
            targetRooms(
              roomWidgets.find(w => w.id === pickingRoomFor.widgetId) ?? null,
            ).length === 0 ? (
              <Text
                style={{
                  color: tokens.smart.colors.textSecondary,
                  fontSize: 13,
                }}
              >
                {STRINGS.templates.noCompatibleRoom}
              </Text>
            ) : null}
            <ScrollView style={styles.pickerList}>
              {pickingRoomFor !== null
                ? targetRooms(
                    roomWidgets.find(w => w.id === pickingRoomFor.widgetId) ??
                      null,
                  ).map(targetRoomId => (
                    <Pressable
                      key={targetRoomId}
                      style={[
                        styles.menuRow,
                        { borderWidth: 1, borderRadius: 10, marginBottom: 6 },
                        { borderColor: tokens.smart.colors.cardBorder },
                      ]}
                      testID={`widget-target-room-${targetRoomId}`}
                      onPress={() => {
                        void pickRoom(targetRoomId);
                      }}
                    >
                      <Ionicons
                        name="bed-outline"
                        size={16}
                        color={tokens.primary}
                      />
                      <Text
                        style={[
                          styles.menuRowText,
                          { color: tokens.smart.colors.textPrimary },
                        ]}
                      >
                        {rooms.find(room => room.id === targetRoomId)?.name ??
                          targetRoomId}
                      </Text>
                    </Pressable>
                  ))
                : null}
            </ScrollView>
            <View style={styles.dialogActions}>
              <Pressable
                style={[
                  styles.dialogButton,
                  { borderColor: tokens.smart.colors.cardBorder },
                ]}
                onPress={() => setPickingRoomFor(null)}
              >
                <Text
                  style={[
                    styles.dialogButtonText,
                    { color: tokens.smart.colors.textSecondary },
                  ]}
                >
                  {STRINGS.templates.cancel}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete-widget confirmation (draft removal — persisted at Save). */}
      <ConfirmDialog
        visible={confirmingDelete !== null}
        title={STRINGS.dashboard.deleteWidget}
        message={
          confirmingDelete
            ? `${STRINGS.dashboard.deleteWidget}: ${
                roomWidgets.find(w => w.id === confirmingDelete)?.title ??
                confirmingDelete
              }?`
            : ''
        }
        onConfirm={() => {
          if (confirmingDelete) {
            onDraftRemove(confirmingDelete);
          }
          setConfirmingDelete(null);
        }}
        onDismiss={() => setConfirmingDelete(null)}
      />

      {/* Discard confirmation for Android/native back with a dirty draft. */}
      <ConfirmDialog
        visible={discardConfirm}
        title={STRINGS.templates.discardChanges}
        message={STRINGS.dashboard.editHint}
        destructive
        confirmLabel={STRINGS.templates.discardConfirm}
        onConfirm={() => {
          setDiscardConfirm(false);
          leaveEditor();
        }}
        onDismiss={() => setDiscardConfirm(false)}
      />
    </LinearGradient>
  );
}

/** Binding candidates for the configure dialog (room-compatible only). */
function configureCandidates(
  widgetId: string | null,
  roomWidgets: readonly WidgetConfig[],
  devices: readonly Device[],
  capabilities: readonly CapabilityDef[],
  registry: WidgetRegistry,
): readonly {
  readonly device: Device;
  readonly capabilities: readonly CapabilityType[];
}[] {
  const widget = roomWidgets.find(w => w.id === widgetId);
  if (!widget) {
    return [];
  }
  const definition = registry.get(widget.type);
  if (!definition) {
    // Unknown custom type — no registry binding rules to configure.
    return [];
  }
  const supported = effectiveCapabilities(definition, capabilities);
  return devices
    .filter(device => device.roomId === widget.roomId)
    .map(device => ({
      device,
      capabilities: device.capabilities.filter(capability =>
        supported.includes(capability),
      ),
    }))
    .filter(candidate => candidate.capabilities.length > 0);
}

function capabilityLabel(
  capability: CapabilityType,
  capabilities: readonly CapabilityDef[],
): string {
  return (
    capabilities.find(entry => entry.type === capability)?.label ?? capability
  );
}

/**
 * Reserved vertical space of ONE section label row (the small secondary
 * smart label: `smart.typography.secondary` line box + marginBottom 10 +
 * a small gap) — kept at the legacy pill-era upper bound so the editor's
 * shell reservation never under-reserves and nothing can overlap the grid
 * below the labels.
 */
const SECTION_LABEL_ROW = 36;

const makeStyles = (tokens: ThemeTokens) =>
  StyleSheet.create({
    flex: { flex: 1 },
    // Scope amendment 3 (header alignment): the Hủy | title | Lưu header is
    // constrained to the SAME centered max-width band (880) as the card
    // content (coherence with the Dashboard tab; affordances unchanged).
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
      width: '100%',
      maxWidth: SMART_VIEW_MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    headerAction: { paddingVertical: 6, paddingHorizontal: 4 },
    headerActionText: { fontSize: 15, fontWeight: '700' },
    headerText: { flex: 1, minWidth: 0 },
    // settings-smart-home-sync: header + hint text read the smart tokens.
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: tokens.smart.colors.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 11,
      color: tokens.smart.colors.textSecondary,
      textAlign: 'center',
      marginTop: 1,
    },
    // 44pt hit target (dashboard-history-board-touch-share): explicit bounds
    // around the arrow.
    backButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: { padding: 12, paddingBottom: 60 },
    // Scope amendment 2 (content cap, visual sync): the editor's canvas is
    // CAPPED and CENTERED like the view screens so the exact-slot grid
    // stays WYSIWYG with the preview on wide screens. Presentation-only —
    // the persisted `computeGridMetrics` math derives from the MEASURED
    // (capped) width; the slot contract is untouched.
    gridShell: {
      width: '100%',
      maxWidth: SMART_VIEW_MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    addWidgetButton: {
      borderRadius: 12,
      alignItems: 'center',
      paddingVertical: 12,
      marginTop: 12,
    },
    addWidgetText: { fontWeight: '700', fontSize: 14 },
    menuAnchor: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderBottomWidth: 1,
      borderBottomColor: tokens.smart.colors.cardBorder,
    },
    menuAnchorText: {
      fontSize: 12,
      color: tokens.smart.colors.textSecondary,
      flex: 1,
    },
    emptyHint: {
      color: tokens.smart.colors.textSecondary,
      textAlign: 'center',
      marginTop: 40,
      fontSize: 14,
      paddingHorizontal: 32,
    },
    menuBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    menuCard: {
      width: '100%',
      maxWidth: 320,
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 8,
    },
    menuTitle: {
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    menuRowText: { fontSize: 14, fontWeight: '500' },
    dialogCard: {
      width: '100%',
      borderRadius: 14,
      borderWidth: 1,
      padding: 16,
    },
    dialogTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
    dialogHint: { fontSize: 12, marginTop: 8, marginBottom: 4 },
    input: {
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: tokens.smart.colors.textPrimary,
      fontSize: 14,
    },
    dialogActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 14,
    },
    dialogButton: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    dialogButtonText: { fontSize: 14, fontWeight: '600' },
    pickerList: { maxHeight: 200 },
    pickerDeviceRow: { marginBottom: 10 },
    pickerDeviceName: {
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 4,
    },
    pickerCapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    capChip: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    capChipText: { fontSize: 12, fontWeight: '500' },
    // Small secondary smart section label (no pill) — the Smart Home
    // visual language; the label text itself and its reserved row are
    // unchanged affordances. Scope amendment 2 (label spacing): the
    // margin is dropped so the label→card gap is the persisted grid's own
    // top padding (16pt — the editor's pixel math is untouched), matching
    // the view screens' 12–16pt band.
    sectionLabel: {
      fontSize: tokens.smart.typography.secondary,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textSecondary,
      marginBottom: 0,
    },
    // Swap confirmation block (fix cycle 7 G): framed inside the Configure
    // dialog above its action row.
    swapConfirmCard: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginTop: 8,
    },
  });
