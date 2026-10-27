/**
 * Theme mode — an explicit user preference with exactly two choices.
 *
 * `'system'` was removed (settings-information-architecture plan): the user
 * picks Light (`'light'`) or Dark (`'dark'`) explicitly. Persisted legacy
 * `'system'` values migrate deterministically to `'light'` at parse time
 * (see the settings module's `UiSettingsSchema`), so no runtime path ever
 * sees or resolves `'system'`.
 */

/** User-selectable theme preference (explicit choices only). */
export type ThemeMode = 'light' | 'dark';
