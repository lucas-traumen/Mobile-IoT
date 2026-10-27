/**
 * Telemetry domain: sensor payload parsing (pure).
 *
 * Boards contract: each `<prefix>/boards/<boardId>/sensors/S<n>/state`
 * message carries ONE finite numeric metric (the topic carries the source
 * identity `{boardId, channel}`; the payload is just the value). The
 * payload is external data — per repository convention Zod is its
 * validation source — and invalid payloads are rejected safely (never
 * crash).
 */

import { z } from 'zod';

import { Errors, err, ok, type Result } from '@core/errors';

/**
 * Explicitly accepted grammar (fix cycle 2): one plain DECIMAL number with
 * an optional sign, an optional fraction (`5`, `5.`, `.5`, `5.2`) and an
 * optional decimal exponent (`1e2`, `1.5E-2`); surrounding whitespace is
 * tolerated. Deliberately REJECTED: radix forms (`0x1f`, `0b101`, `0o17`),
 * separators (`1_000`, `1,5`), trailing junk (`25.6 kg`), `NaN`/`Infinity`
 * literals, booleans/JSON leftovers (`true`, `{"t":25.6}`, `[1]`),
 * empty/whitespace-only payloads and values overflowing to a non-finite
 * number (`1e999`).
 */
const SENSOR_PAYLOAD_PATTERN =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Zod schema — THE validation source for a raw sensor payload (repository
 * convention: Zod validates all external data). The regex gates the
 * accepted encodings, the transform converts the already-validated decimal
 * text, and the refine rejects values overflowing to `±Infinity`.
 */
const finiteDecimalPayload = z
  .string()
  .trim()
  .regex(SENSOR_PAYLOAD_PATTERN)
  .transform(value => Number(value))
  .refine(Number.isFinite);

/**
 * Parse a raw MQTT payload string into one finite sensor value.
 *
 * Accepts one plain decimal number (`25.6`, `60`, `-3.2e1`) with optional
 * surrounding whitespace — see {@link SENSOR_PAYLOAD_PATTERN} for the exact
 * accepted/rejected encodings.
 *
 * @param raw - UTF-8 payload received on a sensor topic.
 * @returns `ok(value)` when the payload is one finite number,
 *   `err(code: 'validation')` otherwise.
 */
export function parseSensorPayload(raw: string): Result<number> {
  const parsed = finiteDecimalPayload.safeParse(raw);
  if (!parsed.success) {
    return err(
      Errors.validation(
        `Sensor payload is not one finite decimal number: ${raw.slice(0, 32)}`,
      ),
    );
  }
  return ok(parsed.data);
}
