/**
 * Wizard session store tests (B2; mode model as of
 * advanced-settings-sequential-recovery): `currentStep` + `savedOk` +
 * `mode` live in a small SESSION-scoped zustand store so the guided
 * flow's position AND mode survive screen unmount/remount within the app
 * session.
 *
 * Contract:
 * - initial: `currentStep === null` (no session position yet → the
 *   screen's mount-resolve applies), `savedOk === false`,
 *   `mode === null` (no session mode → the mount default applies);
 * - `setStep`/`setSavedOk`/`setMode` update the state (every flow/mode
 *   transition goes through them);
 * - the singleton is module-scoped: the SAME instance is returned across
 *   calls (survives unmount/remount; NO AsyncStorage — an app restart
 *   re-evaluates the module and resets to the mount-resolve);
 * - tests reset the singleton via `setState` (test hygiene only).
 */

import {
  createWizardSessionStore,
  getWizardSessionStore,
} from './wizardSessionStore';

describe('wizard session store (B2 + mode model)', () => {
  beforeEach(() => {
    getWizardSessionStore().setState({
      currentStep: null,
      savedOk: false,
      mode: null,
    });
  });

  it('starts with no session position, no saved seal, no session mode', () => {
    const store = createWizardSessionStore();
    expect(store.getState().currentStep).toBeNull();
    expect(store.getState().savedOk).toBe(false);
    expect(store.getState().mode).toBeNull();
  });

  it('setStep updates the stored position', () => {
    const store = createWizardSessionStore();
    store.getState().setStep(2);
    expect(store.getState().currentStep).toBe(2);
    store.getState().setStep(3);
    expect(store.getState().currentStep).toBe(3);
    store.getState().setStep(1);
    expect(store.getState().currentStep).toBe(1);
  });

  it('setSavedOk updates the saved seal (and resets are possible)', () => {
    const store = createWizardSessionStore();
    store.getState().setSavedOk(true);
    expect(store.getState().savedOk).toBe(true);
    store.getState().setSavedOk(false);
    expect(store.getState().savedOk).toBe(false);
  });

  it('setMode updates the active mode (setup | status — never a tab)', () => {
    const store = createWizardSessionStore();
    store.getState().setMode('status');
    expect(store.getState().mode).toBe('status');
    store.getState().setMode('setup');
    expect(store.getState().mode).toBe('setup');
  });

  it('the singleton state SURVIVES across calls (module-scope session)', () => {
    // Simulate unmount/remount: the screen re-resolves the SAME singleton
    // on every mount, so its state carries across.
    getWizardSessionStore().getState().setStep(3);
    getWizardSessionStore().getState().setSavedOk(true);
    getWizardSessionStore().getState().setMode('status');
    expect(getWizardSessionStore().getState().currentStep).toBe(3);
    expect(getWizardSessionStore().getState().savedOk).toBe(true);
    expect(getWizardSessionStore().getState().mode).toBe('status');
  });

  it('getWizardSessionStore returns the same lazy singleton', () => {
    expect(getWizardSessionStore()).toBe(getWizardSessionStore());
  });
});
