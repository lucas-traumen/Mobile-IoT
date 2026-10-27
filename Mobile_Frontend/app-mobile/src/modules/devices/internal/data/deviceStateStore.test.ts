/**
 * Device state store tests.
 *
 * Verifies keying `${deviceId}:${capability}`, removal cleanup, the injectable
 * clock for deterministic `updatedAt`, and the rolling numeric series buffer —
 * plus the per-capability command-error map (boards-topic-contract-v2:
 * `setCommandError`/`getCommandError`, set + cleared with `null`, and every
 * write notifying store subscribers).
 */

import { capabilityKey } from '../domain/devices';
import { createDeviceStateStore, deltaOverHorizon } from './deviceStateStore';

describe('createDeviceStateStore', () => {
  it('stores values under `${deviceId}:${capability}`', () => {
    const store = createDeviceStateStore(() => 1234);
    store.getState().setCapabilityValue('sensor-01', 'temperature', 25.5);
    expect(
      store.getState().values[capabilityKey('sensor-01', 'temperature')],
    ).toEqual({ value: 25.5, updatedAt: 1234 });
  });

  it('overwrites a value when set again', () => {
    const store = createDeviceStateStore(() => 1000);
    store.getState().setCapabilityValue('sensor-01', 'humidity', 40);
    store.getState().setCapabilityValue('sensor-01', 'humidity', 55);
    expect(
      store.getState().values[capabilityKey('sensor-01', 'humidity')],
    ).toEqual({ value: 55, updatedAt: 1000 });
  });

  it('stores boolean switch values', () => {
    const store = createDeviceStateStore();
    store.getState().setCapabilityValue('relay-1', 'switch', true);
    expect(
      store.getState().values[capabilityKey('relay-1', 'switch')].value,
    ).toBe(true);
  });

  it('removeDevice drops all keys of that device only', () => {
    const store = createDeviceStateStore();
    store.getState().setCapabilityValue('a', 'temperature', 1);
    store.getState().setCapabilityValue('a', 'humidity', 2);
    store.getState().setCapabilityValue('b', 'temperature', 3);

    store.getState().removeDevice('a');

    expect(store.getState().values).toEqual({
      [capabilityKey('b', 'temperature')]: expect.any(Object),
    });
  });

  describe('command error map (boards-topic-contract-v2)', () => {
    it('stores and reads a per-capability error message', () => {
      const store = createDeviceStateStore();
      store
        .getState()
        .setCommandError('relay-1', 'switch', 'đã hết thời gian chờ');
      expect(store.getState().getCommandError('relay-1', 'switch')).toBe(
        'đã hết thời gian chờ',
      );
      // Another capability key is unaffected.
      expect(
        store.getState().getCommandError('relay-1', 'temperature'),
      ).toBeNull();
      expect(store.getState().getCommandError('relay-2', 'switch')).toBeNull();
    });

    it('clears an error with null (and stores the empty message honestly)', () => {
      const store = createDeviceStateStore();
      store.getState().setCommandError('relay-1', 'switch', 'boom');
      store.getState().setCommandError('relay-1', 'switch', null);
      expect(store.getState().getCommandError('relay-1', 'switch')).toBeNull();

      store.getState().setCommandError('relay-1', 'switch', '');
      expect(store.getState().getCommandError('relay-1', 'switch')).toBe('');
    });

    it('overwrites a previous error message', () => {
      const store = createDeviceStateStore();
      store.getState().setCommandError('relay-1', 'switch', 'first');
      store.getState().setCommandError('relay-1', 'switch', 'second');
      expect(store.getState().getCommandError('relay-1', 'switch')).toBe(
        'second',
      );
    });

    it('notifies subscribers on BOTH the error setter and setCapabilityValue', () => {
      const store = createDeviceStateStore();
      const listener = jest.fn();
      store.subscribe(listener);

      store.getState().setCommandError('relay-1', 'switch', 'boom');
      expect(listener).toHaveBeenCalledTimes(1);

      store.getState().setCapabilityValue('relay-1', 'switch', true);
      expect(listener).toHaveBeenCalledTimes(2);

      store.getState().setCommandError('relay-1', 'switch', null);
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('removeDevice also drops the device error entries', () => {
      const store = createDeviceStateStore();
      store.getState().setCommandError('a', 'switch', 'boom');
      store.getState().removeDevice('a');
      expect(store.getState().getCommandError('a', 'switch')).toBeNull();
    });
  });

  describe('rolling numeric series buffer', () => {
    it('appends numeric values per capability (newest last)', () => {
      const store = createDeviceStateStore();
      store.getState().setCapabilityValue('sensor-01', 'temperature', 20);
      store.getState().setCapabilityValue('sensor-01', 'temperature', 21.5);
      store.getState().setCapabilityValue('sensor-01', 'humidity', 60);

      expect(
        store.getState().getSeriesValues('sensor-01', 'temperature'),
      ).toEqual([20, 21.5]);
      expect(store.getState().getSeriesValues('sensor-01', 'humidity')).toEqual(
        [60],
      );
    });

    it('caps the series at 40 values, dropping the oldest', () => {
      const store = createDeviceStateStore();
      for (let i = 1; i <= 45; i++) {
        store.getState().setCapabilityValue('sensor-01', 'temperature', i);
      }
      const series = store
        .getState()
        .getSeriesValues('sensor-01', 'temperature');

      expect(series).toHaveLength(40);
      expect(series[0]).toBe(6); // oldest kept
      expect(series[series.length - 1]).toBe(45); // newest
    });

    it('does NOT append boolean values (switch is not a series)', () => {
      const store = createDeviceStateStore();
      store.getState().setCapabilityValue('relay-1', 'switch', true);
      store.getState().setCapabilityValue('relay-1', 'switch', false);

      expect(store.getState().getSeriesValues('relay-1', 'switch')).toEqual([]);
    });

    it('returns an empty array for a capability with no series yet', () => {
      const store = createDeviceStateStore();
      expect(
        store.getState().getSeriesValues('sensor-01', 'temperature'),
      ).toEqual([]);
    });

    it('removeDevice drops the series of that device only', () => {
      const store = createDeviceStateStore();
      store.getState().setCapabilityValue('a', 'temperature', 1);
      store.getState().setCapabilityValue('a', 'temperature', 2);
      store.getState().setCapabilityValue('b', 'temperature', 3);

      store.getState().removeDevice('a');

      expect(store.getState().getSeriesValues('a', 'temperature')).toEqual([]);
      expect(store.getState().getSeriesValues('b', 'temperature')).toEqual([3]);
    });

    it('getSeriesPoints carries the wall-clock ts of each value (CP6)', () => {
      const store = createDeviceStateStore(() => 10_000);
      store.getState().setCapabilityValue('sensor-01', 'temperature', 20);
      store.getState().setCapabilityValue('sensor-01', 'temperature', 21);

      expect(
        store.getState().getSeriesPoints('sensor-01', 'temperature'),
      ).toEqual([
        { value: 20, ts: 10_000 },
        { value: 21, ts: 10_000 },
      ]);
    });
  });

  describe('deltaOverHorizon (CP6)', () => {
    const H = 3_600_000;

    it('compares the newest point with the newest point >= 1h old', () => {
      const now = 10 * H;
      const series = [
        { value: 28, ts: now - 2 * H },
        { value: 28.6, ts: now - H - 1 }, // newest at/after the cutoff
        { value: 29, ts: now - 1000 },
      ];
      expect(deltaOverHorizon(series, H, now)).toBeCloseTo(0.4);
    });

    it('falls back to the first point when the series is younger than 1h', () => {
      const now = 10 * H;
      const series = [
        { value: 28, ts: now - 1000 },
        { value: 28.6, ts: now },
      ];
      expect(deltaOverHorizon(series, H, now)).toBeCloseTo(0.6);
    });

    it('returns null for a single point or an empty series', () => {
      expect(deltaOverHorizon([], H, 1)).toBeNull();
      expect(deltaOverHorizon([{ value: 1, ts: 0 }], H, 1)).toBeNull();
    });

    it('returns null when every point is the same instant (no reference)', () => {
      const series = [
        { value: 1, ts: 100 },
        { value: 2, ts: 100 },
      ];
      // cutoff = now - H; both points after cutoff → reference = first point.
      expect(deltaOverHorizon(series, H, 100)).toBe(1);
      // now equal to the point ts → cutoff before both → reference = first.
      expect(deltaOverHorizon(series, 0, 100)).toBeNull();
    });
  });
});
