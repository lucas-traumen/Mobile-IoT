/**
 * TemplateListScreen tests — focused render + visual contract (reviewer
 * MAJOR-3, settings-smart-home-sync fix cycle 1).
 *
 * The screen is dumb (everything arrives as props — see
 * `hierarchyRoutes.tsx` TemplateListRoute for the realistic wiring), so
 * these tests pin the presentation contract only, not CRUD flows:
 * - AMBIENT WASH: the diagonal Smart Home wash (LinearGradient tealTint →
 *   page → amberTint) in light AND dark,
 * - CONNECTION BADGE: the badge dot follows the SHARED D3 color contract
 *   for EVERY state (teal = connected, amber = connecting/reconnecting,
 *   danger = failed, textSecondary = idle — never amber),
 * - SMART CARDS: the Template cards render the solid smart card recipe
 *   (card surface + hairline border + card shadow) — the retired gel glass
 *   surface never comes back.
 */

import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';

import type { DashboardTemplate } from '../internal/domain/dashboardSchema';
import type { WidgetConnectionState } from '@modules/widgets/api';

import { OK_OUTCOME } from './ConfirmDialog';
import { TemplateListScreen } from './TemplateListScreen';

const TEMPLATES: readonly DashboardTemplate[] = [
  { id: 'tpl-home', name: 'Nhà', updatedAt: 0, rooms: [] },
  { id: 'tpl-office', name: 'Văn phòng', updatedAt: 0, rooms: [] },
];

/** Render the screen with realistic props (TemplateListRoute shape). */
function renderScreen(
  mode: 'light' | 'dark',
  connectionState: WidgetConnectionState['state'] = 'connected',
): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <TemplateListScreen
          templates={TEMPLATES}
          connection={{ state: connectionState, label: 'snapshot' }}
          onBack={() => undefined}
          onOpenTemplate={async () => OK_OUTCOME}
          onCreateTemplate={() => undefined}
          onRenameTemplate={async () => OK_OUTCOME}
          onDuplicateTemplate={async () => OK_OUTCOME}
          onDeleteTemplate={async () => OK_OUTCOME}
        />
      </ThemeProvider>,
    );
  });
  return renderer;
}

/** Flatten an RN style (object or array of objects) into one plain object. */
function flatStyles(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  return Object.assign(
    {},
    ...(layers.filter(
      layer => layer !== null && typeof layer === 'object',
    ) as Record<string, unknown>[]),
  );
}

/** Views whose flattened style carries ALL the given style entries. */
function viewsWithStyle(
  root: ReactTestInstance,
  match: Record<string, unknown>,
): ReactTestInstance[] {
  return root.findAllByType(View).filter(view => {
    const flat = flatStyles(view.props.style);
    return Object.entries(match).every(([key, value]) => flat[key] === value);
  });
}

/** The 8×8 badge dot inside the connection badge. */
function badgeDotOf(root: ReactTestInstance): ReactTestInstance {
  const dot = root.findAllByType(View).find(view => {
    const flat = flatStyles(view.props.style);
    return flat.width === 8 && flat.height === 8 && flat.borderRadius === 4;
  });
  expect(dot).toBeTruthy();
  return dot!;
}

describe('TemplateListScreen ambient wash (settings-smart-home-sync)', () => {
  it('renders the diagonal teal→page→amber wash in light AND dark', () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = renderScreen(mode);
      const gradient = renderer.root.findByType(LinearGradient);
      expect(gradient.props.colors).toEqual([
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]);
      expect(gradient.props.start).toEqual({ x: 0, y: 0 });
      expect(gradient.props.end).toEqual({ x: 1, y: 1 });
      act(() => {
        renderer.unmount();
      });
    }
  });
});

describe('TemplateListScreen connection badge (D3 contract)', () => {
  it('follows the D3 connection color contract for EVERY state', () => {
    // Shared contract (settings-smart-home-sync D3): teal = connected,
    // amber = connecting AND reconnecting ONLY, danger = failed, idle =
    // smart textSecondary (never amber — idle is not a progress state).
    const expectations: readonly [WidgetConnectionState['state'], string][] = [
      ['connected', LIGHT_TOKENS.smart.colors.teal],
      ['connecting', LIGHT_TOKENS.smart.colors.amber],
      ['reconnecting', LIGHT_TOKENS.smart.colors.amber],
      ['failed', LIGHT_TOKENS.danger],
      ['idle', LIGHT_TOKENS.smart.colors.textSecondary],
    ];
    for (const [state, expectedColor] of expectations) {
      const renderer = renderScreen('light', state);
      expect(
        flatStyles(badgeDotOf(renderer.root).props.style).backgroundColor,
      ).toBe(expectedColor);
      act(() => {
        renderer.unmount();
      });
    }
  });

  it('renders the dark-theme badge colors when the active theme is dark', () => {
    for (const [state, expectedColor] of [
      ['connected', DARK_TOKENS.smart.colors.teal],
      ['idle', DARK_TOKENS.smart.colors.textSecondary],
      ['failed', DARK_TOKENS.danger],
    ] as const) {
      const renderer = renderScreen('dark', state);
      expect(
        flatStyles(badgeDotOf(renderer.root).props.style).backgroundColor,
      ).toBe(expectedColor);
      act(() => {
        renderer.unmount();
      });
    }
  });
});

describe('TemplateListScreen smart cards (gel retired)', () => {
  it('renders every Template card on the solid smart card recipe in light AND dark', () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = renderScreen(mode);
      // Card surface + hairline border + the smart card shadow (the
      // retired gel glass surface never returns).
      const cards = viewsWithStyle(renderer.root, {
        backgroundColor: tokens.smart.colors.card,
        borderColor: tokens.smart.colors.cardBorder,
        borderRadius: tokens.smart.radius.card,
        elevation: tokens.smart.cardShadow.elevation,
      });
      expect(cards).toHaveLength(TEMPLATES.length);
      act(() => {
        renderer.unmount();
      });
    }
  });
});

describe('TemplateListScreen 44pt touch targets (dashboard-history-board-touch-share)', () => {
  it('the back button and the template-card ⋯ menu carry explicit ≥44×44 hit bounds', () => {
    const renderer = renderScreen('light');
    const back = renderer.root.findByProps({ testID: 'template-list-back' });
    const backFlat = flatStyles(back.props.style);
    expect(typeof backFlat.minWidth).toBe('number');
    expect(backFlat.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof backFlat.minHeight).toBe('number');
    expect(backFlat.minHeight as number).toBeGreaterThanOrEqual(44);

    const menu = renderer.root.findByProps({
      testID: 'template-menu-tpl-home',
    });
    const menuFlat = flatStyles(menu.props.style);
    expect(typeof menuFlat.minWidth).toBe('number');
    expect(menuFlat.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof menuFlat.minHeight).toBe('number');
    expect(menuFlat.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});
