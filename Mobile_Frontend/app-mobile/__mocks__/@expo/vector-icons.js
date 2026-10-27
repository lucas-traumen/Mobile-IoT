/**
 * Manual Jest mock for `@expo/vector-icons` (auto-applied from __mocks__).
 *
 * The real package pulls in expo-font → expo-asset, which lives nested under
 * `expo/node_modules` and cannot be resolved from the Jest environment. The
 * mock provides Text-based stand-ins that accept `name` / `size` / `color`
 * props — ONE STAND-IN PER ICON FAMILY — so the family-aware glyph renderer
 * (`WidgetGlyphIcon`) and its tests can assert WHICH family a glyph renders
 * through (`findAllByType(Ionicons)` vs
 * `findAllByType(MaterialCommunityIcons)`). Each stand-in is created once
 * per module load so component identity (and therefore `findAllByType`) is
 * stable across renders.
 */

const React = require('react');
const { Text } = require('react-native');

function createIcon() {
  const Icon = ({ name, size = 20, color }) =>
    React.createElement(
      Text,
      { style: { fontSize: size, color } },
      String(name ?? ''),
    );
  Icon.glyphMap = {};
  return Icon;
}

module.exports = {
  Ionicons: createIcon(),
  MaterialCommunityIcons: createIcon(),
};
