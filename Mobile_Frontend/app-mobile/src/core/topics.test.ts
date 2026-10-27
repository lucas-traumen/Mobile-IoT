/**
 * Boards-contract topic builder/parser tests (boards-topic-contract-v2):
 * every builder produces the exact wire shape, every parser enforces the
 * configured prefix (exact), the exact segment structure, non-empty segments
 * free of MQTT wildcards, and the strict `S<positive int>` channel grammar
 * (S0 and leading-zero forms like S01 are rejected).
 */

import {
  SENSOR_CHANNEL_REGEX,
  boardStatusSubscriptionTopic,
  boardStatusTopic,
  descriptorSubscriptionTopic,
  descriptorTopic,
  isSensorChannel,
  parseBoardStatusTopic,
  parseDescriptorTopic,
  parseSensorStateTopic,
  sensorStateSubscriptionTopic,
  sensorStateTopic,
  sensorStateTopicShape,
} from './topics';

describe('descriptor topics', () => {
  it('builds the per-board descriptor topic', () => {
    expect(descriptorTopic('smarthome', 'board-1')).toBe(
      'smarthome/boards/board-1/descriptor',
    );
  });

  it('builds the descriptor wildcard', () => {
    expect(descriptorSubscriptionTopic('smarthome')).toBe(
      'smarthome/boards/+/descriptor',
    );
  });

  it('parses a well-formed descriptor topic into its board id', () => {
    expect(
      parseDescriptorTopic('smarthome/boards/board-1/descriptor', 'smarthome'),
    ).toEqual({
      ok: true,
      value: 'board-1',
    });
  });

  it('rejects wrong prefixes, malformed shapes and wildcard-like segments', () => {
    expect(
      parseDescriptorTopic('home/boards/board-1/descriptor', 'smarthome').ok,
    ).toBe(false);
    expect(
      parseDescriptorTopic('smarthome/boards/board-1', 'smarthome').ok,
    ).toBe(false);
    expect(
      parseDescriptorTopic('smarthome/boards/board-1/status', 'smarthome').ok,
    ).toBe(false);
    expect(
      parseDescriptorTopic(
        'smarthome/boards/board-1/descriptor/extra',
        'smarthome',
      ).ok,
    ).toBe(false);
    expect(
      parseDescriptorTopic('smarthome/boards//descriptor', 'smarthome').ok,
    ).toBe(false);
    expect(
      parseDescriptorTopic('smarthome/boards/+/descriptor', 'smarthome').ok,
    ).toBe(false);
  });
});

describe('sensor state topics', () => {
  it('builds the per-channel sensor state topic', () => {
    expect(sensorStateTopic('smarthome', 'board-1', 'S2')).toBe(
      'smarthome/boards/board-1/sensors/S2/state',
    );
  });

  it('builds the sensor wildcard', () => {
    expect(sensorStateSubscriptionTopic('smarthome')).toBe(
      'smarthome/boards/+/sensors/+/state',
    );
  });
});

describe('board status topics (boards contract)', () => {
  it('builds the per-board status topic', () => {
    expect(boardStatusTopic('smarthome', 'board-1')).toBe(
      'smarthome/boards/board-1/status',
    );
  });

  it('builds the status wildcard', () => {
    expect(boardStatusSubscriptionTopic('smarthome')).toBe(
      'smarthome/boards/+/status',
    );
  });

  it('parses a well-formed status topic into its board id', () => {
    expect(parseBoardStatusTopic('home/boards/esp-32/status', 'home')).toEqual({
      ok: true,
      value: 'esp-32',
    });
  });

  it('rejects the legacy room-shape status topic (clean cut)', () => {
    expect(parseBoardStatusTopic('home/room/board-1/status', 'home').ok).toBe(
      false,
    );
  });

  it('rejects wrong prefixes, malformed shapes and wildcard-like segments', () => {
    expect(parseBoardStatusTopic('other/boards/b1/status', 'home').ok).toBe(
      false,
    );
    expect(parseBoardStatusTopic('home/boards/b1', 'home').ok).toBe(false);
    expect(parseBoardStatusTopic('home/boards/b1/stat', 'home').ok).toBe(false);
    expect(
      parseBoardStatusTopic('home/boards/b1/status/extra', 'home').ok,
    ).toBe(false);
    expect(parseBoardStatusTopic('home/boards//status', 'home').ok).toBe(false);
    expect(parseBoardStatusTopic('home/boards/+/status', 'home').ok).toBe(
      false,
    );
  });
});

describe('sensor channel grammar', () => {
  it('accepts S1..S999 (positive int, no leading zeros)', () => {
    expect(isSensorChannel('S1')).toBe(true);
    expect(isSensorChannel('S2')).toBe(true);
    expect(isSensorChannel('S10')).toBe(true);
    expect(isSensorChannel('S999')).toBe(true);
  });

  it('rejects S0, leading zeros, missing S and non-numeric forms', () => {
    expect(isSensorChannel('S0')).toBe(false);
    expect(isSensorChannel('S01')).toBe(false);
    expect(isSensorChannel('S')).toBe(false);
    expect(isSensorChannel('1')).toBe(false);
    expect(isSensorChannel('s1')).toBe(false);
    expect(isSensorChannel('S1a')).toBe(false);
    expect(isSensorChannel('S-1')).toBe(false);
    expect(isSensorChannel('')).toBe(false);
  });

  it('exports the regex as the single channel authority', () => {
    expect(SENSOR_CHANNEL_REGEX.test('S7')).toBe(true);
    expect(SENSOR_CHANNEL_REGEX.test('S07')).toBe(false);
  });
});

describe('parseSensorStateTopic', () => {
  it('parses a well-formed topic into {boardId, channel}', () => {
    expect(
      parseSensorStateTopic('home/boards/esp-32/sensors/S1/state', 'home'),
    ).toEqual({ ok: true, value: { boardId: 'esp-32', channel: 'S1' } });
  });

  it('rejects the legacy room-shape sensor topic (clean cut)', () => {
    expect(
      parseSensorStateTopic('home/room/r1/sensor/temperature', 'home').ok,
    ).toBe(false);
  });

  it('rejects wrong prefixes and malformed shapes', () => {
    expect(
      parseSensorStateTopic('other/boards/b1/sensors/S1/state', 'home').ok,
    ).toBe(false);
    expect(parseSensorStateTopic('home/boards/b1/sensors/S1', 'home').ok).toBe(
      false,
    );
    expect(
      parseSensorStateTopic('home/boards/b1/sensors/S1/set', 'home').ok,
    ).toBe(false);
    expect(
      parseSensorStateTopic('home/boards/b1/sensors/S1/state/extra', 'home').ok,
    ).toBe(false);
    expect(
      parseSensorStateTopic('home/boards/b1/relays/K1/state', 'home').ok,
    ).toBe(false);
  });

  it('rejects empty and wildcard-like segments', () => {
    expect(
      parseSensorStateTopic('home/boards//sensors/S1/state', 'home').ok,
    ).toBe(false);
    expect(
      parseSensorStateTopic('home/boards/b1/sensors//state', 'home').ok,
    ).toBe(false);
    expect(
      parseSensorStateTopic('home/boards/+/sensors/S1/state', 'home').ok,
    ).toBe(false);
    expect(
      parseSensorStateTopic('home/boards/b1/sensors/S+1/state', 'home').ok,
    ).toBe(false);
  });

  it('rejects invalid channels (S0, leading zeros, junk)', () => {
    expect(
      parseSensorStateTopic('home/boards/b1/sensors/S0/state', 'home').ok,
    ).toBe(false);
    expect(
      parseSensorStateTopic('home/boards/b1/sensors/S01/state', 'home').ok,
    ).toBe(false);
    expect(
      parseSensorStateTopic('home/boards/b1/sensors/temperature/state', 'home')
        .ok,
    ).toBe(false);
  });
});

describe('sensorStateTopicShape (lenient — telemetry warn/noise split)', () => {
  it('matches the sensor-state structure WITHOUT channel validation', () => {
    expect(
      sensorStateTopicShape('home/boards/b1/sensors/S0/state', 'home'),
    ).toEqual({ boardId: 'b1', channel: 'S0' });
    expect(
      sensorStateTopicShape('home/boards/b1/sensors/S1/state', 'home'),
    ).toEqual({ boardId: 'b1', channel: 'S1' });
  });

  it('returns null for anything that is not a sensor-state topic shape', () => {
    expect(sensorStateTopicShape('home/boards/b1/status', 'home')).toBeNull();
    expect(
      sensorStateTopicShape('home/boards/b1/relays/K1/state', 'home'),
    ).toBeNull();
    expect(
      sensorStateTopicShape('home/room/b1/sensor/temperature', 'home'),
    ).toBeNull();
    expect(
      sensorStateTopicShape('home/boards/b1/descriptor', 'home'),
    ).toBeNull();
  });
});
