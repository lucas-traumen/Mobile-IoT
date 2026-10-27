/**
 * Drag-measurement seam for the room-card drag-to-swap reorder.
 *
 * ONE native `measureInWindow` call per drag start (on the dragged card)
 * anchors the grid-relative card layouts (from `onLayout`) into window
 * coordinates so `PanResponder` finger positions (`pageX`/`pageY`) can be
 * compared against the card rects. Isolated in its own module so tests can
 * mock the native measurement deterministically.
 */

import type { View } from 'react-native';

/** A window-space point (the same space as `nativeEvent.pageX/pageY`). */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Window-space origin (top-left) of `node`, or `null` when the node is
 * gone or cannot be measured (the caller snaps back / aborts the drag).
 */
export function measurePageOrigin(
  node: View | null,
): Promise<PagePoint | null> {
  if (!node) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    node.measureInWindow((x, y) => {
      resolve({ x, y });
    });
  });
}
