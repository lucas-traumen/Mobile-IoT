/**
 * Network host normalization shared by every MQTT connection boundary
 * (mqtt-invalid-url-host-normalization).
 *
 * mqtt.js builds the WebSocket URL by concatenating
 * `ws://${hostname}:${port}${path}`, and its react-native/browser path
 * copies `opts.host` into `hostname`. A scheme-bearing or URL-ish value
 * stored in settings (`ws://192.168.100.3:9001`) therefore produces a
 * malformed `ws://ws://…` URL and React Native's WebSocket throws
 * `TypeError: Invalid URL`; a bare IPv6 literal (`fe80::1`) collides with
 * the `:${port}` suffix the same way. Both boundaries normalize the host
 * through {@link normalizeBrokerHost} BEFORE any `mqtt.connect` call.
 */

/**
 * Normalize a user-entered broker host to a bare host usable in a
 * `ws://` URL.
 *
 * Regex-only by design — NO `URL` constructor (Hermes caution; the
 * `deriveBrokerAddress` convention in BoardsScreen.tsx). Pure: no
 * logging, no side effects, no platform checks.
 *
 * Semantics (order matters — the IPv6 trap):
 * 1. trim; strip a leading scheme (`ws://`, `wss://`, `http://`,
 *    `mqtt://`, `tcp://`, …);
 * 2. drop userinfo (everything up to and including the LAST `@`);
 * 3. cut at the first `/`, `?`, or `#`;
 * 4. host:port split:
 *    - already bracketed `[...]`: keep the bracketed literal verbatim and
 *      strip a trailing `:port` only if it sits AFTER the closing `]`;
 *    - unbracketed AND containing ≥2 colons: an IPv6 literal — do NOT
 *      strip a trailing `:<digits>` (that is part of the address); wrap
 *      the whole thing in `[...]`;
 *    - exactly one colon whose suffix is all digits: strip the `:port`
 *      (the settings port field stays the connection authority);
 *    - no colon: plain hostname/IPv4, unchanged.
 *
 * Returns `''` when nothing usable remains (e.g. the input was just
 * `ws://` or whitespace); callers must fail typed on `''` and never call
 * `mqtt.connect`.
 *
 * @param raw - the persisted/draft/probe host exactly as stored.
 * @returns the normalized host, or `''` when unusable.
 */
export function normalizeBrokerHost(raw: string): string {
  // 1. Trim + strip a leading scheme.
  let host = raw.trim().replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '');
  // 2. Drop userinfo (up to and including the LAST `@`).
  const atIndex = host.lastIndexOf('@');
  if (atIndex !== -1) {
    host = host.slice(atIndex + 1);
  }
  // 3. Cut at the first path/query/fragment separator.
  host = host.replace(/[/?#].*$/, '');
  if (host === '') {
    return '';
  }

  // 4. Host:port split — the IPv6 trap lives here.
  if (host.startsWith('[')) {
    const closeIndex = host.indexOf(']');
    if (closeIndex !== -1) {
      // Keep the bracketed literal verbatim; strip a trailing `:port`
      // only AFTER the closing `]`.
      const bracketed = host.slice(0, closeIndex + 1);
      return bracketed.replace(/\]:\d+$/, ']');
    }
    // Malformed bracket form: fall through to the general rules.
  }

  const colonCount = (host.match(/:/g) ?? []).length;
  if (colonCount >= 2) {
    // Bare IPv6 literal: a trailing `:<digits>` is part of the address,
    // not a port — wrap the whole thing.
    return `[${host}]`;
  }
  if (colonCount === 1) {
    const colonIndex = host.indexOf(':');
    const suffix = host.slice(colonIndex + 1);
    if (/^\d+$/.test(suffix)) {
      // Single colon with an all-digit suffix = a port; the settings
      // port field stays the connection authority.
      host = host.slice(0, colonIndex);
    }
  }
  return host;
}

/**
 * Format a bare host for use inside a URL authority
 * (influx-ipv6-url-normalization). IPv4/hostname unchanged; a bare
 * multi-colon IPv6 literal is bracket-wrapped WITHOUT eating the final
 * hextet as if it were a port; an already-bracketed literal is preserved
 * verbatim; empty input returns `''`.
 *
 * Pure, regex-only, NO `URL` constructor (same Hermes convention as
 * {@link normalizeBrokerHost}). Presentation/URL-authority helper only —
 * unlike {@link normalizeBrokerHost} it never strips a port: the caller
 * supplies the port itself (e.g. the mDNS `influx_port` TXT record).
 *
 * @param host - the discovered/entered host exactly as received.
 * @returns the URL-safe host form, or `''` for empty input.
 */
export function formatHostForUrl(host: string): string {
  const trimmed = host.trim();
  if (trimmed === '') {
    return '';
  }
  if (trimmed.startsWith('[') && trimmed.includes(']')) {
    // Already bracketed — preserve verbatim.
    return trimmed;
  }
  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount >= 2) {
    // Bare IPv6 literal — a trailing `:<digits>` is part of the address,
    // never a port. Wrap the whole thing.
    return `[${trimmed}]`;
  }
  return trimmed;
}

/**
 * Normalize an app-controlled InfluxDB base URL
 * (influx-ipv6-url-normalization).
 *
 * Repairs exactly ONE known deterministic defect: the unbracketed IPv6
 * authority (`http://fe80::1:8086`) — bracket-wraps the IPv6 host and
 * separates a terminal decimal port (1–65535). Because an unbracketed
 * IPv6+port string is inherently ambiguous, the explicit app contract
 * treats a final decimal token as the URL port ONLY when the preceding
 * portion is still a plausible multi-colon IPv6 (≥2 colons remain);
 * otherwise the token is the address's final hextet and is never
 * separated (`http://fe80::1` → `http://[fe80::1]`). The concrete broken
 * backend shape emits `:8086`, so the compatibility contract holds for
 * the real payload.
 *
 * Everything else is preserved byte-for-byte apart from trimming: scheme
 * (its original case), userinfo, path/query/fragment, valid IPv4 /
 * hostname / already-bracketed IPv6. Invalid or non-`http(s)` input is
 * returned trimmed UNCHANGED — Zod and fetch remain the honest validity
 * authorities; this function never invents a URL and never silently
 * drops one. Pure, regex-only, NO `URL` constructor.
 *
 * @param raw - a draft/persisted/QR-carried InfluxDB base URL.
 * @returns the normalized base URL (or the trimmed input when it is not
 *   a repairable `http(s)` URL).
 */
export function normalizeInfluxBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const schemeMatch = /^https?:\/\//i.exec(trimmed);
  if (!schemeMatch) {
    // Non-http(s) or already garbage — return trimmed unchanged.
    return trimmed;
  }
  const schemePrefix = schemeMatch[0];
  const rest = trimmed.slice(schemePrefix.length);
  // Split authority from path/query/fragment at the FIRST separator.
  const separatorMatch = /[/?#]/.exec(rest);
  const authority = separatorMatch ? rest.slice(0, separatorMatch.index) : rest;
  const tail = separatorMatch ? rest.slice(separatorMatch.index) : '';
  // Preserve userinfo verbatim (everything up to the LAST `@`).
  const atIndex = authority.lastIndexOf('@');
  const userinfo = atIndex !== -1 ? authority.slice(0, atIndex + 1) : '';
  const hostPart = atIndex !== -1 ? authority.slice(atIndex + 1) : authority;

  let formattedHost: string;
  if (hostPart.startsWith('[') && hostPart.includes(']')) {
    // Already bracketed — byte-for-byte.
    formattedHost = hostPart;
  } else {
    const colonCount = (hostPart.match(/:/g) ?? []).length;
    if (colonCount >= 2) {
      const lastColonIndex = hostPart.lastIndexOf(':');
      const portToken = hostPart.slice(lastColonIndex + 1);
      const remainder = hostPart.slice(0, lastColonIndex);
      const remainderColons = (remainder.match(/:/g) ?? []).length;
      if (
        remainderColons >= 2 &&
        /^\d{1,5}$/.test(portToken) &&
        Number(portToken) >= 1 &&
        Number(portToken) <= 65535
      ) {
        // Terminal decimal port after a still-plausible multi-colon
        // IPv6 host: bracket the host, keep the port.
        formattedHost = `[${remainder}]:${portToken}`;
      } else {
        // A bare IPv6 (possibly with a zone id / non-decimal tail) —
        // never eat the final hextet as a port.
        formattedHost = `[${hostPart}]`;
      }
    } else {
      // Plain hostname / IPv4 — unchanged.
      formattedHost = hostPart;
    }
  }
  return `${schemePrefix}${userinfo}${formattedHost}${tail}`;
}
