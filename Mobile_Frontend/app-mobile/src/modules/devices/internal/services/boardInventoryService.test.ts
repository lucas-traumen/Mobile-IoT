/**
 * BoardInventoryService tests — descriptor-driven discovery
 * (boards-topic-contract-v2).
 *
 * Verifies: a valid RETAINED descriptor on
 * `<prefix>/boards/<id>/descriptor` creates/updates the board entry
 * (REPLACES the previous descriptor — no union) and marks a board without a
 * status message `seen`; plain `online`/`offline` status messages merge with
 * the descriptor in EITHER arrival order; invalid payloads (schemaVersion ≠
 * 1, topic/payload board-id mismatch, duplicate channels, malformed
 * channels) are warned + skipped, never thrown; telemetry/relay bus events
 * NO LONGER create entries (discovery is descriptor/status-driven only);
 * `startListeners` subscribes BOTH wildcards and `applyPrefix` re-subscribes
 * both; `resolveSensorField` maps a descriptor channel to its semantic
 * field.
 */

import { InMemoryEventBus } from '@core/eventbus';
import { ok, type Result } from '@core/errors';
import { createLogger } from '@core/logger';

import type {
  MqttClientPort,
  MqttConnectionConfig,
  MqttConnectionState,
  MqttMessage,
} from '@modules/telemetry/api';
import { createBoardStore } from '../ui/boardStore';
import { BoardInventoryService } from './boardInventoryService';

class FakeMqttClient implements MqttClientPort {
  public subscribedTopics: string[] = [];

  async connect(_config: MqttConnectionConfig): Promise<void> {}
  subscribe(topic: string): void {
    this.subscribedTopics.push(topic);
  }
  publish(_topic: string, _payload: string): Result<void> {
    return ok(undefined);
  }
  disconnect(): void {}
  onMessage(_handler: (message: MqttMessage) => void): void {}
  onStateChange(_handler: (state: MqttConnectionState) => void): void {}
}

function makeService(options?: {
  prefix?: string;
  getDeletedBoardCodes?: () => readonly string[];
}) {
  const bus = new InMemoryEventBus(createLogger('test'));
  const client = new FakeMqttClient();
  const store = createBoardStore();
  const changes: string[] = [];
  bus.subscribe('board:changed', event => changes.push(event.code));
  const service = new BoardInventoryService({
    client,
    bus,
    logger: createLogger('test'),
    store,
    prefix: options?.prefix ?? 'home',
    getDeletedBoardCodes: options?.getDeletedBoardCodes,
  });
  return { bus, client, store, changes, service };
}

const VALID_DESCRIPTOR = {
  schemaVersion: 1,
  boardId: 'board-1',
  boardType: 'esp32-sensor-relay',
  sensors: [
    { channel: 'S1', field: 'temperature', unit: '°C' },
    { channel: 'S2', field: 'humidity' },
  ],
  relays: [{ channel: 'K1' }, { channel: 'K2' }, { channel: 'K3' }],
  displayName: 'Phòng khách',
};

const descriptorMessage = (
  code: string,
  payload: unknown,
): { topic: string; payload: string } => ({
  topic: `home/boards/${code}/descriptor`,
  payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

const statusMessage = (
  code: string,
  payload: string,
): { topic: string; payload: string } => ({
  topic: `home/boards/${code}/status`,
  payload,
});

describe('BoardInventoryService — descriptor messages (retained)', () => {
  it('creates a `seen` entry from a valid descriptor', () => {
    const { store, changes, service } = makeService();
    const matched = service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );

    expect(matched).toBe(true);
    expect(store.getState().boards).toEqual([
      {
        code: 'board-1',
        status: 'seen',
        descriptor: {
          boardType: 'esp32-sensor-relay',
          sensors: [
            { channel: 'S1', field: 'temperature', unit: '°C' },
            { channel: 'S2', field: 'humidity' },
          ],
          relays: ['K1', 'K2', 'K3'],
          displayName: 'Phòng khách',
        },
      },
    ]);
    expect(changes).toEqual(['board-1']);
  });

  it('keeps the code visible and stores displayName as descriptor metadata', () => {
    const { store, service } = makeService();
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    const entry = store.getState().boards[0];
    expect(entry?.code).toBe('board-1');
    expect(entry?.descriptor?.displayName).toBe('Phòng khách');
  });

  it('REPLACES the previous descriptor (no union of stale channels)', () => {
    const { store, service } = makeService();
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    service.handleDescriptorMessage(
      descriptorMessage('board-1', {
        schemaVersion: 1,
        boardId: 'board-1',
        boardType: 'esp32-relay-only',
        sensors: [{ channel: 'S1', field: 'temperature' }],
        relays: [{ channel: 'K1' }],
      }),
    );

    expect(store.getState().boards[0]?.descriptor).toEqual({
      boardType: 'esp32-relay-only',
      sensors: [{ channel: 'S1', field: 'temperature' }],
      relays: ['K1'],
    });
  });

  it('rejects a topic/payload board-id mismatch (warn + skip)', () => {
    const { store, changes, service } = makeService();
    const matched = service.handleDescriptorMessage(
      descriptorMessage('board-1', { ...VALID_DESCRIPTOR, boardId: 'board-2' }),
    );

    expect(matched).toBe(true); // topic matched, payload rejected
    expect(store.getState().boards).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('rejects schemaVersion ≠ 1 (warn + skip)', () => {
    const { store, service } = makeService();
    const matched = service.handleDescriptorMessage(
      descriptorMessage('board-1', { ...VALID_DESCRIPTOR, schemaVersion: 2 }),
    );

    expect(matched).toBe(true);
    expect(store.getState().boards).toEqual([]);
  });

  it('rejects duplicate sensor channels (warn + skip)', () => {
    const { store, service } = makeService();
    const matched = service.handleDescriptorMessage(
      descriptorMessage('board-1', {
        ...VALID_DESCRIPTOR,
        sensors: [
          { channel: 'S1', field: 'temperature' },
          { channel: 'S1', field: 'humidity' },
        ],
      }),
    );

    expect(matched).toBe(true);
    expect(store.getState().boards).toEqual([]);
  });

  it('rejects duplicate relay channels (warn + skip)', () => {
    const { store, service } = makeService();
    const matched = service.handleDescriptorMessage(
      descriptorMessage('board-1', {
        ...VALID_DESCRIPTOR,
        relays: [{ channel: 'K1' }, { channel: 'K1' }],
      }),
    );

    expect(matched).toBe(true);
    expect(store.getState().boards).toEqual([]);
  });

  it('rejects malformed sensor/relay channel formats (warn + skip)', () => {
    const { store, service } = makeService();
    expect(
      service.handleDescriptorMessage(
        descriptorMessage('board-1', {
          ...VALID_DESCRIPTOR,
          sensors: [{ channel: 'S0', field: 'temperature' }],
        }),
      ),
    ).toBe(true);
    expect(
      service.handleDescriptorMessage(
        descriptorMessage('board-1', {
          ...VALID_DESCRIPTOR,
          sensors: [{ channel: 'S01', field: 'temperature' }],
        }),
      ),
    ).toBe(true);
    expect(
      service.handleDescriptorMessage(
        descriptorMessage('board-1', {
          ...VALID_DESCRIPTOR,
          relays: [{ channel: 'K11' }],
        }),
      ),
    ).toBe(true);
    expect(
      service.handleDescriptorMessage(
        descriptorMessage('board-1', {
          ...VALID_DESCRIPTOR,
          relays: [{ channel: '1' }],
        }),
      ),
    ).toBe(true);
    expect(store.getState().boards).toEqual([]);
  });

  it('rejects invalid payloads (bad JSON, missing fields) without throwing', () => {
    const { store, service } = makeService();
    expect(
      service.handleDescriptorMessage(
        descriptorMessage('board-1', '{not-json'),
      ),
    ).toBe(true);
    expect(
      service.handleDescriptorMessage(
        descriptorMessage('board-1', { schemaVersion: 1 }),
      ),
    ).toBe(true);
    expect(store.getState().boards).toEqual([]);
  });

  it('ignores descriptor topics under another prefix / wrong shape', () => {
    const { store, service } = makeService({ prefix: 'home' });
    expect(
      service.handleDescriptorMessage({
        topic: 'other/boards/board-1/descriptor',
        payload: JSON.stringify(VALID_DESCRIPTOR),
      }),
    ).toBe(false);
    expect(
      service.handleDescriptorMessage({
        topic: 'home/boards/board-1/status',
        payload: JSON.stringify(VALID_DESCRIPTOR),
      }),
    ).toBe(false);
    expect(store.getState().boards).toEqual([]);
  });
});

describe('BoardInventoryService — status messages (retained, plain text primary)', () => {
  it('records an online board from a bare "online" payload', () => {
    const { store, changes, service } = makeService();
    const matched = service.handleStatusMessage(
      statusMessage('board-1', 'online'),
    );

    expect(matched).toBe(true);
    expect(store.getState().boards).toEqual([
      { code: 'board-1', status: 'online' },
    ]);
    expect(changes).toEqual(['board-1']);
  });

  it('tolerates the JSON {"status":...} shape defensively', () => {
    const { store, service } = makeService();
    service.handleStatusMessage(
      statusMessage('board-1', '{"status":"online"}'),
    );
    expect(store.getState().boards[0]?.status).toBe('online');
    service.handleStatusMessage(statusMessage('board-1', 'offline'));
    expect(store.getState().boards[0]?.status).toBe('offline');
  });

  it('skips an INVALID payload with a warn and keeps the previous entry', () => {
    const { store, changes, service } = makeService();
    service.handleStatusMessage(statusMessage('board-1', 'online'));
    const matched = service.handleStatusMessage(
      statusMessage('board-1', '{"status":"away"}'),
    );

    expect(matched).toBe(true); // Topic matched, payload rejected.
    expect(changes).toEqual(['board-1']);
    expect(store.getState().boards[0]?.status).toBe('online');
  });

  it('ignores status messages under another prefix (legacy room shape dropped)', () => {
    const { store, service } = makeService({ prefix: 'home' });
    const matched = service.handleStatusMessage({
      topic: 'other/boards/board-1/status',
      payload: 'online',
    });
    expect(matched).toBe(false);
    // The legacy `<prefix>/room/<code>/status` shape no longer matches.
    expect(
      service.handleStatusMessage({
        topic: 'home/room/board-1/status',
        payload: 'online',
      }),
    ).toBe(false);
    expect(store.getState().boards).toEqual([]);
  });
});

describe('BoardInventoryService — merge on partial arrival (either order)', () => {
  it('status first, then descriptor keeps status and adds the descriptor', () => {
    const { store, service } = makeService();
    service.handleStatusMessage(statusMessage('board-1', 'online'));
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );

    const entry = store.getState().boards[0];
    expect(entry?.status).toBe('online');
    expect(entry?.descriptor?.boardType).toBe('esp32-sensor-relay');
  });

  it('descriptor first (`seen`), then status flips the badge only', () => {
    const { store, service } = makeService();
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    expect(store.getState().boards[0]?.status).toBe('seen');

    service.handleStatusMessage(statusMessage('board-1', 'offline'));
    const entry = store.getState().boards[0];
    expect(entry?.status).toBe('offline');
    expect(entry?.descriptor?.sensors).toHaveLength(2);
  });

  it('a late status does not drop the descriptor', () => {
    const { store, service } = makeService();
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    service.handleStatusMessage(statusMessage('board-1', 'online'));
    service.handleStatusMessage(statusMessage('board-1', 'offline'));

    expect(store.getState().boards[0]?.descriptor?.displayName).toBe(
      'Phòng khách',
    );
  });
});

describe('BoardInventoryService — no bus inference (descriptor-driven only)', () => {
  it('telemetry readings no longer create or mutate entries', () => {
    const { bus, store, changes } = makeService();
    bus.emit('telemetry:received', {
      roomId: 'board-7',
      field: 'temperature',
      value: 26,
    });

    expect(store.getState().boards).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('relay feedback/commands no longer create or mutate entries', () => {
    const { bus, store, changes } = makeService();
    bus.emit('relay:feedback', { roomId: 'board-7', index: 2, state: 'ON' });
    bus.emit('relay:command', { roomId: 'board-7', index: 2, state: 'OFF' });

    expect(store.getState().boards).toEqual([]);
    expect(changes).toEqual([]);
  });
});

describe('BoardInventoryService — local board deletion tombstones', () => {
  it('keeps deleted boards hidden while retained MQTT messages continue', () => {
    const { store, changes, service } = makeService({
      getDeletedBoardCodes: () => ['board-1'],
    });

    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    service.handleStatusMessage(statusMessage('board-1', 'online'));
    service.handleStatusMessage(statusMessage('board-1', 'online'));

    expect(store.getState().boards).toEqual([]);
    expect(service.getBoards()).toEqual([]);
    expect(service.resolveSensorField('board-1', 'S1')).toBeNull();
    expect(changes).toEqual(['board-1', 'board-1']);
  });

  it('seeds a hidden board from QR data and reveals it after restoration', () => {
    const deletedCodes = ['board-1'];
    const { bus, store, service } = makeService({
      getDeletedBoardCodes: () => deletedCodes,
    });

    service.restoreFromQr('board-1', 'esp32-sensor-relay');
    expect(store.getState().boards).toEqual([]);

    deletedCodes.length = 0;
    bus.emit('devices:changed', { removedDeviceIds: [], removedBindings: [] });

    expect(store.getState().boards).toEqual([
      {
        code: 'board-1',
        status: 'seen',
        descriptor: {
          boardType: 'esp32-sensor-relay',
          sensors: [],
          relays: [],
        },
      },
    ]);
  });

  it('seeds a hidden board from BLE alone (no QR label type) so the card returns', () => {
    const deletedCodes = ['board-1'];
    const { bus, store, service } = makeService({
      getDeletedBoardCodes: () => deletedCodes,
    });

    service.restoreFromQr('board-1');
    expect(store.getState().boards).toEqual([]);

    deletedCodes.length = 0;
    bus.emit('devices:changed', { removedDeviceIds: [], removedBindings: [] });

    expect(store.getState().boards).toEqual([
      {
        code: 'board-1',
        status: 'seen',
        descriptor: { boardType: '', sensors: [], relays: [] },
      },
    ]);
  });

  it('refreshes visibility when the device registry changes its tombstones', () => {
    const deletedCodes: string[] = [];
    const { bus, store, service } = makeService({
      getDeletedBoardCodes: () => deletedCodes,
    });
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    expect(store.getState().boards).toHaveLength(1);

    deletedCodes.push('board-1');
    bus.emit('devices:changed', { removedDeviceIds: [], removedBindings: [] });
    expect(store.getState().boards).toEqual([]);

    deletedCodes.length = 0;
    bus.emit('devices:changed', { removedDeviceIds: [], removedBindings: [] });
    expect(store.getState().boards).toHaveLength(1);
  });
});

describe('BoardInventoryService — duplicate upserts do not re-emit (change-detect)', () => {
  it('a duplicate identical STATUS does not re-emit board:changed', () => {
    const { store, changes, service } = makeService();

    service.handleStatusMessage(statusMessage('board-1', 'online'));
    expect(changes).toEqual(['board-1']);

    // The same retained status delivered again: no real change → the
    // mirror store is untouched and NO second board:changed fires.
    service.handleStatusMessage(statusMessage('board-1', 'online'));
    expect(changes).toEqual(['board-1']);
    expect(store.getState().boards[0]?.status).toBe('online');

    // A real change still emits.
    service.handleStatusMessage(statusMessage('board-1', 'offline'));
    expect(changes).toEqual(['board-1', 'board-1']);
  });

  it('a duplicate identical DESCRIPTOR does not re-emit board:changed', () => {
    const { store, changes, service } = makeService();

    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    expect(changes).toEqual(['board-1']);

    // The same retained descriptor delivered again (broker re-send /
    // reconnect replay): content-identical → NO second board:changed.
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );
    expect(changes).toEqual(['board-1']);
    expect(store.getState().boards[0]?.descriptor?.boardType).toBe(
      'esp32-sensor-relay',
    );

    // A genuinely different descriptor is a real change and still emits.
    service.handleDescriptorMessage(
      descriptorMessage('board-1', {
        ...VALID_DESCRIPTOR,
        relays: [{ channel: 'K1' }],
      }),
    );
    expect(changes).toEqual(['board-1', 'board-1']);
    expect(store.getState().boards[0]?.descriptor?.relays).toEqual(['K1']);
  });
});

describe('BoardInventoryService — resolveSensorField', () => {
  it('maps a descriptor channel to its semantic field', () => {
    const { service } = makeService();
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );

    expect(service.resolveSensorField('board-1', 'S1')).toBe('temperature');
    expect(service.resolveSensorField('board-1', 'S2')).toBe('humidity');
  });

  it('returns null for an unknown board/channel and rejects invalid channels', () => {
    const { service } = makeService();
    service.handleDescriptorMessage(
      descriptorMessage('board-1', VALID_DESCRIPTOR),
    );

    expect(service.resolveSensorField('board-1', 'S9')).toBeNull();
    expect(service.resolveSensorField('ghost', 'S1')).toBeNull();
    expect(service.resolveSensorField('board-1', 'S0')).toBeNull();
    expect(service.resolveSensorField('board-1', '')).toBeNull();
  });
});

describe('BoardInventoryService — subscription discipline (B1/M2)', () => {
  it('startListeners subscribes BOTH the descriptor and status wildcards', () => {
    const { client, service } = makeService({ prefix: 'home' });
    service.startListeners();

    expect(client.subscribedTopics).toEqual([
      'home/boards/+/descriptor',
      'home/boards/+/status',
    ]);
  });

  it('re-subscribes BOTH wildcards with the NEW prefix on applyPrefix', () => {
    const { client, service } = makeService({ prefix: 'home' });
    service.startListeners();
    service.applyPrefix('smarthome');
    service.startListeners();

    expect(client.subscribedTopics).toEqual([
      'home/boards/+/descriptor',
      'home/boards/+/status',
      'smarthome/boards/+/descriptor',
      'smarthome/boards/+/status',
      'smarthome/boards/+/descriptor',
      'smarthome/boards/+/status',
    ]);
  });

  it('routes both message kinds by the CURRENT prefix after applyPrefix', () => {
    const { store, service } = makeService({ prefix: 'home' });
    service.applyPrefix('smarthome');

    service.handleDescriptorMessage({
      topic: 'smarthome/boards/board-2/descriptor',
      payload: JSON.stringify({
        schemaVersion: 1,
        boardId: 'board-2',
        boardType: 'esp32',
        sensors: [],
        relays: [{ channel: 'K1' }],
      }),
    });
    service.handleStatusMessage({
      topic: 'smarthome/boards/board-2/status',
      payload: 'online',
    });

    expect(store.getState().boards.map(board => board.code)).toEqual([
      'board-2',
    ]);
    expect(store.getState().boards[0]?.status).toBe('online');
  });
});
