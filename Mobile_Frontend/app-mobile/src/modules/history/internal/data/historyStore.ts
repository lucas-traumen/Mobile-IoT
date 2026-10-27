/**
 * History store — thin ViewModel: current range, loading/error state and the
 * last fetched series, plus a monotonic request id (CP-R5 stale-request
 * guard): a resolved older request can never overwrite a newer one.
 */

import { create } from 'zustand';

import type { HistoryRange, HistorySeries } from '@modules/history/api';

interface HistoryState {
  /** Selected chart range. */
  range: HistoryRange;
  /** Last fetched series (one per deviceId + field). */
  series: HistorySeries[];
  loading: boolean;
  error: string | null;
  /**
   * Monotonic id of the newest request (CP-R5). `beginRequest` bumps it and
   * returns the value the caller must pass to the conditional result
   * appliers; older request results are dropped.
   */
  requestId: number;
  /**
   * Start a new request: bumps + returns the request id and switches the
   * store to loading (previous series stay visible while loading).
   */
  beginRequest(): number;
  /** Apply a successful result only when its request is still current. */
  setSeriesIfCurrent(requestId: number, series: HistorySeries[]): boolean;
  /** Apply a failure only when its request is still current. */
  setErrorIfCurrent(requestId: number, error: string | null): boolean;
  setRange(range: HistoryRange): void;
  setLoading(loading: boolean): void;
}

/** Create the history zustand store. */
export function createHistoryStore() {
  return create<HistoryState>((set, get) => ({
    range: '1h',
    series: [],
    loading: false,
    error: null,
    requestId: 0,

    beginRequest: () => {
      const id = get().requestId + 1;
      set({ requestId: id, loading: true, error: null });
      return id;
    },
    setSeriesIfCurrent: (requestId, series) => {
      if (get().requestId !== requestId) {
        return false;
      }
      set({ series, loading: false, error: null });
      return true;
    },
    setErrorIfCurrent: (requestId, error) => {
      if (get().requestId !== requestId) {
        return false;
      }
      set({ error, loading: false });
      return true;
    },
    setRange: range => set({ range, error: null }),
    setLoading: loading => set({ loading }),
  }));
}

/** The zustand store instance shape returned by {@link createHistoryStore}. */
export type HistoryStore = ReturnType<typeof createHistoryStore>;
