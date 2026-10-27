/**
 * Devices UI store — zustand ViewModel mirroring the registry snapshot.
 *
 * The registry service pushes the updated snapshot into this store after
 * every mutation so screens re-render without polling. Pure UI state: all
 * business rules live in the registry service / domain.
 */

import { create } from 'zustand';

import type { Device, DevicesSnapshot, Room } from '../domain/devices';

interface DevicesUiState {
  /** Latest persisted snapshot (rooms + devices + capability catalog). */
  snapshot: DevicesSnapshot;
  /** Replace the whole snapshot (called by the registry after mutations). */
  setSnapshot(snapshot: DevicesSnapshot): void;
  /** All rooms (convenience selector). */
  getRooms(): readonly Room[];
  /** All devices (convenience selector). */
  getDevices(): readonly Device[];
}

/** Create the devices UI zustand store. */
export function createDevicesStore(initial: DevicesSnapshot) {
  return create<DevicesUiState>((set, get) => ({
    snapshot: initial,
    setSnapshot: snapshot => set({ snapshot }),
    getRooms: () => get().snapshot.rooms,
    getDevices: () => get().snapshot.devices,
  }));
}

/** The zustand store instance shape returned by {@link createDevicesStore}. */
export type DevicesStore = ReturnType<typeof createDevicesStore>;
