/**
 * secretsQrContract tests (settings-secrets-qr) — the pure credentials-QR
 * parse authority: full/partial fills, empty-field keep-current semantics,
 * and every honest rejection (garbage JSON, unknown kind, wrong
 * schemaVersion, QR with no values). The QR is the server's printed
 * KEY — the parser never trims secret values (verbatim) and never throws.
 */

import { parseCredentialsQr } from './secretsQrContract';

/** A full credentials QR payload (the README contract example shape). */
const FULL_QR = JSON.stringify({
  schemaVersion: 1,
  kind: 'credentials',
  mqttUsername: 'homeuser',
  mqttPassword: 's3cret-pass',
  influxToken: 'influx-token-abc',
});

describe('parseCredentialsQr — accepted payloads', () => {
  it('parses a full credentials QR into all three fields', () => {
    const result = parseCredentialsQr(FULL_QR);
    expect(result).toEqual({
      ok: true,
      credentials: {
        mqttUsername: 'homeuser',
        mqttPassword: 's3cret-pass',
        influxToken: 'influx-token-abc',
      },
    });
  });

  it('parses a single-field QR: only the carried field is in the patch', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttPassword: 'only-pass',
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: { mqttPassword: 'only-pass' },
    });
  });

  it('keeps secret values VERBATIM (never trimmed — a space can be part of a secret)', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttPassword: ' padded secret ',
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: { mqttPassword: ' padded secret ' },
    });
  });

  it('treats an EMPTY field as keep-current (dropped from the patch, not an error)', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttUsername: '',
        mqttPassword: 'kept-pass',
        influxToken: '',
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: { mqttPassword: 'kept-pass' },
    });
  });

  it('tolerates unknown extra fields (server tooling may enrich; zod strips)', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttPassword: 'p',
        futureField: { nested: true },
      }),
    );
    expect(result).toEqual({ ok: true, credentials: { mqttPassword: 'p' } });
  });
});

describe('parseCredentialsQr — optional non-secret fields (credentials-qr-nonsecret-fields / M27b)', () => {
  /**
   * The M27a backend shape: the three secrets PLUS the six optional
   * non-secret fields (present only when non-empty on the server side).
   * `mqttPort` is emitted as a NUMBER.
   */
  const FULL_11_FIELD_QR = JSON.stringify({
    schemaVersion: 1,
    kind: 'credentials',
    mqttUsername: 'homeuser',
    mqttPassword: 's3cret-pass',
    influxToken: 'influx-token-abc',
    mqttHost: '192.168.3.105',
    mqttPort: 9001,
    mqttPrefix: 'smarthome',
    influxUrl: 'http://192.168.3.105:8086',
    influxOrg: 'smarthome',
    influxBucket: 'telemetry',
  });

  it('parses the full 11-field QR into the whole patch (mqttPort stays a NUMBER)', () => {
    const result = parseCredentialsQr(FULL_11_FIELD_QR);
    expect(result).toEqual({
      ok: true,
      credentials: {
        mqttUsername: 'homeuser',
        mqttPassword: 's3cret-pass',
        influxToken: 'influx-token-abc',
        mqttHost: '192.168.3.105',
        mqttPort: 9001,
        mqttPrefix: 'smarthome',
        influxUrl: 'http://192.168.3.105:8086',
        influxOrg: 'smarthome',
        influxBucket: 'telemetry',
      },
    });
  });

  it('a secrets-only QR fills the secrets and keeps every non-secret value (absent from the patch)', () => {
    const result = parseCredentialsQr(FULL_QR);
    expect(result).toEqual({
      ok: true,
      credentials: {
        mqttUsername: 'homeuser',
        mqttPassword: 's3cret-pass',
        influxToken: 'influx-token-abc',
      },
    });
    expect(Object.keys(result).length).toBe(2); // ok + credentials only
  });

  it('drops a STRING mqttPort (the server emits a number) — port dropped, QR still parses', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttPassword: 'p',
        mqttHost: '192.168.3.105',
        mqttPort: '9001',
        influxBucket: 'telemetry',
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: {
        mqttPassword: 'p',
        mqttHost: '192.168.3.105',
        influxBucket: 'telemetry',
      },
    });
  });

  it('drops an OUT-OF-RANGE mqttPort (0 and 65536) — the rest still fills', () => {
    for (const badPort of [0, 65536]) {
      const result = parseCredentialsQr(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'credentials',
          mqttUsername: 'u',
          mqttPort: badPort,
          mqttHost: '192.168.3.105',
        }),
      );
      expect(result).toEqual({
        ok: true,
        credentials: { mqttUsername: 'u', mqttHost: '192.168.3.105' },
      });
    }
  });

  it('drops a NON-INTEGER mqttPort (the server never sends one, but junk stays junk)', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttUsername: 'u',
        mqttPort: 9001.5,
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: { mqttUsername: 'u' },
    });
  });

  it('drops a junk mqttPrefix that fails the settings prefix rule — everything else fills', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttUsername: 'homeuser',
        mqttPassword: 's3cret-pass',
        influxToken: 'influx-token-abc',
        mqttHost: '192.168.3.105',
        mqttPort: 9001,
        mqttPrefix: 'smarthome!',
        influxUrl: 'http://192.168.3.105:8086',
        influxOrg: 'smarthome',
        influxBucket: 'telemetry',
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: {
        mqttUsername: 'homeuser',
        mqttPassword: 's3cret-pass',
        influxToken: 'influx-token-abc',
        mqttHost: '192.168.3.105',
        mqttPort: 9001,
        influxUrl: 'http://192.168.3.105:8086',
        influxOrg: 'smarthome',
        influxBucket: 'telemetry',
      },
    });
  });

  it('repairs a malformed unbracketed IPv6 influxUrl in the patch (influx-ipv6-url-normalization)', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttUsername: 'homeuser',
        influxUrl: 'http://fe80::9b78:6845:8077:4ce2:9001:8086',
        influxOrg: 'smarthome',
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: {
        mqttUsername: 'homeuser',
        influxUrl: 'http://[fe80::9b78:6845:8077:4ce2:9001]:8086',
        influxOrg: 'smarthome',
      },
    });
  });

  it('drops EMPTY non-secret fields (keep-current — never overwrite with nothing)', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttUsername: 'homeuser',
        mqttPassword: 's3cret-pass',
        influxToken: 'influx-token-abc',
        mqttHost: '',
        mqttPrefix: '',
        influxUrl: '',
        influxOrg: '',
        influxBucket: '',
      }),
    );
    expect(result).toEqual({
      ok: true,
      credentials: {
        mqttUsername: 'homeuser',
        mqttPassword: 's3cret-pass',
        influxToken: 'influx-token-abc',
      },
    });
  });

  it('a non-secret-only QR (NO secret values) still rejects as "QR rỗng"', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'credentials',
        mqttHost: '192.168.3.105',
        mqttPort: 9001,
        mqttPrefix: 'smarthome',
        influxUrl: 'http://192.168.3.105:8086',
        influxOrg: 'smarthome',
        influxBucket: 'telemetry',
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('parseCredentialsQr — honest rejections', () => {
  it('rejects garbage JSON as malformed', () => {
    expect(parseCredentialsQr('not json at all')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects non-object JSON (array, number, string, null) as malformed', () => {
    expect(parseCredentialsQr('[1,2,3]')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(parseCredentialsQr('42')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(parseCredentialsQr('"text"')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(parseCredentialsQr('null')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects a missing kind as malformed (kind is part of the contract)', () => {
    expect(
      parseCredentialsQr(
        JSON.stringify({ schemaVersion: 1, mqttPassword: 'p' }),
      ),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects an UNKNOWN kind without trying to parse fields (forward-compat honesty)', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'system',
        mqttPassword: 'p',
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'unsupportedKind' });
  });

  it('rejects a wrong schemaVersion', () => {
    const result = parseCredentialsQr(
      JSON.stringify({
        schemaVersion: 2,
        kind: 'credentials',
        mqttPassword: 'p',
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'unsupportedVersion' });
  });

  it('rejects a missing schemaVersion', () => {
    expect(parseCredentialsQr(JSON.stringify({ kind: 'credentials' }))).toEqual(
      { ok: false, reason: 'unsupportedVersion' },
    );
  });

  it('rejects a well-formed credentials QR where NO field has a value ("QR rỗng")', () => {
    expect(
      parseCredentialsQr(
        JSON.stringify({ schemaVersion: 1, kind: 'credentials' }),
      ),
    ).toEqual({ ok: false, reason: 'empty' });
    expect(
      parseCredentialsQr(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'credentials',
          mqttUsername: '',
          mqttPassword: '',
          influxToken: '',
        }),
      ),
    ).toEqual({ ok: false, reason: 'empty' });
  });
});
