/**
 * Influx probe config fingerprint tests (fix cycle 2 — probe truthfulness):
 * the fingerprint must be a stable per-configuration identity that changes
 * whenever ANY connection field changes (including the token) and must
 * never leak secret values into the derived string.
 */

import { influxConfigFingerprint } from './influxFingerprint';

const base = {
  url: 'http://influx.local:8086',
  org: 'iot',
  bucket: 'sensors',
  token: 'secret-token-value',
};

describe('influxConfigFingerprint', () => {
  it('is stable for the exact same configuration', () => {
    expect(influxConfigFingerprint(base)).toBe(
      influxConfigFingerprint({ ...base }),
    );
  });

  it('changes when any connection field changes', () => {
    const reference = influxConfigFingerprint(base);
    expect(
      influxConfigFingerprint({ ...base, url: 'http://other:8086' }),
    ).not.toBe(reference);
    expect(influxConfigFingerprint({ ...base, org: 'other' })).not.toBe(
      reference,
    );
    expect(influxConfigFingerprint({ ...base, bucket: 'other' })).not.toBe(
      reference,
    );
  });

  it('changes when only the token changes (secret is fingerprinted too)', () => {
    expect(influxConfigFingerprint({ ...base, token: 'rotated' })).not.toBe(
      influxConfigFingerprint(base),
    );
  });

  it('is delimiter-ambiguous safe (length-prefixed canonical form)', () => {
    // url=`a|b`, org=`c` must never equal url=`a`, org=`b|c`.
    expect(
      influxConfigFingerprint({
        url: 'a|b',
        org: 'c',
        bucket: 'd',
        token: 'e',
      }),
    ).not.toBe(
      influxConfigFingerprint({
        url: 'a',
        org: 'b|c',
        bucket: 'd',
        token: 'e',
      }),
    );
  });

  it('does not leak the token (or any raw field value) into the fingerprint', () => {
    const fingerprint = influxConfigFingerprint(base);
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint).not.toContain(base.token);
    expect(fingerprint).not.toContain(base.url);
    expect(fingerprint).not.toContain(base.bucket);
  });
});
