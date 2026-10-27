/**
 * Board QR label contract (boards-qr-scan, AD-1): a QR label on a board is
 * a 3-field JSON subset of the board descriptor —
 *
 * ```json
 * { "schemaVersion": 1, "boardId": "0", "boardType": "esp32-sensor-relay" }
 * ```
 *
 * The label is generated from the descriptor by the backend/tooling; the
 * app ONLY scans and parses. Deliberately NOT part of the QR: the S/K
 * channel data — those always come from the live retained descriptor, so
 * what the board publishes is what the app displays (a sticker can never
 * disagree with the broker).
 *
 * `boardId` reuses the EXISTING board-code grammar authority
 * (`ROOM_CODE_REGEX` — 1–32 chars of `[a-zA-Z0-9_-]`, the alphabet of one
 * MQTT topic segment) — the same validation the AddRoomDialog manual entry
 * applies; no new regex was invented. Unknown/extra fields are tolerated
 * (zod default strip) so label tooling can enrich the payload without
 * breaking older app versions.
 *
 * Same pure-file pattern as `boardImages.ts`/`valueAxis.ts`: NOT exported
 * through the module `api/` — a screens-local concern.
 */

import { z } from 'zod';

import { ROOM_CODE_REGEX } from '../internal/domain/devices';

/**
 * The QR label schema: `schemaVersion` pinned to 1, `boardId` under the
 * shared board-code grammar (1–32 machine-key chars, mirrored from the
 * room `code` field of `RoomSchema`), `boardType` a non-empty string.
 */
export const BoardQrLabelSchema = z.object({
  schemaVersion: z.literal(1),
  boardId: z.string().min(1).max(32).regex(ROOM_CODE_REGEX, {
    message:
      'Board id must be 1-32 ASCII letters, digits, "_" or "-" (e.g. "board-1")',
  }),
  boardType: z.string().min(1),
});

/** A parsed QR board label (extra QR fields stripped). */
export type BoardQrLabel = z.infer<typeof BoardQrLabelSchema>;

/**
 * Pure QR parse: JSON.parse the raw scan, zod-validate, return the label —
 * or `null` for EVERY malformed input (non-JSON, non-object, wrong
 * schemaVersion, missing fields, boardId grammar violations). Returning
 * `null` (never throwing) keeps the scanner screen trivial: `null` → keep
 * the camera open with the inline error (AD-3); a label → resolve the
 * found / not-found cases (AD-2).
 */
export function parseBoardQrLabel(raw: string): BoardQrLabel | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = BoardQrLabelSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
