/**
 * mdnsDiscoveryContract tests — the pure mDNS mapping (plan required
 * tests): service-type constants; tolerant TXT parse (full records,
 * missing records, garbage port, garbage prefix, empty TXT); the
 * applyDiscoveredService mapping (full → correct fields, missing
 * prefix/org/bucket → keep-current, secrets never in the output); the
 * Influx URL build with the 8086 default.
 */

import {
  DEFAULT_INFLUX_PORT,
  MDNS_SERVICE_DOMAIN,
  MDNS_SERVICE_PROTOCOL,
  MDNS_SERVICE_TYPE,
  MDNS_SERVICE_TYPE_FULL,
  MDNS_TXT_KEYS,
  applyDiscoveredService,
  parseMdnsTxt,
  type DiscoveredServer,
} from './mdnsDiscoveryContract';
import { defaultSettings, type AppSettings } from './settingsSchema';

/** A full, contract-conformant advertisement fixture. */
function server(overrides: Partial<DiscoveredServer> = {}): DiscoveredServer {
  return {
    name: 'Smart Home Server',
    host: '192.168.1.10',
    port: 9001,
    txt: {
      prefix: 'smarthome',
      influxPort: 8086,
      influxOrg: 'smarthome',
      influxBucket: 'smarthome',
    },
    ...overrides,
  };
}

/** The default draft (settingsSchema defaults — prefix `smarthome`). */
function draft(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...defaultSettings(),
    ...overrides,
  };
}

describe('mDNS contract constants', () => {
  it('pins the single advertised service type (AD-1 — README/iOS parity)', () => {
    expect(MDNS_SERVICE_TYPE).toBe('smarthome');
    expect(MDNS_SERVICE_PROTOCOL).toBe('tcp');
    expect(MDNS_SERVICE_DOMAIN).toBe('local.');
    expect(MDNS_SERVICE_TYPE_FULL).toBe('_smarthome._tcp');
    expect(MDNS_TXT_KEYS.influxPort).toBe('influx_port');
    expect(DEFAULT_INFLUX_PORT).toBe(8086);
  });
});

describe('parseMdnsTxt — tolerant of garbage', () => {
  it('parses a complete TXT set', () => {
    expect(
      parseMdnsTxt({
        prefix: 'smarthome',
        influx_port: '8086',
        influx_org: 'smarthome',
        influx_bucket: 'smarthome',
      }),
    ).toEqual({
      prefix: 'smarthome',
      influxPort: 8086,
      influxOrg: 'smarthome',
      influxBucket: 'smarthome',
    });
  });

  it('returns all-absent for missing records (minimal advertisement)', () => {
    expect(parseMdnsTxt({})).toEqual({});
  });

  it('returns all-absent for empty/undefined/non-object TXT', () => {
    expect(parseMdnsTxt(undefined)).toEqual({});
    expect(parseMdnsTxt(null)).toEqual({});
  });

  it('trims values and drops empty/whitespace-only ones', () => {
    expect(
      parseMdnsTxt({
        prefix: '  home  ',
        influx_org: '   ',
        influx_bucket: '',
      }),
    ).toEqual({ prefix: 'home' });
  });

  it('drops a garbage port (not a number, out of range, float, zero)', () => {
    expect(parseMdnsTxt({ influx_port: 'abc' })).toEqual({});
    expect(parseMdnsTxt({ influx_port: '99999' })).toEqual({});
    expect(parseMdnsTxt({ influx_port: '80.5' })).toEqual({});
    expect(parseMdnsTxt({ influx_port: '0' })).toEqual({});
    expect(parseMdnsTxt({ influx_port: '' })).toEqual({});
  });

  it('accepts a numeric TXT port value (tolerant of non-string advertisers)', () => {
    expect(parseMdnsTxt({ influx_port: 8086 })).toEqual({ influxPort: 8086 });
  });

  it('drops a garbage prefix (spaces, non-ASCII) but keeps schema-valid ones', () => {
    expect(parseMdnsTxt({ prefix: 'my home' })).toEqual({});
    expect(parseMdnsTxt({ prefix: 'nhà' })).toEqual({});
    // The schema's own alphabet: letters, digits, _ / -
    expect(parseMdnsTxt({ prefix: 'smarthome/2nd-floor' })).toEqual({
      prefix: 'smarthome/2nd-floor',
    });
  });
});

describe('applyDiscoveredService — fill mapping (non-secret only)', () => {
  it('fills mqtt host/port/prefix + influx url/org/bucket from a full advertisement', () => {
    const patch = applyDiscoveredService(draft(), server());
    expect(patch).toEqual({
      mqtt: { host: '192.168.1.10', port: 9001, prefix: 'smarthome' },
      influx: {
        url: 'http://192.168.1.10:8086',
        org: 'smarthome',
        bucket: 'smarthome',
      },
    });
  });

  it('defaults the Influx port to 8086 when the TXT record is missing', () => {
    const patch = applyDiscoveredService(draft(), server({ txt: {} }));
    expect(patch.influx.url).toBe('http://192.168.1.10:8086');
  });

  it('uses the advertised influx_port for the URL when present', () => {
    const patch = applyDiscoveredService(
      draft(),
      server({ txt: { influxPort: 8087 } }),
    );
    expect(patch.influx.url).toBe('http://192.168.1.10:8087');
  });

  it('brackets an IPv6 discovered host in the Influx URL while MQTT host stays bare (influx-ipv6-url-normalization)', () => {
    const patch = applyDiscoveredService(
      draft(),
      server({ host: 'fe80::9b78:6845:8077:4ce2:9001' }),
    );
    expect(patch.influx.url).toBe(
      'http://[fe80::9b78:6845:8077:4ce2:9001]:8086',
    );
    // The MQTT host is passed through ORIGINAL (unbracketed).
    expect(patch.mqtt.host).toBe('fe80::9b78:6845:8077:4ce2:9001');
  });

  it('keeps the draft prefix/org/bucket when the TXT records are missing (AD-3)', () => {
    const base = draft();
    base.mqtt.prefix = 'home-custom';
    base.influx.org = 'my-org';
    base.influx.bucket = 'my-bucket';
    const patch = applyDiscoveredService(base, server({ txt: {} }));
    expect(patch.mqtt.prefix).toBe('home-custom');
    expect(patch.influx.org).toBe('my-org');
    expect(patch.influx.bucket).toBe('my-bucket');
  });

  it('NEVER carries the secret fields (mqtt.username/password, influx.token) — structural pin (AD-2)', () => {
    const base = draft();
    base.mqtt.username = 'admin';
    base.mqtt.password = 'super-secret';
    base.influx.token = 'super-token';
    const patch = applyDiscoveredService(base, server());
    expect(Object.keys(patch.mqtt).sort()).toEqual(['host', 'port', 'prefix']);
    expect(Object.keys(patch.influx).sort()).toEqual(['bucket', 'org', 'url']);
    expect(JSON.stringify(patch)).not.toContain('super-secret');
    expect(JSON.stringify(patch)).not.toContain('super-token');
    expect(JSON.stringify(patch)).not.toContain('admin');
  });
});
