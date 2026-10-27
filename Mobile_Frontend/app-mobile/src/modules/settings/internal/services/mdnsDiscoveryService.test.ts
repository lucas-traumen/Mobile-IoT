/**
 * mdnsDiscoveryService tests (plan required tests — mock the zeroconf
 * lib): scan start/stop with the DNSSD impl; resolved event → typed
 * result mapping with the address-selection contract (filter + subnet
 * priority + honest skip); cleanup on EVERY exit path (timeout / error /
 * user stop); the 10 s timeout → the honest EMPTY result (never an
 * error); lib error → typed error Result; web guard — lazy getter +
 * TRANSPORT error, the lib is NEVER constructed on web; async phone-IP
 * init (provider settles before the native scan; stop during pending →
 * ok([]) exactly once, scan never started).
 */

import Zeroconf, { ImplType } from 'react-native-zeroconf';
import type { Service } from 'react-native-zeroconf';

import {
  MDNS_SCAN_TIMEOUT_MS,
  MdnsDiscoveryService,
  mapResolvedService,
} from './mdnsDiscoveryService';
import { applyDiscoveredService } from '../domain/mdnsDiscoveryContract';
import { defaultSettings, type AppSettings } from '../domain/settingsSchema';

/** Mutable Platform.OS seam (web-guard test) — jest-expo is 'ios'. */
let mockPlatformOS = 'ios';

/**
 * Wrap the react-native module in a Proxy so `Platform.OS` reads the
 * mutable seam while every other export stays the untouched actual value
 * (the BLE service test's established pattern — a spread-based mock
 * eagerly evaluates RN internals and crashes jest-expo's setup).
 */
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as Record<
    PropertyKey,
    unknown
  >;
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'Platform') {
        return {
          ...(target.Platform as Record<string, unknown>),
          get OS() {
            return mockPlatformOS;
          },
        };
      }
      return target[prop];
    },
  });
});

/**
 * The default provider must never touch the native module under Jest —
 * the injected fakes make it unreachable anyway; this mock is belt and
 * braces (plan's defensive jest.mock for expo-network).
 */
jest.mock('expo-network', () => ({
  getIpAddressAsync: async () => null,
}));

/** The test-visible surface of the factory-created fake below. */
interface FakeZeroconfLike {
  scanCalls: unknown[][];
  stopCalls: unknown[][];
  stopped: boolean;
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
  removeListener(
    event: string,
    listener: (...args: unknown[]) => unknown,
  ): unknown;
  emit(event: string, ...args: unknown[]): void;
  listenerCountOf(event: string): number;
}

jest.mock('react-native-zeroconf', () => {
  /**
   * Minimal fake of the lib's JS surface the service uses (on /
   * removeListener / emit / scan / stop). Instances are tracked on the
   * static `instances` array so tests can pin lazy construction. The
   * factory also exports `ImplType` (the real module does) — without it
   * the service's `ImplType.DNSSD` import would be `undefined` under
   * this mock.
   */
  class FakeZeroconf {
    static readonly instances: FakeZeroconf[] = [];
    /** When true, the next scan() throws synchronously (native failure). */
    static failScan = false;
    readonly scanCalls: unknown[][] = [];
    readonly stopCalls: unknown[][] = [];
    stopped = false;
    private readonly handlers = new Map<
      string,
      Set<(...args: unknown[]) => unknown>
    >();

    constructor() {
      FakeZeroconf.instances.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => unknown): unknown {
      let set = this.handlers.get(event);
      if (!set) {
        set = new Set();
        this.handlers.set(event, set);
      }
      set.add(listener);
      return this;
    }

    removeListener(
      event: string,
      listener: (...args: unknown[]) => unknown,
    ): unknown {
      this.handlers.get(event)?.delete(listener);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.handlers.get(event) ?? [])]) {
        listener(...args);
      }
    }

    listenerCountOf(event: string): number {
      return this.handlers.get(event)?.size ?? 0;
    }

    scan(...args: unknown[]): void {
      if (FakeZeroconf.failScan) {
        throw new Error('native module gone');
      }
      this.scanCalls.push(args);
    }

    stop(...args: unknown[]): void {
      this.stopCalls.push(args);
      this.stopped = true;
    }
  }
  return {
    __esModule: true,
    default: FakeZeroconf,
    ImplType: { NSD: 'NSD', DNSSD: 'DNSSD' },
  };
});

/** The most recently constructed fake (undefined-checked). */
function latestFake(): FakeZeroconfLike {
  const ctor = Zeroconf as unknown as {
    instances: FakeZeroconfLike[];
  };
  const instance = ctor.instances[ctor.instances.length - 1];
  if (!instance) {
    throw new Error('no zeroconf instance was constructed');
  }
  return instance;
}

/**
 * The scan start is now ASYNC (the phone-IP provider settles before the
 * native scan starts) — tests flush the microtask chain after
 * `startScan` before emitting fake events or advancing timers.
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Default injected provider: resolves `null` (no subnet ranking). */
function makeService(phoneIp: string | null = null): MdnsDiscoveryService {
  return new MdnsDiscoveryService(undefined, async () => phoneIp);
}

/** A contract-conformant resolved-service fixture. */
function resolvedService(overrides: Partial<Service> = {}): Service {
  return {
    name: 'Smart Home Server',
    fullName: 'Smart Home Server._smarthome._tcp.local.',
    addresses: ['192.168.1.23'],
    host: 'smarthomeserver.local.',
    port: 9001,
    txt: {
      prefix: 'smarthome',
      influx_port: '8086',
      influx_org: 'smarthome',
      influx_bucket: 'smarthome',
    },
    ...overrides,
  };
}

/** The default draft (settingsSchema defaults — prefix `smarthome`). */
function draft(): AppSettings {
  return defaultSettings();
}

/** Pull the scan result value off the single onDone call (typed loose). */
function resultOf(onDone: jest.Mock): {
  ok: boolean;
  value?: readonly unknown[];
  error?: { code: string; message?: string };
} {
  return onDone.mock.calls[0]?.[0] as {
    ok: boolean;
    value?: readonly unknown[];
    error?: { code: string; message?: string };
  };
}

function hostOf(onDone: jest.Mock): string | undefined {
  const result = resultOf(onDone);
  return (result.value?.[0] as { host?: string } | undefined)?.host;
}

describe('MdnsDiscoveryService — lazy construction (AD-4)', () => {
  beforeEach(() => {
    mockPlatformOS = 'ios';
    (Zeroconf as unknown as { instances: unknown[] }).instances.length = 0;
  });

  it('constructs the client lazily (none before the first scan settles)', async () => {
    makeService();
    expect(
      (Zeroconf as unknown as { instances: unknown[] }).instances,
    ).toHaveLength(0);
    const session = makeService().startScan(() => undefined);
    await flush();
    expect(
      (Zeroconf as unknown as { instances: unknown[] }).instances,
    ).toHaveLength(1);
    // End the scan so no timer leaks past the test (worker-exit hygiene).
    session.stop();
  });
});

describe('MdnsDiscoveryService — scan lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPlatformOS = 'ios';
    (Zeroconf as unknown as { instances: unknown[] }).instances.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('browses the contract service type via the DNSSD impl (AD-1 + D-2)', async () => {
    makeService().startScan(() => undefined);
    await flush();
    expect(latestFake().scanCalls).toEqual([
      ['smarthome', 'tcp', 'local.', ImplType.DNSSD],
    ]);
    expect(ImplType.DNSSD).toBe('DNSSD');
  });

  it('stop dispatches the SAME DNSSD impl the scan used (factory keys stop to the impl)', async () => {
    const session = makeService().startScan(() => undefined);
    await flush();
    session.stop();
    expect(latestFake().stopCalls).toEqual([[ImplType.DNSSD]]);
  });

  it('maps a resolved advertisement to the typed result and deduplicates it', async () => {
    const onDone = jest.fn();
    makeService().startScan(onDone);
    await flush();
    const fake = latestFake();
    fake.emit('resolved', resolvedService());
    fake.emit('resolved', resolvedService()); // same name|host|port → dedupe

    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([
      {
        name: 'Smart Home Server',
        host: '192.168.1.23',
        port: 9001,
        txt: {
          prefix: 'smarthome',
          influxPort: 8086,
          influxOrg: 'smarthome',
          influxBucket: 'smarthome',
        },
      },
    ]);
  });

  it('USER FIXTURE (AC1, subnet rank path): [fe80::a, 172.17.0.1, 127.0.0.1, 192.168.1.50] with phone 192.168.1.10 → 192.168.1.50', async () => {
    const onDone = jest.fn();
    makeService('192.168.1.10').startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({
        addresses: ['fe80::a', '172.17.0.1', '127.0.0.1', '192.168.1.50'],
      }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(hostOf(onDone)).toBe('192.168.1.50');
  });

  it('USER FIXTURE (AC1, only-survivor path): same list with phone IP null → still 192.168.1.50', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({
        addresses: ['fe80::a', '172.17.0.1', '127.0.0.1', '192.168.1.50'],
      }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(hostOf(onDone)).toBe('192.168.1.50');
  });

  it('AVAHI-SHAPED FIXTURE (AC2): the real server advertisement → 196.169.4.166 fills BOTH mqtt.host and influx.url', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({
        addresses: [
          'fe80::aebc:123:ffff:abcd',
          'fe80::1',
          '172.17.0.1',
          '172.18.0.1',
          '172.19.0.1',
          '172.20.0.1',
          '127.0.0.1',
          '196.169.4.166',
        ],
      }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(hostOf(onDone)).toBe('196.169.4.166');

    // One source of truth: the mapped server feeds applyDiscoveredService.
    const mapped = mapResolvedService(
      resolvedService({
        addresses: [
          'fe80::aebc:123:ffff:abcd',
          'fe80::1',
          '172.17.0.1',
          '172.18.0.1',
          '172.19.0.1',
          '172.20.0.1',
          '127.0.0.1',
          '196.169.4.166',
        ],
      }),
      null,
    );
    if (mapped === null) {
      throw new Error('the avahi fixture must map');
    }
    const patch = applyDiscoveredService(draft(), mapped);
    expect(patch.mqtt.host).toBe('196.169.4.166');
    expect(patch.influx.url).toBe('http://196.169.4.166:8086');
  });

  it('SUBNET TIER (AC3): phone 192.168.1.10 ranks 192.168.1.50 over the earlier 10.0.0.2', async () => {
    const onDone = jest.fn();
    makeService('192.168.1.10').startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['10.0.0.2', '192.168.1.50', 'fe80::a'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(hostOf(onDone)).toBe('192.168.1.50');
  });

  it('SUBNET TIE (AC3): equal rank keeps advertisement order', async () => {
    const onDone = jest.fn();
    makeService('10.0.0.9').startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['10.0.0.2', '10.0.0.3'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(hostOf(onDone)).toBe('10.0.0.2');
  });

  it('SUBNET DEGRADE (AC3): a rejecting provider → null phone IP → advertisement order', async () => {
    const onDone = jest.fn();
    const service = new MdnsDiscoveryService(undefined, async () => {
      throw new Error('provider exploded');
    });
    service.startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['10.0.0.2', '192.168.1.50'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(hostOf(onDone)).toBe('10.0.0.2');
  });

  it('SUBNET DEGRADE (AC3): a garbage (non-IPv4) provider result → advertisement order', async () => {
    const onDone = jest.fn();
    makeService('not-an-ip').startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['10.0.0.2', '192.168.1.50'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(hostOf(onDone)).toBe('10.0.0.2');
  });

  it('ALL-FILTERED (AC4): fe80-only advertisement is SKIPPED → honest ok([])', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['fe80::aebc:123:ffff:abcd'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('ALL-FILTERED (AC4): ::1-only advertisement is SKIPPED → honest ok([])', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit('resolved', resolvedService({ addresses: ['::1'] }));
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('ALL-FILTERED (AC4, inverted legacy): every IPv4 unreachable → SKIPPED, no first-IPv4 keep', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['127.0.0.1', '172.17.0.1'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('ALL-FILTERED (AC4, inverted legacy): hostname-only advertisement is SKIPPED — no hostname fallback', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: [], host: 'smarthomeserver.local.' }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('FILTERS (AC5): a zone-id form (fe80::1%wlan0) is filtered', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['fe80::1%wlan0'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(resultOf(onDone).value).toEqual([]);
  });

  it('FILTERS (AC5): a v4-mapped loopback (::ffff:127.0.0.1) follows the IPv4 filters', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['::ffff:127.0.0.1'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(resultOf(onDone).value).toEqual([]);
  });

  it('GLOBAL IPV6 TIER (AC6): selected ONLY when no IPv4 survives; the Influx URL brackets it while mqtt.host stays bare', async () => {
    const onDone = jest.fn();
    makeService('192.168.1.10').startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({
        addresses: ['fe80::a', '2a00:1450:4001:81b::200e'],
      }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(hostOf(onDone)).toBe('2a00:1450:4001:81b::200e');

    const mapped = mapResolvedService(
      resolvedService({ addresses: ['fe80::a', '2a00:1450:4001:81b::200e'] }),
      '192.168.1.10',
    );
    if (mapped === null) {
      throw new Error('the global-IPv6 fixture must map');
    }
    const patch = applyDiscoveredService(draft(), mapped);
    expect(patch.mqtt.host).toBe('2a00:1450:4001:81b::200e');
    expect(patch.influx.url).toBe('http://[2a00:1450:4001:81b::200e]:8086');
  });

  it('a ULA / non-global IPv6 (fc00::/7) is never selected', async () => {
    const onDone = jest.fn();
    makeService(null).startScan(onDone);
    await flush();
    latestFake().emit(
      'resolved',
      resolvedService({ addresses: ['fd12:3456:789a::1'] }),
    );
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(resultOf(onDone).value).toEqual([]);
  });

  it('skips foreign/useless advertisements (no name, no port)', async () => {
    const onDone = jest.fn();
    makeService().startScan(onDone);
    await flush();
    const fake = latestFake();
    fake.emit('resolved', resolvedService({ name: '  ' }));
    fake.emit('resolved', resolvedService({ port: 0 }));
    fake.emit('resolved', resolvedService({ port: 99999 }));

    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(resultOf(onDone).value).toEqual([]);
  });

  it('the 10 s timeout is the honest EMPTY result (ok([]), not an error) (AD-5)', async () => {
    const onDone = jest.fn();
    makeService().startScan(onDone);
    await flush();
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('honors a custom (shorter) scan window — the window starts at native scan start', async () => {
    const onDone = jest.fn();
    makeService().startScan(onDone, 50);
    await flush();
    jest.advanceTimersByTime(49);
    expect(onDone).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the DEFAULT provider (expo-network mocked to null) still starts the scan', async () => {
    const onDone = jest.fn();
    // eslint-disable-next-line no-new
    new MdnsDiscoveryService().startScan(onDone);
    await flush();
    expect(latestFake().scanCalls).toHaveLength(1);
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(resultOf(onDone).ok).toBe(true);
  });
});

describe('MdnsDiscoveryService — cleanup on every exit path', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPlatformOS = 'ios';
    (Zeroconf as unknown as { instances: unknown[] }).instances.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('timeout: stops the native browse, detaches the handlers, fires once', async () => {
    const onDone = jest.fn();
    makeService().startScan(onDone);
    await flush();
    const fake = latestFake();
    expect(fake.listenerCountOf('resolved')).toBe(1);
    expect(fake.listenerCountOf('error')).toBe(1);

    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(fake.stopped).toBe(true);
    expect(fake.listenerCountOf('resolved')).toBe(0);
    expect(fake.listenerCountOf('error')).toBe(0);

    // Late events after the finish are inert (detached + finished flag).
    fake.emit('resolved', resolvedService());
    fake.emit('error', new Error('late'));
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS * 2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('user stop: fires once with the results found so far and cleans up', async () => {
    const onDone = jest.fn();
    const session = makeService().startScan(onDone);
    await flush();
    const fake = latestFake();
    fake.emit('resolved', resolvedService());

    session.stop();
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(1);
    expect(fake.stopped).toBe(true);
    expect(fake.listenerCountOf('resolved')).toBe(0);
    expect(fake.listenerCountOf('error')).toBe(0);

    // Idempotent + inert afterwards.
    session.stop();
    jest.advanceTimersByTime(MDNS_SCAN_TIMEOUT_MS);
    fake.emit('resolved', resolvedService());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ASYNC INIT (AC7): stop() while the provider is pending → onDone EXACTLY ONCE with ok([]), native scan NEVER started', async () => {
    const onDone = jest.fn();
    const session = makeService().startScan(onDone);

    // Flush-free stop: the provider promise is still pending.
    session.stop();
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);

    await flush();
    // The provider settled AFTER the finish — no handlers, no native scan.
    expect(latestFake().scanCalls).toEqual([]);
    expect(latestFake().listenerCountOf('resolved')).toBe(0);
    expect(latestFake().listenerCountOf('error')).toBe(0);

    // Idempotent + inert afterwards.
    session.stop();
    latestFake().emit('resolved', resolvedService());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('lib error event: fires a typed error Result once and cleans up', async () => {
    const onDone = jest.fn();
    makeService().startScan(onDone);
    await flush();
    const fake = latestFake();

    fake.emit('error', new Error('NSD failure'));
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unavailable');
    expect(result.error?.message).toBe('NSD failure');
    expect(fake.stopped).toBe(true);
    expect(fake.listenerCountOf('resolved')).toBe(0);
    expect(fake.listenerCountOf('error')).toBe(0);
  });

  it('a synchronous scan-start failure is a typed error with full cleanup', async () => {
    const onDone = jest.fn();
    const ctor = Zeroconf as unknown as { failScan: boolean };
    ctor.failScan = true;
    try {
      makeService().startScan(onDone);
      await flush();
    } finally {
      ctor.failScan = false;
    }
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unavailable');
    // Cleanup ran even though the scan never started.
    const fake = latestFake();
    expect(fake.stopped).toBe(true);
    expect(fake.listenerCountOf('resolved')).toBe(0);
    expect(fake.listenerCountOf('error')).toBe(0);
  });
});

describe('MdnsDiscoveryService — web guard (AD-4)', () => {
  beforeEach(() => {
    (Zeroconf as unknown as { instances: unknown[] }).instances.length = 0;
  });

  it('on web: typed TRANSPORT error, no error thrown to the caller, lib NEVER constructed, provider NEVER invoked', async () => {
    mockPlatformOS = 'web';
    const provider = jest.fn(async () => '192.168.1.10');
    const onDone = jest.fn();
    new MdnsDiscoveryService(undefined, provider).startScan(onDone);

    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('transport');
    expect(result.error?.message).toBe(
      'mDNS discovery is not available on web',
    );
    expect(provider).not.toHaveBeenCalled();
    expect(
      (Zeroconf as unknown as { instances: unknown[] }).instances,
    ).toHaveLength(0);
  });
});
