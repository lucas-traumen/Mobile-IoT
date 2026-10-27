/**
 * Clock abstraction — lets tests control time deterministically
 * (backoff scheduling, timestamps, retention windows).
 */

/** Abstraction over time sources used by the app. */
export interface Clock {
  /** Current Unix epoch seconds. */
  nowSeconds(): number;
  /** Current Unix epoch milliseconds. */
  nowMillis(): number;
  /** Schedule a callback after `ms`; returns a cancel function. */
  setTimeout(callback: () => void, ms: number): () => void;
}

/** Real wall-clock implementation (backed by global timers). */
export class SystemClock implements Clock {
  nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  nowMillis(): number {
    return Date.now();
  }

  setTimeout(callback: () => void, ms: number): () => void {
    const id = globalThis.setTimeout(callback, ms);
    return () => globalThis.clearTimeout(id);
  }
}

/** Deterministic clock for tests; can be advanced manually. */
export class FakeClock implements Clock {
  private now = 0;

  /** Advance the fake time by `ms` (fires due timers). */
  advance(ms: number): void {
    this.now += ms;
    for (const timer of Array.from(this.timers)) {
      if (timer.dueAt <= this.now) {
        this.timers.delete(timer);
        timer.callback();
      }
    }
  }

  nowSeconds(): number {
    return Math.floor(this.now / 1000);
  }

  nowMillis(): number {
    return this.now;
  }

  setTimeout(callback: () => void, ms: number): () => void {
    const timer = { dueAt: this.now + ms, callback };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  }

  private readonly timers = new Set<{ dueAt: number; callback: () => void }>();
}
