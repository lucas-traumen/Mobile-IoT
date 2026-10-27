/**
 * WidgetGlyphIcon — renders a {@link ResolvedWidgetIcon} with the vector
 * component of ITS family (scope amendment 3): Ionicons names render via
 * `<Ionicons>`, MaterialCommunityIcons names (the Quạt `fan` glyph) via
 * `<MaterialCommunityIcons>`. The resolver (`widgetIcon.ts`) has already
 * validated every name against the installed glyph map of its family, so
 * the component can never receive a non-renderable name.
 *
 * Both widget cards (SensorValueWidget / SwitchWidget) render through this
 * one seam so the per-family dispatch lives in exactly one place.
 */

import React from 'react';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

import type { ResolvedWidgetIcon } from '../../domain/widgetIcon';

/**
 * The validated glyph, rendered at `size` in `color` with its own family's
 * component (line-style glyphs in both families keep the same visual
 * language).
 *
 * @param props.icon - a resolver-validated glyph (family + name).
 * @param props.size - glyph size in points.
 * @param props.color - glyph tint (state/accent color from the caller).
 */
export function WidgetGlyphIcon({
  icon,
  size,
  color,
}: {
  readonly icon: ResolvedWidgetIcon;
  readonly size: number;
  readonly color: string;
}) {
  if (icon.family === 'material-community') {
    return (
      <MaterialCommunityIcons name={icon.name} size={size} color={color} />
    );
  }
  return <Ionicons name={icon.name} size={size} color={color} />;
}
