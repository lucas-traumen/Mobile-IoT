/**
 * DeviceManagementScreen tests — ROOM-FIRST interaction (approved
 * room-sensor-derived-history-layout-rework plan, slice A + the
 * devices-add-device-dialog plan).
 *
 * Verifies the user-facing acceptance path through the public props +
 * rendered tree:
 * - the top level is a ROOM LIST whose `＋ Thêm phòng` pill opens the
 *   centered add-room dialog; creating a room opens the CREATED room
 *   immediately (the user-reported broken room-create flow,
 *   regression-tested) and a failure keeps the dialog open with the error;
 * - room detail exposes ONLY `Cảm biến (n)` and `Điều khiển (n)` content
 *   tabs plus the visually distinct `＋ Thêm thiết bị` ACTION pill — no
 *   `Tất cả`, repeated room chooser, binding-kind chooser, or inline
 *   add-form cards;
 * - the contextual add dialog opens over a scrim from the active room
 *   section, closes via ✕ / scrim /
 *   Android back with NO side effects, and keeps its state fresh on
 *   reopen;
 * - adding a sensor inherits the open room and offers exactly one data channel
 *   choice (already-registered fields are omitted; the room being full
 *   disables the add); the curated custom metric is created INSIDE the
 *   dialog and immediately selectable;
 * - adding a relay inherits the room and asks only name + a free slot;
 * - `Lưu` stays disabled until the form is valid; failure keeps the dialog
 *   open with the truthful error, success closes it and shows the banner;
 * - room rows carry NO persistent edit/delete controls: ONE overflow
 *   affordance per row opens a centered action menu for exactly that room
 *   (Đổi tên phòng / Xóa phòng / Hủy) and the card body still opens the
 *   room's detail;
 * - REGRESSION (unchanged flows pinned by the reviewer fix cycle): room
 *   rename (routed through the action menu into the centered rename
 *   dialog), relay rename, relay removal, legacy roomless assign/remove and
 *   the room-deletion migration dialog all behave exactly as before —
 *   truthful errors keep the editing surface open;
 * - deleting a sensor row calls the binding-level cascade (one metric of a
 *   legacy record; siblings survive);
 * - legacy roomless records stay manageable in a dedicated section.
 */

import React from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TestRenderer, { act } from 'react-test-renderer';

import { DARK_TOKENS, LIGHT_TOKENS, ThemeProvider } from '@core/theme';
import type {
  BoardInventoryEntry,
  CapabilityDef,
  Device,
  NewCapabilityInput,
  NewDeviceInput,
  Room,
  RoomMigrationTarget,
} from '@modules/devices/api';

import { DeviceManagementScreen, type ActionOutcome } from './DevicesScreen';
import {
  CAPABILITY_COLORS,
  CAPABILITY_ICON_GROUPS,
} from '../internal/domain/capabilityPresets';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const ROOMS: readonly Room[] = [
  { id: 'room-a', name: 'Phòng A', order: 0 },
  { id: 'room-b', name: 'Phòng B', order: 1 },
];

const CAPABILITIES: readonly CapabilityDef[] = [
  { type: 'temperature', label: 'Nhiệt độ', kind: 'sensor' },
  { type: 'humidity', label: 'Độ ẩm', kind: 'sensor' },
  { type: 'switch', label: 'Công tắc', kind: 'switch' },
];

/** A legacy multi-capability board + a relay: sensors counter shows 2/10. */
const DEVICES: readonly Device[] = [
  {
    id: 'sensor-legacy',
    name: 'Cảm biến môi trường',
    roomId: 'room-a',
    type: 'sensor',
    capabilities: ['temperature', 'humidity'],
    binding: { kind: 'telemetry-sensor' },
  },
  {
    id: 'relay-a1',
    name: 'Đèn A',
    roomId: 'room-a',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 1 },
  },
  {
    id: 'sensor-temp-b',
    name: 'Nhiệt độ B',
    roomId: 'room-b',
    type: 'sensor',
    capabilities: ['temperature'],
    binding: { kind: 'telemetry-sensor' },
  },
  {
    id: 'sensor-orphan',
    name: 'Cảm biến cũ',
    type: 'sensor',
    capabilities: ['temperature'],
    binding: { kind: 'telemetry-sensor' },
  },
];

/** All visible text of the renderer (flattening nested Text children). */
function visibleText(renderer: TestRenderer.ReactTestRenderer): string {
  const texts: string[] = [];
  const walk = (node: { props?: { children?: unknown } }) => {
    const children = node.props?.children;
    if (typeof children === 'string') {
      texts.push(children);
    } else if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child === 'string') {
          texts.push(child);
        } else if (child && typeof child === 'object') {
          walk(child as { props?: { children?: unknown } });
        }
      }
    } else if (children && typeof children === 'object') {
      walk(children as { props?: { children?: unknown } });
    }
  };
  for (const textNode of renderer.root.findAllByType(Text)) {
    walk(textNode as never);
  }
  return texts.join('\n');
}

interface HarnessCallbacks {
  onAddRoom?: (name: string, code?: string) => Promise<ActionOutcome>;
  /** Discovered boards for the AddRoomDialog pick step (optional). */
  boards?: readonly BoardInventoryEntry[];
  /** Room-state override (initial rooms; defaults to ROOMS). */
  initialRooms?: readonly Room[];
  onRenameRoom?: (roomId: string, name: string) => Promise<ActionOutcome>;
  onRemoveRoom?: (
    roomId: string,
    target: RoomMigrationTarget,
  ) => Promise<ActionOutcome>;
  onAddDevice?: (input: NewDeviceInput) => Promise<ActionOutcome>;
  onRemoveDeviceCapability?: (
    deviceId: string,
    field: string,
  ) => Promise<ActionOutcome>;
  onRemoveDevice?: (id: string) => Promise<ActionOutcome>;
  onUpdateDevice?: (
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<ActionOutcome>;
  onAddCapability?: (input: NewCapabilityInput) => Promise<ActionOutcome>;
}

/** Renderers still mounted (unmounted in afterEach — teardown hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

async function renderScreen(
  callbacks: HarnessCallbacks = {},
  mode: 'light' | 'dark' = 'light',
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  const Harness = () => {
    const [rooms, setRooms] = React.useState<readonly Room[]>(
      callbacks.initialRooms ?? ROOMS,
    );
    const [devices, setDevices] = React.useState<readonly Device[]>(DEVICES);
    const [capabilities, setCapabilities] =
      React.useState<readonly CapabilityDef[]>(CAPABILITIES);
    const nextDeviceId = React.useRef(0);
    return (
      <ThemeProvider mode={mode}>
        <DeviceManagementScreen
          onBack={() => undefined}
          rooms={rooms}
          devices={devices}
          capabilities={capabilities}
          boards={callbacks.boards}
          onAddRoom={
            callbacks.onAddRoom ??
            (async name => {
              const room: Room = {
                id: `room-${name}`,
                name,
                order: rooms.length,
              };
              setRooms(previous => [...previous, room]);
              return { ok: true, message: '', roomId: room.id };
            })
          }
          onRenameRoom={async (roomId, name) => {
            // Ok-gated: the room row only renames when the service agrees,
            // so truthful-failure tests observe the row staying in edit.
            const result = (await callbacks.onRenameRoom?.(roomId, name)) ?? {
              ok: true,
              message: '',
            };
            if (result.ok) {
              setRooms(previous =>
                previous.map(room =>
                  room.id === roomId ? { ...room, name } : room,
                ),
              );
            }
            return result;
          }}
          onRemoveRoom={async (roomId, target) => {
            const result = (await callbacks.onRemoveRoom?.(roomId, target)) ?? {
              ok: true,
              message: '',
            };
            if (result.ok) {
              setRooms(previous => previous.filter(room => room.id !== roomId));
            }
            return result;
          }}
          onAddDevice={async (input: NewDeviceInput) => {
            const result = (await callbacks.onAddDevice?.(input)) ?? {
              ok: true,
              message: '',
            };
            if (result.ok) {
              const device: Device = {
                id: `created-${nextDeviceId.current++}`,
                name: input.name,
                roomId: input.roomId,
                type: input.type,
                capabilities: [...input.capabilities],
                binding: { ...input.binding },
              };
              setDevices(previous => [...previous, device]);
            }
            return result;
          }}
          onUpdateDevice={async (id, patch) => {
            const result = (await callbacks.onUpdateDevice?.(
              id,
              patch as Record<string, unknown>,
            )) ?? { ok: true, message: '' };
            if (result.ok) {
              setDevices(previous =>
                previous.map(device =>
                  device.id === id
                    ? ({ ...device, ...patch } as Device)
                    : device,
                ),
              );
            }
            return result;
          }}
          onRemoveDevice={async id => {
            const result = (await callbacks.onRemoveDevice?.(id)) ?? {
              ok: true,
              message: '',
            };
            if (result.ok) {
              setDevices(previous =>
                previous.filter(device => device.id !== id),
              );
            }
            return result;
          }}
          onAddCapability={
            callbacks.onAddCapability ??
            (async (input: NewCapabilityInput) => {
              setCapabilities(previous => [
                ...previous,
                {
                  type: input.type,
                  label: input.label,
                  kind: 'sensor' as const,
                },
              ]);
              return { ok: true, message: '' };
            })
          }
          onRemoveDeviceCapability={async (deviceId, field) => {
            const result =
              (await callbacks.onRemoveDeviceCapability?.(deviceId, field)) ??
              ({ ok: true, message: '' } as const);
            if (result.ok) {
              setDevices(previous =>
                previous.map(device =>
                  device.id === deviceId
                    ? {
                        ...device,
                        capabilities: device.capabilities.filter(
                          cap => cap !== field,
                        ),
                      }
                    : device,
                ),
              );
            }
            return result;
          }}
        />
      </ThemeProvider>
    );
  };
  await act(async () => {
    renderer = TestRenderer.create(<Harness />);
  });
  openRenderers.push(renderer);
  return renderer;
}

async function press(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): Promise<void> {
  const nodes = byTestID(renderer, testID).filter(
    node => typeof node.props.onPress === 'function',
  );
  if (nodes.length === 0) {
    throw new Error(`No pressable node for testID "${testID}"`);
  }
  await act(async () => {
    nodes[0]!.props.onPress();
  });
}

async function changeText(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
  value: string,
): Promise<void> {
  await act(async () => {
    renderer.root.findByProps({ testID }).props.onChangeText(value);
  });
}

/**
 * testID lookup restricted to actually-pressable nodes (react-test-renderer
 * `findAllByProps` matches host elements too; host Views never carry
 * `onPress`, so filtering on it removes the double counting).
 */
function byTestID(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance[] {
  return renderer.root
    .findAllByProps({ testID })
    .filter(node => typeof node.props.onPress === 'function');
}

function hasTestID(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean {
  return byTestID(renderer, testID).length > 0;
}

/** TextInput presence (non-pressable — lookup by testID directly). */
function hasTextInput(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

/** Open a room's detail through its row. */
async function openRoom(
  renderer: TestRenderer.ReactTestRenderer,
  roomId: string,
): Promise<void> {
  await press(renderer, `devices-room-row-${roomId}`);
}

/** The one currently-visible RN Modal (the open centered dialog). */
function findOpenModal(
  renderer: TestRenderer.ReactTestRenderer,
): TestRenderer.ReactTestInstance | undefined {
  return renderer.root
    .findAllByType(Modal)
    .find(node => node.props.visible === true);
}

/** Recursive Text content of a node (RN nests Texts; numbers stringify). */
function textOfNode(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textOfNode(child as TestRenderer.ReactTestInstance),
    )
    .join('');
}

/** Whether ANY ancestor of `node` renders `text` somewhere in its subtree. */
function insideTreeText(
  node: TestRenderer.ReactTestInstance,
  text: string,
): boolean {
  let current: TestRenderer.ReactTestInstance | null = node;
  while (current) {
    if (textOfNode(current).includes(text)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Press the first pressable node carrying `accessibilityLabel`, optionally
 * scoped to the innermost card whose subtree contains `withinText` (row
 * action icons are labelled per row).
 */
async function pressByLabel(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
  withinText?: string,
): Promise<void> {
  let nodes = renderer.root
    .findAllByProps({ accessibilityLabel: label })
    .filter(node => typeof node.props.onPress === 'function');
  if (withinText) {
    nodes = nodes.filter(node => insideTreeText(node, withinText));
  }
  if (nodes.length === 0) {
    throw new Error(`No pressable node labelled "${label}"`);
  }
  await act(async () => {
    nodes[0]!.props.onPress();
  });
}

/**
 * Press the first pressable whose (nested) text EQUALS `label` exactly,
 * skipping testID-tagged pressables (room rows also render the room name).
 */
async function pressByText(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> {
  const nodes = renderer.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      !node.props.testID &&
      textOfNode(node).trim() === label,
  );
  if (nodes.length === 0) {
    throw new Error(`No pressable node with text "${label}"`);
  }
  await act(async () => {
    nodes[0]!.props.onPress();
  });
}

/**
 * Press the trash icon of the row card whose subtree contains `rowText` —
 * row removal buttons are icon-only (no label, no testID). Scoped to the
 * INNERMOST card-styled ancestor (smart card surface) so higher containers
 * — whose subtrees contain every row's text — never false-match.
 */
async function pressTrashInsideCard(
  renderer: TestRenderer.ReactTestRenderer,
  rowText: string,
): Promise<void> {
  const icons = renderer.root
    .findAllByType(Ionicons)
    .filter(icon => icon.props.name === 'trash-outline');
  for (const icon of icons) {
    // Innermost card-styled ancestor of this icon (row cards carry the
    // smart card surface + border).
    let card: TestRenderer.ReactTestInstance | null = null;
    let current: TestRenderer.ReactTestInstance | null = icon;
    while (current && !card) {
      const style = current.props.style
        ? (StyleSheet.flatten(current.props.style) as Record<
            string,
            unknown
          > | null)
        : null;
      if (
        style &&
        style.backgroundColor === LIGHT_TOKENS.smart.colors.card &&
        style.borderColor === LIGHT_TOKENS.smart.colors.cardBorder
      ) {
        card = current;
      }
      current = current.parent;
    }
    if (!card || !textOfNode(card).includes(rowText)) {
      continue; // a different row's trash icon
    }
    // Nearest pressable ancestor between the icon and the card boundary is
    // the removal button (the mocked icon may render intermediates).
    let node: TestRenderer.ReactTestInstance | null = icon;
    while (node && node !== card) {
      if (typeof node.props.onPress === 'function') {
        const onPress = node.props.onPress;
        await act(async () => {
          onPress();
        });
        return;
      }
      node = node.parent;
    }
  }
  throw new Error(`No trash icon inside a card containing "${rowText}"`);
}

/**
 * The reopened dialog state contract (reviewer fix cycle): default sensor
 * kind, blank name input, no metric chip selected, Lưu disabled.
 */
function assertFreshSensorDialog(
  renderer: TestRenderer.ReactTestRenderer,
): void {
  // Default kind is the sensor body.
  expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(true);
  expect(hasTextInput(renderer, 'devices-add-relay-name')).toBe(false);
  // Blank name.
  expect(
    renderer.root.findByProps({ testID: 'devices-add-sensor-name' }).props
      .value,
  ).toBe('');
  // No metric selected: the offered chip keeps its neutral border…
  const chip = renderer.root.findByProps({ testID: 'devices-field-humidity' });
  const chipStyle = StyleSheet.flatten(chip.props.style) as Record<
    string,
    unknown
  >;
  expect(chipStyle.borderColor).toBe(LIGHT_TOKENS.smart.colors.cardBorder);
  // …and DIMS while unselected (user-acceptance affordance fix).
  expect(chipStyle.opacity).toBe(0.4);
  // …and Lưu is disabled again.
  expect(
    byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
  ).toBe(true);
}

describe('DeviceManagementScreen (room list)', () => {
  it('shows the room list with truthful projected counters and NO Tất cả view', async () => {
    const renderer = await renderScreen();
    const text = visibleText(renderer);
    // Room rows with projected counters (legacy board = 2 metrics).
    expect(text).toContain('Phòng A');
    expect(text).toContain('2/10');
    expect(text).toContain('1/10'); // relays in room A
    expect(text).toContain('Phòng B');
    // The rejected global views are gone.
    expect(text).not.toContain('Tất cả');
    expect(hasTestID(renderer, 'device-subview-devices')).toBe(false);
    expect(hasTestID(renderer, 'device-subview-data')).toBe(false);
  });

  it('creating a room awaits the service and OPENS the created room (regression)', async () => {
    const renderer = await renderScreen();
    await press(renderer, 'devices-add-room-toggle');
    await changeText(renderer, 'devices-add-room-input', 'Phòng làm việc');
    await press(renderer, 'devices-add-room-submit');

    // The dialog closed and the detail for the CREATED room is open
    // (section tabs visible).
    expect(hasTextInput(renderer, 'devices-add-room-input')).toBe(false);
    expect(hasTestID(renderer, 'devices-section-sensors')).toBe(true);
    expect(hasTestID(renderer, 'devices-section-controls')).toBe(true);
  });

  it('a failed room creation keeps the DIALOG open and surfaces the error', async () => {
    const renderer = await renderScreen({
      onAddRoom: async () => ({ ok: false, message: 'Tên phòng không hợp lệ' }),
    });
    await press(renderer, 'devices-add-room-toggle');
    await changeText(renderer, 'devices-add-room-input', 'Phòng làm việc');
    await press(renderer, 'devices-add-room-submit');

    // Still on the room list; the error stays visible inside the dialog.
    expect(hasTestID(renderer, 'devices-section-sensors')).toBe(false);
    expect(hasTextInput(renderer, 'devices-add-room-input')).toBe(true);
    expect(visibleText(renderer)).toContain('Tên phòng không hợp lệ');
  });

  it('the add-room dialog closes via ✕ / scrim with no room created', async () => {
    const renderer = await renderScreen();
    await press(renderer, 'devices-add-room-toggle');
    expect(hasTextInput(renderer, 'devices-add-room-input')).toBe(true);
    await press(renderer, 'devices-add-room-close');
    expect(hasTextInput(renderer, 'devices-add-room-input')).toBe(false);

    await press(renderer, 'devices-add-room-toggle');
    await press(renderer, 'devices-add-room-scrim');
    expect(hasTextInput(renderer, 'devices-add-room-input')).toBe(false);
    // No side effect: still the two original rooms (no third row).
    expect(visibleText(renderer)).not.toContain('Phòng làm việc');
  });

  it('legacy roomless records stay manageable (assign/delete, no global filter)', async () => {
    const renderer = await renderScreen();
    expect(visibleText(renderer)).toContain('Cảm biến cũ');
    expect(hasTestID(renderer, 'device-subview-rooms')).toBe(false);
  });

  it('room rows have NO persistent edit/delete controls; the body tap opens detail', async () => {
    const renderer = await renderScreen();
    // No direct pencil/trash affordances on the room-list rows (actions are
    // menu-gated now).
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'Sửa phòng' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'Xóa phòng' }),
    ).toHaveLength(0);
    expect(
      renderer.root
        .findAllByType(Ionicons)
        .filter(icon => icon.props.name === 'pencil-outline'),
    ).toHaveLength(0);
    // ONE overflow affordance per room row.
    expect(hasTestID(renderer, 'devices-room-actions-room-a')).toBe(true);
    expect(hasTestID(renderer, 'devices-room-actions-room-b')).toBe(true);
    // The card BODY still opens the room detail (never the action menu).
    await openRoom(renderer, 'room-a');
    expect(hasTestID(renderer, 'devices-section-sensors')).toBe(true);
  });

  it('the room action affordance opens a CENTERED menu with rename/delete/cancel for exactly that room', async () => {
    const renderer = await renderScreen();
    await press(renderer, 'devices-room-actions-room-b');
    // The menu is the one open Modal and offers exactly THIS room's actions.
    expect(findOpenModal(renderer)).toBeDefined();
    expect(hasTestID(renderer, 'devices-room-menu-rename-room-b')).toBe(true);
    expect(hasTestID(renderer, 'devices-room-menu-delete-room-b')).toBe(true);
    expect(hasTestID(renderer, 'devices-room-menu-cancel')).toBe(true);
    // Exactly one room: no menu actions for the OTHER room exist.
    expect(hasTestID(renderer, 'devices-room-menu-rename-room-a')).toBe(false);
    expect(hasTestID(renderer, 'devices-room-menu-delete-room-a')).toBe(false);
    expect(visibleText(renderer)).toContain('Đổi tên phòng');
    expect(visibleText(renderer)).toContain('Xóa phòng');
    expect(visibleText(renderer)).toContain('Hủy');
    // Cancel closes the menu with NO side effects (no rename dialog, no
    // migration dialog, room untouched).
    await press(renderer, 'devices-room-menu-cancel');
    expect(findOpenModal(renderer)).toBeUndefined();
    expect(hasTextInput(renderer, 'devices-room-rename-input')).toBe(false);
    expect(visibleText(renderer)).toContain('Phòng B');
  });

  it('renaming a room routes through the action menu into the centered dialog (regression)', async () => {
    const renderer = await renderScreen();
    // The room's affordance opens the menu for exactly that room…
    await press(renderer, 'devices-room-actions-room-a');
    expect(hasTestID(renderer, 'devices-room-menu-rename-room-a')).toBe(true);
    await press(renderer, 'devices-room-menu-rename-room-a');
    // …the menu closes BEFORE the rename dialog opens.
    expect(hasTestID(renderer, 'devices-room-menu-rename-room-a')).toBe(false);
    expect(findOpenModal(renderer)).toBeDefined();
    // The centered dialog carries the EXISTING room name.
    expect(
      renderer.root.findByProps({ testID: 'devices-room-rename-input' }).props
        .value,
    ).toBe('Phòng A');
    await changeText(renderer, 'devices-room-rename-input', 'Phòng A mới');
    await press(renderer, 'devices-room-rename-save-room-a');
    // The dialog closed; the row shows the new name + the banner confirms.
    expect(hasTextInput(renderer, 'devices-room-rename-input')).toBe(false);
    expect(visibleText(renderer)).toContain('Phòng A mới');
    expect(visibleText(renderer)).toContain('Đã đổi tên phòng');
  });

  it('a FAILED room rename keeps the CENTERED dialog open with the draft + error (regression)', async () => {
    const renderer = await renderScreen({
      onRenameRoom: async () => ({
        ok: false,
        message: 'Tên phòng không hợp lệ',
      }),
    });
    await press(renderer, 'devices-room-actions-room-a');
    await press(renderer, 'devices-room-menu-rename-room-a');
    await changeText(renderer, 'devices-room-rename-input', 'Phòng A mới');
    await press(renderer, 'devices-room-rename-save-room-a');
    // The dialog STAYS open (truthful failure): the error shows inside and
    // the draft is kept for retry; the room was NOT renamed.
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    expect(
      renderer.root.findByProps({ testID: 'devices-room-rename-input' }).props
        .value,
    ).toBe('Phòng A mới');
    expect(visibleText(renderer)).toContain('Tên phòng không hợp lệ');
    expect(visibleText(renderer)).not.toContain('Đã đổi tên phòng');
  });

  it('a roomless record can be assigned to a room (legacy assign, regression)', async () => {
    const renderer = await renderScreen();
    expect(visibleText(renderer)).toContain('Cảm biến cũ');
    await pressByText(renderer, 'Chuyển vào phòng');
    // Room chips offered (room rows are testID-tagged → excluded here).
    await pressByText(renderer, 'Phòng B');
    await pressByText(renderer, 'Chuyển vào phòng');
    // The device left the roomless section (harness applied the roomId).
    expect(visibleText(renderer)).not.toContain('Cảm biến cũ');
  });

  it('a FAILED legacy assign keeps the picker open and surfaces the error (regression)', async () => {
    const renderer = await renderScreen({
      onUpdateDevice: async () => ({
        ok: false,
        message: 'Phòng đã đầy',
      }),
    });
    await pressByText(renderer, 'Chuyển vào phòng');
    await pressByText(renderer, 'Phòng B');
    await pressByText(renderer, 'Chuyển vào phòng');
    // The record stays roomless, the picker stays open, the error shows.
    expect(visibleText(renderer)).toContain('Cảm biến cũ');
    expect(visibleText(renderer)).toContain('Phòng đã đầy');
    expect(
      renderer.root.findAll(
        node =>
          typeof node.props.onPress === 'function' &&
          textOfNode(node).trim() === 'Chuyển vào phòng',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('a roomless record can be removed; failure surfaces the legacy error (regression)', async () => {
    let fail = true;
    const renderer = await renderScreen({
      onRemoveDevice: async () =>
        fail
          ? { ok: false, message: 'Không xóa được' }
          : { ok: true, message: '' },
    });
    await pressTrashInsideCard(renderer, 'Cảm biến cũ');
    // Failure: the legacy error shows and the record stays.
    expect(visibleText(renderer)).toContain('Không xóa được');
    expect(visibleText(renderer)).toContain('Cảm biến cũ');
    // Success: the record is gone.
    fail = false;
    await pressTrashInsideCard(renderer, 'Cảm biến cũ');
    expect(visibleText(renderer)).not.toContain('Cảm biến cũ');
  });

  it('room deletion routes through the menu into the migration dialog and migrates to the CHOSEN target (regression)', async () => {
    const migrations: { roomId: string; target: RoomMigrationTarget }[] = [];
    const renderer = await renderScreen({
      onRemoveRoom: async (roomId, target) => {
        migrations.push({ roomId, target });
        return { ok: true, message: '' };
      },
    });
    // The affordance opens the menu; the menu item opens the migration
    // dialog for exactly that room.
    await press(renderer, 'devices-room-actions-room-a');
    await press(renderer, 'devices-room-menu-delete-room-a');
    // The menu closed BEFORE the migration dialog opened.
    expect(hasTestID(renderer, 'devices-room-menu-delete-room-a')).toBe(false);
    expect(findOpenModal(renderer)).toBeDefined();
    // Choose the explicit move target, then confirm.
    await pressByText(renderer, 'Chuyển vào Phòng B');
    await pressByText(renderer, 'Xóa');
    // Dialog closed, the room row is gone, the banner confirms.
    expect(findOpenModal(renderer)).toBeUndefined();
    expect(visibleText(renderer)).not.toContain('Phòng A');
    expect(visibleText(renderer)).toContain('Đã xóa phòng');
    expect(migrations).toEqual([
      { roomId: 'room-a', target: { kind: 'move', roomId: 'room-b' } },
    ]);
  });

  it('a FAILED room deletion keeps the migration dialog open with the error (regression)', async () => {
    const renderer = await renderScreen({
      onRemoveRoom: async () => ({
        ok: false,
        message: 'Không thể xóa phòng này',
      }),
    });
    await press(renderer, 'devices-room-actions-room-a');
    await press(renderer, 'devices-room-menu-delete-room-a');
    await pressByText(renderer, 'Xóa');
    // The dialog STAYS open with the truthful error (re-targetable).
    expect(findOpenModal(renderer)).toBeDefined();
    expect(visibleText(renderer)).toContain('Không thể xóa phòng này');
    // The room still exists.
    expect(visibleText(renderer)).toContain('Phòng A');
  });
});

describe('DeviceManagementScreen (room detail)', () => {
  it('shows contextual sensor creation from the sensor section without a repeated kind choice', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-a');

    const text = visibleText(renderer);
    expect(text).toContain('Cảm biến (2)');
    expect(text).toContain('Điều khiển (1)');
    expect(text).toContain('＋ Thêm cảm biến');
    expect(text).not.toContain('＋ Thêm thiết bị');
    expect(text).not.toContain('Kiểu kết nối');
    expect(hasTestID(renderer, 'devices-add-sensor-toggle')).toBe(false);
    expect(hasTestID(renderer, 'devices-add-relay-toggle')).toBe(false);
    expect(hasTestID(renderer, 'devices-add-sensor-tab')).toBe(true);

    await press(renderer, 'devices-add-sensor-tab');
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(true);
    expect(hasTestID(renderer, 'devices-add-device-kind-sensor')).toBe(false);
    expect(hasTestID(renderer, 'devices-add-device-kind-relay')).toBe(false);
    expect(visibleText(renderer)).toContain('Kênh dữ liệu');
    expect(visibleText(renderer)).toContain('đây không phải cảm biến đã có.');
  });

  it('the section tab row wraps so contextual add actions stay reachable on narrow screens', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-a');
    const tabRow = renderer.root.findByProps({
      testID: 'devices-section-sensors',
    }).parent!;
    const flat = StyleSheet.flatten(tabRow.props.style) as Record<
      string,
      unknown
    >;
    expect(flat.flexDirection).toBe('row');
    expect(flat.flexWrap).toBe('wrap');
    expect(flat.justifyContent).toBe('center');

    await press(renderer, 'devices-section-controls');
    expect(hasTestID(renderer, 'devices-add-relay-tab')).toBe(true);
    expect(hasTestID(renderer, 'devices-add-sensor-tab')).toBe(false);
  });

  it('the contextual dialogs close via ✕, scrim and Android back with NO side effects and fresh state', async () => {
    const onAddDevice = jest.fn();
    const renderer = await renderScreen({ onAddDevice });
    await openRoom(renderer, 'room-b');

    await press(renderer, 'devices-add-sensor-tab');
    await changeText(renderer, 'devices-add-sensor-name', 'Đồ bỏ');
    await press(renderer, 'devices-field-humidity');
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(false);
    await press(renderer, 'devices-add-device-close');
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(false);

    await press(renderer, 'devices-section-controls');
    await press(renderer, 'devices-add-relay-tab');
    await changeText(renderer, 'devices-add-relay-name', 'Rơ le bỏ');
    await press(renderer, 'devices-slot-1');
    expect(
      byTestID(renderer, 'devices-add-relay-submit')[0]!.props.disabled,
    ).toBe(false);
    await press(renderer, 'devices-add-device-scrim');
    expect(hasTextInput(renderer, 'devices-add-relay-name')).toBe(false);

    await press(renderer, 'devices-section-sensors');
    await press(renderer, 'devices-add-sensor-tab');
    await changeText(renderer, 'devices-add-sensor-name', 'Đồ bỏ 2');
    await press(renderer, 'devices-field-humidity');
    const openModal = findOpenModal(renderer);
    expect(openModal).toBeDefined();
    await act(async () => {
      openModal!.props.onRequestClose();
    });
    expect(findOpenModal(renderer)).toBeUndefined();

    await press(renderer, 'devices-add-sensor-tab');
    assertFreshSensorDialog(renderer);
    expect(onAddDevice).not.toHaveBeenCalled();
  });

  it('requires a trimmed sensor name and a data channel before creation', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');

    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(true);
    await changeText(renderer, 'devices-add-sensor-name', '   ');
    await press(renderer, 'devices-field-humidity');
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(true);
    await changeText(renderer, 'devices-add-sensor-name', '  Cảm biến B  ');
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(false);
  });

  it('keeps relay creation contextual and asks only for name plus a free slot', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-section-controls');
    await press(renderer, 'devices-add-relay-tab');

    expect(hasTextInput(renderer, 'devices-add-relay-name')).toBe(true);
    expect(hasTestID(renderer, 'devices-slot-1')).toBe(true);
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(false);
    expect(hasTestID(renderer, 'devices-add-device-kind-relay')).toBe(false);
  });

  it('keeps the room form validation while the sensor name and channel are required', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');

    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(true);
    await changeText(renderer, 'devices-add-sensor-name', 'Cảm biến B');
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(true);
    await press(renderer, 'devices-field-humidity');
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(false);

    await press(renderer, 'devices-add-device-close');
    await press(renderer, 'devices-room-back');
    await press(renderer, 'devices-add-room-toggle');
    expect(
      byTestID(renderer, 'devices-add-room-submit')[0]!.props.disabled,
    ).toBe(true);
    await changeText(renderer, 'devices-add-room-input', 'Phòng C');
    expect(
      byTestID(renderer, 'devices-add-room-submit')[0]!.props.disabled,
    ).toBe(false);
  });

  it('a FAILED sensor add keeps the dialog open with the error; success closes it + banner', async () => {
    let fail = true;
    const renderer = await renderScreen({
      onAddDevice: async input =>
        fail
          ? { ok: false, message: 'Tên đã tồn tại' }
          : { ok: true, message: '' },
    });
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');
    await press(renderer, 'devices-field-humidity');
    await changeText(renderer, 'devices-add-sensor-name', 'Nhiệt độ phòng B');
    await press(renderer, 'devices-add-sensor-submit');

    // Failure: the dialog STAYS open with the truthful error inside.
    expect(hasTestID(renderer, 'devices-add-sensor-submit')).toBe(true);
    expect(visibleText(renderer)).toContain('Tên đã tồn tại');

    // Success: the dialog closes and the banner confirms the outcome.
    fail = false;
    await press(renderer, 'devices-add-sensor-submit');
    expect(hasTestID(renderer, 'devices-add-sensor-submit')).toBe(false);
    expect(visibleText(renderer)).toContain('Thêm cảm biến');
  });

  it('the custom-metric STEP hides the main form and ‹ Quay lại preserves its state', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');
    // Mutate the main step: name + metric choice.
    await changeText(renderer, 'devices-add-sensor-name', 'Áp suất phòng B');
    await press(renderer, 'devices-field-humidity');
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(false);

    // Enter the step: ONLY the creation form is rendered.
    await press(renderer, 'devices-custom-metric-toggle');
    expect(hasTestID(renderer, 'devices-add-device-kind-sensor')).toBe(false);
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(false);
    expect(hasTestID(renderer, 'devices-field-humidity')).toBe(false);
    expect(hasTestID(renderer, 'devices-add-sensor-submit')).toBe(false);
    expect(hasTextInput(renderer, 'capability-key-input')).toBe(true);
    // The title switched to the step's own.
    expect(visibleText(renderer)).toContain('Tạo loại thông số mới');

    // ‹ Quay lại: the main step is restored WITH its prior state.
    await press(renderer, 'devices-custom-metric-back');
    expect(hasTextInput(renderer, 'capability-key-input')).toBe(false);
    expect(
      renderer.root.findByProps({ testID: 'devices-add-sensor-name' }).props
        .value,
    ).toBe('Áp suất phòng B');
    const chip = renderer.root.findByProps({
      testID: 'devices-field-humidity',
    });
    const chipStyle = StyleSheet.flatten(chip.props.style) as Record<
      string,
      unknown
    >;
    expect(chipStyle.borderColor).toBe(LIGHT_TOKENS.primary);
    // The selected chip is the highlighted one — NOT dimmed.
    expect(chipStyle.opacity).toBeUndefined();
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(false);
  });

  it('a FAILED custom-metric creation keeps the STEP open with the error', async () => {
    const renderer = await renderScreen({
      onAddCapability: async () => ({ ok: false, message: 'Mã đã tồn tại' }),
    });
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');
    await press(renderer, 'devices-custom-metric-toggle');
    await changeText(renderer, 'capability-key-input', 'co2');
    await changeText(renderer, 'capability-label-input', 'CO2');
    await press(renderer, 'capability-add-submit');
    // The step STAYS open with the truthful error inside the form; the main
    // form is still hidden.
    expect(hasTextInput(renderer, 'capability-key-input')).toBe(true);
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(false);
    expect(visibleText(renderer)).toContain('Mã đã tồn tại');
  });

  it('✕ from the custom-metric step closes the WHOLE dialog with no side effects (fresh on reopen)', async () => {
    const onAddCapability = jest.fn();
    const renderer = await renderScreen({ onAddCapability });
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');
    await press(renderer, 'devices-custom-metric-toggle');
    await changeText(renderer, 'capability-key-input', 'co2');
    // ✕ (shell-level, works from either step) closes the ENTIRE dialog…
    await press(renderer, 'devices-add-device-close');
    expect(hasTextInput(renderer, 'capability-key-input')).toBe(false);
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(false);
    expect(onAddCapability).not.toHaveBeenCalled();
    // …and the reopen starts fresh on the main step.
    await press(renderer, 'devices-add-sensor-tab');
    assertFreshSensorDialog(renderer);
  });

  it('chip affordances: selected highlighted, others dimmed, bigger text/icons (user acceptance)', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');
    await press(renderer, 'devices-custom-metric-toggle');

    // COLOR swatches (dashboard-history-board-touch-share): the pressable
    // hit target is ≥44×44 and the PAINTED 36pt swatch is its child — one
    // is ALWAYS selected (3pt teal ring), the others dim.
    const selectedColor = renderer.root.findByProps({
      testID: `capability-color-${CAPABILITY_COLORS[0]}`,
    });
    const selectedHitStyle = StyleSheet.flatten(
      selectedColor.props.style,
    ) as Record<string, unknown>;
    expect(selectedHitStyle.minWidth).toBeGreaterThanOrEqual(44);
    expect(selectedHitStyle.minHeight).toBeGreaterThanOrEqual(44);
    const selectedSwatch = selectedColor.findAllByType(View).find(view => {
      const flatStyle = StyleSheet.flatten(view.props.style) as Record<
        string,
        unknown
      >;
      return flatStyle.width === 36;
    });
    expect(selectedSwatch).toBeTruthy();
    const selectedColorStyle = StyleSheet.flatten(
      selectedSwatch!.props.style,
    ) as Record<string, unknown>;
    expect(selectedColorStyle.width).toBe(36);
    expect(selectedColorStyle.height).toBe(36);
    expect(selectedColorStyle.borderWidth).toBe(3);
    expect(selectedColorStyle.borderColor).toBe(LIGHT_TOKENS.primary);
    expect(selectedColorStyle.opacity).toBeUndefined();

    const dimmedColor = renderer.root.findByProps({
      testID: `capability-color-${CAPABILITY_COLORS[1]}`,
    });
    const dimmedSwatch = dimmedColor.findAllByType(View).find(view => {
      const flatStyle = StyleSheet.flatten(view.props.style) as Record<
        string,
        unknown
      >;
      return flatStyle.width === 36;
    });
    expect(dimmedSwatch).toBeTruthy();
    const dimmedColorStyle = StyleSheet.flatten(
      dimmedSwatch!.props.style,
    ) as Record<string, unknown>;
    expect(dimmedColorStyle.opacity).toBe(0.4);
    expect(dimmedColorStyle.borderWidth).toBe(2);

    // ICON chips: bigger 22pt icons; the default group is selected (not
    // dimmed), the other groups dim.
    const firstGroup = CAPABILITY_ICON_GROUPS[0]!;
    const selectedIcon = renderer.root.findByProps({
      testID: `capability-icon-${firstGroup.icon}`,
    });
    expect(selectedIcon.findByType(Ionicons).props.size).toBe(22);
    const selectedIconStyle = StyleSheet.flatten(
      selectedIcon.props.style,
    ) as Record<string, unknown>;
    expect(selectedIconStyle.opacity).toBeUndefined();

    const secondGroup = CAPABILITY_ICON_GROUPS[1]!;
    const dimmedIcon = renderer.root.findByProps({
      testID: `capability-icon-${secondGroup.icon}`,
    });
    const dimmedIconStyle = StyleSheet.flatten(
      dimmedIcon.props.style,
    ) as Record<string, unknown>;
    expect(dimmedIconStyle.opacity).toBe(0.4);

    // PRESET chips: one-tap fill actions (no selection state) with bigger
    // 15pt text.
    const presetGroup = CAPABILITY_ICON_GROUPS.find(
      group => group.presets.length > 0,
    )!;
    await press(renderer, `capability-icon-${presetGroup.icon}`);
    const presetChip = renderer.root.findByProps({
      testID: `capability-preset-${presetGroup.presets[0]!.key}`,
    });
    const presetText = StyleSheet.flatten(
      presetChip.findByType(Text).props.style,
    ) as Record<string, unknown>;
    expect(presetText.fontSize).toBe(15);
  });

  it('the sensor add dialog inherits the room and omits already-registered fields', async () => {
    const added: NewDeviceInput[] = [];
    const renderer = await renderScreen({
      onAddDevice: async input => {
        added.push(input);
        return { ok: true, message: '' };
      },
    });
    await openRoom(renderer, 'room-a');
    await press(renderer, 'devices-add-sensor-tab');

    // temperature + humidity are both registered in room A → NOT offered.
    expect(hasTestID(renderer, 'devices-field-temperature')).toBe(false);
    expect(hasTestID(renderer, 'devices-field-humidity')).toBe(false);

    // Register a custom metric first — a dedicated STEP inside the dialog
    // (entering hides the main form; success returns to the main step).
    await press(renderer, 'devices-custom-metric-toggle');
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(false);
    expect(hasTextInput(renderer, 'capability-key-input')).toBe(true);
    await changeText(renderer, 'capability-key-input', 'pressure');
    await changeText(renderer, 'capability-label-input', 'Áp suất');
    await press(renderer, 'capability-add-submit');
    // Back on the MAIN step with the newly created metric selected.
    expect(hasTextInput(renderer, 'capability-key-input')).toBe(false);
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(true);
    const createdChip = renderer.root.findByProps({
      testID: 'devices-field-pressure',
    });
    const createdChipStyle = StyleSheet.flatten(
      createdChip.props.style,
    ) as Record<string, unknown>;
    expect(createdChipStyle.borderColor).toBe(LIGHT_TOKENS.primary);

    // The selected metric is used to create a new device in the open room.
    await changeText(renderer, 'devices-add-sensor-name', 'Áp suất phòng A');
    await press(renderer, 'devices-add-sensor-submit');

    expect(added).toHaveLength(1);
    expect(added[0]).toEqual({
      name: 'Áp suất phòng A',
      roomId: 'room-a',
      type: 'sensor',
      capabilities: ['pressure'],
      binding: { kind: 'telemetry-sensor' },
    });
    // Success closed the dialog.
    expect(hasTextInput(renderer, 'devices-add-sensor-name')).toBe(false);
  });

  it('a FULL room disables the sensor add (no field choices left)', async () => {
    const fullCapabilities: readonly CapabilityDef[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        type: `field_${i}`,
        label: `Trường ${i}`,
        kind: 'sensor' as const,
      })),
    ];
    const full: readonly Device[] = Array.from(
      { length: 10 },
      (_, i) =>
        ({
          id: `s${i}`,
          name: `Cảm biến ${i}`,
          roomId: 'room-a',
          type: 'sensor',
          capabilities: [`field_${i}`],
          binding: { kind: 'telemetry-sensor' },
        } as Device),
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    // Render with a full-room device list via a one-off harness override.
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <DeviceManagementScreen
            onBack={() => undefined}
            rooms={ROOMS}
            devices={full}
            capabilities={fullCapabilities}
            onAddRoom={async () => ({ ok: true, message: '' })}
            onRenameRoom={async () => ({ ok: true, message: '' })}
            onRemoveRoom={async () => ({ ok: true, message: '' })}
            onAddDevice={async () => ({ ok: true, message: '' })}
            onUpdateDevice={async () => ({ ok: true, message: '' })}
            onRemoveDevice={async () => ({ ok: true, message: '' })}
            onAddCapability={async () => ({ ok: true, message: '' })}
            onRemoveDeviceCapability={async () => ({ ok: true, message: '' })}
          />
        </ThemeProvider>,
      );
    });
    openRenderers.push(renderer);
    await openRoom(renderer, 'room-a');
    await press(renderer, 'devices-add-sensor-tab');
    // The counter shows the projected full quota, the truthful "no fields"
    // hint replaces the chips and Lưu is disabled.
    expect(visibleText(renderer)).toContain('Cảm biến (10)');
    expect(visibleText(renderer)).toContain(
      'Phòng đã đủ số lượng cảm biến cho phép.',
    );
    expect(
      byTestID(renderer, 'devices-add-sensor-submit')[0]!.props.disabled,
    ).toBe(true);
  });

  it('deleting a sensor row cascades the EXACT binding only (siblings survive)', async () => {
    const removed: { deviceId: string; field: string }[] = [];
    const renderer = await renderScreen({
      onRemoveDeviceCapability: async (deviceId, field) => {
        removed.push({ deviceId, field });
        return { ok: true, message: '' };
      },
    });
    await openRoom(renderer, 'room-a');
    await press(renderer, 'devices-sensor-delete-sensor-legacy-temperature');

    expect(removed).toEqual([
      { deviceId: 'sensor-legacy', field: 'temperature' },
    ]);
  });

  it('deleting and re-adding a field creates a new device identity', async () => {
    const added: NewDeviceInput[] = [];
    const removed: { deviceId: string; field: string }[] = [];
    const renderer = await renderScreen({
      onAddDevice: async input => {
        added.push(input);
        return { ok: true, message: '' };
      },
      onRemoveDeviceCapability: async (deviceId, field) => {
        removed.push({ deviceId, field });
        return { ok: true, message: '' };
      },
    });
    await openRoom(renderer, 'room-a');
    await press(renderer, 'devices-sensor-delete-sensor-legacy-temperature');
    expect(removed).toEqual([
      { deviceId: 'sensor-legacy', field: 'temperature' },
    ]);

    await press(renderer, 'devices-add-sensor-tab');
    await press(renderer, 'devices-field-temperature');
    await changeText(renderer, 'devices-add-sensor-name', 'Nhiệt độ mới');
    await press(renderer, 'devices-add-sensor-submit');

    expect(added[0]).toEqual({
      name: 'Nhiệt độ mới',
      roomId: 'room-a',
      type: 'sensor',
      capabilities: ['temperature'],
      binding: { kind: 'telemetry-sensor' },
    });
    const createdRows = renderer.root
      .findAllByType(View)
      .filter(
        row => row.props.testID === 'devices-sensor-row-created-0-temperature',
      );
    const deletedRows = renderer.root
      .findAllByType(View)
      .filter(
        row =>
          row.props.testID === 'devices-sensor-row-sensor-legacy-temperature',
      );
    expect(createdRows).toHaveLength(1);
    expect(deletedRows).toHaveLength(0);
  });

  it('renaming a relay saves through onUpdateDevice; failure keeps the row in edit mode (regression)', async () => {
    let fail = true;
    const renderer = await renderScreen({
      onUpdateDevice: async () =>
        fail
          ? { ok: false, message: 'Tên relay trùng' }
          : { ok: true, message: '' },
    });
    await openRoom(renderer, 'room-a');
    // Relay rows live on the controls tab.
    await press(renderer, 'devices-section-controls');
    // The pencil on the relay row ('Đèn A', labelled 'Sửa').
    await pressByLabel(renderer, 'Sửa', 'Đèn A');
    // The inline rename input is the only TextInput mounted in the detail.
    await act(async () => {
      renderer.root.findByType(TextInput).props.onChangeText('Quạt trần A');
    });
    await pressByText(renderer, 'Lưu');
    // Failure: the row error shows and the row STAYS in edit mode.
    expect(visibleText(renderer)).toContain('Tên relay trùng');
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
    // Success: the row exits edit mode showing the new name.
    fail = false;
    await pressByText(renderer, 'Lưu');
    expect(visibleText(renderer)).toContain('Quạt trần A');
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('removing a relay calls onRemoveDevice; failure shows the row error (regression)', async () => {
    let fail = true;
    const removed: string[] = [];
    const renderer = await renderScreen({
      onRemoveDevice: async id => {
        removed.push(id);
        return fail
          ? { ok: false, message: 'Không xóa được' }
          : { ok: true, message: '' };
      },
    });
    await openRoom(renderer, 'room-a');
    // Relay rows live on the controls tab.
    await press(renderer, 'devices-section-controls');
    await pressTrashInsideCard(renderer, 'Đèn A');
    // Failure: the row error shows, the relay row stays.
    expect(removed).toEqual(['relay-a1']);
    expect(visibleText(renderer)).toContain('Không xóa được');
    // The row card is a plain View (non-pressable) — raw testID lookup.
    expect(
      renderer.root.findAllByProps({ testID: 'devices-relay-row-relay-a1' })
        .length,
    ).toBeGreaterThan(0);
    // Success: the row is gone.
    fail = false;
    await pressTrashInsideCard(renderer, 'Đèn A');
    expect(removed).toEqual(['relay-a1', 'relay-a1']);
    expect(
      renderer.root.findAllByProps({ testID: 'devices-relay-row-relay-a1' }),
    ).toHaveLength(0);
  });

  it('the relay add dialog asks only for name + free slot (room inherited)', async () => {
    const added: NewDeviceInput[] = [];
    const renderer = await renderScreen({
      onAddDevice: async input => {
        added.push(input);
        return { ok: true, message: '' };
      },
    });
    await openRoom(renderer, 'room-a');
    await press(renderer, 'devices-section-controls');
    await press(renderer, 'devices-add-relay-tab');

    // Slot 1 is taken in room A; slot 2 is offered.
    expect(hasTestID(renderer, 'devices-slot-1')).toBe(false);
    expect(hasTestID(renderer, 'devices-slot-2')).toBe(true);
    await changeText(renderer, 'devices-add-relay-name', 'Quạt A');
    await press(renderer, 'devices-slot-2');
    await press(renderer, 'devices-add-relay-submit');

    expect(added).toHaveLength(1);
    expect(added[0]).toEqual({
      name: 'Quạt A',
      roomId: 'room-a',
      type: 'relay',
      capabilities: ['switch'],
      binding: { kind: 'relay', index: 2 },
    });
    // Success closed the dialog.
    expect(hasTextInput(renderer, 'devices-add-relay-name')).toBe(false);
  });

  it('renders the ambient smart wash + smart card rows in light AND dark (settings-smart-home-sync)', async () => {
    // Both themes (reviewer MAJOR-3: the visual contract is not light-only).
    for (const [mode, tokens] of [
      ['light', LIGHT_TOKENS],
      ['dark', DARK_TOKENS],
    ] as const) {
      const renderer = await renderScreen({}, mode);
      const gradient = renderer.root.findByType(LinearGradient);
      expect(gradient.props.colors).toEqual([
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]);
      expect(gradient.props.start).toEqual({ x: 0, y: 0 });
      expect(gradient.props.end).toEqual({ x: 1, y: 1 });
      // Smart card rows (no legacy plain surface/border recipe)…
      const cards = viewsWithStyle(renderer.root, {
        backgroundColor: tokens.smart.colors.card,
        borderColor: tokens.smart.colors.cardBorder,
      });
      expect(cards.length).toBeGreaterThan(0);
      // …carrying the smart card shadow (rowCard/addCard elevation; dark
      // theme's border-borne depth pins the zeroed elevation explicitly).
      expect(
        viewsWithStyle(renderer.root, {
          backgroundColor: tokens.smart.colors.card,
          borderColor: tokens.smart.colors.cardBorder,
          elevation: tokens.smart.cardShadow.elevation,
        }).length,
      ).toBeGreaterThan(0);
    }
  });
});

/** Views whose flattened style carries ALL the given style entries. */
function viewsWithStyle(
  root: TestRenderer.ReactTestInstance,
  match: Record<string, unknown>,
): TestRenderer.ReactTestInstance[] {
  return root.findAllByType(View).filter(view => {
    if (!view.props.style) {
      return false;
    }
    const flat = StyleSheet.flatten(view.props.style as never) as Record<
      string,
      unknown
    >;
    if (!flat) {
      return false;
    }
    return Object.entries(match).every(([key, value]) => flat[key] === value);
  });
}

/** Unmount every renderer created by the suite (teardown hygiene). */
afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
});

describe('AddRoomDialog board-pick step (board-discovery-binding)', () => {
  const DISCOVERED: readonly BoardInventoryEntry[] = [
    { code: 'board-2', status: 'offline' },
    { code: 'board-1', status: 'online' },
    { code: 'board-3', status: 'seen' },
  ];

  it('lists unassigned boards ONLINE FIRST and submits the picked code', async () => {
    const submissions: { name: string; code?: string }[] = [];
    const renderer = await renderScreen({
      boards: DISCOVERED,
      onAddRoom: async (name, code) => {
        submissions.push({ name, code });
        return {
          ok: true,
          message: '',
          roomId: `room-${name}`,
        };
      },
    });

    await press(renderer, 'devices-add-room-toggle');
    // The pick step lists the discovered boards (all unassigned here).
    expect(hasTextInput(renderer, 'devices-add-room-board-board-1')).toBe(true);
    expect(hasTextInput(renderer, 'devices-add-room-board-board-2')).toBe(true);
    expect(hasTextInput(renderer, 'devices-add-room-board-board-3')).toBe(true);
    // A room with a board code already bound must NOT be offered. (Harness
    // rooms have no codes, so all three are available — the taken-filter is
    // covered by the dedicated case below.)

    await changeText(renderer, 'devices-add-room-input', 'Phòng mới');
    await press(renderer, 'devices-add-room-board-board-1');
    await press(renderer, 'devices-add-room-submit');

    expect(submissions).toEqual([{ name: 'Phòng mới', code: 'board-1' }]);
    expect(hasTextInput(renderer, 'devices-add-room-input')).toBe(false);
  });

  it('omits boards already bound to a room from the pick list', async () => {
    const renderer = await renderScreen({
      boards: DISCOVERED,
      initialRooms: [
        { id: 'room-a', name: 'Phòng A', order: 0, code: 'board-1' },
        { id: 'room-b', name: 'Phòng B', order: 1 },
      ],
    });

    await press(renderer, 'devices-add-room-toggle');

    expect(hasTextInput(renderer, 'devices-add-room-board-board-1')).toBe(
      false,
    );
    expect(hasTextInput(renderer, 'devices-add-room-board-board-2')).toBe(true);
  });

  it('the manual "Nhập mã khác" entry validates format and uniqueness', async () => {
    const submissions: { name: string; code?: string }[] = [];
    const renderer = await renderScreen({
      boards: DISCOVERED,
      initialRooms: [
        { id: 'room-a', name: 'Phòng A', order: 0, code: 'board-9' },
        { id: 'room-b', name: 'Phòng B', order: 1 },
      ],
      onAddRoom: async (name, code) => {
        submissions.push({ name, code });
        return { ok: true, message: '', roomId: `room-${name}` };
      },
    });

    await press(renderer, 'devices-add-room-toggle');
    await press(renderer, 'devices-add-room-manual-toggle');
    expect(hasTextInput(renderer, 'devices-add-room-manual-input')).toBe(true);

    const submitDisabled = (): boolean =>
      byTestID(renderer, 'devices-add-room-submit')[0]!.props.disabled;

    // Invalid format → the submit stays DISABLED (red input border + hint).
    await changeText(renderer, 'devices-add-room-input', 'Phòng X');
    await changeText(renderer, 'devices-add-room-manual-input', 'phòng 1');
    expect(submitDisabled()).toBe(true);

    // Already-bound code → still disabled; the hint names the conflict.
    await changeText(renderer, 'devices-add-room-manual-input', 'board-9');
    expect(submitDisabled()).toBe(true);
    expect(visibleText(renderer)).toContain(
      'Mã này đã được gán cho phòng khác.',
    );

    // Guard rail (defense in depth): forcing the guard still rejects.
    await press(renderer, 'devices-add-room-submit');
    expect(submissions).toEqual([]);

    // Valid, untaken code → enabled and submitted with the room.
    await changeText(renderer, 'devices-add-room-manual-input', 'board-42');
    expect(submitDisabled()).toBe(false);
    await press(renderer, 'devices-add-room-submit');
    expect(submissions).toEqual([{ name: 'Phòng X', code: 'board-42' }]);
  });

  it('submitting WITHOUT a pick creates an unbound room (skip = as before)', async () => {
    const submissions: { name: string; code?: string }[] = [];
    const renderer = await renderScreen({
      boards: DISCOVERED,
      onAddRoom: async (name, code) => {
        submissions.push({ name, code });
        return { ok: true, message: '', roomId: `room-${name}` };
      },
    });

    await press(renderer, 'devices-add-room-toggle');
    await changeText(renderer, 'devices-add-room-input', 'Phòng trống');
    await press(renderer, 'devices-add-room-submit');

    expect(submissions).toEqual([{ name: 'Phòng trống', code: undefined }]);
  });

  it('the manual code fallback stays reachable with an EMPTY inventory (fix cycle 2)', async () => {
    const submissions: { name: string; code?: string }[] = [];
    const renderer = await renderScreen({
      boards: [], // Nothing discovered / all assigned.
      onAddRoom: async (name, code) => {
        submissions.push({ name, code });
        return { ok: true, message: '', roomId: `room-${name}` };
      },
    });

    await press(renderer, 'devices-add-room-toggle');
    // No board chips, but the manual entry MUST still be offered.
    expect(hasTextInput(renderer, 'devices-add-room-board-board-1')).toBe(
      false,
    );
    await press(renderer, 'devices-add-room-manual-toggle');
    expect(hasTextInput(renderer, 'devices-add-room-manual-input')).toBe(true);

    await changeText(renderer, 'devices-add-room-input', 'Phòng tay');
    await changeText(renderer, 'devices-add-room-manual-input', 'board-77');
    await press(renderer, 'devices-add-room-submit');

    expect(submissions).toEqual([{ name: 'Phòng tay', code: 'board-77' }]);
  });
});

describe('AddDeviceDialog descriptor-driven choices (boards-topic-contract-v2)', () => {
  /**
   * board-1 declares: temperature + pressure sensors (K1 + K3 relays).
   * `pressure` has NO catalog entry → the raw-field label fallback applies;
   * `temperature` IS declared but already registered in room-a → filtered
   * by the not-taken rule.
   */
  const BOUND_ROOMS: readonly Room[] = [
    { id: 'room-a', name: 'Phòng A', order: 0, code: 'board-1' },
    { id: 'room-b', name: 'Phòng B', order: 1 }, // unbound
  ];
  const DESCRIPTOR_BOARDS: readonly BoardInventoryEntry[] = [
    {
      code: 'board-1',
      status: 'online',
      descriptor: {
        boardType: 'esp32-sensor-relay',
        sensors: [
          { channel: 'S1', field: 'temperature', unit: '°C' },
          { channel: 'S2', field: 'pressure' },
        ],
        relays: ['K1', 'K3'],
      },
    },
  ];

  async function openAddDeviceDialog(
    callbacks: HarnessCallbacks,
    roomId: string,
    kind: 'sensor' | 'relay' = 'sensor',
  ) {
    const renderer = await renderScreen(callbacks);
    await openRoom(renderer, roomId);
    if (kind === 'relay') {
      await press(renderer, 'devices-section-controls');
      await press(renderer, 'devices-add-relay-tab');
    } else {
      await press(renderer, 'devices-add-sensor-tab');
    }
    return renderer;
  }

  it('offers ONLY the descriptor fields for a bound room (catalog label, raw fallback, not-taken filter)', async () => {
    const renderer = await openAddDeviceDialog(
      { boards: DESCRIPTOR_BOARDS, initialRooms: BOUND_ROOMS },
      'room-a',
    );

    // Declared + free → offered. `pressure` has no catalog entry → the RAW
    // field name is the chip label (fallback).
    expect(hasTestID(renderer, 'devices-field-pressure')).toBe(true);
    expect(visibleText(renderer)).toContain('pressure');
    // Declared but ALREADY REGISTERED in the room → filtered (not-taken).
    expect(hasTestID(renderer, 'devices-field-temperature')).toBe(false);
    // NOT declared by the descriptor → never offered, even though the full
    // catalog path would offer it (undeclared channels are not displayed).
    expect(hasTestID(renderer, 'devices-field-humidity')).toBe(false);
  });

  it('offers the descriptor-declared K channels ∩ free slots for a bound room', async () => {
    const renderer = await openAddDeviceDialog(
      { boards: DESCRIPTOR_BOARDS, initialRooms: BOUND_ROOMS },
      'room-a',
      'relay',
    );

    // Declared K3 + free → offered (a declared channel without data stays
    // a valid choice — decision #10).
    expect(hasTestID(renderer, 'devices-slot-3')).toBe(true);
    // Declared K1 but slot 1 is TAKEN (relay-a1) → filtered.
    expect(hasTestID(renderer, 'devices-slot-1')).toBe(false);
    // NOT declared (K2) → never offered, despite being free in the full
    // 1..10 pool.
    expect(hasTestID(renderer, 'devices-slot-2')).toBe(false);
  });

  it('requires metadata for an uncatalogued declared field, then auto-selects it for the new sensor', async () => {
    const submissions: NewDeviceInput[] = [];
    const metadata: NewCapabilityInput[] = [];
    const renderer = await openAddDeviceDialog(
      {
        boards: DESCRIPTOR_BOARDS,
        initialRooms: BOUND_ROOMS,
        onAddDevice: async input => {
          submissions.push(input);
          return { ok: true, message: '' };
        },
        onAddCapability: async input => {
          metadata.push(input);
          return { ok: true, message: '' };
        },
      },
      'room-a',
    );

    await press(renderer, 'devices-field-pressure');
    expect(
      renderer.root.findByProps({ testID: 'capability-key-input' }).props.value,
    ).toBe('pressure');
    expect(
      renderer.root.findByProps({ testID: 'capability-key-input' }).props
        .editable,
    ).toBe(false);
    await changeText(renderer, 'capability-label-input', 'Áp suất');
    await press(renderer, 'capability-add-submit');
    expect(metadata).toEqual([
      expect.objectContaining({ type: 'pressure', label: 'Áp suất' }),
    ]);
    expect(hasTestID(renderer, 'devices-field-pressure')).toBe(true);

    await changeText(renderer, 'devices-add-sensor-name', 'Áp suất phòng A');
    await press(renderer, 'devices-add-sensor-submit');
    expect(submissions).toEqual([
      {
        name: 'Áp suất phòng A',
        roomId: 'room-a',
        type: 'sensor',
        capabilities: ['pressure'],
        binding: { kind: 'telemetry-sensor' },
      },
    ]);
  });

  it('an UNBOUND room keeps the full catalog + slots 1..10 (no descriptor narrowing)', async () => {
    const renderer = await openAddDeviceDialog(
      { boards: DESCRIPTOR_BOARDS, initialRooms: BOUND_ROOMS },
      'room-b',
    );

    // Full catalog minus the room's taken temperature; `pressure` (not in
    // the catalog) is never offered on the unbound path.
    expect(hasTestID(renderer, 'devices-field-humidity')).toBe(true);
    expect(hasTestID(renderer, 'devices-field-temperature')).toBe(false);
    expect(hasTestID(renderer, 'devices-field-pressure')).toBe(false);

    await press(renderer, 'devices-add-device-close');
    await press(renderer, 'devices-section-controls');
    await press(renderer, 'devices-add-relay-tab');
    // The full 1..10 pool (room-b has no relays) — slot 10 only exists on
    // the un-narrowed path.
    expect(hasTestID(renderer, 'devices-slot-2')).toBe(true);
    expect(hasTestID(renderer, 'devices-slot-10')).toBe(true);
  });

  it('a bound room whose board has NO descriptor yet falls back to the full behavior', async () => {
    const renderer = await openAddDeviceDialog(
      {
        // Both boards discovered but NEITHER descriptor has arrived.
        boards: [
          { code: 'board-1', status: 'online' },
          { code: 'board-2', status: 'online' },
        ],
        initialRooms: [
          { id: 'room-a', name: 'Phòng A', order: 0, code: 'board-1' },
          // room-b is BOUND (board-2) and only holds a temperature sensor,
          // so the full catalog still offers humidity there.
          { id: 'room-b', name: 'Phòng B', order: 1, code: 'board-2' },
        ],
      },
      'room-b',
    );

    // Full catalog path: humidity free → offered; `pressure` (not a catalog
    // type) is never offered outside a descriptor; temperature is taken.
    expect(hasTestID(renderer, 'devices-field-humidity')).toBe(true);
    expect(hasTestID(renderer, 'devices-field-temperature')).toBe(false);
    expect(hasTestID(renderer, 'devices-field-pressure')).toBe(false);

    await press(renderer, 'devices-add-device-close');
    await press(renderer, 'devices-section-controls');
    await press(renderer, 'devices-add-relay-tab');
    // Full 1..10 pool (room-b has no relays) — the un-narrowed fallback.
    expect(hasTestID(renderer, 'devices-slot-2')).toBe(true);
    expect(hasTestID(renderer, 'devices-slot-10')).toBe(true);
  });
});

describe('DevicesScreen 44pt touch targets (dashboard-history-board-touch-share)', () => {
  /** Flatten an RN style (object or array of objects) into one object. */
  const flat = (style: unknown): Record<string, unknown> =>
    Object.assign(
      {},
      ...((Array.isArray(style) ? style : [style]).filter(
        layer => layer !== null && typeof layer === 'object',
      ) as Record<string, unknown>[]),
    );

  /** Pressable style by testID (repo pressable-filter convention). */
  const pressableFlat = (
    renderer: TestRenderer.ReactTestRenderer,
    testID: string,
  ): Record<string, unknown> => {
    const node = renderer.root
      .findAllByProps({ testID })
      .find(candidate => typeof candidate.props.onPress === 'function');
    if (!node) {
      throw new Error(`No pressable node for testID "${testID}"`);
    }
    return flat(node.props.style);
  };

  it('both back rows and the room overflow affordance carry explicit ≥44 bounds', async () => {
    const renderer = await renderScreen();
    // The room overflow lives on the ROOT rooms list (it is replaced by
    // the room detail once a room is opened).
    const overflow = pressableFlat(renderer, 'devices-room-actions-room-a');
    expect(typeof overflow.minWidth).toBe('number');
    expect(overflow.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof overflow.minHeight).toBe('number');
    expect(overflow.minHeight as number).toBeGreaterThanOrEqual(44);

    await openRoom(renderer, 'room-a');
    for (const testID of ['devices-room-back']) {
      const style = pressableFlat(renderer, testID);
      expect(typeof style.minHeight).toBe('number');
      expect(style.minHeight as number).toBeGreaterThanOrEqual(44);
    }
  });

  it('the Add Device dialog close ✕ and the custom-metric icon-only controls carry explicit ≥44 bounds', async () => {
    const renderer = await renderScreen();
    await openRoom(renderer, 'room-b');
    await press(renderer, 'devices-add-sensor-tab');

    // The shell ✕ close (shared by both dialogs).
    const closeStyle = pressableFlat(renderer, 'devices-add-device-close');
    expect(typeof closeStyle.minWidth).toBe('number');
    expect(closeStyle.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof closeStyle.minHeight).toBe('number');
    expect(closeStyle.minHeight as number).toBeGreaterThanOrEqual(44);

    // The custom-metric step's icon-only controls.
    await press(renderer, 'devices-custom-metric-toggle');
    const firstGroup = CAPABILITY_ICON_GROUPS[0]!;
    const iconStyle = pressableFlat(
      renderer,
      `capability-icon-${firstGroup.icon}`,
    );
    expect(typeof iconStyle.minWidth).toBe('number');
    expect(iconStyle.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof iconStyle.minHeight).toBe('number');
    expect(iconStyle.minHeight as number).toBeGreaterThanOrEqual(44);

    const colorStyle = pressableFlat(
      renderer,
      `capability-color-${CAPABILITY_COLORS[0]}`,
    );
    expect(typeof colorStyle.minWidth).toBe('number');
    expect(colorStyle.minWidth as number).toBeGreaterThanOrEqual(44);
    expect(typeof colorStyle.minHeight).toBe('number');
    expect(colorStyle.minHeight as number).toBeGreaterThanOrEqual(44);
  });
});
