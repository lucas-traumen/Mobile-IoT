/**
 * User-facing Vietnamese label for an MQTT connection state.
 *
 * Shared by the Dashboard header badge and the Settings "Kết nối" section
 * (CP5) so every screen describes the connection with the same words. (The
 * built-in connection widget was retired in Phase 1; global MQTT status now
 * lives only in the header + Settings.)
 */

import type { ConnectionState } from '../events';

import { STRINGS } from './strings';

/** Vietnamese label for a connection state (online / offline / …). */
export function mqttConnectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return STRINGS.dashboard.mqttOnline;
    case 'connecting':
      return STRINGS.dashboard.mqttConnecting;
    case 'reconnecting':
      return STRINGS.dashboard.mqttReconnecting;
    case 'failed':
      return STRINGS.dashboard.mqttOffline;
    default:
      return STRINGS.dashboard.mqttOffline;
  }
}
