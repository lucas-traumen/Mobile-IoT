/**
 * i18n error-label tests (CP5).
 *
 * Verifies that the friendly Vietnamese label map is total over the
 * {@link AppErrorCode} union: every code in ALL_ERROR_CODES has a non-empty
 * label, and errorLabel returns it.
 */

import { ALL_ERROR_CODES, ERROR_LABELS, errorLabel } from './errors';

describe('errorLabel (CP5)', () => {
  it('has a label for every error code', () => {
    expect(ALL_ERROR_CODES.length).toBeGreaterThan(0);
    for (const code of ALL_ERROR_CODES) {
      expect(typeof ERROR_LABELS[code]).toBe('string');
      expect(ERROR_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  it('returns the mapped label for a code', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(errorLabel(code)).toBe(ERROR_LABELS[code]);
    }
  });

  it('labels the common connection failure codes in Vietnamese', () => {
    expect(errorLabel('network')).toBe('Lỗi kết nối mạng');
    expect(errorLabel('auth')).toBe('Sai thông tin đăng nhập');
    expect(errorLabel('timeout')).toBe('Hết thời gian chờ');
  });
});
