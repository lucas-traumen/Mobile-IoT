/**
 * Widget uniqueness (approved room-sensor rework, dashboard slice E):
 * within one dashboard/room a sensor-value binding or a switch binding can
 * appear AT MOST ONCE.
 *
 * The approved uniqueness classes are EXACTLY:
 * a) `sensor-value` — room + type + exact binding,
 * b) `switch`       — room + type + exact binding.
 *
 * ANY other type — including unknown custom widget types — has NO
 * uniqueness constraint: `widgetUniquenessKey` returns `null` for them and
 * every instance survives load/apply migrations (persisted data loss is
 * never acceptable). Retired built-ins (`connection`, `history-chart`,
 * `room-device-list`) are removed separately by the load migration
 * regardless of uniqueness.
 *
 * The same rule drives the Add-flow hiding, the authoritative service
 * validation (`addWidget`/`applyLayout`) and the deterministic load
 * migration (keep the first occurrence of a DUPLICATED APPROVED key, drop
 * later exact duplicates).
 */

import type { WidgetConfig } from './widgetTypes';

/**
 * Widget types the approved uniqueness invariant constrains.
 */
const UNIQUE_TYPES: readonly string[] = ['sensor-value', 'switch'];

/**
 * Canonical uniqueness key of one widget placement, or `null` when the
 * type has NO uniqueness constraint (unknown/custom widget types).
 *
 * - Bound approved widgets (`sensor-value`/`switch`):
 *   `room|type|deviceId:capability` — the exact binding inside the room.
 * - Global widgets (no room) key under the `global` scope.
 */
export function widgetUniquenessKey(
  widget: Pick<WidgetConfig, 'type' | 'roomId' | 'binding'>,
): string | null {
  if (!UNIQUE_TYPES.includes(widget.type)) {
    return null;
  }
  const room = widget.roomId ?? 'global';
  const binding = widget.binding
    ? `${widget.binding.deviceId}:${widget.binding.capability}`
    : 'unbound';
  return `${room}|${widget.type}|${binding}`;
}

/**
 * Collect the duplicate uniqueness keys of a widget list (pure): a key is
 * duplicated when two or more widgets share it. Unconstrained types
 * (`null` keys) never count.
 */
export function duplicateWidgetKeys(
  widgets: readonly Pick<WidgetConfig, 'type' | 'roomId' | 'binding' | 'id'>[],
): Set<string> {
  const seen = new Map<string, number>();
  for (const widget of widgets) {
    const key = widgetUniquenessKey(widget);
    if (key === null) {
      continue;
    }
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [key, count] of seen) {
    if (count > 1) {
      duplicates.add(key);
    }
  }
  return duplicates;
}

/**
 * Human-readable duplicate validation error for a candidate against a
 * widget list, `null` when the placement is unique — or when the type has
 * no uniqueness constraint at all (unknown/custom types).
 *
 * @param widgets - the existing (draft or persisted) widget list.
 * @param candidate - the placement to validate.
 * @param excludeWidgetId - id to ignore (e.g. the widget being re-saved).
 */
export function duplicateWidgetError(
  widgets: readonly Pick<WidgetConfig, 'type' | 'roomId' | 'binding' | 'id'>[],
  candidate: Pick<WidgetConfig, 'type' | 'roomId' | 'binding' | 'id'>,
  excludeWidgetId?: string,
): string | null {
  const candidateKey = widgetUniquenessKey(candidate);
  if (candidateKey === null) {
    return null;
  }
  const clash = widgets.some(
    widget =>
      widget.id !== excludeWidgetId &&
      widgetUniquenessKey(widget) === candidateKey,
  );
  if (!clash) {
    return null;
  }
  const room = candidate.roomId
    ? `room "${candidate.roomId}"`
    : 'the global scope';
  return `A "${candidate.type}" widget for this source already exists in ${room}`;
}

/**
 * Deterministic duplicate removal (load migration): keeps the FIRST
 * occurrence of every duplicated APPROVED uniqueness key, drops later
 * exact duplicates. Unknown/custom types (no key) always survive.
 * Pure + idempotent — a list without duplicates returns unchanged.
 *
 * @returns the deduped list, or the ORIGINAL array reference when nothing
 *   was duplicated (cheap change detection for the caller).
 */
export function dedupeWidgets(
  widgets: readonly WidgetConfig[],
): readonly WidgetConfig[] {
  const seen = new Set<string>();
  let duplicated = false;
  for (const widget of widgets) {
    const key = widgetUniquenessKey(widget);
    if (key === null) {
      continue;
    }
    if (seen.has(key)) {
      duplicated = true;
      continue;
    }
    seen.add(key);
  }
  if (!duplicated) {
    return widgets;
  }
  const kept: WidgetConfig[] = [];
  const seenAgain = new Set<string>();
  for (const widget of widgets) {
    const key = widgetUniquenessKey(widget);
    if (key !== null && seenAgain.has(key)) {
      continue;
    }
    if (key !== null) {
      seenAgain.add(key);
    }
    kept.push(widget);
  }
  return kept;
}
