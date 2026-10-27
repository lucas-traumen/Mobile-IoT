/**
 * BoardQrLabel tests (boards-qr-scan): the QR label contract is a 3-field
 * subset of the board descriptor — JSON `{schemaVersion: 1, boardId,
 * boardType}` — zod-validated with the SAME board-code grammar authority
 * (`ROOM_CODE_REGEX`, 1–32 chars) as the AddRoomDialog manual entry (AD-1).
 *
 * `parseBoardQrLabel` is the ONLY parse entry point: every malformed input
 * (non-JSON, non-object, wrong schemaVersion, missing fields, boardId
 * grammar violations) yields `null`; extra fields are tolerated (zod
 * default strip) so the label tooling may enrich the QR without breaking
 * older app versions.
 */

import { parseBoardQrLabel } from './boardQrLabel';

const VALID_JSON = JSON.stringify({
  schemaVersion: 1,
  boardId: '0',
  boardType: 'esp32-sensor-relay',
});

describe('parseBoardQrLabel (boards-qr-scan, AD-1)', () => {
  it('parses a valid label into its 3 fields', () => {
    expect(parseBoardQrLabel(VALID_JSON)).toEqual({
      schemaVersion: 1,
      boardId: '0',
      boardType: 'esp32-sensor-relay',
    });
  });

  it('accepts boardId at the grammar bounds (1 and 32 chars)', () => {
    expect(
      parseBoardQrLabel(
        JSON.stringify({
          schemaVersion: 1,
          boardId: 'a',
          boardType: 'esp32-relay',
        }),
      ),
    ).toMatchObject({ boardId: 'a' });
    expect(
      parseBoardQrLabel(
        JSON.stringify({
          schemaVersion: 1,
          boardId: 'a'.repeat(32),
          boardType: 'esp32-relay',
        }),
      ),
    ).toMatchObject({ boardId: 'a'.repeat(32) });
  });

  it('returns null for non-JSON garbage', () => {
    expect(parseBoardQrLabel('not json at all')).toBeNull();
    expect(parseBoardQrLabel('{schemaVersion: 1}')).toBeNull();
    expect(parseBoardQrLabel('')).toBeNull();
  });

  it('returns null for JSON that is not an object', () => {
    expect(parseBoardQrLabel('42')).toBeNull();
    expect(parseBoardQrLabel('"hello"')).toBeNull();
    expect(parseBoardQrLabel('null')).toBeNull();
    expect(parseBoardQrLabel('[1, 2]')).toBeNull();
  });

  it('returns null for a wrong schemaVersion', () => {
    expect(
      parseBoardQrLabel(
        JSON.stringify({
          schemaVersion: 2,
          boardId: 'board-1',
          boardType: 'esp32-relay',
        }),
      ),
    ).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(
      parseBoardQrLabel(JSON.stringify({ boardId: 'board-1', boardType: 't' })),
    ).toBeNull();
    expect(
      parseBoardQrLabel(
        JSON.stringify({ schemaVersion: 1, boardType: 'esp32-relay' }),
      ),
    ).toBeNull();
    expect(
      parseBoardQrLabel(
        JSON.stringify({ schemaVersion: 1, boardId: 'board-1' }),
      ),
    ).toBeNull();
  });

  it('returns null for boardId grammar violations (same authority as AddRoomDialog)', () => {
    const labelWith = (boardId: string): string =>
      JSON.stringify({ schemaVersion: 1, boardId, boardType: 'esp32-relay' });
    // Character outside [a-zA-Z0-9_-].
    expect(parseBoardQrLabel(labelWith('board 1'))).toBeNull();
    expect(parseBoardQrLabel(labelWith('board.1'))).toBeNull();
    expect(parseBoardQrLabel(labelWith('board#1'))).toBeNull();
    // Vietnamese diacritics are not part of the machine-key alphabet.
    expect(parseBoardQrLabel(labelWith('bòárd'))).toBeNull();
    // Empty and over-length (33+) boardIds.
    expect(parseBoardQrLabel(labelWith(''))).toBeNull();
    expect(parseBoardQrLabel(labelWith('a'.repeat(33)))).toBeNull();
  });

  it('returns null for an empty boardType', () => {
    expect(
      parseBoardQrLabel(
        JSON.stringify({ schemaVersion: 1, boardId: 'board-1', boardType: '' }),
      ),
    ).toBeNull();
  });

  it('tolerates extra fields — they are stripped from the result', () => {
    const label = parseBoardQrLabel(
      JSON.stringify({
        schemaVersion: 1,
        boardId: 'board-1',
        boardType: 'esp32-sensor-relay',
        displayName: 'Bộ đo phòng khách',
        printedAt: '2026-09-18',
      }),
    );
    expect(label).toEqual({
      schemaVersion: 1,
      boardId: 'board-1',
      boardType: 'esp32-sensor-relay',
    });
    expect(Object.keys(label ?? {})).toEqual([
      'schemaVersion',
      'boardId',
      'boardType',
    ]);
  });
});
