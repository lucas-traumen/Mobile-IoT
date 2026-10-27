/**
 * i18n module — Vietnamese UI strings.
 *
 * Single source of truth for every user-facing label. `STRINGS` is typed
 * (`as const`) so typos in keys fail TypeScript.
 */

export { STRINGS } from './strings';
export type { Strings } from './strings';
export { ALL_ERROR_CODES, ERROR_LABELS, errorLabel } from './errors';
export { mqttConnectionLabel } from './connection';
