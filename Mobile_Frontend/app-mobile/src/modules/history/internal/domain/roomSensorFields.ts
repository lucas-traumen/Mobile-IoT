/**
 * History domain: room → history query mapping (pure).
 *
 * Visible History fields follow valid sensor-value bindings in the active
 * Template's saved room layout. Registrations remain the authority for device,
 * room and capability identity; layout order never changes registration order.
 * `null` roomId = no valid active room (no query must be issued).
 */

import type { CapabilityDef, Device } from '@modules/devices/api';
import { projectSensorRegistrations } from '@modules/devices/api';
import type { WidgetConfig } from '@modules/widgets/api';
import type { HistoryQuery, HistoryRange } from './fluxQueryBuilder';

/**
 * Sensor fields (Influx `_field` keys) registered in a room, derived from
 * the pure sensor projection (one visible sensor = one metric; legacy
 * multi-capability boards contribute each of their capabilities).
 *
 * @param devices - all registered devices.
 * @param capabilities - the capability catalog (sensor kinds only project).
 * @param roomId - room to scope to (`null` = no valid room → empty).
 * @param savedWidgets - saved room layout; `[]` or `null` selects nothing.
 *   Omitted keeps the unfiltered registration helper behavior. App History
 *   always supplies an explicit saved scope (missing room reference = `null`).
 * @returns eligible registered fields in registration order (unique).
 */
export function sensorFieldsForRoom(
  devices: readonly Device[],
  capabilities: readonly CapabilityDef[],
  roomId: string | null,
  savedWidgets?: readonly WidgetConfig[] | null,
): readonly string[] {
  if (roomId === null) {
    return [];
  }
  const fields: string[] = [];
  for (const registration of projectSensorRegistrations(
    devices,
    capabilities,
  )) {
    if (
      registration.roomId === roomId &&
      (savedWidgets === undefined ||
        savedWidgets?.some(
          widget =>
            widget.type === 'sensor-value' &&
            widget.roomId === roomId &&
            widget.binding?.deviceId === registration.deviceId &&
            widget.binding.capability === registration.field,
        )) &&
      !fields.includes(registration.field)
    ) {
      fields.push(registration.field);
    }
  }
  return fields;
}

/**
 * Build the room's history query value object (approved `roomId + _field`
 * identity — the query filters the room's tag; fields come from the room's
 * projected registered sensors selected by the optional saved layout).
 *
 * Identity (boards-topic-contract-v2, decision 1): the backend's direct
 * InfluxDB contract tags real-board rows with the `boardId` tag. When
 * `boardCode` is present (the room is bound to a board) the query carries
 * `{boardId: boardCode, roomId: null}` so the Flux filter targets the
 * `boardId` tag; without it the exact historical behavior applies
 * (`tagRoomId ?? roomId` in the `roomId` filter). Field derivation ALWAYS
 * scopes by the internal `roomId` (registrations never carry codes); only
 * the tag identity switches.
 *
 * @param savedWidgets - explicit saved layout scope (`null` = missing room
 *   reference); omitted retains unfiltered helper compatibility.
 * @returns `null` when no sensor is eligible (no query must be issued),
 *   or the query filtering the room/board + selected registered fields.
 */
export function historyQueryForRoom(
  devices: readonly Device[],
  capabilities: readonly CapabilityDef[],
  roomId: string | null,
  range: HistoryRange,
  tagRoomId?: string,
  boardCode?: string,
  savedWidgets?: readonly WidgetConfig[] | null,
): HistoryQuery | null {
  if (roomId === null) {
    return null;
  }
  const fields = sensorFieldsForRoom(
    devices,
    capabilities,
    roomId,
    savedWidgets,
  );
  if (fields.length === 0) {
    return null;
  }
  if (boardCode !== undefined) {
    return {
      measurement: 'sensors',
      range,
      fields,
      roomId: null,
      boardId: boardCode,
    };
  }
  return { measurement: 'sensors', range, fields, roomId: tagRoomId ?? roomId };
}
