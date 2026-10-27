/**
 * WidgetRenderer rebind-picker tests (fix cycle 1): the lost-binding picker
 * is room-scoped — a widget with `roomId: 'room-a'` only offers devices of
 * room A (equal-capability devices of other rooms are NOT offered); a
 * global widget may bind any device; a no-binding widget (room overview)
 * never shows the picker at all. The UI filter is backed by the
 * authoritative dashboard service/store seam (covered separately).
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@core/theme';
import {
  createWidgetRegistry,
  WidgetServicesProvider,
  type WidgetRegistry,
  type WidgetServices,
} from '@modules/widgets/api';
import type { CapabilityDef, Device } from '@modules/devices/api';
import { BUILT_IN_CAPABILITIES } from '@modules/devices/api';
import type { WidgetConfig } from '@modules/widgets/api';

import { WidgetRenderer } from './WidgetRenderer';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

function FakeSwitch(): null {
  return null;
}

function makeRegistry(): WidgetRegistry {
  const registry = createWidgetRegistry();
  registry.register({
    type: 'switch',
    label: 'Công tắc',
    description: 'test widget',
    icon: 'power-outline',
    category: 'control',
    supportedCapabilities: ['switch'],
    supportedSizes: ['1x1', '2x1'],
    component: FakeSwitch,
  });
  registry.register({
    type: 'vendor-camera-panel',
    label: 'Bảng camera',
    description: 'test widget',
    icon: 'list-outline',
    category: 'control',
    supportedCapabilities: [],
    supportedSizes: ['2x1', '2x2'],
    component: FakeSwitch,
  });
  return registry;
}

const DEVICES: readonly Device[] = [
  {
    id: 'relay-a',
    name: 'Đèn phòng A',
    roomId: 'room-a',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 1 },
  },
  {
    id: 'relay-b',
    name: 'Đèn phòng B',
    roomId: 'room-b',
    type: 'relay',
    capabilities: ['switch'],
    binding: { kind: 'relay', index: 1 },
  },
];

function makeServices(devices: readonly Device[]): WidgetServices {
  // Stable connected snapshot (amendment-2 connection seam; identity
  // stability for useSyncExternalStore).
  const connection = { state: 'connected' as const, label: 'Đã kết nối' };
  return {
    getState: () => undefined,
    getSeries: () => [],
    sendCommand: () => ({
      ok: false as const,
      error: { code: 'unknown' as const, message: 'not wired' },
    }),
    queryHistory: async () => ({
      ok: true as const,
      value: [],
    }),
    getRooms: () => [
      { id: 'room-a', name: 'Phòng A', order: 0 },
      { id: 'room-b', name: 'Phòng B', order: 1 },
    ],
    getDevices: () => devices,
    getCapabilities: (): readonly CapabilityDef[] => BUILT_IN_CAPABILITIES,
    getActiveRoomId: () => 'room-a',
    subscribeDeviceState: () => () => undefined,
    // Stable connected snapshot (amendment-2 connection seam).
    getConnectionState: () => connection,
    getCommandError: () => null,
    subscribeConnection: () => () => undefined,
  };
}

function lostBindingWidget(roomId?: string): WidgetConfig {
  return {
    id: 'w1',
    type: 'switch',
    roomId,
    // The bound device no longer exists → bindingLost.
    binding: { deviceId: 'gone', capability: 'switch' },
    layout: { x: 0, y: 0, width: 1, height: 1 },
  };
}

async function renderWidget(config: WidgetConfig, devices: readonly Device[]) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider mode="light">
        <WidgetServicesProvider services={makeServices(devices)}>
          <WidgetRenderer
            registry={makeRegistry()}
            config={config}
            onRebind={() => undefined}
          />
        </WidgetServicesProvider>
      </ThemeProvider>,
    );
  });
  return renderer;
}

/** All visible text of the renderer. */
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

/** Deep text under ONE instance (node-level walk). */
function nodeText(node: {
  props?: { children?: unknown };
  children?: unknown[];
}): string {
  const texts: string[] = [];
  const walk = (n: { props?: { children?: unknown } }) => {
    const children = n.props?.children;
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
  walk(node as never);
  return texts.join('');
}

/** Press the Pressable whose subtree renders exactly `label`. */
async function pressLabel(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> {
  const found = renderer.root.findAll(
    node =>
      node.type !== undefined &&
      typeof node.props?.onPress === 'function' &&
      nodeText(node as never) === label,
  );
  expect(found.length).toBeGreaterThan(0);
  await act(async () => {
    found[0]!.props.onPress();
  });
}

describe('WidgetRenderer lost-binding rebind picker (room-scoped)', () => {
  it('offers ONLY same-room devices to a room-scoped widget', async () => {
    const renderer = await renderWidget(lostBindingWidget('room-a'), DEVICES);
    // Open the picker.
    await pressLabel(renderer, 'Chọn lại thiết bị');
    const text = visibleText(renderer);
    expect(text).toContain('Đèn phòng A');
    expect(text).not.toContain('Đèn phòng B');
  });

  it('offers every compatible device to a GLOBAL widget', async () => {
    const renderer = await renderWidget(lostBindingWidget(undefined), DEVICES);
    await pressLabel(renderer, 'Chọn lại thiết bị');
    const text = visibleText(renderer);
    expect(text).toContain('Đèn phòng A');
    expect(text).toContain('Đèn phòng B');
  });

  it('a no-binding widget never renders the rebind picker', async () => {
    const unbound: WidgetConfig = {
      id: 'w2',
      type: 'vendor-camera-panel',
      roomId: 'room-a',
      layout: { x: 0, y: 0, width: 2, height: 1 },
    };
    const renderer = await renderWidget(unbound, DEVICES);
    expect(visibleText(renderer)).not.toContain('Chọn lại thiết bị');
  });
});
