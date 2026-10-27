/**
 * ConnectionStatusBadge tests — the shared dot/label renderer (the D3
 * connection/health color contract): healthy = smart teal, failed =
 * danger, progress = smart amber, gray = smart textSecondary.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';

import { ConnectionStatusBadge } from './ConnectionStatusBadge';

/** Renderers still mounted (unmounted in afterEach — act hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

function makeBadge(
  status: 'healthy' | 'failed' | 'progress' | 'gray',
  mode: 'light' | 'dark' = 'light',
): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <ConnectionStatusBadge status={status} label="Trạng thái" />
      </ThemeProvider>,
    );
  });
  openRenderers.push(renderer);
  return renderer;
}

/** Unmount every renderer created by the suite (act hygiene). */
afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
});

describe('ConnectionStatusBadge', () => {
  it('renders a dot testID per status', () => {
    for (const status of ['healthy', 'failed', 'progress', 'gray'] as const) {
      const renderer = makeBadge(status);
      // Presence only — react-test-renderer double-counts host nodes
      // (DevicesScreen.test.tsx convention: no exact positive counts).
      expect(
        renderer.root.findAllByProps({ testID: `status-dot-${status}` }).length,
      ).toBeGreaterThan(0);
    }
  });

  it('colors the dot per the D3 contract (teal/danger/amber/gray)', () => {
    const expectations: Record<string, string> = {
      healthy: LIGHT_TOKENS.smart.colors.teal,
      failed: LIGHT_TOKENS.danger,
      progress: LIGHT_TOKENS.smart.colors.amber,
      gray: LIGHT_TOKENS.smart.colors.textSecondary,
    };
    for (const status of Object.keys(expectations)) {
      const renderer = makeBadge(
        status as 'healthy' | 'failed' | 'progress' | 'gray',
      );
      const dot = renderer.root.findByProps({
        testID: `status-dot-${status}`,
      });
      expect(dot.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ backgroundColor: expectations[status] }),
        ]),
      );
    }
  });

  it('renders the label text next to the dot', () => {
    const renderer = makeBadge('healthy');
    const texts = renderer.root.findAll(
      node => node.props.children === 'Trạng thái',
    );
    expect(texts.length).toBeGreaterThan(0);
  });

  it('renders without a label (dot-only usage)', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="dark">
          <ConnectionStatusBadge status="progress" />
        </ThemeProvider>,
      );
    });
    openRenderers.push(renderer);
    expect(
      renderer.root.findAllByProps({ testID: 'status-dot-progress' }).length,
    ).toBeGreaterThan(0);
  });

  it('resolves colors from the active theme tokens (dark)', () => {
    const renderer = makeBadge('healthy', 'dark');
    const dot = renderer.root.findByProps({ testID: 'status-dot-healthy' });
    expect(dot.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          backgroundColor: DARK_TOKENS.smart.colors.teal,
        }),
      ]),
    );
  });
});
