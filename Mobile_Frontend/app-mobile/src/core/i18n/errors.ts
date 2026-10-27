/**
 * Friendly Vietnamese labels for the coarse {@link AppErrorCode} taxonomy.
 *
 * Screens never show raw error codes: they map an {@link AppErrorCode} to a
 * human sentence through {@link errorLabel} (CP5). The map is total over the
 * code union so a new code fails TypeScript until labelled.
 */

import type { AppErrorCode } from '../errors';

/** Every {@link AppErrorCode} value (runtime iterable, for tests + UI). */
export const ALL_ERROR_CODES: readonly AppErrorCode[] = [
  'validation',
  'not-found',
  'network',
  'timeout',
  'auth',
  'config',
  'unknown',
];

/** Vietnamese friendly label per error code. */
export const ERROR_LABELS: Record<AppErrorCode, string> = {
  validation: 'Dữ liệu không hợp lệ',
  'not-found': 'Không tìm thấy',
  network: 'Lỗi kết nối mạng',
  timeout: 'Hết thời gian chờ',
  auth: 'Sai thông tin đăng nhập',
  config: 'Cấu hình chưa đúng',
  unknown: 'Lỗi không xác định',
};

/**
 * User-facing Vietnamese label for an error code.
 *
 * @param code - the machine-readable {@link AppErrorCode}.
 * @returns the friendly sentence to display.
 */
export function errorLabel(code: AppErrorCode): string {
  return ERROR_LABELS[code];
}
