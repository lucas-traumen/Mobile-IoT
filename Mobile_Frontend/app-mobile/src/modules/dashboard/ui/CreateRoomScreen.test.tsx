/**
 * CreateRoomScreen tests — focused render + visual contract (reviewer
 * MAJOR-3, settings-smart-home-sync fix cycle 1).
 *
 * The screen selects existing physical rooms for a Template. Covers the
 * ambient wash/card recipe, selection errors and busy protection, and the
 * absence of physical-room creation controls in Dashboard management.
 */

import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { STRINGS } from '@core/i18n';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';

import type { Room } from '@modules/devices/api';

import { OK_OUTCOME } from './ConfirmDialog';
import { CreateRoomScreen } from './CreateRoomScreen';

const AVAILABLE_ROOMS: readonly Room[] = [
  { id: 'room-garage', name: 'Nhà để xe', order: 0 },
  { id: 'room-attic', name: 'Gác xép', order: 1 },
];

/** Render the screen with realistic props (CreateRoomRoute shape). */
function renderScreen(
  mode: 'light' | 'dark',
  overrides: Partial<React.ComponentProps<typeof CreateRoomScreen>> = {},
): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode={mode}>
        <CreateRoomScreen
          availableRooms={AVAILABLE_ROOMS}
          onAddExisting={async () => OK_OUTCOME}
          onCancel={() => undefined}
          {...overrides}
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

describe('CreateRoomScreen ambient wash (settings-smart-home-sync)', () => {
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

describe('CreateRoomScreen existing-room selection (light AND dark)', () => {
  it('renders every existing-room card on the FULL smart card recipe', () => {
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = renderScreen(mode);
      // Card surface + hairline border + token radius + the smart card
      // shadow (reviewer MAJOR-2: the shadow was missing on these cards).
      const cards = viewsWithStyle(renderer.root, {
        backgroundColor: tokens.smart.colors.card,
        borderColor: tokens.smart.colors.cardBorder,
        borderRadius: tokens.smart.radius.card,
        elevation: tokens.smart.cardShadow.elevation,
      });
      expect(cards).toHaveLength(AVAILABLE_ROOMS.length);
      act(() => {
        renderer.unmount();
      });
    }
  });

  it('has no physical-room name input or new-room submit in either theme', () => {
    for (const mode of ['light', 'dark'] as const) {
      const renderer = renderScreen(mode);
      expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
      expect(
        renderer.root.findAllByProps({ testID: 'create-room-new-submit' }),
      ).toHaveLength(0);
      expect(JSON.stringify(renderer.toJSON())).not.toContain('Tạo phòng mới');
      act(() => {
        renderer.unmount();
      });
    }
  });

  it('passes the selected existing room id to the callback and shows failures beside selection', async () => {
    const onAddExisting = jest.fn(async () => ({
      ok: false,
      message: 'Không thể lưu bố cục',
    }));
    const renderer = renderScreen('light', { onAddExisting });
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'create-room-existing-room-garage' })
        .props.onPress();
    });
    expect(onAddExisting).toHaveBeenCalledWith('room-garage');
    expect(
      renderer.root
        .findAllByType(Text)
        .some(text => text.props.children === 'Không thể lưu bố cục'),
    ).toBe(true);
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    act(() => {
      renderer.unmount();
    });
  });

  it('disables all room choices while adding and allows retry after failure', async () => {
    let resolve!: (outcome: { ok: boolean; message: string }) => void;
    const onAddExisting = jest.fn(
      () =>
        new Promise<{ ok: boolean; message: string }>(done => {
          resolve = done;
        }),
    );
    const renderer = renderScreen('light', { onAddExisting });
    act(() => {
      renderer.root
        .findByProps({ testID: 'create-room-existing-room-garage' })
        .props.onPress();
      renderer.root
        .findByProps({ testID: 'create-room-existing-room-attic' })
        .props.onPress();
    });
    for (const room of AVAILABLE_ROOMS) {
      expect(
        renderer.root.findByProps({ testID: `create-room-existing-${room.id}` })
          .props.disabled,
      ).toBe(true);
    }
    // A second invocation while busy also cannot submit another reference.
    act(() => {
      renderer.root
        .findByProps({ testID: 'create-room-existing-room-attic' })
        .props.onPress();
    });
    expect(onAddExisting).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ok: false, message: 'Thử lại' });
    });
    expect(
      renderer.root.findByProps({ testID: 'create-room-existing-room-garage' })
        .props.disabled,
    ).toBe(false);
    onAddExisting.mockResolvedValueOnce(OK_OUTCOME);
    await act(async () => {
      renderer.root
        .findByProps({ testID: 'create-room-existing-room-garage' })
        .props.onPress();
    });
    expect(onAddExisting).toHaveBeenCalledTimes(2);
    expect(
      renderer.root
        .findAllByType(Text)
        .some(text => text.props.children === 'Thử lại'),
    ).toBe(false);
    act(() => {
      renderer.unmount();
    });
  });

  it('explains where to create physical rooms when no existing choice remains', () => {
    const renderer = renderScreen('light', { availableRooms: [] });
    expect(
      renderer.root
        .findAllByType(Text)
        .some(
          text => text.props.children === STRINGS.templates.noRoomAvailable,
        ),
    ).toBe(true);
    expect(STRINGS.templates.noRoomAvailable).toContain('Phòng & thiết bị');
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    act(() => {
      renderer.unmount();
    });
  });
});

describe('CreateRoomScreen 44pt touch targets (dashboard-history-board-touch-share)', () => {
  it('the back button carries explicit ≥44×44 hit bounds (not hitSlop)', () => {
    const renderer = renderScreen('light');
    const back = renderer.root.findByProps({ testID: 'create-room-back' });
    const flat = flatStyles(back.props.style);
    expect(typeof flat.minWidth).toBe('number');
    expect(flat.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof flat.minHeight).toBe('number');
    expect(flat.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});
