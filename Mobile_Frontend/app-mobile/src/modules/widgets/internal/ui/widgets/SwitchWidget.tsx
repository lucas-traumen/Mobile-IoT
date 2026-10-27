/**
 * SwitchWidget — ON/OFF toggle for a `switch` capability with inline error
 * (Smart Home anatomy, dashboard-smart-home-redesign).
 *
 * Card anatomy: width-aware. At FULL width (`layout.width === 2`) ONE row —
 * a line-style glyph inside a soft icon chip, the friendly device title
 * (with the state caption STACKED UNDER the name, scope amendment 3), and
 * the operational switch control. At a NARROW single-column slot
 * (`layout.width === 1`, dashboard-editor-switch-compact-layout) the three
 * elements cannot share one line without squeezing the name into a
 * mid-word wrap ("Đèn" → "Đè/n"): the identity (chip + name/caption) keeps
 * its own full-width row and the switch control moves to a
 * dedicated trailing row below it — a structural reflow, never a
 * truncation. NO bound device id and NO visible `Đang bật`/`Đang tắt`
 * caption: the state rides the switch
 * semantics (accessibility state `checked` + accessible value text) so
 * accessibility services keep the full state. The GLYPH resolves per device
 * first (scope amendment 2 — optional per-device `icon`), then from the
 * capability definition, then the widget default (`resolveWidgetIcon`),
 * rendered with the glyph's OWN icon family (`WidgetGlyphIcon` — Quạt's
 * `fan` is a MaterialCommunityIcons glyph, amendment 3).
 *
 * Switch CONTROL (dashboard-history-board-touch-share, AD-1): the platform
 * `Switch` is replaced by a DRAWN track + thumb inside a Pressable whose
 * own bounds are the hit target — explicit minWidth/minHeight 44 on BOTH
 * card widths (never `transform: scale`, which paints bigger without
 * growing the touch area). Track: teal ON / neutral gray OFF; thumb:
 * on-primary ON / surface OFF.
 *
 * State rendering (approved Smart Home states + amendments 2–3):
 * - ON: the TEAL accent (track + icon) — an explicitly defined capability
 *   color keeps its precedence over the accent (same rule as
 *   `resolveCapabilityAccent`),
 * - OFF: neutral gray,
 * - UNKNOWN (no state entry at all, connected): muted neutral icon +
 *   switch at reduced opacity — visually DISTINCT from OFF — with the
 *   VISIBLE caption "Chưa rõ trạng thái" under the name (never plain OFF)
 *   and the accessible value text stating the unknown status.
 * - OFFLINE (MQTT connection not `'connected'`, amendments 2–3): the
 *   switch is DISABLED, the visible caption "Không thể điều khiển" sits
 *   UNDER the device name, and the ICON STAYS VISUALLY CLEAR (amendment 3:
 *   no opacity muting on the glyph — the disabled switch + the caption
 *   carry the offline signal; only the switch wrapper keeps its muted
 *   distinct styling). Offline WINS for the glyph: the offline ∩
 *   unconfirmed intersection keeps the icon clear too — only the
 *   CONNECTED-unknown state mutes the icon. This SUPERSEDES the previous "optimistic even
 *   offline" behavior (disclosed, user-directed): no optimistic flip is
 *   attempted while offline. While CONNECTED the confirmed-state
 *   optimistic toggle + rollback + reconciliation are unchanged (tapping
 *   an unknown switch still flips optimistically and renders the ON
 *   accent).
 *
 * The committed value comes from `getState` (last known relay state). While
 * connected, toggling is OPTIMISTIC: the rendered switch flips immediately
 * via a local `override`, then `sendCommand` is called. When the command
 * fails synchronously (publish rejected), the override is rolled back and an
 * inline error shows the failure reason (closes KNOWN ISSUE-001). When the
 * command times out asynchronously (relay acknowledgement timeout, M13-4),
 * the failure arrives through the reactive `getCommandError` seam
 * (`relay:commandFailed` → DeviceStateSync → store): the widget watches the
 * command error with an effect, clears its local override so the ROLLED
 * BACK committed state becomes visible again, and renders the message
 * inline through the same error row. A later successful command/feedback
 * clears the store error (DeviceStateSync), which removes the inline
 * message. When the committed feedback catches up with the override, the
 * override is cleared so external state changes stay visible. The live
 * connection state flows in through the widget services seam
 * (`useConnectionState`).
 *
 * NO one-line clamps: the title, the captions and the inline error reflow
 * at font scale (the smart view card grows via its per-type `minHeight`
 * floor) — the error message must stay fully readable, never truncated.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@core/i18n';
import { INTER_SEMIBOLD, useTheme } from '@core/theme';

import type { WidgetConfig } from '../../domain/widgetTypes';
import { resolveWidgetIcon } from '../../domain/widgetIcon';
import { WidgetGlyphIcon } from './WidgetGlyphIcon';
import {
  useWidgetServices,
  useCapabilityState,
  useCommandError,
  useConnectionState,
} from '../widgetContext';

/** Reduced opacity of the muted UNKNOWN rendering (icon + switch). */
const UNKNOWN_OPACITY = 0.45;

/**
 * Switch widget: icon chip + friendly title + RN switch — one row at full
 * width, stacked identity/control rows in the narrow single-column compact
 * layout — plus the state caption (offline / unknown) and an optional
 * inline error.
 *
 * Title fallback chain (M2 title fix): `config.title ?? bound device name ??
 * capability definition label ?? generic switch label`.
 *
 * @param props.config - widget config (binding must point at a switch cap).
 */
export function SwitchWidget({ config }: { config: WidgetConfig }) {
  const { tokens } = useTheme();
  const services = useWidgetServices();
  const [error, setError] = useState<string | null>(null);
  /**
   * Optimistic toggle override: `null` = show the committed value; `true`/
   * `false` = show this value until the committed feedback matches (then
   * clear) or the command fails (then roll back).
   */
  const [override, setOverride] = useState<boolean | null>(null);

  const deviceId = config.binding?.deviceId ?? '';
  const capability = config.binding?.capability ?? 'switch';
  const enabled = !!config.binding && !!deviceId;

  // CP-R1: reactive subscription via useSyncExternalStore hook.
  const state = useCapabilityState(deviceId, capability, enabled);
  // Amendment-2 offline lock: the LIVE MQTT connection snapshot decides
  // whether the switch is operational at all.
  const connection = useConnectionState();
  const offline = connection.state !== 'connected';
  // M13-4 async failure seam: the relay acknowledgement timeout lands here
  // (relay:commandFailed → DeviceStateSync → store). The sync rejections
  // stay on the local `error` state below; this one is the ASYNC path.
  const commandError = useCommandError(deviceId, capability, enabled);
  // UNKNOWN = no committed observation AND no optimistic override (a tap
  // already expresses user intent — the flipped value renders confidently).
  const unknown = state === undefined && override === null;
  const committed =
    state && typeof state.value === 'boolean' ? state.value : false;
  const value = override ?? committed;

  const def = services
    .getCapabilities()
    .find(candidate => candidate.type === capability);

  // Per-device glyph (amendment 2): device icon → capability icon → default.
  const device = services.getDevices().find(item => item.id === deviceId);

  // Smart Home accents: teal for the ACTIVE state, neutral gray for OFF /
  // the muted UNKNOWN base. An explicitly defined capability color keeps
  // its precedence over the teal accent (CP5 per-capability contract).
  const activeColor = def?.color ?? tokens.smart.colors.teal;
  const neutralColor = tokens.smart.colors.neutral;

  // Muted base for the SWITCH wrapper: the UNKNOWN state or the OFFLINE
  // lock (amendment 2) — visually distinct from an operational OFF.
  const muted = unknown || offline;
  // Icon clarity (scope amendment 3, reviewer-6 fix): OFFLINE WINS for the
  // glyph — only the CONNECTED-UNKNOWN state mutes the icon chip. The
  // offline ∩ unconfirmed intersection keeps the icon at FULL clarity: the
  // disabled switch + the "Không thể điều khiển" caption carry the offline
  // signal instead.
  const iconMuted = !offline && unknown;

  // M2 title fix: seeded widgets carry no `title`, so the bound DEVICE name
  // ("Đèn"/"Quạt") must win over the capability label ("Công tắc") — works
  // for existing persisted data without a reset.
  const title =
    config.title ?? device?.name ?? def?.label ?? STRINGS.widgets.switch;

  const handleValueChange = (next: boolean) => {
    // OFFLINE lock (amendment 2): the switch is disabled offline — no
    // optimistic flip is attempted (a disabled Pressable does not fire;
    // this guard keeps the contract explicit).
    if (offline) {
      return;
    }
    // Optimistic render FIRST: the switch flips immediately (even before
    // relay feedback arrives) instead of waiting on the store.
    setOverride(next);
    const result = services.sendCommand(deviceId, capability, next);
    if (!result.ok) {
      // Command rejected: roll the optimistic flip back + surface why.
      setOverride(null);
      setError(result.error.message);
    } else {
      setError(null);
    }
  };

  // Committed feedback caught up with the override → the override has done
  // its job; clear it so later external state changes are not masked.
  // (Post-commit state reset — the approved optimistic-toggle pattern.)
  useEffect(() => {
    if (override !== null && committed === override) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- approved post-commit override reset
      setOverride(null);
    }
  }, [committed, override]);

  // Async failure (M13-4): when a command error appears while an
  // optimistic override is showing, the store has ALREADY rolled the
  // committed value back — clear the override so the restored (or unknown)
  // committed state becomes visible instead of the stale optimistic flip.
  // (Approved set-state-in-effect precedent: the async failure reset.)
  useEffect(() => {
    if (commandError !== null && override !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- approved async-failure override reset
      setOverride(null);
    }
  }, [commandError, override]);

  // Inline error row: the synchronous publish rejection wins (it is the
  // most recent user action); otherwise the async timeout error.
  const inlineError = error ?? commandError;

  // Visible state caption (amendment 2): the offline lock explains why the
  // switch is disabled; the connected-unknown state states its status as
  // VISIBLE text — never rendered as plain OFF.
  const caption = offline
    ? STRINGS.widgets.offlineCaption
    : unknown
    ? STRINGS.widgets.unknownCaption
    : null;

  // Narrow-slot compact presentation (dashboard-editor-switch-compact-
  // layout): at `layout.width === 1` the 40pt icon chip, the flexible name
  // column and the intrinsic native Switch cannot coexist on one line
  // without squeezing the name into a mid-word wrap. The identity keeps its
  // own full-width row and the switch moves to a dedicated trailing row —
  // the full title text stays in the render tree (no clamp/ellipsis) and
  // the native Switch keeps its unscaled intrinsic touch target.
  const compact = config.layout.width === 1;

  const iconChipNode = (
    <View
      style={[
        styles.iconChip,
        {
          backgroundColor: tokens.smart.colors.page,
          borderColor: tokens.smart.colors.cardBorder,
          opacity: iconMuted ? UNKNOWN_OPACITY : 1,
        },
      ]}
    >
      <WidgetGlyphIcon
        icon={resolveWidgetIcon(device?.icon, def?.icon, {
          family: 'ionicons',
          name: 'power-outline',
        })}
        size={20}
        // State-aware glyph (approved semantics: teal only for the
        // active state, neutral off / muted unknown otherwise). An
        // explicitly defined capability color is an intentional
        // per-capability contract and wins in every state.
        color={def?.color ?? (value ? activeColor : neutralColor)}
      />
    </View>
  );

  const nameColumnNode = (
    // Name column (scope amendment 3): the device name with the state
    // caption STACKED UNDER it, aligned with the name column — the icon
    // chip stays left, the switch right (full-width) / below (compact).
    <View style={styles.nameColumn}>
      <Text style={[styles.title, { color: tokens.smart.colors.textPrimary }]}>
        {title}
      </Text>
      {caption ? (
        <Text
          style={[styles.caption, { color: tokens.smart.colors.textSecondary }]}
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );

  const switchControlNode = (
    // Drawn switch control (dashboard-history-board-touch-share, AD-1):
    // the platform Switch is replaced by a DRAWN track + thumb inside a
    // Pressable whose own bounds are the hit target — explicit
    // minWidth/minHeight 44 on BOTH card widths, never `transform: scale`
    // (scaling paints bigger without growing the touch area). The switch
    // semantics stay complete: accessibilityRole 'switch', the
    // checked/disabled state, the accessible value text, teal track ON /
    // neutral gray OFF, on-primary thumb ON / surface thumb OFF.
    <View style={muted ? styles.unknownSwitch : undefined}>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: value, disabled: offline }}
        accessibilityValue={{
          text: offline
            ? STRINGS.widgets.offlineCaption
            : unknown
            ? STRINGS.widgets.stateUnknown
            : value
            ? STRINGS.widgets.on
            : STRINGS.widgets.off,
        }}
        disabled={offline}
        onPress={() => handleValueChange(!value)}
        style={styles.switchControl}
      >
        <View
          style={[
            styles.switchTrack,
            {
              backgroundColor: value ? activeColor : neutralColor,
              justifyContent: value ? 'flex-end' : 'flex-start',
            },
          ]}
          testID="switch-track"
        >
          <View
            style={[
              styles.switchThumb,
              { backgroundColor: value ? tokens.onPrimary : tokens.surface },
            ]}
            testID="switch-thumb"
          />
        </View>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.card}>
      {compact ? (
        <View style={styles.compactBody}>
          <View style={styles.row}>
            {iconChipNode}
            {nameColumnNode}
          </View>
          <View style={styles.compactSwitchRow}>{switchControlNode}</View>
        </View>
      ) : (
        <View style={styles.row}>
          {iconChipNode}
          {nameColumnNode}
          {switchControlNode}
        </View>
      )}
      {inlineError ? (
        <Text style={[styles.error, { color: tokens.danger }]}>
          {inlineError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  // ONE friendly row: icon chip, name column (title + stacked caption),
  // operational switch. At full width it carries all three; in the compact
  // layout it is the identity row (chip + name column only).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Narrow single-column compact body: the identity row and the dedicated
  // switch row stack vertically (see the compact derivation above).
  compactBody: {
    flexDirection: 'column',
    gap: 10,
  },
  // Dedicated compact switch row: the UNSCALED native switch rides the
  // trailing edge — the same right-side position it occupies in the
  // full-width anatomy. No width/height/transform overrides, so the
  // platform touch target is untouched.
  compactSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  // Soft icon chip (approved anatomy): page-tinted surface + hairline border.
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Name column (scope amendment 3): the title with the state caption
  // stacked UNDER it (aligned with the name column; grows with content).
  nameColumn: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontFamily: INTER_SEMIBOLD },
  // Muted UNKNOWN/OFFLINE switch wrapper: reduced opacity (visually
  // distinct from an operational OFF). The ICON is never muted offline
  // (scope amendment 3 — icon clarity).
  unknownSwitch: { opacity: UNKNOWN_OPACITY },
  // Drawn switch control (AD-1): the Pressable IS the hit target — its
  // explicit ≥44×44 bounds wrap the painted track with breathing room,
  // centered so the control stays visually anchored on both rows.
  switchControl: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The painted track (iOS-switch geometry): teal ON / neutral gray OFF
  // rides the dynamic backgroundColor; the thumb rides flex-start (OFF)
  // / flex-end (ON) — position without any transform.
  switchTrack: {
    width: 51,
    height: 31,
    borderRadius: 15.5,
    padding: 2,
    flexDirection: 'row',
  },
  // The painted thumb: on-primary ON / surface OFF (dynamic token).
  switchThumb: { width: 27, height: 27, borderRadius: 13.5 },
  // Visible state caption (amendments 2–3): offline lock + connected-
  // unknown, stacked directly under the device name inside the name column.
  caption: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  error: { fontSize: 12, marginTop: 6 },
});
