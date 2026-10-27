import type { EventBus, EventHandler, EventMap, Unsubscribe } from './EventBus';

/**
 * In-memory, synchronous {@link EventBus} implementation.
 *
 * - Handlers run in subscription order, synchronously on {@link emit}.
 * - A handler that throws is isolated: the error is logged and other
 *   subscribers still run (one broken subscriber must not break the app).
 * - `unsubscribe` is idempotent.
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<
    keyof EventMap,
    Set<EventHandler<never>>
  >();
  private readonly logger: {
    error: (message: string, ...args: unknown[]) => void;
  };

  constructor(logger: {
    error: (message: string, ...args: unknown[]) => void;
  }) {
    this.logger = logger;
  }

  subscribe<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): Unsubscribe {
    const key = event as keyof EventMap;
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler as EventHandler<never>);
    return () => {
      set.delete(handler as EventHandler<never>);
    };
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const key = event as keyof EventMap;
    const set = this.handlers.get(key);
    if (!set) {
      return;
    }
    for (const handler of Array.from(set)) {
      try {
        (handler as EventHandler<EventMap[K]>)(payload);
      } catch (e) {
        this.logger.error(`EventBus: handler for "${event}" threw`, e);
      }
    }
  }
}
