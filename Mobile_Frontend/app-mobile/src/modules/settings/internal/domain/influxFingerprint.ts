/**
 * Influx probe config fingerprint (fix cycle 2 — probe truthfulness).
 *
 * A probe result is valid only for the EXACT Influx configuration it
 * tested. {@link influxConfigFingerprint} derives a stable, typed identity
 * for a connection target so the UI can detect "this result belongs to a
 * different configuration" (edited fields, a save of edited settings, or a
 * config swap while the async probe was still in flight).
 *
 * Secrets: the fingerprint is a one-way 32-bit FNV-1a hash over a
 * length-prefixed canonical form of the four connection fields. The token
 * (or any other secret) is never stored in the result, rendered, or logged
 * — only its hash contribution is kept.
 */

/** The connection fields a probe targets (subset of `AppSettings['influx']`). */
export interface InfluxProbeTarget {
  readonly url: string;
  readonly org: string;
  readonly bucket: string;
  readonly token: string;
}

/** FNV-1a 32-bit, hex encoded (deterministic, dependency-free). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable identity of an Influx connection target.
 *
 * Fields are length-prefixed before hashing so values containing the
 * separator (`|`, `:`) can never collide across different field splits
 * (e.g. url=`a|b`, org=`c` vs url=`a`, org=`b|c`).
 */
export function influxConfigFingerprint(config: InfluxProbeTarget): string {
  const canonical = [
    `${config.url.length}:${config.url}`,
    `${config.org.length}:${config.org}`,
    `${config.bucket.length}:${config.bucket}`,
    `${config.token.length}:${config.token}`,
  ].join('|');
  return fnv1a(canonical);
}
