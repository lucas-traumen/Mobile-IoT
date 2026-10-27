/**
 * mDNS discovery service (settings-mdns-discovery) — the ONLY place that
 * touches `react-native-zeroconf`; AdvancedSettingsScreen consumes the
 * {@link MdnsDiscoveryServiceLike} seam and never imports the lib.
 *
 * Scan lifecycle (AD-1/AD-5): one `_smarthome._tcp` browse for up to
 * {@link MDNS_SCAN_TIMEOUT_MS} (10 s). Before the native scan starts, the
 * injected phone-IP provider settles (the phone's Wi-Fi IPv4, or `null`)
 * so every `resolved` event maps against a SETTLED phone IP. Resolved
 * advertisements are mapped to typed {@link DiscoveredServer}s (TXT
 * through the contract's tolerant parser, host chosen by the address-
 * selection contract in {@link pickHost}) and deduplicated by
 * name|host|port. The
 * 10 s timeout is the HONEST end: `ok([])` — an empty result, never an
 * error (the server may simply not be advertising yet, R4). A lib error
 * event or a failed scan start resolves a typed
 * {@link MdnsDiscoveryError} Result instead. Cleanup — detach the scan
 * handlers, native stop, timer clear — runs on EVERY exit path: timeout,
 * error, and user stop (user stop keeps the results found so far). A
 * `stop()` landing while the provider is still pending finishes the scan
 * with `ok([])` exactly once and the native scan never starts.
 *
 * Web safety (AD-4, the BLE `bleManager()` pattern): module-scope
 * evaluation of `react-native-zeroconf` only reads
 * `NativeModules.RNZeroconf` (→ `undefined` on web, no crash). The
 * Zeroconf INSTANCE is constructed lazily inside
 * {@link MdnsDiscoveryService.zeroconf}, and on web that getter throws a
 * typed TRANSPORT error before any construction. The screen additionally
 * hides the whole flow behind a `Platform.OS !== 'web'` gate, so the
 * service is never even called on web.
 *
 * Listener lifecycle note: the lib's constructor subscribes its
 * DeviceEventEmitter plumbing ONCE for the client's lifetime; re-adding
 * them (`addDeviceListeners`) while present makes the lib emit — and the
 * `events` EventEmitter THROW on — an unhandled `'error'`. So each scan
 * only attaches/detaches its own `resolved`/`error` handlers and calls
 * `stop()`; the constructor-owned subscription set is reused for every
 * scan of the singleton client.
 */

import { Platform } from 'react-native';
import Zeroconf, { ImplType, type Service } from 'react-native-zeroconf';

import { getIpAddressAsync } from 'expo-network';

import { err, ok, type Result } from '@core/errors';
import { createLogger, type Logger } from '@core/logger';

import {
  MDNS_SERVICE_DOMAIN,
  MDNS_SERVICE_PROTOCOL,
  MDNS_SERVICE_TYPE,
  parseMdnsTxt,
  type DiscoveredServer,
} from '../domain/mdnsDiscoveryContract';

/** The honest scan window (AD-5): 10 seconds. */
export const MDNS_SCAN_TIMEOUT_MS = 10_000;

/**
 * Why a scan failed — never `'timeout'`: the timeout is the honest EMPTY
 * result (`ok([])`), not an error.
 */
export type MdnsDiscoveryErrorCode = 'transport' | 'unavailable';

/** Typed discovery error (`transport` = web guard; `unavailable` = stack). */
export class MdnsDiscoveryError extends Error {
  constructor(readonly code: MdnsDiscoveryErrorCode, message: string) {
    super(message);
    this.name = 'MdnsDiscoveryError';
  }
}

/** Scan outcome: `ok(servers)` — possibly EMPTY — or `err(typed)`. */
export type MdnsScanResult = Result<
  readonly DiscoveredServer[],
  MdnsDiscoveryError
>;

/** A live scan; `stop()` ends it early (idempotent) with the partials. */
export interface MdnsScanSession {
  stop(): void;
}

/**
 * The screen-facing seam (AD-4): exactly the surface
 * AdvancedSettingsScreen consumes. `onDone` fires EXACTLY ONCE per scan.
 */
export interface MdnsDiscoveryServiceLike {
  /**
   * Browse `_smarthome._tcp` for up to `timeoutMs`.
   *
   * @param onDone - called exactly once: `ok(servers)` (empty = honest
   *   nothing-found timeout) or `err(typed)`.
   * @param timeoutMs - scan window (default 10 s).
   * @returns the session; `stop()` ends the scan early with the results
   *   found so far (safe to call from unmount cleanup).
   */
  startScan(
    onDone: (result: MdnsScanResult) => void,
    timeoutMs?: number,
  ): MdnsScanSession;
}

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

/** True when the string is a plausible dotted-quad IPv4 address. */
function isIpv4(host: string): boolean {
  if (!IPV4_PATTERN.test(host)) {
    return false;
  }
  return host.split('.').every(part => {
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

/**
 * Ranges a LAN phone client cannot reach even though the server
 * advertises them on its own interfaces: loopback (127/8), link-local
 * (169.254/16), the Docker bridge block (172.16/12) and the Tailscale
 * CGNAT block (100.64/10). Avahi emits those BEFORE the Wi-Fi LAN
 * address, so picking an unfiltered address could select an unreachable
 * host and make discovery appear broken (runtime evidence:
 * 127.0.0.1 + 172.17-19.0.1 advertised before 192.168.100.3).
 */
function isUnreachableFromLan(ip: string): boolean {
  const [first = -1, second = -1] = ip.split('.').map(part => Number(part));
  return (
    first === 127 || // loopback
    (first === 169 && second === 254) || // link-local
    (first === 172 && second >= 16 && second <= 31) || // Docker bridge
    (first === 100 && second >= 64 && second <= 127) // Tailscale CGNAT
  );
}

/** Strip a trailing zone-id (`fe80::1%wlan0` → `fe80::1`) — tolerant. */
function stripZoneId(address: string): string {
  const percent = address.indexOf('%');
  return percent === -1 ? address : address.slice(0, percent);
}

/**
 * Unwrap a v4-mapped IPv6 literal (`::ffff:127.0.0.1` → `127.0.0.1`) so
 * it follows the IPv4 filters instead of falling through to the IPv6
 * classification.
 */
function unwrapV4Mapped(address: string): string {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return match?.[1] ?? address;
}

/** First hextet of a textual IPv6 address (NaN when malformed). */
function firstHextet(address: string): number {
  const match = /^[0-9a-fA-F]{1,4}/.exec(address);
  return match === null ? Number.NaN : parseInt(match[0], 16);
}

/** IPv6 link-local `fe80::/10` (first hextet 0xfe80–0xfebf). */
function isIpv6LinkLocal(address: string): boolean {
  const hextet = firstHextet(address);
  return hextet >= 0xfe80 && hextet <= 0xfebf;
}

/** IPv6 loopback `::1`. */
function isIpv6Loopback(address: string): boolean {
  return address === '::1';
}

/** IPv6 global-unicast `2000::/3` (first hextet 0x2000–0x3fff). */
function isIpv6GlobalUnicast(address: string): boolean {
  const hextet = firstHextet(address);
  return hextet >= 0x2000 && hextet <= 0x3fff;
}

/**
 * Shared LEADING octets between two dotted-quad IPv4 addresses (0–4).
 * Android/JS exposes no subnet mask, so "same subnet" is this octet-
 * prefix heuristic, not a true mask compare (disclosed in the README).
 */
function sharedLeadingOctets(a: string, b: string): number {
  const aParts = a.split('.');
  const bParts = b.split('.');
  let score = 0;
  while (score < 4 && aParts[score] === bParts[score]) {
    score += 1;
  }
  return score;
}

/**
 * Pick the MQTT host from a resolved advertisement. FILTER (never
 * selected): IPv6 link-local `fe80::/10`, IPv6 loopback `::1`, IPv4
 * loopback 127/8, IPv4 link-local 169.254/16, Docker 172.16/12, Tailscale
 * CGNAT 100.64/10; a trailing zone-id is stripped BEFORE classification
 * and a v4-mapped `::ffff:a.b.c.d` unwraps to its IPv4. PRIORITY:
 * (1) among the surviving IPv4s, the one sharing the most LEADING octets
 * with the phone's own IPv4 (0–4; ties keep advertisement order — the
 * explicit `{ip, index, score}` sort never relies on engine sort
 * stability); (2) any other surviving IPv4 (rank 0, same pass);
 * (3) the first surviving IPv6 global-unicast (`2000::/3`).
 * There is NO hostname fallback: on Android NSD the lib's `host` field is
 * the reverse-DNS of the ONE OS-chosen address (i.e. the fe80:: literal
 * itself — the leak path that motivated this contract) and on DNSSD it is
 * the service NAME; `.local` names are not resolvable by RN sockets
 * anyway. `null` = no usable address → the advertisement is SKIPPED.
 */
function pickHost(service: Service, phoneIp: string | null): string | null {
  const rawAddresses = Array.isArray(service.addresses)
    ? service.addresses
    : [];
  const candidates: { ip: string; index: number; ipv4: boolean }[] = [];
  rawAddresses.forEach((raw, index) => {
    if (typeof raw !== 'string') {
      return;
    }
    const address = unwrapV4Mapped(stripZoneId(raw.trim()));
    if (isIpv4(address)) {
      if (!isUnreachableFromLan(address)) {
        candidates.push({ ip: address, index, ipv4: true });
      }
      return;
    }
    if (isIpv6Loopback(address) || isIpv6LinkLocal(address)) {
      return;
    }
    if (isIpv6GlobalUnicast(address)) {
      candidates.push({ ip: address.toLowerCase(), index, ipv4: false });
    }
  });

  const ipv4s = candidates.filter(candidate => candidate.ipv4);
  if (ipv4s.length > 0) {
    const phone = phoneIp !== null && isIpv4(phoneIp) ? phoneIp : null;
    return (
      ipv4s
        .map(candidate => ({
          ...candidate,
          score: phone === null ? 0 : sharedLeadingOctets(candidate.ip, phone),
        }))
        // score DESC, index ASC — no reliance on engine sort stability.
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(candidate => candidate.ip)[0] ?? null
    );
  }
  const globalIpv6 = candidates.find(candidate => !candidate.ipv4);
  return globalIpv6 === undefined ? null : globalIpv6.ip;
}

/**
 * The injected phone-IP seam: resolves the phone's own IPv4 (or `null`)
 * before a scan starts so the subnet-priority tier can rank candidates.
 */
export type PhoneIpProvider = () => Promise<string | null>;

/**
 * The DEFAULT provider: on web it resolves `null` without touching the
 * native module (the service's web transport guard fires before the
 * provider anyway); otherwise it reads the phone's Wi-Fi IPv4 from
 * `expo-network` and SANITIZES it with the `isIpv4` check — cellular
 * oddities, IPv6 or garbage all degrade to `null` (the subnet tier then
 * degrades to advertisement order). It NEVER rejects.
 */
async function defaultPhoneIpProvider(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const ip = await getIpAddressAsync();
    return typeof ip === 'string' && isIpv4(ip) ? ip : null;
  } catch {
    return null;
  }
}

/**
 * Map a lib resolved service to the typed result (plan: "map resolved
 * service (name/host/port/TXT) → typed result"). Returns `null` for
 * foreign/useless advertisements: no name, no valid port (the port IS
 * the MQTT WebSocket port) or no address that survives
 * {@link pickHost}'s filter (such advertisements are SKIPPED — the scan
 * ends honestly empty, never a typed error).
 */
export function mapResolvedService(
  service: Service,
  phoneIp: string | null = null,
): DiscoveredServer | null {
  const name = typeof service.name === 'string' ? service.name.trim() : '';
  if (name.length === 0) {
    return null;
  }
  const port =
    typeof service.port === 'number' &&
    Number.isInteger(service.port) &&
    service.port >= 1 &&
    service.port <= 65535
      ? service.port
      : null;
  if (port === null) {
    return null;
  }
  const host = pickHost(service, phoneIp);
  if (host === null) {
    return null;
  }
  return { name, host, port, txt: parseMdnsTxt(service.txt) };
}

/**
 * The real service. One instance is enough (`getMdnsDiscoveryService`
 * singleton) — the Zeroconf client is created lazily on first use and
 * reused.
 */
export class MdnsDiscoveryService implements MdnsDiscoveryServiceLike {
  private client: Zeroconf | null = null;
  private readonly logger: Logger;
  private readonly phoneIpProvider: PhoneIpProvider;

  constructor(
    logger: Logger = createLogger('MdnsDiscovery'),
    phoneIpProvider: PhoneIpProvider = defaultPhoneIpProvider,
  ) {
    this.logger = logger;
    this.phoneIpProvider = phoneIpProvider;
  }

  /**
   * Lazy Zeroconf access — the web guard (AD-4): constructing Zeroconf
   * subscribes the native event plumbing, so it happens only when a scan
   * is actually requested, and on web it never happens (a typed
   * TRANSPORT error is thrown instead of constructing the native client).
   */
  private zeroconf(): Zeroconf {
    if (Platform.OS === 'web') {
      throw new MdnsDiscoveryError(
        'transport',
        'mDNS discovery is not available on web',
      );
    }
    if (this.client === null) {
      this.client = new Zeroconf();
    }
    return this.client;
  }

  startScan(
    onDone: (result: MdnsScanResult) => void,
    timeoutMs: number = MDNS_SCAN_TIMEOUT_MS,
  ): MdnsScanSession {
    let client: Zeroconf;
    try {
      client = this.zeroconf();
    } catch (error: unknown) {
      onDone(
        err(
          error instanceof MdnsDiscoveryError
            ? error
            : new MdnsDiscoveryError(
                'transport',
                'mDNS discovery failed to start',
              ),
        ),
      );
      return { stop: () => undefined };
    }

    const found = new Map<string, DiscoveredServer>();
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Settled by the provider BEFORE the handlers attach — every
    // `resolved` event maps against this settled value.
    let phoneIp: string | null = null;

    const onResolved = (service: Service) => {
      if (finished) {
        return;
      }
      const mapped = mapResolvedService(service, phoneIp);
      if (mapped !== null) {
        found.set(`${mapped.name}|${mapped.host}|${mapped.port}`, mapped);
      }
    };

    const onError = (error: Error) => {
      finish(
        err(
          new MdnsDiscoveryError(
            'unavailable',
            error.message || 'mDNS scan error',
          ),
        ),
      );
    };

    // Cleanup on EVERY exit path (timeout / error / user stop): clear the
    // timer, detach this scan's handlers, stop the native browse — then
    // report exactly once. `client.stop()` dispatches the SAME impl
    // string the scan used (the lib's factory keys the stop to it).
    const finish = (result: MdnsScanResult) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      client.removeListener('resolved', onResolved);
      client.removeListener('error', onError);
      try {
        client.stop(ImplType.DNSSD);
      } catch (stopError: unknown) {
        // Stopping an already-stopped/dead scan is a harmless no-op —
        // never mask the scan result with a cleanup failure.
        this.logger.warn('mDNS scan stop failed', stopError);
      }
      onDone(result);
    };

    // Attach handlers + start the native scan. Called AFTER the phone-IP
    // provider settles; a `finished` guard makes a stop() landing during
    // the pending provider a no-op here (the scan never starts).
    const beginScan = (settledPhoneIp: string | null) => {
      if (finished) {
        return;
      }
      phoneIp = settledPhoneIp;
      client.on('resolved', onResolved);
      client.on('error', onError);
      timer = setTimeout(() => {
        // Honest timeout (AD-5): the empty result is a successful scan
        // that found nothing — NOT an error.
        finish(ok([...found.values()]));
      }, timeoutMs);
      try {
        // DNSSD impl (Android): the embedded resolver delivers the FULL
        // advertised A/AAAA list — the NSD default emits exactly ONE
        // OS-chosen address, which is the fe80:: leak path. iOS ignores
        // the impl argument.
        client.scan(
          MDNS_SERVICE_TYPE,
          MDNS_SERVICE_PROTOCOL,
          MDNS_SERVICE_DOMAIN,
          ImplType.DNSSD,
        );
      } catch (scanError: unknown) {
        this.logger.warn('mDNS scan failed to start', scanError);
        finish(
          err(
            new MdnsDiscoveryError(
              'unavailable',
              'mDNS scan could not start on this device',
            ),
          ),
        );
      }
    };

    // Async init: the provider settles ONCE per scan BEFORE the handlers
    // attach and the native scan starts. A rejecting provider degrades to
    // `null` (the subnet tier then ranks everything 0 — advertisement
    // order); the default provider never rejects.
    void Promise.resolve()
      .then(() => this.phoneIpProvider())
      .then(settled => beginScan(typeof settled === 'string' ? settled : null))
      .catch(() => {
        this.logger.warn('mDNS phone-IP provider failed; ranking degraded');
        beginScan(null);
      });

    return {
      stop: () => {
        // User stop (e.g. the screen unmounted mid-scan): the results
        // found so far are still valid discoveries.
        finish(ok([...found.values()]));
      },
    };
  }
}

/** Lazily-created default instance (constructed on first use). */
let defaultService: MdnsDiscoveryService | null = null;

/**
 * The default real service (singleton). The screen resolves this when no
 * service was injected — tests always inject a fake, so the zeroconf lib
 * is never constructed under Jest (BoardsScreen BLE precedent).
 */
export function getMdnsDiscoveryService(): MdnsDiscoveryService {
  if (defaultService === null) {
    defaultService = new MdnsDiscoveryService();
  }
  return defaultService;
}
