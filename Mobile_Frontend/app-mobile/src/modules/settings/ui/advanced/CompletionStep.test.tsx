/**
 * CompletionStep tests — step 3 (Hoàn tất) of the guided flow:
 * - large ✓ icon + `Kết nối thành công` title;
 * - summary rows: broker address, WS port, auth status (username or
 *   `không xác thực`, with the `đã kiểm tra` marker) — never secret
 *   values beyond the username;
 * - primary `Lưu cấu hình` = the EXISTING save path (loading label +
 *   disabled while saving); on a FAILED save the error renders near the
 *   save action and the primary label becomes `Thử lại` — the user is
 *   never navigated away (advanced-settings-sequential-recovery);
 * - the contextual edit actions are EXPLICIT: `Chỉnh sửa xác thực` (→
 *   step 2) always; `Chỉnh sửa máy chủ` (→ step 1) only when the screen
 *   passes the handler (server fields need changing).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';

import { CompletionStep } from './CompletionStep';

/** Renderers still mounted (unmounted in afterEach — act hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
});

interface MakeProps {
  readonly username?: string;
  readonly saving?: boolean;
  readonly influxState?: 'ok' | 'failed' | 'skipped';
  readonly saveError?: string | null;
  readonly withEditServer?: boolean;
}

function makeStep(props: MakeProps = {}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  const onSave = jest.fn();
  const onEditAuth = jest.fn();
  const onEditServer = jest.fn();
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <CompletionStep
          host="192.168.2.28"
          port={9001}
          username={props.username ?? 'alice'}
          saving={props.saving ?? false}
          influxState={props.influxState ?? 'skipped'}
          saveError={props.saveError ?? null}
          onSave={onSave}
          onEditAuth={onEditAuth}
          onEditServer={props.withEditServer ? onEditServer : undefined}
        />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return { renderer, onSave, onEditAuth, onEditServer };
}

function findPressable(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance {
  const node = renderer.root
    .findAllByProps({ testID })
    .find(candidate => typeof candidate.props.onPress === 'function');
  if (!node) {
    throw new Error(`no pressable node for ${testID}`);
  }
  return node;
}

/** The visible label of a pressable (its string-carrying Text child). */
function buttonLabel(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): string | undefined {
  const button = findPressable(renderer, testID);
  const text = button
    .findAll(node => typeof node.props.children === 'string')
    .at(0);
  return text?.props.children as string | undefined;
}

describe('CompletionStep', () => {
  it('renders the check icon and the success title', () => {
    const { renderer } = makeStep();
    expect(
      renderer.root.findAllByProps({ testID: 'completion-check' }).length,
    ).toBeGreaterThan(0);
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(STRINGS.settings.completionTitle);
  });

  it('renders the summary rows: address, WS port, auth status', () => {
    const { renderer } = makeStep();
    expect(
      renderer.root.findByProps({ testID: 'completion-address' }).props
        .children,
    ).toBe('192.168.2.28');
    expect(
      renderer.root.findByProps({ testID: 'completion-port' }).props.children,
    ).toBe(9001);
    const authRow = renderer.root
      .findByProps({ testID: 'completion-auth' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(authRow).toContain('alice');
    expect(authRow).toContain(STRINGS.settings.summaryVerified);
  });

  it('shows `không xác thực` when no username was entered', () => {
    const { renderer } = makeStep({ username: '' });
    const authRow = renderer.root
      .findByProps({ testID: 'completion-auth' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(authRow).toContain(STRINGS.settings.summaryNoAuth);
  });

  it('Lưu cấu hình forwards to the existing save path', () => {
    const { renderer, onSave } = makeStep();
    expect(buttonLabel(renderer, 'setup-save')).toBe(
      STRINGS.settings.saveConfig,
    );
    act(() => {
      findPressable(renderer, 'setup-save').props.onPress();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('while saving the button is disabled with the loading label', () => {
    const { renderer } = makeStep({ saving: true });
    const save = findPressable(renderer, 'setup-save');
    // Disabled + the honest loading label; the double-save guard itself
    // lives in the screen's handleSave.
    expect(save.props.disabled).toBe(true);
    expect(buttonLabel(renderer, 'setup-save')).toBe(STRINGS.settings.saving);
  });

  it('a save failure renders the retryable error near the save action and makes Thử lại primary', () => {
    const { renderer, onSave } = makeStep({ saveError: 'Lưu thất bại' });
    expect(
      renderer.root.findByProps({ testID: 'completion-save-error' }).props
        .children,
    ).toBe('Lưu thất bại');
    // `Thử lại` is the PRIMARY recovery label on the save action itself.
    expect(buttonLabel(renderer, 'setup-save')).toBe(STRINGS.settings.retry);
    // Still the one save path — pressing it retries the save.
    act(() => {
      findPressable(renderer, 'setup-save').props.onPress();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('without a save error the primary reads Lưu cấu hình and no error renders', () => {
    const { renderer, onSave } = makeStep();
    expect(
      renderer.root.findAllByProps({ testID: 'completion-save-error' }).length,
    ).toBe(0);
    expect(buttonLabel(renderer, 'setup-save')).toBe(
      STRINGS.settings.saveConfig,
    );
    act(() => {
      findPressable(renderer, 'setup-save').props.onPress();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('Chỉnh sửa xác thực returns to step 2 (explicit, draft kept)', () => {
    const { renderer, onEditAuth } = makeStep();
    expect(buttonLabel(renderer, 'setup-edit-auth')).toBe(
      STRINGS.settings.editAuthAction,
    );
    act(() => {
      findPressable(renderer, 'setup-edit-auth').props.onPress();
    });
    expect(onEditAuth).toHaveBeenCalledTimes(1);
  });

  it('Chỉnh sửa máy chủ renders only when the screen offers it (contextual)', () => {
    const offered = makeStep({ withEditServer: true });
    expect(
      offered.renderer.root.findAllByProps({ testID: 'setup-edit-server' })
        .length,
    ).toBeGreaterThan(0);
    act(() => {
      findPressable(offered.renderer, 'setup-edit-server').props.onPress();
    });
    expect(offered.onEditServer).toHaveBeenCalledTimes(1);

    const withheld = makeStep();
    expect(
      withheld.renderer.root.findAllByProps({ testID: 'setup-edit-server' })
        .length,
    ).toBe(0);
  });

  // Amendment 1 (A3) — the InfluxDB summary row (non-secret states only).
  it('renders the InfluxDB row: đã kiểm tra ✓ / thất bại / chưa cấu hình — bỏ qua', () => {
    const okRun = makeStep({ influxState: 'ok' });
    const okRow = okRun.renderer.root
      .findByProps({ testID: 'completion-influx' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(okRow).toContain(STRINGS.settings.summaryVerified);
    act(() => {
      okRun.renderer.unmount();
    });

    const failedRun = makeStep({ influxState: 'failed' });
    const failedRow = failedRun.renderer.root
      .findByProps({ testID: 'completion-influx' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(failedRow).toContain(STRINGS.settings.failed);
    act(() => {
      failedRun.renderer.unmount();
    });

    const skippedRun = makeStep({ influxState: 'skipped' });
    const skippedRow = skippedRun.renderer.root
      .findByProps({ testID: 'completion-influx' })
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children)
      .join('');
    expect(skippedRow).toContain(STRINGS.settings.summaryInfluxSkipped);
    act(() => {
      skippedRun.renderer.unmount();
    });
  });
});
