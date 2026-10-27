/**
 * Relay domain topic tests — boards contract v2 (boards-topic-contract-v2).
 *
 * The wire identity is the board id (the RelayAddress.roomId carries the
 * room's MQTT identity — the board code for bound rooms, the internal id for
 * unbound demo rooms). Channels are wire `K<n>` strings (K1..K10) mapped to
 * the persisted numeric slot 1..10.
 */

import {
  buildRelayAddress,
  buildRelayCommand,
  buildRelaySetTopic,
  buildRelayStateTopic,
  isRelayChannel,
  isRelayIndex,
  isRelayRoomId,
  isRelayState,
  parseRelayChannel,
  parseRelayStatePayload,
  parseRelayStateTopic,
  relayIndexToChannel,
  relayStateSubscriptionTopic,
} from './commands';

const BOARD_A = 'board-1';
const BOARD_B = 'room-bedroom'; // unbound demo room: internal id on the wire

describe('K-channel ↔ RelayIndex mapping', () => {
  it('maps K1→1 … K10→10', () => {
    expect(relayIndexOfChannelOrThrow('K1')).toBe(1);
    expect(relayIndexOfChannelOrThrow('K10')).toBe(10);
  });

  it('maps index → channel label (K1..K10)', () => {
    expect(relayIndexToChannel(1)).toBe('K1');
    expect(relayIndexToChannel(10)).toBe('K10');
  });

  it('rejects invalid channels (K0, K11, k1, leading zeros, junk)', () => {
    expect(isRelayChannel('K0')).toBe(false);
    expect(isRelayChannel('K11')).toBe(false);
    expect(isRelayChannel('k1')).toBe(false);
    expect(isRelayChannel('K01')).toBe(false);
    expect(isRelayChannel('K')).toBe(false);
    expect(isRelayChannel('1')).toBe(false);
    expect(isRelayChannel('')).toBe(false);
    expect(parseRelayChannel('K11').ok).toBe(false);
    expect(parseRelayChannel('Kx').ok).toBe(false);
  });

  it('rejects invalid indices for channel conversion', () => {
    expect(relayIndexToChannel(0 as 1)).toBeNull();
    expect(relayIndexToChannel(11 as 1)).toBeNull();
  });

  function relayIndexOfChannelOrThrow(channel: string): number {
    const parsed = parseRelayChannel(channel);
    if (!parsed.ok) {
      throw new Error(`expected ${channel} to parse`);
    }
    return parsed.value;
  }
});

describe('buildRelayAddress (unchanged contract)', () => {
  it('builds board-scoped addresses for slots 1..10', () => {
    for (let index = 1; index <= 10; index++) {
      expect(buildRelayAddress(BOARD_A, index)).toEqual({
        ok: true,
        value: { roomId: BOARD_A, index },
      });
    }
  });

  it('rejects slots 0 and 11 (outside 1..10)', () => {
    expect(buildRelayAddress(BOARD_A, 0).ok).toBe(false);
    expect(buildRelayAddress(BOARD_A, 11).ok).toBe(false);
    expect(buildRelayAddress(BOARD_A, -1).ok).toBe(false);
  });

  it('rejects non-integer slots', () => {
    expect(buildRelayAddress(BOARD_A, NaN).ok).toBe(false);
    expect(buildRelayAddress(BOARD_A, 1.5).ok).toBe(false);
    // @ts-expect-error – deliberately passing a string at runtime
    expect(buildRelayAddress(BOARD_A, '2').ok).toBe(false);
  });

  it('rejects malformed board ids (empty, separators, wildcards)', () => {
    expect(buildRelayAddress('', 1).ok).toBe(false);
    expect(buildRelayAddress('board/evil', 1).ok).toBe(false);
    expect(buildRelayAddress('board+', 1).ok).toBe(false);
    expect(buildRelayAddress('board#', 1).ok).toBe(false);
  });
});

describe('isRelayRoomId (unchanged contract)', () => {
  it('accepts normal board ids', () => {
    expect(isRelayRoomId('board-1')).toBe(true);
    expect(isRelayRoomId('room_1')).toBe(true);
  });

  it('rejects empty/separator/wildcard board ids', () => {
    expect(isRelayRoomId('')).toBe(false);
    expect(isRelayRoomId('a/b')).toBe(false);
    expect(isRelayRoomId('a+b')).toBe(false);
    expect(isRelayRoomId('a#b')).toBe(false);
  });
});

describe('buildRelayCommand (unchanged contract)', () => {
  it('builds ON/OFF commands for a board-scoped slot', () => {
    expect(buildRelayCommand(BOARD_A, 1, 'ON')).toEqual({
      ok: true,
      value: { roomId: BOARD_A, index: 1, state: 'ON' },
    });
    expect(buildRelayCommand(BOARD_B, 10, 'OFF')).toEqual({
      ok: true,
      value: { roomId: BOARD_B, index: 10, state: 'OFF' },
    });
  });

  it('rejects slots outside 1..10 and unknown states', () => {
    expect(buildRelayCommand(BOARD_A, 0, 'ON').ok).toBe(false);
    expect(buildRelayCommand(BOARD_A, 11, 'ON').ok).toBe(false);
    expect(buildRelayCommand('', 1, 'ON').ok).toBe(false);
    expect(buildRelayCommand(BOARD_A, 1, 'TOGGLE').ok).toBe(false);
    expect(buildRelayCommand(BOARD_A, 1, 'on').ok).toBe(false); // uppercase only
  });
});

describe('relay topics (boards contract)', () => {
  it('builds the exact set topic `<prefix>/boards/<boardId>/relays/K<n>/set`', () => {
    expect(
      buildRelaySetTopic('smarthome', { roomId: BOARD_A, index: 1 }),
    ).toEqual({
      ok: true,
      value: 'smarthome/boards/board-1/relays/K1/set',
    });
    expect(buildRelaySetTopic('home', { roomId: BOARD_B, index: 10 })).toEqual({
      ok: true,
      value: 'home/boards/room-bedroom/relays/K10/set',
    });
  });

  it('builds the exact state topic `<prefix>/boards/<boardId>/relays/K<n>/state`', () => {
    expect(
      buildRelayStateTopic('smarthome', { roomId: BOARD_A, index: 2 }),
    ).toEqual({
      ok: true,
      value: 'smarthome/boards/board-1/relays/K2/state',
    });
  });

  it('rejects slots outside 1..10, malformed ids and an empty prefix', () => {
    expect(
      buildRelaySetTopic('home', { roomId: BOARD_A, index: 0 as 1 }).ok,
    ).toBe(false);
    expect(
      buildRelaySetTopic('home', { roomId: BOARD_A, index: 11 as 1 }).ok,
    ).toBe(false);
    expect(buildRelaySetTopic('home', { roomId: '', index: 1 }).ok).toBe(false);
    expect(buildRelaySetTopic('home', { roomId: 'a/b', index: 1 }).ok).toBe(
      false,
    );
    expect(buildRelaySetTopic('', { roomId: BOARD_A, index: 1 }).ok).toBe(
      false,
    );
    expect(
      buildRelayStateTopic('home', { roomId: BOARD_A, index: 11 as 1 }).ok,
    ).toBe(false);
  });
});

describe('relayStateSubscriptionTopic', () => {
  it('wildcards board + channel with the configured prefix', () => {
    expect(relayStateSubscriptionTopic('smarthome')).toBe(
      'smarthome/boards/+/relays/+/state',
    );
    expect(relayStateSubscriptionTopic('factory/house-a')).toBe(
      'factory/house-a/boards/+/relays/+/state',
    );
  });
});

describe('parseRelayStateTopic', () => {
  it('extracts the board-scoped address from a state topic', () => {
    expect(
      parseRelayStateTopic('home/boards/board-1/relays/K2/state', 'home'),
    ).toEqual({
      ok: true,
      value: { roomId: 'board-1', index: 2 },
    });
    expect(
      parseRelayStateTopic('home/boards/kitchen/relays/K10/state', 'home'),
    ).toEqual({
      ok: true,
      value: { roomId: 'kitchen', index: 10 },
    });
  });

  it('rejects wrong prefixes', () => {
    expect(
      parseRelayStateTopic('office/boards/board-1/relays/K2/state', 'home').ok,
    ).toBe(false);
  });

  it('rejects the legacy room-shape stat topic (clean cut)', () => {
    expect(parseRelayStateTopic('home/room/r1/stat/relay/2', 'home').ok).toBe(
      false,
    );
  });

  it('rejects set topics and foreign topic structures', () => {
    expect(parseRelayStateTopic('home/tele/sensor', 'home').ok).toBe(false);
    expect(
      parseRelayStateTopic('home/boards/board-1/relays/K2/set', 'home').ok,
    ).toBe(false);
    expect(
      parseRelayStateTopic('home/boards/board-1/relays/K2', 'home').ok,
    ).toBe(false);
    expect(
      parseRelayStateTopic('home/boards/board-1/relays/K2/state/extra', 'home')
        .ok,
    ).toBe(false);
    expect(
      parseRelayStateTopic('home/boards/board-1/descriptor', 'home').ok,
    ).toBe(false);
  });

  it('rejects channels outside K1..K10', () => {
    expect(
      parseRelayStateTopic('home/boards/b/relays/K0/state', 'home').ok,
    ).toBe(false);
    expect(
      parseRelayStateTopic('home/boards/b/relays/K11/state', 'home').ok,
    ).toBe(false);
    expect(
      parseRelayStateTopic('home/boards/b/relays/K01/state', 'home').ok,
    ).toBe(false);
    expect(parseRelayStateTopic('home/boards/b/relays//state', 'home').ok).toBe(
      false,
    );
  });

  it('rejects an empty board segment and wildcard-like segments', () => {
    expect(
      parseRelayStateTopic('home/boards//relays/K1/state', 'home').ok,
    ).toBe(false);
    expect(
      parseRelayStateTopic('home/boards/+/relays/K1/state', 'home').ok,
    ).toBe(false);
  });

  it('escapes regex metacharacters in the configured prefix', () => {
    expect(
      parseRelayStateTopic('aXb/boards/kitchen/relays/K1/state', 'a.b').ok,
    ).toBe(false);
    expect(
      parseRelayStateTopic('a.b/boards/kitchen/relays/K1/state', 'a.b'),
    ).toEqual({
      ok: true,
      value: { roomId: 'kitchen', index: 1 },
    });
  });
});

describe('guards (unchanged contract)', () => {
  it('isRelayIndex matches only 1..10', () => {
    expect(isRelayIndex(1)).toBe(true);
    expect(isRelayIndex(10)).toBe(true);
    expect(isRelayIndex(0)).toBe(false);
    expect(isRelayIndex(11)).toBe(false);
  });

  it('isRelayState matches ON/OFF only', () => {
    expect(isRelayState('ON')).toBe(true);
    expect(isRelayState('OFF')).toBe(true);
    expect(isRelayState('on')).toBe(false);
    expect(isRelayState('TOGGLE')).toBe(false);
  });
});

describe('parseRelayStatePayload (unchanged contract)', () => {
  it('parses ON/OFF (case-insensitive, trimmed)', () => {
    expect(parseRelayStatePayload('ON')).toEqual({ ok: true, value: 'ON' });
    expect(parseRelayStatePayload(' off ')).toEqual({ ok: true, value: 'OFF' });
  });

  it('rejects anything else', () => {
    expect(parseRelayStatePayload('MAYBE').ok).toBe(false);
    expect(parseRelayStatePayload('1').ok).toBe(false);
  });
});
