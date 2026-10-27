/**
 * Telemetry payload parsing tests (approved room-sensor contract): each
 * sensor message carries ONE finite decimal metric; anything else is
 * rejected safely. Fix cycle 2: the validation source is Zod, with an
 * explicit accepted/rejected encoding matrix.
 */

import { parseSensorPayload } from './payloads';

describe('parseSensorPayload', () => {
  describe('accepted encodings', () => {
    it('parses plain decimal numbers', () => {
      expect(parseSensorPayload('25.6')).toEqual(ok(25.6));
      expect(parseSensorPayload('60')).toEqual(ok(60));
      expect(parseSensorPayload('-3.2')).toEqual(ok(-3.2));
      expect(parseSensorPayload('0')).toEqual(ok(0));
    });

    it('parses signed, exponent and leading-zero forms', () => {
      expect(parseSensorPayload('+3.25')).toEqual(ok(3.25));
      expect(parseSensorPayload('1e2')).toEqual(ok(100));
      expect(parseSensorPayload('1.5E-2')).toEqual(ok(0.015));
      expect(parseSensorPayload('007')).toEqual(ok(7));
    });

    it('parses bare fraction forms Number() accepts', () => {
      expect(parseSensorPayload('.5')).toEqual(ok(0.5));
      expect(parseSensorPayload('5.')).toEqual(ok(5));
    });

    it('tolerates surrounding whitespace', () => {
      expect(parseSensorPayload('  25.6\n')).toEqual(ok(25.6));
      expect(parseSensorPayload('\t-1.5 ')).toEqual(ok(-1.5));
    });
  });

  describe('rejected encodings', () => {
    it('rejects empty and whitespace-only payloads', () => {
      expect(parseSensorPayload('').ok).toBe(false);
      expect(parseSensorPayload('   ').ok).toBe(false);
      expect(parseSensorPayload('\n\t').ok).toBe(false);
    });

    it('rejects non-numeric text and JSON leftovers', () => {
      expect(parseSensorPayload('abc').ok).toBe(false);
      expect(parseSensorPayload('{"temperature":25}').ok).toBe(false);
      expect(parseSensorPayload('[1]').ok).toBe(false);
      expect(parseSensorPayload('true').ok).toBe(false);
      expect(parseSensorPayload('false').ok).toBe(false);
    });

    it('rejects non-finite literals', () => {
      expect(parseSensorPayload('NaN').ok).toBe(false);
      expect(parseSensorPayload('Infinity').ok).toBe(false);
      expect(parseSensorPayload('-Infinity').ok).toBe(false);
    });

    it('rejects radix forms, separators and trailing junk', () => {
      expect(parseSensorPayload('0x1F').ok).toBe(false);
      expect(parseSensorPayload('0b101').ok).toBe(false);
      expect(parseSensorPayload('0o17').ok).toBe(false);
      expect(parseSensorPayload('1_000').ok).toBe(false);
      expect(parseSensorPayload('1,5').ok).toBe(false);
      expect(parseSensorPayload('25.6 kg').ok).toBe(false);
      expect(parseSensorPayload('--5').ok).toBe(false);
    });

    it('rejects values overflowing to a non-finite number', () => {
      expect(parseSensorPayload('1e999').ok).toBe(false);
      expect(parseSensorPayload('-1e999').ok).toBe(false);
    });
  });
});

/** Local ok-shape helper (mirrors core Result). */
function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}
