/**
 * DeviceCommandServiceImpl tests.
 *
 * Verifies routing: relay-bound switch commands delegate to the relay
 * service with the ROOM-SCOPED address `{roomId, slot}`; unknown devices /
 * unsupported capability / non-relay binding / roomless relay devices
 * reject with the right AppError code.
 */

import { err, Errors, ok, type Result } from '@core/errors';

import type { RelayAddress, RelayService } from '@modules/relay/api';
import type { Device, Room } from '../domain/devices';
import { DeviceCommandServiceImpl } from './deviceCommandService';

class FakeRelayService implements RelayService {
  public calls: { address: RelayAddress; state: string }[] = [];
  public publishResult: Result<void> = ok(undefined);

  setRelay(address: RelayAddress, state: string): Result<void> {
    this.calls.push({ address, state });
    return this.publishResult;
  }
}

const relayDevice: Device = {
  id: 'relay-1',
  name: 'Đèn',
  roomId: 'room-living',
  type: 'relay',
  capabilities: ['switch'],
  binding: { kind: 'relay', index: 1 },
};

/** Roomless legacy relay record (unassign migration output). */
const roomlessRelay: Device = {
  id: 'relay-legacy',
  name: 'Rơ le cũ',
  type: 'relay',
  capabilities: ['switch'],
  binding: { kind: 'relay', index: 3 },
};

const sensorDevice: Device = {
  id: 'sensor-01',
  name: 'Cảm biến',
  roomId: 'room-living',
  type: 'sensor',
  capabilities: ['temperature', 'humidity'],
  binding: { kind: 'telemetry-sensor' },
};

function makeService(devices: readonly Device[], rooms: readonly Room[] = []) {
  const relay = new FakeRelayService();
  const service = new DeviceCommandServiceImpl({
    registry: {
      findDevice: id => devices.find(d => d.id === id),
      findRoom: id => rooms.find(r => r.id === id),
    },
    relayService: relay,
  });
  return { relay, service };
}

describe('DeviceCommandServiceImpl', () => {
  it('routes switch=true for a relay-bound device to its room-scoped slot', () => {
    const { relay, service } = makeService([relayDevice]);
    const result = service.sendCommand('relay-1', 'switch', true);
    expect(result.ok).toBe(true);
    expect(relay.calls).toEqual([
      { address: { roomId: 'room-living', index: 1 }, state: 'ON' },
    ]);
  });

  it('routes switch=false to OFF', () => {
    const { relay, service } = makeService([relayDevice]);
    const result = service.sendCommand('relay-1', 'switch', false);
    expect(result.ok).toBe(true);
    expect(relay.calls).toEqual([
      { address: { roomId: 'room-living', index: 1 }, state: 'OFF' },
    ]);
  });

  it('carries each device’s own room so equal slots never alias', () => {
    const kitchenRelay: Device = {
      ...relayDevice,
      id: 'relay-kitchen',
      roomId: 'room-kitchen',
      binding: { kind: 'relay', index: 1 },
    };
    const { relay, service } = makeService([relayDevice, kitchenRelay]);
    service.sendCommand('relay-kitchen', 'switch', true);
    service.sendCommand('relay-1', 'switch', true);
    expect(relay.calls).toEqual([
      { address: { roomId: 'room-kitchen', index: 1 }, state: 'ON' },
      { address: { roomId: 'room-living', index: 1 }, state: 'ON' },
    ]);
  });

  it('rejects a roomless legacy relay device with validation', () => {
    const { relay, service } = makeService([roomlessRelay]);
    const result = service.sendCommand('relay-legacy', 'switch', true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.message).toMatch(/no room/i);
    }
    expect(relay.calls).toHaveLength(0);
  });

  it('relays the publish failure to the caller (ISSUE-001)', () => {
    const { relay, service } = makeService([relayDevice]);
    relay.publishResult = err(Errors.network('MQTT client is not connected'));
    const result = service.sendCommand('relay-1', 'switch', true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
    }
  });

  it('rejects an unknown device with not-found', () => {
    const { relay, service } = makeService([relayDevice]);
    const result = service.sendCommand('ghost', 'switch', true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
    expect(relay.calls).toHaveLength(0);
  });

  it('rejects a non-switch capability with validation', () => {
    const { service } = makeService([relayDevice]);
    const result = service.sendCommand('relay-1', 'temperature', true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });

  it('rejects switch on a non-relay device with validation', () => {
    const { service } = makeService([sensorDevice]);
    const result = service.sendCommand('sensor-01', 'switch', true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
    }
  });
});

describe('DeviceCommandServiceImpl — board-code command topics (board-discovery-binding)', () => {
  const boundRoom: Room = {
    id: 'room-living',
    name: 'Phòng khách',
    order: 0,
    code: 'board-1',
  };

  it('addresses the relay command with the room CODE when bound (3d)', () => {
    const { relay, service } = makeService([relayDevice], [boundRoom]);
    const result = service.sendCommand('relay-1', 'switch', true);
    expect(result.ok).toBe(true);
    expect(relay.calls).toEqual([
      // The relay module publishes <prefix>/boards/<code>/relays/K<slot>/set.
      { address: { roomId: 'board-1', index: 1 }, state: 'ON' },
    ]);
  });

  it('keeps the internal room id for code-less rooms (regression)', () => {
    const unboundRoom: Room = { ...boundRoom, code: undefined };
    const { relay, service } = makeService([relayDevice], [unboundRoom]);
    const result = service.sendCommand('relay-1', 'switch', false);
    expect(result.ok).toBe(true);
    expect(relay.calls).toEqual([
      { address: { roomId: 'room-living', index: 1 }, state: 'OFF' },
    ]);
  });

  it('falls back to the device roomId when the room record is missing', () => {
    // Stale/legacy registry state: no room record. The topic id stays the
    // raw device roomId (previous behavior) instead of failing the command.
    const { relay, service } = makeService([relayDevice], []);
    const result = service.sendCommand('relay-1', 'switch', true);
    expect(result.ok).toBe(true);
    expect(relay.calls).toEqual([
      { address: { roomId: 'room-living', index: 1 }, state: 'ON' },
    ]);
  });
});
