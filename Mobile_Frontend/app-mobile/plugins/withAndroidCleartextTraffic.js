/**
 * withAndroidCleartextTraffic — local Expo config plugin
 * (android-cleartext-policy fix).
 *
 * The Smart Home backend lives on the LAN with no TLS (MQTT `ws://` +
 * InfluxDB `http://`). Android 9+ blocks app cleartext traffic by DEFAULT
 * and the stock Expo prebuild template does not opt in — so without this
 * plugin the OS kills every `fetch('http://…')` (Influx probe + History)
 * with `CLEARTEXT communication not permitted`, surfacing as a 'network'
 * probe failure even with a correct URL. This plugin sets
 * `android:usesCleartextTraffic="true"` on the `<application>` tag during
 * `expo prebuild`, restoring LAN-HTTP for the app's own backend calls.
 *
 * Accepted tradeoff (user-approved 2026-09-30): the flag is app-wide, not
 * scoped to the LAN IPs — IP-scoping is impractical because the home DHCP
 * rotates the server address, and the app talks to no other HTTP endpoint.
 */

const { withAndroidManifest } = require('@expo/config-plugins');

function withAndroidCleartextTraffic(config) {
  return withAndroidManifest(config, modConfig => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return modConfig;
  });
}

module.exports = withAndroidCleartextTraffic;
