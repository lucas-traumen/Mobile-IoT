/**
 * Device command service — routes capability commands to the right sink.
 *
 * Only `switch` commands on relay-bound devices are supported today: they are
 * delegated to the relay module (via its public facade). Anything else is
 * rejected with a `validation` error so callers can surface it inline
 * (closes ISSUE-001: UI must see the failure, not silently ignore it).
 */

import type { AppError, Result } from '@core/errors';
import { Errors, err } from '@core/errors';
import type { RelayService } from '@modules/relay/api';

import type { CapabilityType, Device, Room } from '../domain/devices';
import { mqttRoomIdOf } from '../domain/devices';

/** Registry access needed by the command service (narrow dependency). */
export interface DeviceCommandRegistry {
  findDevice(id: string): Device | undefined;
  /**
   * Room lookup (board-discovery-binding plan): the relay command topic
   * carries the room's MQTT identity (`mqttRoomIdOf`), so the service must
   * be able to resolve the device's room record.
   */
  findRoom(id: string): Room | undefined;
}

/** Route a capability command to its sink (relay today). */
export class DeviceCommandServiceImpl {
  private readonly registry: DeviceCommandRegistry;
  private readonly relayService: RelayService;

  constructor(options: {
    registry: DeviceCommandRegistry;
    relayService: RelayService;
  }) {
    this.registry = options.registry;
    this.relayService = options.relayService;
  }

  /**
   * Send a command to a device capability.
   *
   * @param deviceId - target device.
   * @param capability - the capability to command (only `switch` is supported).
   * @param value - boolean payload (react-native Switch style).
   * @returns `ok(void)` when routed; `err` with code `not-found` for unknown
   *   devices, or `validation` for unsupported capability / binding / a
   *   relay device without a room (roomless legacy records cannot address a
   *   room-scoped relay topic — assign the device to a room first).
   */
  sendCommand(
    deviceId: string,
    capability: CapabilityType,
    value: boolean,
  ): Result<void, AppError> {
    const device = this.registry.findDevice(deviceId);
    if (!device) {
      return err(Errors.notFound(`Device "${deviceId}" does not exist`));
    }
    if (capability !== 'switch') {
      return err(
        Errors.validation(
          `Capability "${capability}" cannot be commanded (only "switch" is supported)`,
        ),
      );
    }
    if (device.binding.kind !== 'relay') {
      return err(
        Errors.validation(
          `Device "${device.name}" is not relay-bound; cannot send switch commands`,
        ),
      );
    }
    if (!device.roomId) {
      return err(
        Errors.validation(
          `Device "${device.name}" has no room; assign it to a room to command its relay slot`,
        ),
      );
    }
    // Board-discovery-binding identity: the command topic must address the
    // room's MQTT identity — the board `code` when the room is bound, the
    // internal room id otherwise (unbound seed demo rooms). A missing room
    // record (stale legacy state) falls back to the raw device roomId so
    // the command never silently degrades.
    const room = this.registry.findRoom(device.roomId);
    const mqttRoomId = room ? mqttRoomIdOf(room) : device.roomId;
    // Room-scoped relay address (value object): `{roomId, slot}` travels to
    // the relay module so equal slots in separate rooms never alias.
    return this.relayService.setRelay(
      { roomId: mqttRoomId, index: device.binding.index },
      value ? 'ON' : 'OFF',
    );
  }
}
