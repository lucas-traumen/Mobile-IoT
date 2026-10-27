/**
 * Board inventory UI store — zustand ViewModel mirroring the discovered
 * boards (board-discovery-binding plan).
 *
 * The BoardInventoryService pushes the updated inventory after every
 * change (status message, telemetry, relay feedback) so the BoardsScreen
 * and the AddRoomDialog board step re-render without polling. Pure UI
 * state: all discovery rules live in the service.
 */

import { create } from 'zustand';

import type { BoardInventoryEntry } from '../services/boardInventoryService';

interface BoardUiState {
  /** Latest discovered boards (insertion order; UI sorts online-first). */
  boards: readonly BoardInventoryEntry[];
  /** Replace the whole inventory (called by the inventory service). */
  setBoards(boards: readonly BoardInventoryEntry[]): void;
  /** All boards (convenience selector). */
  getBoards(): readonly BoardInventoryEntry[];
}

/** Create the board inventory zustand store. */
export function createBoardStore() {
  return create<BoardUiState>((set, get) => ({
    boards: [],
    setBoards: boards => set({ boards }),
    getBoards: () => get().boards,
  }));
}

/** The zustand store instance shape returned by {@link createBoardStore}. */
export type BoardStore = ReturnType<typeof createBoardStore>;
