/**
 * TemplateListScreen — the ROOT screen of the management hierarchy inside
 * the Settings tab (official hierarchy, one level per screen): a
 * title/subtitle, responsive Template cards (name, room count, last-updated
 * copy), the `+ Tạo Template mới` action and a per-card overflow menu
 * (rename / duplicate / delete).
 *
 * There is deliberately NO room strip and NO widget canvas here — rooms are
 * the next native-stack screen (`RoomListScreen`). Selection, management and
 * content never co-render (the official layout contract).
 *
 * The screen is dumb: everything arrives as props; the app-layer navigator
 * wires the dashboard service/store and navigation. Delete asks for
 * confirmation; failures keep the dialog open and show the actual service
 * error. The MQTT connection badge stays on this root so connection truth
 * remains visible at the Dashboard entry point.
 *
 * Visual language (settings-smart-home-sync): the former gel gradient +
 * glass surfaces are fully retired — the ambient Smart Home wash
 * (tealTint → page → amberTint), solid smart cards with the hairline border
 * + card shadow, a smart badge whose dot follows the SHARED
 * connection/health color contract (D3: teal/amber/danger) and smart text
 * throughout.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { APP_NAME } from '@core/constants';
import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme, type ThemeTokens } from '@core/theme';
import {
  OperationBanner,
  useOperationFeedback,
} from '@core/ui/OperationBanner';

import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import type { WidgetConnectionState } from '@modules/widgets/api';
import { ConfirmDialog, type ActionOutcome } from './ConfirmDialog';

/**
 * Deterministic "last updated" copy for a Template card (`dd/MM/yyyy HH:mm`
 * from local Date parts — no Intl dependency, testable). `0` (never
 * stamped) renders the neutral "Chưa cập nhật" copy.
 */
export function formatTemplateUpdatedAt(epochMillis: number): string {
  if (!Number.isFinite(epochMillis) || epochMillis <= 0) {
    return STRINGS.templates.updatedNever;
  }
  const date = new Date(epochMillis);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return STRINGS.templates.updated.replace(
    '{time}',
    `${pad(date.getDate())}/${pad(
      date.getMonth() + 1,
    )}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
  );
}

/**
 * MQTT badge dot color by connection state — the SHARED connection/health
 * color contract (D3, settings-smart-home-sync): connected = smart teal,
 * failed = semantic danger, connecting/reconnecting = smart amber, and
 * idle/unknown = smart textSecondary (never amber — idle is not a progress
 * state; same mapping as the Dashboard chip and the Advanced status dots).
 */
function badgeColor(
  state: WidgetConnectionState['state'],
  tokens: {
    smart: { colors: { teal: string; amber: string; textSecondary: string } };
    danger: string;
  },
): string {
  switch (state) {
    case 'connected':
      return tokens.smart.colors.teal;
    case 'failed':
      return tokens.danger;
    case 'connecting':
    case 'reconnecting':
      return tokens.smart.colors.amber;
    default:
      // `idle` (and any future state) is the neutral no-signal color.
      return tokens.smart.colors.textSecondary;
  }
}

/** Two-column card grid from a canvas width (same breakpoint family as the widget grid). */
function columnCount(width: number): 1 | 2 {
  return width >= 560 ? 2 : 1;
}

interface TemplateListScreenProps {
  /** All persisted Templates (root objects). */
  readonly templates: readonly DashboardTemplate[];
  /** Live MQTT connection snapshot for the badge. */
  readonly connection: WidgetConnectionState;
  /**
   * Back to the Settings root (the hierarchy's exit affordance — without
   * it the Template list is a dead end on phones).
   */
  readonly onBack: () => void;
  /**
   * Open a Template's room list. The active-Template selection is awaited
   * by the navigator: a persistence failure resolves with a failed outcome
   * (shown truthfully in the banner) and NO navigation happens.
   */
  readonly onOpenTemplate: (templateId: string) => Promise<ActionOutcome>;
  /** Open the dedicated create-Template screen (typed Settings stack). */
  readonly onCreateTemplate: () => void;
  /** Rename a Template (display name only). */
  readonly onRenameTemplate: (
    id: string,
    name: string,
  ) => Promise<ActionOutcome>;
  /** Duplicate a Template (fresh ids; rooms referenced, not cloned). */
  readonly onDuplicateTemplate: (id: string) => Promise<ActionOutcome>;
  /** Delete a Template (last one protected by the service). */
  readonly onDeleteTemplate: (id: string) => Promise<ActionOutcome>;
}

/**
 * The Template list screen (management hierarchy root, inside the Settings
 * tab).
 *
 * @param props - see {@link TemplateListScreenProps}.
 */
export function TemplateListScreen({
  templates,
  connection,
  onBack,
  onOpenTemplate,
  onCreateTemplate,
  onRenameTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
}: TemplateListScreenProps) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const { feedback, exiting, show, clear } = useOperationFeedback();

  // Overflow menu per card.
  const [menuFor, setMenuFor] = useState<DashboardTemplate | null>(null);
  // Rename dialog.
  const [renaming, setRenaming] = useState<DashboardTemplate | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  // Delete confirmation (service errors keep it open).
  const [deleting, setDeleting] = useState<DashboardTemplate | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const columns = columnCount(width);

  const submitRename = async () => {
    if (!renaming) {
      return;
    }
    const name = renameValue.trim();
    if (name.length === 0) {
      setRenameError(STRINGS.devices.requiredField);
      return;
    }
    const result = await onRenameTemplate(renaming.id, name);
    if (!result.ok) {
      setRenameError(result.message || 'Lỗi');
      return;
    }
    setRenaming(null);
    setRenameError(null);
  };

  const confirmDelete = async () => {
    if (!deleting) {
      return;
    }
    setDeleteError(null);
    const result = await onDeleteTemplate(deleting.id);
    if (!result.ok) {
      setDeleteError(result.message || 'Lỗi');
      return;
    }
    setDeleting(null);
  };

  const dotColor = badgeColor(connection.state, tokens);

  return (
    // The ambient Smart Home wash — the gel gradient is retired
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
      <OperationBanner
        feedback={feedback}
        exiting={exiting}
        onDismiss={clear}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          {/* Back to the Settings root — same arrow-back recipe as the
              other hierarchy screens (RoomList, Create screens, Room
              Dashboard). */}
          <Pressable
            style={styles.backButton}
            onPress={onBack}
            hitSlop={8}
            testID="template-list-back"
            accessibilityRole="button"
            accessibilityLabel={STRINGS.settings.back}
          >
            <Ionicons name="arrow-back" size={20} color={tokens.primary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>{APP_NAME}</Text>
            <Text style={styles.subtitle}>{STRINGS.templates.subtitle}</Text>
          </View>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: tokens.smart.colors.card,
                borderColor: tokens.smart.colors.cardBorder,
              },
            ]}
          >
            <View style={[styles.badgeDot, { backgroundColor: dotColor }]} />
            <Text style={[styles.badgeText, { color: dotColor }]}>
              {connection.state === 'connected'
                ? STRINGS.dashboard.mqttOnline
                : connection.state === 'failed'
                ? STRINGS.dashboard.mqttOffline
                : STRINGS.dashboard.mqttConnecting}
            </Text>
          </View>
        </View>

        <View style={styles.grid}>
          {templates.map(template => (
            <Pressable
              key={template.id}
              style={[
                styles.card,
                { width: columns === 1 ? '100%' : (width - 40) / 2 },
              ]}
              onPress={() => {
                void onOpenTemplate(template.id).then(result => {
                  if (!result.ok) {
                    show({ severity: 'error', message: result.message });
                  }
                });
              }}
              testID={`template-card-${template.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${
                template.name
              }, ${STRINGS.templates.roomCount.replace(
                '{n}',
                String(template.rooms.length),
              )}`}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {template.name}
                </Text>
                <Pressable
                  style={styles.cardMenuButton}
                  testID={`template-menu-${template.id}`}
                  accessibilityLabel={`${STRINGS.templates.templateMenu}: ${template.name}`}
                  onPress={() => setMenuFor(template)}
                >
                  <Ionicons
                    name="ellipsis-vertical"
                    size={18}
                    color={tokens.smart.colors.textSecondary}
                  />
                </Pressable>
              </View>
              <View style={styles.cardMeta}>
                <Ionicons
                  name="grid-outline"
                  size={14}
                  color={tokens.smart.colors.textSecondary}
                />
                <Text style={styles.cardMetaText}>
                  {STRINGS.templates.roomCount.replace(
                    '{n}',
                    String(template.rooms.length),
                  )}
                </Text>
              </View>
              <View style={styles.cardMeta}>
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={tokens.smart.colors.textSecondary}
                />
                <Text style={styles.cardMetaText}>
                  {formatTemplateUpdatedAt(template.updatedAt)}
                </Text>
              </View>
            </Pressable>
          ))}

          <Pressable
            style={[
              styles.createCard,
              { width: columns === 1 ? '100%' : (width - 40) / 2 },
            ]}
            testID="template-create-card"
            accessibilityRole="button"
            accessibilityLabel={STRINGS.templates.createTemplate}
            onPress={() => onCreateTemplate()}
          >
            <Ionicons
              name="add-circle-outline"
              size={22}
              color={tokens.primary}
            />
            <Text style={styles.createCardText}>
              {STRINGS.templates.createTemplateAction}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Per-card overflow menu (rename / duplicate / delete). */}
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
              numberOfLines={1}
            >
              {menuFor?.name}
            </Text>
            <Pressable
              style={styles.menuRow}
              testID="template-menu-rename"
              onPress={() => {
                setRenameValue(menuFor?.name ?? '');
                setRenameError(null);
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
                {STRINGS.templates.renameTemplate}
              </Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              testID="template-menu-duplicate"
              onPress={() => {
                const target = menuFor;
                setMenuFor(null);
                if (target) {
                  void onDuplicateTemplate(target.id).then(result => {
                    show({
                      severity: result.ok ? 'success' : 'error',
                      message: result.ok
                        ? 'Đã nhân bản Template'
                        : result.message,
                    });
                  });
                }
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
                {STRINGS.templates.duplicateTemplate}
              </Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              testID="template-menu-delete"
              onPress={() => {
                setDeleteError(null);
                setDeleting(menuFor);
                setMenuFor(null);
              }}
            >
              <Ionicons name="trash-outline" size={16} color={tokens.danger} />
              <Text style={[styles.menuRowText, { color: tokens.danger }]}>
                {STRINGS.templates.deleteTemplate}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Rename dialog (failures keep it open with the error). */}
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
              {STRINGS.templates.renameTemplate}
            </Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={STRINGS.templates.templateName}
              placeholderTextColor={tokens.smart.colors.textSecondary}
              autoFocus
              testID="template-rename-input"
            />
            {renameError ? (
              <Text style={[styles.errorText, { color: tokens.danger }]}>
                {renameError}
              </Text>
            ) : null}
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
                testID="template-rename-submit"
                onPress={() => {
                  void submitRename();
                }}
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

      {/* Delete confirmation (CP: destructive Template deletion). */}
      <ConfirmDialog
        visible={deleting !== null}
        title={STRINGS.templates.deleteTemplate}
        message={STRINGS.templates.deleteTemplateConfirm.replace(
          '{name}',
          deleting?.name ?? '',
        )}
        error={deleteError}
        onConfirm={() => {
          void confirmDelete();
        }}
        onDismiss={() => setDeleting(null)}
      />
    </LinearGradient>
  );
}

const makeStyles = (tokens: ThemeTokens) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { paddingHorizontal: 16, paddingBottom: 40 },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 12,
      marginBottom: 16,
    },
    // Same back affordance as the other hierarchy screens (RoomList recipe).
    // 44pt hit target (dashboard-history-board-touch-share): explicit bounds
    // around the arrow.
    backButton: {
      minWidth: 44,
      minHeight: 44,
      marginTop: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The template-card ⋯ menu: explicit ≥44×44 hit bounds (was hitSlop 8).
    cardMenuButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { flex: 1, minWidth: 0 },
    title: {
      fontSize: 22,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
    },
    subtitle: {
      fontSize: 13,
      color: tokens.smart.colors.textSecondary,
      marginTop: 2,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 5,
    },
    badgeDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    badgeText: { fontSize: 12, fontWeight: '600' },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    // Solid smart card (settings-smart-home-sync): card surface + hairline
    // border + card shadow — the gel glass surface is retired.
    card: {
      flexGrow: 1,
      maxWidth: '100%',
      borderRadius: tokens.smart.radius.card,
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      backgroundColor: tokens.smart.colors.card,
      padding: 14,
      gap: 6,
      ...tokens.smart.cardShadow,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    cardName: {
      flex: 1,
      fontSize: 16,
      fontFamily: INTER_SEMIBOLD,
      color: tokens.smart.colors.textPrimary,
    },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    cardMetaText: { fontSize: 12, color: tokens.smart.colors.textSecondary },
    createCard: {
      flexGrow: 1,
      borderRadius: tokens.smart.radius.card,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: tokens.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 22,
      gap: 6,
    },
    createCardText: {
      color: tokens.primary,
      fontWeight: '600',
      fontSize: 13,
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
      borderWidth: 1,
      padding: 16,
    },
    dialogTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
    input: {
      borderWidth: 1,
      borderColor: tokens.smart.colors.cardBorder,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: tokens.smart.colors.textPrimary,
      fontSize: 14,
    },
    errorText: { fontSize: 13, marginTop: 8 },
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
  });
