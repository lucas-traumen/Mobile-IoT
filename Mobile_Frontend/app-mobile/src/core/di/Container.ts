/**
 * Manual dependency injection container (composition root helpers).
 *
 * Keeps the "wire everything once" ceremony in `src/app/wiring/container.ts`
 * while giving modules typed access to shared singletons without global state.
 */

/** A lazily-created singleton factory. */
export type Factory<T> = () => T;

/**
 * Tiny manual DI container. Register factories once at startup (composition
 * root), then resolve instances anywhere. Instances are memoized per token.
 */
export class Container {
  private readonly factories = new Map<unknown, Factory<unknown>>();
  private readonly instances = new Map<unknown, unknown>();

  /** Register a factory (lazily instantiates on first {@link resolve}). */
  register<T>(token: unknown, factory: Factory<T>): void {
    this.factories.set(token, factory as Factory<unknown>);
    this.instances.delete(token);
  }

  /** Resolve the instance for `token`, creating it on first use. */
  resolve<T>(token: unknown): T {
    const existing = this.instances.get(token);
    if (existing !== undefined) {
      return existing as T;
    }
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(
        `Container: no factory registered for token ${String(token)}`,
      );
    }
    const instance = factory();
    this.instances.set(token, instance);
    return instance as T;
  }

  /** Remove all registrations (used by tests between cases). */
  clear(): void {
    this.factories.clear();
    this.instances.clear();
  }
}
