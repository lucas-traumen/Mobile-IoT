/**
 * Error taxonomy and `Result` type shared across the app.
 *
 * Domain code never throws for expected failures: it returns
 * {@link Result}. Adapters translate transport/IO failures into
 * {@link AppError} instances so callers get a stable, structured error.
 */

/** Coarse error category, used to decide how the UI/logs treat the error. */
export type AppErrorCode =
  | 'validation'
  | 'not-found'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'config'
  | 'unknown';

/** Structured error value (no `Error` subclass — plain data, easy to serialize). */
export interface AppError {
  /** Stable machine-readable category. */
  readonly code: AppErrorCode;
  /** Human-readable message safe to show in the UI. */
  readonly message: string;
  /** Optional originating error / extra context (never exposed in the UI). */
  readonly cause?: unknown;
}

/** Build a typed {@link AppError}. */
export function appError(
  code: AppErrorCode,
  message: string,
  cause?: unknown,
): AppError {
  return { code, message, cause };
}

/** Shortcuts for the most common error categories. */
export const Errors = {
  validation: (message: string, cause?: unknown): AppError =>
    appError('validation', message, cause),
  notFound: (message: string, cause?: unknown): AppError =>
    appError('not-found', message, cause),
  network: (message: string, cause?: unknown): AppError =>
    appError('network', message, cause),
  timeout: (message: string, cause?: unknown): AppError =>
    appError('timeout', message, cause),
  auth: (message: string, cause?: unknown): AppError =>
    appError('auth', message, cause),
  config: (message: string, cause?: unknown): AppError =>
    appError('config', message, cause),
  unknown: (message: string, cause?: unknown): AppError =>
    appError('unknown', message, cause),
} as const;

/**
 * Result of an operation that can fail with an {@link AppError}.
 *
 * ```ts
 * const result: Result<number, AppError> = parseIntSafe('42');
 * if (result.ok) {
 *   console.log(result.value);
 * } else {
 *   console.log(result.error.code);
 * }
 * ```
 */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct an ok result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Construct an err result. */
export function err<E = AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** True when the result is ok; narrows the type for the caller. */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { ok: true; value: T } {
  return result.ok;
}

/** True when the result is err; narrows the type for the caller. */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { ok: false; error: E } {
  return !result.ok;
}

/**
 * Run a fallible function and capture any thrown exception as an
 * {@link AppError} (`unknown` category). Use at adapter boundaries only —
 * domain logic must stay pure and never throw.
 */
export function tryCatch<T>(fn: () => T, message: string): Result<T, AppError> {
  try {
    return ok(fn());
  } catch (e) {
    return err(Errors.unknown(message, e));
  }
}
