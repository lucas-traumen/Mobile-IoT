/**
 * Room filtering — which widgets are visible under a room filter.
 *
 * Pure, synchronous, no dependencies: the dashboard screen applies this to
 * the active dashboard's widgets before rendering.
 *
 * - `roomId === null` ("Tất cả") → every widget.
 * - `roomId === '<id>'` → widgets of that room + widgets without a room
 *   (global widgets show under every room filter).
 */

import type { WidgetConfig } from '@modules/widgets/api';

/**
 * Filter widgets for a room.
 *
 * @param widgets - the dashboard's widgets (order preserved).
 * @param roomId - room to filter by; `null` disables filtering.
 * @returns the visible widgets.
 */
export function filterWidgetsForRoom(
  widgets: readonly WidgetConfig[],
  roomId: string | null,
): WidgetConfig[] {
  if (roomId === null) {
    return [...widgets];
  }
  return widgets.filter(
    widget => widget.roomId === roomId || widget.roomId === undefined,
  );
}

/**
 * Regroup a flat widget list into the Template's room-reference order —
 * the same normalization the editor's atomic Save applies before
 * committing (`saveDraft` groups the flat draft per room reference, in
 * Template room order, preserving each room's widget order). Widgets whose
 * `roomId` is not referenced are DROPPED — callers that need totality use
 * {@link widgetsMatchAfterRoomOrdering}.
 *
 * @param widgets - a flat widget list (e.g. the editor draft).
 * @param rooms - the Template's ordered room references.
 */
export function orderWidgetsByTemplateRooms(
  widgets: readonly WidgetConfig[],
  rooms: readonly { readonly roomId: string }[],
): WidgetConfig[] {
  return rooms.flatMap(room =>
    widgets.filter(widget => widget.roomId === room.roomId),
  );
}

/**
 * Semantic equality AFTER the store's own regrouping: `true` when both
 * flat lists hold the same widgets (JSON sense) in the same per-room
 * order, regardless of where a cross-room insertion landed in the flat
 * arrays. This is the editor's dirty/exit comparison — a cross-room
 * duplicate/move appends at the END of the flat draft while the Save
 * regroups per room, so the flat orders legitimately differ even though
 * the draft is semantically identical to the persisted state.
 *
 * Totality guard: any widget whose `roomId` is not among `rooms` (or an
 * otherwise unbalanced list) makes the comparison `false` — a widget is
 * never silently dropped from the equality decision.
 *
 * @param a - first flat list (e.g. the live draft).
 * @param b - second flat list (e.g. the persisted Template widgets).
 * @param rooms - the Template's ordered room references.
 */
export function widgetsMatchAfterRoomOrdering(
  a: readonly WidgetConfig[],
  b: readonly WidgetConfig[],
  rooms: readonly { readonly roomId: string }[],
): boolean {
  const normalizedA = orderWidgetsByTemplateRooms(a, rooms);
  const normalizedB = orderWidgetsByTemplateRooms(b, rooms);
  if (normalizedA.length !== a.length || normalizedB.length !== b.length) {
    return false;
  }
  return JSON.stringify(normalizedA) === JSON.stringify(normalizedB);
}
