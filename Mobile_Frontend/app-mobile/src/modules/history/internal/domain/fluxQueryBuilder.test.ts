import {
  buildFluxQuery,
  escapeFluxString,
  parseFluxCsv,
  RANGE_TO_DURATION,
  type HistoryQuery,
  type HistoryRange,
} from './fluxQueryBuilder';

function makeQuery(overrides?: Partial<HistoryQuery>): HistoryQuery {
  return {
    measurement: 'temperature',
    range: '1h',
    fields: [],
    roomId: null,
    ...overrides,
  };
}

describe('buildFluxQuery', () => {
  it('builds a query for 1h range', () => {
    const query = buildFluxQuery('sensors', makeQuery());
    expect(query).toContain('from(bucket: "sensors")');
    expect(query).toContain('range(start: -1h)');
    expect(query).toContain('r._measurement == "temperature"');
    expect(query).toContain(
      'r._field == "temperature" or r._field == "humidity"',
    );
  });

  it('builds a query for 24h and 7d ranges', () => {
    expect(buildFluxQuery('sensors', makeQuery({ range: '24h' }))).toContain(
      'range(start: -24h)',
    );
    expect(buildFluxQuery('sensors', makeQuery({ range: '7d' }))).toContain(
      'range(start: -7d)',
    );
  });

  it('maps every range to a duration', () => {
    for (const range of ['1h', '24h', '7d'] as const) {
      expect(RANGE_TO_DURATION[range]).toBeTruthy();
    }
  });

  // dashboard-history-board-touch-share (AD-2): the phone never sees raw
  // per-second points — every range aggregates into fixed-size buckets
  // server-side, with empty buckets dropped (no fake zero points).
  describe('aggregateWindow per range (dashboard-history-board-touch-share, AD-2)', () => {
    const AGGREGATIONS: Record<HistoryRange, string> = {
      '1h': '1m',
      '24h': '15m',
      '7d': '1h',
    };

    it('aggregates 1h into 1-minute means', () => {
      const query = buildFluxQuery('sensors', makeQuery({ range: '1h' }));
      expect(query).toContain('aggregateWindow(every: 1m, fn: mean');
      expect(query).toContain('createEmpty: false');
    });

    it('aggregates 24h into 15-minute means', () => {
      const query = buildFluxQuery('sensors', makeQuery({ range: '24h' }));
      expect(query).toContain('aggregateWindow(every: 15m, fn: mean');
      expect(query).toContain('createEmpty: false');
    });

    it('aggregates 7d into 1-hour means', () => {
      const query = buildFluxQuery('sensors', makeQuery({ range: '7d' }));
      expect(query).toContain('aggregateWindow(every: 1h, fn: mean');
      expect(query).toContain('createEmpty: false');
    });

    it('keeps the aggregation AFTER the series grouping (per-series windows)', () => {
      const query = buildFluxQuery(
        'sensors',
        makeQuery({ roomId: 'room-living' }),
      );
      const groupIdx = query.indexOf('group(columns: ["roomId", "_field"])');
      const aggIdx = query.indexOf('aggregateWindow(');
      expect(groupIdx).toBeGreaterThanOrEqual(0);
      expect(aggIdx).toBeGreaterThan(groupIdx);
    });

    it('every range maps to its window (table pin)', () => {
      expect(AGGREGATIONS).toEqual({
        '1h': '1m',
        '24h': '15m',
        '7d': '1h',
      });
    });
  });

  it('escapes bucket and measurement names', () => {
    const query = buildFluxQuery(
      'a"b\\c',
      makeQuery({ measurement: 'my"measure' }),
    );
    expect(query).toContain('a\\"b\\\\c');
    expect(query).toContain('my\\"measure');
  });

  it('builds a query for custom catalog fields (CP4)', () => {
    const query = buildFluxQuery(
      'sensors',
      makeQuery({ fields: ['temperature', 'pressure'] }),
    );
    expect(query).toContain('r._field == "temperature"');
    expect(query).toContain('r._field == "pressure"');
    expect(query).not.toContain('humidity');
  });

  it('falls back to the default fields for an empty list', () => {
    const query = buildFluxQuery('sensors', makeQuery({ fields: [] }));
    expect(query).toContain(
      'r._field == "temperature" or r._field == "humidity"',
    );
  });

  it('escapes custom field names (CP4)', () => {
    const query = buildFluxQuery('sensors', makeQuery({ fields: ['a"b'] }));
    expect(query).toContain('r._field == "a\\"b"');
  });

  it('filters the roomId tag and keeps/groups roomId + _field (approved contract)', () => {
    const query = buildFluxQuery(
      'sensors',
      makeQuery({
        measurement: 'sensors',
        roomId: 'room-living',
      }),
    );
    expect(query).toContain('r.roomId == "room-living"');
    expect(query).toContain(
      'keep(columns: ["_time", "_field", "_value", "roomId"])',
    );
    expect(query).toContain('group(columns: ["roomId", "_field"])');
  });

  it('filters the boardId tag for board-bound rooms (boards contract v2)', () => {
    const query = buildFluxQuery(
      'sensors',
      makeQuery({
        measurement: 'sensors',
        roomId: null,
        boardId: 'board-1',
      }),
    );
    expect(query).toContain('r.boardId == "board-1"');
    expect(query).not.toContain('r.roomId ==');
    // Both tags are kept (the 1:1 backend contract); boardId stays a plain
    // column while the group key remains roomId + _field.
    expect(query).toContain(
      'keep(columns: ["_time", "_field", "_value", "roomId", "boardId"])',
    );
    expect(query).toContain('group(columns: ["roomId", "_field"])');
  });

  it('escapes the boardId filter value', () => {
    const query = buildFluxQuery(
      'sensors',
      makeQuery({ roomId: null, boardId: 'board"1' }),
    );
    expect(query).toContain('r.boardId == "board\\"1"');
  });

  it('prefers the boardId filter when BOTH tags are set (board-bound path)', () => {
    const query = buildFluxQuery(
      'sensors',
      makeQuery({ roomId: 'room-living', boardId: 'board-1' }),
    );
    expect(query).toContain('r.boardId == "board-1"');
    expect(query).not.toContain('r.roomId ==');
  });

  it('omits the roomId filter when the query is roomless (raw probe)', () => {
    const query = buildFluxQuery('sensors', makeQuery({ roomId: null }));
    expect(query).not.toContain('r.roomId ==');
  });

  it('escapes room ids', () => {
    const query = buildFluxQuery('sensors', makeQuery({ roomId: 'room"1' }));
    expect(query).toContain('r.roomId == "room\\"1"');
  });
});

describe('escapeFluxString', () => {
  it('escapes backslashes and double quotes', () => {
    expect(escapeFluxString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(escapeFluxString('plain')).toBe('plain');
  });
});

describe('parseFluxCsv', () => {
  const csvHeader =
    '#datatype,string,dateTime:RFC3339,string,double\n' +
    ',result,table,_time,_field,_value\n' +
    ',0,0,2026-08-28T00:00:00Z,temperature,25.5\n' +
    ',0,1,2026-08-28T00:00:01Z,humidity,60.2\n';

  it('maps a CSV response to series (legacy rows → roomId null)', () => {
    const result = parseFluxCsv(csvHeader);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const temperature = result.value.find(s => s.field === 'temperature');
      const humidity = result.value.find(s => s.field === 'humidity');
      expect(temperature?.roomId).toBeNull();
      expect(temperature?.points).toEqual([
        { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 25.5 },
      ]);
      expect(humidity?.roomId).toBeNull();
      expect(humidity?.points).toEqual([
        { t: Date.parse('2026-08-28T00:00:01Z') / 1000, value: 60.2 },
      ]);
    }
  });

  it('returns an empty series list for an empty body', () => {
    const result = parseFluxCsv('');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('maps humidity rows to a humidity series (B2 regression)', () => {
    const csv =
      ',result,table,_time,_field,_value\n' +
      ',0,0,2026-08-28T00:00:00Z,humidity,61.5\n' +
      ',0,1,2026-08-28T00:00:01Z,humidity,62.0\n';
    const result = parseFluxCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].field).toBe('humidity');
      expect(result.value[0].points).toEqual([
        { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 61.5 },
        { t: Date.parse('2026-08-28T00:00:01Z') / 1000, value: 62.0 },
      ]);
    }
  });

  it('ignores unknown fields instead of collapsing them to temperature (B2)', () => {
    const csv =
      ',result,table,_time,_field,_value\n' +
      ',0,0,2026-08-28T00:00:00Z,temperature,25.5\n' +
      ',0,1,2026-08-28T00:00:01Z,soil,40.0\n';
    const result = parseFluxCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].field).toBe('temperature');
      expect(result.value[0].points).toHaveLength(1);
    }
  });

  it('maps custom catalog fields when listed (CP4)', () => {
    const csv =
      ',result,table,_time,_field,_value\n' +
      ',0,0,2026-08-28T00:00:00Z,pressure,1013.2\n' +
      ',0,1,2026-08-28T00:00:01Z,humidity,60.0\n';
    const result = parseFluxCsv(csv, ['pressure']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].field).toBe('pressure');
      expect(result.value[0].points).toEqual([
        { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 1013.2 },
      ]);
    }
  });

  it('separates same-field rows by roomId tag (approved identity)', () => {
    const csv =
      '#datatype,string,dateTime:RFC3339,string,string,double\n' +
      ',result,table,_time,_field,roomId,_value\n' +
      ',0,0,2026-08-28T00:00:00Z,temperature,room-living,25.5\n' +
      ',0,0,2026-08-28T00:00:01Z,temperature,room-living,25.7\n' +
      ',0,1,2026-08-28T00:00:00Z,temperature,room-bedroom,22.1\n';
    const result = parseFluxCsv(csv, ['temperature']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      const living = result.value.find(s => s.roomId === 'room-living');
      const bedroom = result.value.find(s => s.roomId === 'room-bedroom');
      expect(living?.field).toBe('temperature');
      expect(living?.points).toEqual([
        { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 25.5 },
        { t: Date.parse('2026-08-28T00:00:01Z') / 1000, value: 25.7 },
      ]);
      expect(bedroom?.points).toEqual([
        { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 22.1 },
      ]);
    }
  });

  it('parses untagged rows in a roomId CSV as roomId null (legacy)', () => {
    const csv =
      ',result,table,_time,_field,roomId,_value\n' +
      ',0,0,2026-08-28T00:00:00Z,temperature,,25.5\n' +
      ',0,1,2026-08-28T00:00:01Z,temperature,room-living,20.0\n';
    const result = parseFluxCsv(csv, ['temperature']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const legacy = result.value.find(s => s.roomId === null);
      const tagged = result.value.find(s => s.roomId === 'room-living');
      expect(legacy?.points).toHaveLength(1);
      expect(tagged?.points).toHaveLength(1);
    }
  });

  it('rejects a body without the _field column', () => {
    const result = parseFluxCsv(',result,table,value\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });

  it('skips malformed rows', () => {
    const csv =
      ',result,table,_time,_field,_value\n' +
      ',0,0,not-a-time,temperature,25.5\n' +
      ',0,1,2026-08-28T00:00:00Z,humidity,not-a-number\n' +
      ',0,2,2026-08-28T00:00:02Z,temperature,21.0\n';
    const result = parseFluxCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const temperature = result.value.find(s => s.field === 'temperature');
      expect(temperature?.points).toEqual([
        { t: Date.parse('2026-08-28T00:00:02Z') / 1000, value: 21.0 },
      ]);
      expect(result.value.some(s => s.field === 'humidity')).toBe(false);
    }
  });

  it('handles quoted CSV cells', () => {
    const csv =
      ',result,table,_time,_field,_value\n' +
      ',0,0,2026-08-28T00:00:00Z,temperature,"25.5"\n';
    const result = parseFluxCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].points[0].value).toBe(25.5);
    }
  });

  describe('boardId column (boards contract v2)', () => {
    const boardCsv =
      '#datatype,string,dateTime:RFC3339,string,string,string,double\n' +
      ',result,table,_time,_field,boardId,roomId,_value\n' +
      ',0,0,2026-08-28T00:00:00Z,temperature,board-1,room-living,25.5\n' +
      ',0,0,2026-08-28T00:00:01Z,temperature,board-1,room-living,25.7\n' +
      ',0,1,2026-08-28T00:00:00Z,temperature,board-2,room-bedroom,22.1\n';

    it('parses both tags and identifies series by (boardId ?? roomId) + field', () => {
      const result = parseFluxCsv(boardCsv, ['temperature']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const board1 = result.value.find(s => s.boardId === 'board-1');
        const board2 = result.value.find(s => s.boardId === 'board-2');
        expect(board1?.roomId).toBe('room-living');
        expect(board1?.field).toBe('temperature');
        expect(board1?.points).toEqual([
          { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 25.5 },
          { t: Date.parse('2026-08-28T00:00:01Z') / 1000, value: 25.7 },
        ]);
        expect(board2?.roomId).toBe('room-bedroom');
        expect(board2?.points).toEqual([
          { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 22.1 },
        ]);
      }
    });

    it('keeps same-field series with different boardIds separate', () => {
      const result = parseFluxCsv(boardCsv, ['temperature']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // board-1 and board-2 both report `temperature` — two series.
        expect(
          result.value.filter(s => s.field === 'temperature'),
        ).toHaveLength(2);
      }
    });

    it('treats a missing boardId cell as null (legacy rows keep pairing by roomId)', () => {
      const csv =
        ',result,table,_time,_field,boardId,roomId,_value\n' +
        ',0,0,2026-08-28T00:00:00Z,temperature,,room-living,25.5\n' +
        ',0,1,2026-08-28T00:00:00Z,temperature,board-1,room-living,20.0\n';
      const result = parseFluxCsv(csv, ['temperature']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const legacy = result.value.find(s => s.boardId === null);
        const bound = result.value.find(s => s.boardId === 'board-1');
        expect(legacy?.roomId).toBe('room-living');
        expect(legacy?.points).toEqual([
          { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 25.5 },
        ]);
        expect(bound?.roomId).toBe('room-living');
      }
    });

    it('separates series by boardId when roomId is absent but boardId differs', () => {
      const csv =
        ',result,table,_time,_field,boardId,_value\n' +
        ',0,0,2026-08-28T00:00:00Z,temperature,board-1,25.5\n' +
        ',0,1,2026-08-28T00:00:00Z,temperature,board-2,22.1\n';
      const result = parseFluxCsv(csv, ['temperature']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const board1 = result.value.find(s => s.boardId === 'board-1');
        expect(board1?.roomId).toBeNull();
        expect(board1?.points).toEqual([
          { t: Date.parse('2026-08-28T00:00:00Z') / 1000, value: 25.5 },
        ]);
      }
    });
  });
});
