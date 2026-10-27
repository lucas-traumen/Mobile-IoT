/**
 * WidgetRenderer — renders one widget instance through the registry.
 *
 * The registry maps a persisted `type` to its {@link WidgetDefinition}
 * (component + metadata). Unknown types render {@link UnsupportedWidget}
 * instead of crashing, so a persisted layout with a stale/unregistered type
 * stays gracely visible and editable (remove/resize still work).
 *
 * CP3 lost-binding fallback: a widget whose bound device no longer exists in
 * the registry renders a "Thiết bị không còn tồn tại" card with a
 * "Chọn lại thiết bị" button that opens an inline device + capability picker
 * wired to `onRebind` (persisted by the app root through
 * `DashboardService.updateWidgetBinding`).
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';

import type { CapabilityType } from '@modules/devices/api';
import type { WidgetConfig, WidgetRegistry } from '@modules/widgets/api';
import {
  effectiveCapabilities,
  useOptionalWidgetServices,
} from '@modules/widgets/api';

import { UnsupportedWidget } from './UnsupportedWidget';

/**
 * Render the component registered for a widget config's type.
 *
 * @param props.registry - the app-wide widget registry (from composition root).
 * @param props.config - the persisted widget (type + binding + layout).
 * @param props.onRebind - called with the picked device + capability when the
 *   user repairs a lost binding (omitted → fallback frame without the picker).
 */
export function WidgetRenderer({
  registry,
  config,
  onRebind,
}: {
  readonly registry: WidgetRegistry;
  readonly config: WidgetConfig;
  readonly onRebind?: (deviceId: string, capability: CapabilityType) => void;
}) {
  const { tokens } = useTheme();
  const services = useOptionalWidgetServices();
  const [showPicker, setShowPicker] = useState(false);

  const definition = registry.get(config.type);
  if (!definition) {
    return <UnsupportedWidget config={config} />;
  }

  // Lost binding: the definition requires a binding, but its device is gone.
  const boundDeviceId = config.binding?.deviceId;
  const capabilities = services?.getCapabilities() ?? [];
  const supported = effectiveCapabilities(definition, capabilities);
  const bindingRequired = supported.length > 0;
  const boundDevice = boundDeviceId
    ? services?.getDevices().find(d => d.id === boundDeviceId)
    : undefined;
  const bindingLost =
    bindingRequired && (boundDeviceId === undefined || !boundDevice);

  if (!bindingLost) {
    const Component = definition.component;
    return <Component config={config} />;
  }

  // Catalog labels for the capability chips (fallback: the raw type).
  const capabilityLabel = (cap: CapabilityType): string =>
    capabilities.find(c => c.type === cap)?.label ?? cap;

  // Device candidates: those exposing at least one supported capability.
  // Room-scoped binding authority (approved plan — `WidgetConfig.roomId` is
  // authoritative): a room-scoped widget can only rebind to devices of its
  // OWN room; a global (roomless) widget may bind any device. This UI filter
  // is mirrored by an authoritative validation seam in the dashboard
  // service/store so a programmatic cross-room rebind can never persist.
  const candidates = (services?.getDevices() ?? []).filter(
    device =>
      device.capabilities.some(cap => supported.includes(cap)) &&
      (config.roomId === undefined || device.roomId === config.roomId),
  );

  if (!showPicker) {
    return (
      <View style={styles.lostCard}>
        <Text style={[styles.lostTitle, { color: tokens.textPrimary }]}>
          {STRINGS.dashboard.lostBinding}
        </Text>
        {onRebind ? (
          <Pressable
            style={[styles.rebindButton, { backgroundColor: tokens.primary }]}
            onPress={() => setShowPicker(true)}
          >
            <Text
              style={[styles.rebindButtonText, { color: tokens.onPrimary }]}
            >
              {STRINGS.dashboard.rebind}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.lostCard}>
      <Text style={[styles.lostTitle, { color: tokens.textPrimary }]}>
        {STRINGS.widgets.chooseDevice}
      </Text>
      {candidates.length === 0 ? (
        <Text style={[styles.lostHint, { color: tokens.textSecondary }]}>
          {STRINGS.widgets.disabled}
        </Text>
      ) : (
        candidates.map(candidate => {
          const caps = candidate.capabilities.filter(cap =>
            supported.includes(cap),
          );
          return (
            <View key={candidate.id} style={styles.pickerRow}>
              <Text
                style={[styles.pickerDevice, { color: tokens.textPrimary }]}
              >
                {candidate.name}
              </Text>
              <View style={styles.capRow}>
                {caps.map(cap => (
                  <Pressable
                    key={cap}
                    style={[styles.capChip, { borderColor: tokens.border }]}
                    onPress={() => {
                      setShowPicker(false);
                      onRebind?.(candidate.id, cap);
                    }}
                  >
                    <Text
                      style={[
                        styles.capChipText,
                        { color: tokens.textPrimary },
                      ]}
                    >
                      {capabilityLabel(cap)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })
      )}
      <Pressable
        style={[styles.cancelButton, { borderColor: tokens.border }]}
        onPress={() => setShowPicker(false)}
      >
        <Text
          style={[styles.cancelButtonText, { color: tokens.textSecondary }]}
        >
          {STRINGS.widgets.cancel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lostCard: { padding: 12, flex: 1, justifyContent: 'center' },
  lostTitle: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  lostHint: { fontSize: 12 },
  rebindButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  rebindButtonText: { fontWeight: '700', fontSize: 12 },
  pickerRow: { marginBottom: 6 },
  pickerDevice: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  capRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  capChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  capChipText: { fontSize: 11, fontWeight: '500' },
  cancelButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  cancelButtonText: { fontSize: 12, fontWeight: '600' },
});
