/**
 * QrScannerModal tests (settings-secrets-qr) — the GENERIC core/ui camera
 * scanner primitive (mock camera lib per the BoardsScanner test pattern):
 * renders the caller's title/hint, forwards the raw payload through the
 * `onScanned` seam, keeps the camera live with the RAW-payload diagnostic
 * (truncated to 80 chars + `…`) when the scan is rejected (`false`), and
 * the harness closes it on an accepted scan (`true` — the documented
 * screen contract, same as BoardsScreen). The re-arm seam lets the next
 * scan through after a rejection; duplicates within one open are ignored
 * (single-scan lock).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Camera } from 'expo-camera';

import { ThemeProvider } from '@core/theme';

import { QrScannerModal } from './QrScannerModal';

/**
 * expo-camera mock (BoardsScanner pattern): the CameraView stub renders a
 * placeholder node that CARRIES the `onBarcodeScanned` prop — tests invoke
 * it to simulate a scan. `Camera.requestCameraPermissionsAsync` is a
 * jest.fn resolving granted by default; individual tests override it for
 * the denied variant. The factory is fully self-contained (jest.mock
 * hoisting forbids out-of-scope value references).
 */
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    CameraView: (props: {
      onBarcodeScanned?: (event: {
        readonly data: string;
        readonly type: string;
      }) => void;
    }) =>
      React.createElement('View', {
        testID: 'qr-scanner-camera',
        onBarcodeScanned: props.onBarcodeScanned,
      }),
    Camera: {
      requestCameraPermissionsAsync: jest.fn(async () => ({
        granted: true,
        status: 'granted',
        canAskAgain: true,
        expires: 'never',
      })),
    },
  };
});

/** Renderers still mounted (unmounted in afterEach — hygiene). */
const openRenderers: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of openRenderers) {
    act(() => {
      renderer.unmount();
    });
  }
  openRenderers.length = 0;
});

/**
 * Harness mirroring the documented SCREEN contract: `onScanned` returning
 * false keeps the modal open with a display-only error; returning true
 * closes it (the caller consumes the payload and dismisses).
 */
function ScannerHarness(props: { onScanned: (raw: string) => boolean }) {
  const [visible, setVisible] = React.useState(true);
  const [lastError, setLastError] = React.useState<string | null>(null);
  return (
    <ThemeProvider mode="light">
      <QrScannerModal
        visible={visible}
        title="Quét QR từ server"
        hint="Hướng mã QR do server in vào khung"
        onClose={() => setVisible(false)}
        onScanned={raw => {
          const accepted = props.onScanned(raw);
          if (accepted) {
            setLastError(null);
            setVisible(false);
          } else {
            setLastError('Loại QR không hỗ trợ');
          }
          return accepted;
        }}
        lastError={lastError}
      />
    </ThemeProvider>
  );
}

function renderHarness(onScanned: (raw: string) => boolean) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ScannerHarness onScanned={onScanned} />);
  });
  openRenderers.push(renderer);
  return renderer;
}

/** Flush the camera-permission promise so the granted flow renders. */
async function flushPermission(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function fireScan(
  renderer: TestRenderer.ReactTestRenderer,
  data: string,
): void {
  const camera = renderer.root.findByProps({ testID: 'qr-scanner-camera' });
  act(() => {
    camera.props.onBarcodeScanned({ data, type: 'qr' });
  });
}

describe('QrScannerModal', () => {
  it('renders the caller title + hint over the camera when visible and granted', async () => {
    const renderer = renderHarness(() => false);
    await flushPermission();
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-title' }).props.children,
    ).toBe('Quét QR từ server');
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-hint' }).props.children,
    ).toBe('Hướng mã QR do server in vào khung');
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-camera' }),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: 'qr-scanner-error' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'qr-scanner-raw' }),
    ).toHaveLength(0);
  });

  it('forwards the RAW payload through onScanned; a rejection keeps the modal open with the diagnostic', async () => {
    const onScanned = jest.fn(() => false);
    const renderer = renderHarness(onScanned);
    await flushPermission();
    fireScan(renderer, '{"schemaVersion":1,"kind":"system"}');
    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith(
      '{"schemaVersion":1,"kind":"system"}',
    );
    // Rejected → the harness kept the modal open (camera still live) and
    // its display-only error shows; the modal shows the raw diagnostic.
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-camera' }),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-error' }).props.children,
    ).toBe('Loại QR không hỗ trợ');
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-raw' }).props.children,
    ).toBe('{"schemaVersion":1,"kind":"system"}');
  });

  it('truncates the diagnostic raw line to 80 chars + ellipsis', async () => {
    const renderer = renderHarness(() => false);
    await flushPermission();
    const longPayload = 'x'.repeat(120);
    fireScan(renderer, longPayload);
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-raw' }).props.children,
    ).toBe(`${'x'.repeat(80)}…`);
  });

  it('an ACCEPTED scan closes the modal through the harness (the screen contract)', async () => {
    const onScanned = jest.fn(() => true);
    const renderer = renderHarness(onScanned);
    await flushPermission();
    fireScan(renderer, '{"schemaVersion":1,"kind":"credentials"}');
    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(
      renderer.root.findAllByProps({ testID: 'qr-scanner-camera' }),
    ).toHaveLength(0);
  });

  it('re-arms after a rejection: the next scan reaches onScanned again', async () => {
    let accept = false;
    const onScanned = jest.fn(() => accept);
    const renderer = renderHarness(onScanned);
    await flushPermission();
    fireScan(renderer, 'first-garbage');
    expect(onScanned).toHaveBeenCalledTimes(1);
    // The camera stays live; flip the handler to accept and scan again.
    accept = true;
    fireScan(renderer, 'second-payload');
    expect(onScanned).toHaveBeenCalledTimes(2);
    expect(onScanned).toHaveBeenLastCalledWith('second-payload');
    expect(
      renderer.root.findAllByProps({ testID: 'qr-scanner-camera' }),
    ).toHaveLength(0);
  });

  it('ignores duplicate camera callbacks for one accepted scan (single-scan lock)', async () => {
    const onScanned = jest.fn(() => true);
    const renderer = renderHarness(onScanned);
    await flushPermission();
    const camera = renderer.root.findByProps({ testID: 'qr-scanner-camera' });
    act(() => {
      camera.props.onBarcodeScanned({ data: 'one', type: 'qr' });
      camera.props.onBarcodeScanned({ data: 'one-duplicate', type: 'qr' });
    });
    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith('one');
  });

  it('the close button requests the close', async () => {
    const onClose = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ThemeProvider mode="light">
          <QrScannerModal
            visible
            title="Quét QR từ server"
            hint="Hướng mã QR do server in vào khung"
            onClose={onClose}
            onScanned={() => false}
          />
        </ThemeProvider>,
      );
    });
    openRenderers.push(renderer);
    await flushPermission();
    act(() => {
      renderer.root.findByProps({ testID: 'qr-scanner-close' }).props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the denied hint without a camera when permission is refused', async () => {
    (Camera.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      status: 'denied',
      canAskAgain: true,
      expires: 'never',
    });
    const renderer = renderHarness(() => false);
    await flushPermission();
    expect(
      renderer.root.findByProps({ testID: 'qr-scanner-denied' }),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({ testID: 'qr-scanner-camera' }),
    ).toHaveLength(0);
  });
});
