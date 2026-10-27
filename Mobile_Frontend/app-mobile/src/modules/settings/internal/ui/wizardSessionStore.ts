/**
 * Wizard session store (Amendment 2 B2; mode model as of
 * advanced-settings-sequential-recovery) — the guided MQTT configuration
 * flow's SESSION-SCOPED position: `currentStep` + `savedOk` + `mode` live
 * here instead of screen-local `useState`, so leaving the screen
 * (Dashboard tab) and returning restores the reached official step and
 * the setup/status mode ("vẫn phải giữ được step đang làm").
 *
 * Lifecycle contract:
 * - MODULE-SCOPED singleton (`getWizardSessionStore`): the state survives
 *   screen unmount/remount within the app session.
 * - NOT persisted: no AsyncStorage — an app restart re-evaluates the
 *   module and the screen falls back to its mount-resolve (persisted
 *   config → status mode, else setup), per the approved mount contract.
 * - `currentStep === null` = "no session position yet" → the screen's
 *   mount-resolve decides. `mode === null` = no session mode yet (same
 *   rule). `savedOk` = THIS session's successful save (the step-3 seal).
 * - Probe results/errors stay screen-local on purpose (they describe the
 *   CURRENT mount's checks); only the POSITION/MODE is session-scoped.
 *
 * This store NEVER triggers an automatic failure rewind (the old A2
 * broker-loss override is retired): a runtime MQTT failure only surfaces
 * recovery actions — the user's explicit `Cấu hình lại` is the only path
 * from status mode back to setup Step 1, and it flows through the same
 * setStep/setMode actions below.
 */

import { create } from 'zustand';

/** One guided-flow step (the official setup stepper has EXACTLY three). */
export type WizardStep = 1 | 2 | 3;

/**
 * The flow's MODE (advanced-settings-sequential-recovery): `setup` hosts
 * the official three-step stepper; `status` is the post-save live-state
 * mode (informally "step 4" — never a stepper level, never a tab).
 */
export type WizardMode = 'setup' | 'status';

interface WizardSessionState {
  /**
   * The flow's position; `null` = no position established this session
   * (the screen's mount-resolve applies: host-valid → step 2, else 1).
   */
  currentStep: WizardStep | null;
  /** Whether THIS session's `Lưu cấu hình` has succeeded (step-3 seal). */
  savedOk: boolean;
  /**
   * The active mode; `null` = no session mode yet (the screen's mount
   * default applies: persisted config → `status`, else `setup`).
   */
  mode: WizardMode | null;
  /** Record a flow transition (advance, Chỉnh sửa/Quay lại, edit). */
  setStep(step: WizardStep): void;
  /** Record the save outcome (success seals step 3; resets unseal it). */
  setSavedOk(saved: boolean): void;
  /** Record a mode transition (save success, explicit Cấu hình lại). */
  setMode(mode: WizardMode): void;
}

/** The zustand store instance shape returned by {@link createWizardSessionStore}. */
export type WizardSessionStore = ReturnType<typeof createWizardSessionStore>;

/** Create the wizard session store (tests create isolated instances). */
export function createWizardSessionStore() {
  return create<WizardSessionState>(set => ({
    currentStep: null,
    savedOk: false,
    mode: null,
    setStep: step => set({ currentStep: step }),
    setSavedOk: saved => set({ savedOk: saved }),
    setMode: mode => set({ mode }),
  }));
}

/** Lazily-created session singleton (module scope — survives remounts). */
let defaultStore: WizardSessionStore | null = null;

/**
 * The session singleton. The screen consumes this; tests may reset it via
 * `setState({ currentStep: null, savedOk: false, mode: null })` between
 * cases.
 */
export function getWizardSessionStore(): WizardSessionStore {
  if (defaultStore === null) {
    defaultStore = createWizardSessionStore();
  }
  return defaultStore;
}
