/**
 * Settings store — thin ViewModel over {@link SettingsService}.
 *
 * No business logic here: it holds UI state (draft form fields, save status)
 * and forwards validated input to the service.
 */

import { create } from 'zustand';

// Direct module-internal imports (NOT the `@modules/settings/api` barrel):
// the barrel re-exports this very file, so importing it from here creates a
// require cycle (KNOWN ISSUE-006). Internal code uses the internal paths.
import {
  defaultSettings,
  parseSettings,
  type AppSettings,
  type MqttSettings,
  type UiSettings,
} from '../domain/settingsSchema';
import type { SettingsService } from '../services/settingsService';

/** Field-level error map keyed by dotted path (e.g. `mqtt.host`). */
export interface SettingsFormErrors {
  [field: string]: string;
}

interface SettingsState {
  /** Latest persisted settings (what telemetry/history actually use). */
  current: AppSettings;
  /** In-editing draft (mirrors the form). */
  draft: AppSettings;
  /** Field-level validation errors of the current draft. */
  errors: SettingsFormErrors;
  /** True while a save is in flight. */
  saving: boolean;
  /** Last save result message ("" = none). */
  saveMessage: string;
  setCurrent(settings: AppSettings): void;
  /**
   * Adopt a UI-ONLY persisted change (user-authorized exceptional fix):
   * `current` becomes the last persisted settings and the draft's ui part
   * mirrors it, but any DIVERGENT unsaved MQTT/Influx draft edits are
   * PRESERVED (unlike {@link setCurrent}, the full-adoption seam used for
   * bootstrap and explicit full saves). Consumed by the App-level
   * `settings:changed` handler when the event is stamped
   * `changeScope: 'ui-only'`.
   */
  applyPersistedUi(settings: AppSettings): void;
  updateMqtt(patch: Partial<MqttSettings>): void;
  updateInflux(patch: Partial<AppSettings['influx']>): void;
  /**
   * Apply a UI patch immediately (theme is an apply-immediately setting):
   * merges the patch over the LAST PERSISTED settings into `current`,
   * mirrors the ui part into the draft, and persists fire-and-forget.
   * Unsaved MQTT/Influx draft edits are never persisted or emitted by this
   * path — technical settings change only through the explicit `save()`.
   */
  updateUi(patch: Partial<UiSettings>): void;
  save(): Promise<void>;
}

function recomputeErrors(settings: AppSettings): SettingsFormErrors {
  const result = parseSettings(settings);
  if (result.ok) {
    return {};
  }
  const errors: SettingsFormErrors = {};
  for (const message of result.errors) {
    const field = message.split(':')[0];
    errors[field] = message;
  }
  return errors;
}

/** Create a zustand store bound to a settings service. */
export function createSettingsStore(service: SettingsService) {
  return create<SettingsState>((set, get) => ({
    current: defaultSettings(),
    draft: defaultSettings(),
    errors: {},
    saving: false,
    saveMessage: '',

    setCurrent: settings =>
      set({ current: settings, draft: settings, saveMessage: '' }),

    applyPersistedUi: settings =>
      set(state => {
        // UI-only adoption: the persisted snapshot is authoritative for
        // `current` and for the draft's ui preferences, but the draft's
        // technical fields keep their unsaved divergent edits — they were
        // never persisted and must survive the theme round-trip until the
        // explicit Advanced save.
        const draft: AppSettings = {
          ...state.draft,
          ui: settings.ui,
        };
        return {
          current: settings,
          draft,
          errors: recomputeErrors(draft),
          saveMessage: '',
        };
      }),

    updateMqtt: patch =>
      set(state => {
        const draft = {
          ...state.draft,
          mqtt: { ...state.draft.mqtt, ...patch },
        };
        return { draft, errors: recomputeErrors(draft), saveMessage: '' };
      }),

    updateInflux: patch =>
      set(state => {
        const draft = {
          ...state.draft,
          influx: { ...state.draft.influx, ...patch },
        };
        return { draft, errors: recomputeErrors(draft), saveMessage: '' };
      }),

    updateUi: patch => {
      // Theme is an APPLY-IMMEDIATELY setting: the app shell reads
      // `current.ui.theme` (ThemeProvider) while the settings form reads the
      // draft and the theme buttons never call save(). The persistence merge
      // bases on `current` (the last persisted settings) — NEVER on the
      // draft — so unsaved MQTT/Influx edits stay in the draft: they are
      // not saved, not emitted via `settings:changed`, and remain dirty
      // behind the explicit Advanced Settings save. The ui part is mirrored
      // into the draft so the form's theme selection matches what was
      // applied.
      const state = get();
      const updated: AppSettings = {
        ...state.current,
        ui: { ...state.current.ui, ...patch },
      };
      const draft: AppSettings = {
        ...state.draft,
        ui: { ...state.draft.ui, ...patch },
      };
      set({
        current: updated,
        draft,
        errors: recomputeErrors(draft),
        saveMessage: '',
      });
      // Fire-and-forget persistence (the in-memory theme is already
      // applied): failures are tolerated silently — the applied theme stays
      // for this session while the technical draft keeps its unsaved edits.
      // The event is stamped `ui-only` so the App-level handler adopts the
      // persisted ui WITHOUT replacing the divergent technical draft.
      void service
        .save(updated, { changeScope: 'ui-only' })
        .catch(() => undefined);
    },

    save: async () => {
      const { draft } = get();
      const errors = recomputeErrors(draft);
      if (Object.keys(errors).length > 0) {
        set({
          errors,
          saveMessage: 'Fix the highlighted fields before saving.',
        });
        return;
      }
      set({ saving: true, saveMessage: '' });
      const result = await service.save(draft);
      set({ saving: false });
      if (result.ok) {
        set({ saveMessage: 'Settings saved and applied.' });
      } else {
        set({ saveMessage: `Save failed: ${result.error.message}` });
      }
    },
  }));
}

/** The zustand store instance shape returned by {@link createSettingsStore}. */
export type SettingsStore = ReturnType<typeof createSettingsStore>;
