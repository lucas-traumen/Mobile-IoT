/**
 * RoomListModal tests (D3 extraction, dashboard-smart-home-redesign).
 *
 * The full room-list dialog is the shared dialog for BOTH hosts: the
 * History screen's ☰ expand action and the Dashboard tab's Smart Home
 * header menu. Verifies:
 * - strictly controlled visibility (`visible` prop; nothing renders open
 *   on its own),
 * - one text-only row per room in the host's order (no icons, no `Tất cả`),
 * - the active row is marked selected and keeps the brand color — NEVER
 *   `onPrimary`, which is invisible on the light sheet,
 * - selecting a row emits `onSelectRoom(id)` — closing is the HOST's job
 *   (the modal itself never auto-closes),
 * - the close action and the Android back request both call `onClose`,
 * - the dialog is CENTERED (scrim centers the sheet; fully rounded sheet)
 *   so no row slides under the Android navigation bar,
 * - the optional `renderRoomIndicator` seam renders custom per-room nodes.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { Ionicons } from '@expo/vector-icons';

import { LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import { STRINGS } from '@core/i18n';
import type { Room } from '@modules/devices/api';

import { RoomListModal } from './RoomListModal';

const ROOMS: readonly Room[] = [
  { id: 'room-a', name: 'Phòng A', order: 0, icon: 'home-outline' },
  { id: 'room-b', name: 'Phòng B', order: 1 },
  { id: 'room-c', name: 'Phòng C', order: 2, icon: 'bed-outline' },
];

function renderModal(props: {
  visible?: boolean;
  rooms?: readonly Room[];
  activeRoomId?: string | null;
  onSelectRoom?: (id: string) => void;
  onClose?: () => void;
  renderRoomIndicator?: (room: Room, active: boolean) => React.ReactNode;
}): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <RoomListModal
          visible={props.visible ?? true}
          rooms={props.rooms ?? ROOMS}
          activeRoomId={props.activeRoomId ?? 'room-b'}
          onSelectRoom={props.onSelectRoom ?? (() => undefined)}
          onClose={props.onClose ?? (() => undefined)}
          renderRoomIndicator={props.renderRoomIndicator}
        />
      </ThemeProvider>,
    );
  });
  return renderer;
}

/** Deep-collect the text strings rendered under a node (RN nests Texts). */
function textOf(node: ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' ? child : textOf(child as ReactTestInstance),
    )
    .join('');
}

/** Flatten an RN style array into one object. */
function flatStyles(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}

describe('RoomListModal (D3 shared dialog)', () => {
  it('is strictly controlled: closed when visible=false, open when true', () => {
    const closed = renderModal({ visible: false });
    expect(
      closed.root.findByProps({ testID: 'dashboard-room-modal' }).props.visible,
    ).toBe(false);
    closed.unmount();

    const open = renderModal({ visible: true });
    expect(
      open.root.findByProps({ testID: 'dashboard-room-modal' }).props.visible,
    ).toBe(true);
    open.unmount();
  });

  it('lists one text-only row per room in the host order (no icons)', () => {
    const renderer = renderModal({});
    for (const room of ROOMS) {
      const row = renderer.root.findByProps({
        testID: `dashboard-room-row-${room.id}`,
      });
      expect(textOf(row)).toBe(room.name);
      expect(row.findAllByType(Ionicons)).toHaveLength(0);
    }
    expect(renderer.root.findAllByType(Ionicons)).toHaveLength(0);
    // No `Tất cả` option.
    const allText = renderer.root.findAllByType(Text).map(textOf).join('\n');
    expect(allText).not.toContain(STRINGS.dashboard.allRooms);
  });

  it('marks the active row selected and keeps it readable (never onPrimary)', () => {
    const renderer = renderModal({ activeRoomId: 'room-b' });
    const activeRow = renderer.root.findByProps({
      testID: 'dashboard-room-row-room-b',
    });
    expect(activeRow.props.accessibilityState).toMatchObject({
      selected: true,
    });
    const activeColor = activeRow.findByType(Text).props.style.color as string;
    // settings-smart-home-sync: the active row text is the smart teal.
    expect(activeColor).toBe(LIGHT_TOKENS.smart.colors.teal);
    expect(activeColor).not.toBe(LIGHT_TOKENS.onPrimary);
    const inactiveRow = renderer.root.findByProps({
      testID: 'dashboard-room-row-room-a',
    });
    expect(inactiveRow.props.accessibilityState).toMatchObject({
      selected: false,
    });
    expect(inactiveRow.findByType(Text).props.style.color).toBe(
      LIGHT_TOKENS.smart.colors.textPrimary,
    );
    // The active row paints the teal tint (was the elevated surface).
    const activeStyle = flatStyles(activeRow.props.style);
    expect(activeStyle.backgroundColor).toBe(
      LIGHT_TOKENS.smart.colors.tealTint,
    );
  });

  it('emits onSelectRoom and leaves closing to the host', () => {
    const onSelectRoom = jest.fn();
    const onClose = jest.fn();
    const renderer = renderModal({ onSelectRoom, onClose });
    act(() => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-row-room-c' })
        .props.onPress();
    });
    expect(onSelectRoom).toHaveBeenCalledTimes(1);
    expect(onSelectRoom).toHaveBeenCalledWith('room-c');
    // The modal itself never auto-closes — the host owns visibility.
    expect(onClose).not.toHaveBeenCalled();
    expect(
      renderer.root.findByProps({ testID: 'dashboard-room-modal' }).props
        .visible,
    ).toBe(true);
  });

  it('closes via the close action and the Android back request', () => {
    const onClose = jest.fn();
    const renderer = renderModal({ onClose });
    act(() => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-close' })
        .props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      renderer.root
        .findByProps({ testID: 'dashboard-room-modal' })
        .props.onRequestClose();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('centers the dialog on screen with fully rounded corners', () => {
    const renderer = renderModal({});
    const scrim = renderer.root.findByProps({
      testID: 'dashboard-room-modal-scrim',
    });
    expect(scrim.props.style.justifyContent).toBe('center');
    expect(scrim.props.style.alignItems).toBe('center');
    const sheet = renderer.root.findByProps({
      testID: 'dashboard-room-modal-sheet',
    });
    expect(sheet.props.style.width).toBe('100%');
    // Smart card recipe (settings-smart-home-sync): token radius + card
    // surface + hairline border + the smart card shadow (fix cycle 1 —
    // the sheet previously missed the shadow).
    expect(sheet.props.style.borderRadius).toBe(LIGHT_TOKENS.smart.radius.card);
    expect(sheet.props.style.backgroundColor).toBe(
      LIGHT_TOKENS.smart.colors.card,
    );
    expect(sheet.props.style.borderColor).toBe(
      LIGHT_TOKENS.smart.colors.cardBorder,
    );
    expect(sheet.props.style.elevation).toBe(
      LIGHT_TOKENS.smart.cardShadow.elevation,
    );
    expect(sheet.props.style.shadowOpacity).toBe(
      LIGHT_TOKENS.smart.cardShadow.shadowOpacity,
    );
    expect(sheet.props.style.maxHeight).toBe('70%');
  });

  it('renders custom per-room indicators through the extension seam', () => {
    const renderer = renderModal({
      renderRoomIndicator: (room, active) => (
        <Text testID={`seam-${room.id}`}>{active ? '•' : ''}</Text>
      ),
    });
    for (const room of ROOMS) {
      expect(
        renderer.root.findByProps({ testID: `seam-${room.id}` }),
      ).toBeTruthy();
    }
  });

  it('renders the shared header title + close label from STRINGS', () => {
    const renderer = renderModal({});
    const allText = renderer.root.findAllByType(Text).map(textOf).join('\n');
    expect(allText).toContain(STRINGS.dashboard.roomList);
    expect(allText).toContain(STRINGS.dashboard.close);
  });
});
