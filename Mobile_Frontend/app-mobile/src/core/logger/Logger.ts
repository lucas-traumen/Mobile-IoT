/**
 * Structured logger.
 *
 * The whole app must go through this logger — `console.log` is banned by
 * ESLint. Logs are prefixed with the emitting component so debug sessions
 * stay greppable.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Minimal logger contract (also used by the event bus for error isolation). */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** No-op logger (used in tests / when logging is disabled). */
export class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Console-backed structured logger. `scope` is prepended to every message:
 * `[scope] message`.
 */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly scope: string,
    private readonly level: LogLevel = 'info',
  ) {}

  private log(level: LogLevel, message: string, args: unknown[]): void {
    const ordered: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    if (ordered.indexOf(level) < ordered.indexOf(this.level)) {
      return;
    }
    const fn =
      level === 'debug' || level === 'info'
        ? console.info
        : level === 'warn'
        ? console.warn
        : console.error;
    fn(`[${this.scope}] ${message}`, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, args);
  }
}

/** Create a scoped logger. */
export function createLogger(scope: string): Logger {
  return new ConsoleLogger(scope);
}
