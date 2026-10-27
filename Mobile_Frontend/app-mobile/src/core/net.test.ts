/**
 * normalizeBrokerHost tests (mqtt-invalid-url-host-normalization).
 *
 * Pins the pure host-normalization contract applied at BOTH MQTT
 * connection boundaries (telemetry `MqttJsClient.openClient` and the
 * settings `MqttProbeService.probe`):
 * - scheme / userinfo / path+query+fragment are stripped;
 * - a trailing `:port` is stripped (the settings port field stays the
 *   connection authority) EXCEPT for bare IPv6 literals, whose `:<digits>`
 *   suffix is part of the address;
 * - bare IPv6 literals are bracket-wrapped; already-bracketed ones are
 *   preserved (a trailing `:port` AFTER the `]` is still stripped);
 * - nothing usable (`ws://` alone, whitespace) → `''`.
 */

import {
  formatHostForUrl,
  normalizeBrokerHost,
  normalizeInfluxBaseUrl,
} from './net';

describe('formatHostForUrl (influx-ipv6-url-normalization)', () => {
  it.each([
    // IPv4 / hostname unchanged.
    ['192.168.1.10', '192.168.1.10'],
    ['broker.local', 'broker.local'],
    // Bare IPv6 bracket-wrapped — never eats the final hextet as a port.
    ['fe80::1', '[fe80::1]'],
    ['fe80::9b78:6845:8077:4ce2:9001', '[fe80::9b78:6845:8077:4ce2:9001]'],
    // Already bracketed preserved verbatim.
    ['[fe80::1]', '[fe80::1]'],
    ['[2001:db8::1]', '[2001:db8::1]'],
    // Empty.
    ['', ''],
    ['   ', ''],
  ])('%s → %s', (raw, expected) => {
    expect(formatHostForUrl(raw)).toBe(expected);
  });
});

describe('normalizeInfluxBaseUrl (influx-ipv6-url-normalization)', () => {
  it.each([
    // Valid IPv4 URL unchanged.
    ['http://192.168.1.10:8086', 'http://192.168.1.10:8086'],
    // Hostname unchanged.
    ['http://server.local:8086', 'http://server.local:8086'],
    // Bare IPv6 with terminal port → bracketed host, port separated.
    ['http://fe80::1:8086', 'http://[fe80::1]:8086'],
    [
      'http://fe80::9b78:6845:8077:4ce2:9001:8086',
      'http://[fe80::9b78:6845:8077:4ce2:9001]:8086',
    ],
    // A bare IPv6 whose final hextet is decimal is NOT corrupted into a
    // port (the remainder would no longer be a multi-colon IPv6).
    ['http://fe80::1', 'http://[fe80::1]'],
    // Already bracketed IPv6 unchanged (byte-for-byte apart from trim).
    ['http://[fe80::1]:8086', 'http://[fe80::1]:8086'],
    // https preserved.
    ['https://fe80::1:8086', 'https://[fe80::1]:8086'],
    ['https://server.local:8086', 'https://server.local:8086'],
    // Path/query/fragment preserved.
    [
      'http://192.168.1.10:8086/prefix?x=1#frag',
      'http://192.168.1.10:8086/prefix?x=1#frag',
    ],
    ['http://fe80::1:8086/sub/path?q=2', 'http://[fe80::1]:8086/sub/path?q=2'],
    ['http://[fe80::1]:8086/x#y', 'http://[fe80::1]:8086/x#y'],
    // Whitespace trimmed.
    ['  http://192.168.1.10:8086  ', 'http://192.168.1.10:8086'],
    // Non-http garbage returned unchanged (trimmed) — Zod/fetch stay the
    // honest validity authorities.
    ['ftp://example.com', 'ftp://example.com'],
    ['not a url at all', 'not a url at all'],
    ['http://', 'http://'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeInfluxBaseUrl(raw)).toBe(expected);
  });
});

describe('normalizeBrokerHost', () => {
  it.each([
    // Passthrough: plain IPv4 / hostname.
    ['192.168.100.3', '192.168.100.3'],
    ['broker.local', 'broker.local'],
    ['MY-BROKER.example.com', 'MY-BROKER.example.com'],
    // Scheme strip.
    ['ws://192.168.100.3', '192.168.100.3'],
    ['wss://broker.local', 'broker.local'],
    ['http://10.0.0.2', '10.0.0.2'],
    ['mqtt://broker.local', 'broker.local'],
    ['tcp://broker.local', 'broker.local'],
    // Userinfo strip (up to the LAST @).
    ['user:pass@10.0.0.2', '10.0.0.2'],
    ['user:pass@10.0.0.2:1883', '10.0.0.2'],
    // Path / query / fragment cut.
    ['broker.local/path', 'broker.local'],
    ['broker.local/path?query=1', 'broker.local'],
    ['broker.local#frag', 'broker.local'],
    ['broker.local/path?query#frag', 'broker.local'],
    // Trailing port strip (single colon, all-digit suffix).
    ['host:9001', 'host'],
    ['192.168.100.3:9001', '192.168.100.3'],
    ['ws://192.168.100.3:9001', '192.168.100.3'],
    // Bare IPv6 literal: the `:<digits>` suffix is part of the address —
    // do NOT eat it; wrap in brackets instead.
    ['fe80::1', '[fe80::1]'],
    ['fe80::1%wlan0', '[fe80::1%wlan0]'],
    ['ws://fe80::1', '[fe80::1]'],
    // Already-bracketed IPv6: kept verbatim; trailing `:port` AFTER `]`
    // is stripped.
    ['[fe80::1]', '[fe80::1]'],
    ['[fe80::1]:9001', '[fe80::1]'],
    ['ws://[fe80::1]:9001', '[fe80::1]'],
    // Nothing usable remains.
    ['ws://', ''],
    ['   ', ''],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeBrokerHost(raw)).toBe(expected);
  });
});
