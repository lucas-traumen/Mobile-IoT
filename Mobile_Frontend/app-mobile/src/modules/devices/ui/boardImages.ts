/**
 * Board-type → bundled photo map (boards-display-by-type, AD-1): one image
 * per hardware TYPE — a presentation concern of the boards screen — same
 * pure-file pattern as history's `valueAxis`/`timeAxis`, NOT exported
 * through the module `api/`.
 *
 * WHY keyed by the board TYPE (AD-1, user-approved): every board of the
 * same type displays identically ("cùng loại thì dùng 1 cái"), so they
 * share ONE photo. The key source is the descriptor `boardType` hardware
 * string (e.g. `IoT_ESP32-S2R3`) — never the wire code, never the
 * `displayName` (display-deprecated metadata). A hardware revision is a
 * NEW boardType string (`IoT_ESP32-S2R3-V2`) and therefore naturally gets
 * its own title + image without any app change.
 *
 * To add a photo later (file-drop convention): the map key is the SLUG of
 * the boardType (`slugifyBoardName`) — `IoT_ESP32-S2R3` → drop the file at
 * `assets/boards/iot-esp32-s2r3.png` — then add ONE map line here, no
 * logic changes, and casing/underscore drift cannot desync the key from
 * the filename:
 *
 * ```ts
 * 'iot-esp32-s2r3': require('../../../../assets/boards/iot-esp32-s2r3.png'),
 * ```
 *
 * The `require()` MUST stay a static string literal — Metro bundles only
 * statically analyzable assets and cannot resolve a dynamic
 * `require(variable)`. Until real photos arrive the map stays EMPTY and
 * every board renders the Ionicons `hardware-chip-outline` placeholder
 * (the screen's fallback). A board without a descriptor has no type yet —
 * the screen passes `''`, which never matches a key, so it stays on the
 * placeholder too.
 */

import type { ImageSourcePropType } from 'react-native';

/**
 * Normalize a boardType string into its map/file key (pure): trim,
 * lowercase, strip diacritics (NFD + remove the combining marks), fold
 * runs of spaces/underscores into a single `-`, and keep only
 * `[a-z0-9-]`. Casing/spacing tolerant — `IoT_ESP32-S2R3`,
 * `iot_esp32-s2r3` and `IOT  ESP32-S2R3` all produce `iot-esp32-s2r3` —
 * so the map key always matches the filename and never drifts on casing
 * or extra whitespace. An empty or all-space type safely produces `''`,
 * which simply never matches a key (the caller keeps the placeholder) —
 * this is the no-descriptor board's path.
 *
 * Characters outside the kept set are dropped (e.g. "Đ" has no NFD
 * decomposition, so "Đèn" → "en"): name types with basic Latin when an
 * exact file mapping matters.
 */
export function slugifyBoardName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * BoardType slug → bundled image source. Deliberately starts EMPTY — no
 * board photos exist yet; the screen falls back to the chip placeholder.
 */
export const BOARD_IMAGES: Record<string, ImageSourcePropType> = {
  // Add one line per board TYPE when photos arrive, e.g.:
  // 'iot-esp32-s2r3': require('../../../../assets/boards/iot-esp32-s2r3.png'),
};

/**
 * Pure lookup: the bundled image for a board TYPE — slugified first — or
 * `null` when the map has no entry (the caller renders the placeholder
 * icon).
 *
 * The `images` parameter exists for tests only (default `BOARD_IMAGES`):
 * the production map starts empty, so a test proves the "has entry" branch
 * with a locally-constructed map instead of shipping a photo.
 *
 * @param boardType - the descriptor `boardType` string (e.g.
 *   `IoT_ESP32-S2R3`); an empty string (no descriptor) never matches a key.
 * @param images - lookup table (defaults to the production {@link BOARD_IMAGES}).
 */
export function boardImageFor(
  boardType: string,
  images: Readonly<Record<string, ImageSourcePropType>> = BOARD_IMAGES,
): ImageSourcePropType | null {
  const source = images[slugifyBoardName(boardType)];
  return source === undefined ? null : source;
}
