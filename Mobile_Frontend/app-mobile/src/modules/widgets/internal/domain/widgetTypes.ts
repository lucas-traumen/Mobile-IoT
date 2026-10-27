/**
 * Widget domain types — widget sizes, config schema + pure helpers.
 *
 * A {@link WidgetConfig} is the persisted form of one widget on a dashboard:
 * a registry `type`, an optional binding (`deviceId + capability`) and a grid
 * position. The zod schema is the single source of truth for the persisted
 * shape (non-empty ids, integer grid coordinates, size 1|2 per axis).
 */

import { z } from 'zod';

import { CapabilitySchema } from '@modules/devices/api';

/** Supported widget grid sizes (width x height in grid cells). */
export const WIDGET_SIZES = ['1x1', '2x1', '1x2', '2x2'] as const;

/** A widget grid size (`'1x1' | '2x1' | '1x2' | '2x2'`). */
export type WidgetSize = (typeof WIDGET_SIZES)[number];

/**
 * Parse a size string into grid dimensions.
 *
 * @param s - a size string (e.g. `'2x1'`).
 * @returns `{ width, height }` for a valid size, `null` otherwise (pure).
 */
export function parseWidgetSize(s: string): {
  width: number;
  height: number;
} | null {
  const match = /^([12])x([12])$/.exec(s);
  if (!match) {
    return null;
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Grid position + size of a widget (validated at persist time). */
export const WidgetLayoutSchema = z.object({
  /** Grid column (0-based, left). */
  x: z.number().int('Grid x must be an integer').min(0, 'Grid x must be >= 0'),
  /** Grid row (0-based, top). */
  y: z.number().int('Grid y must be an integer').min(0, 'Grid y must be >= 0'),
  /** Occupied columns (1 or 2). */
  width: z.union([z.literal(1), z.literal(2)]),
  /** Occupied rows (1 or 2). */
  height: z.union([z.literal(1), z.literal(2)]),
});

/** Grid position + size of a widget. */
export type WidgetLayout = z.infer<typeof WidgetLayoutSchema>;

/**
 * Schema for one persisted widget.
 *
 * `binding` is optional: widgets whose registry definition declares
 * `supportedCapabilities: []` (e.g. `connection`) carry no binding — the
 * registry rules in {@link validateWidgetBinding} enforce this at the
 * definition level.
 *
 * UNKNOWN-FIELD PRESERVATION (approved dashboard-template rework, section C):
 * the schema is a LOOSE object (`z.looseObject`), so unknown top-level
 * extension fields on a persisted widget — custom `config`, `vendorVersion`,
 * plugin metadata, … — survive every parse/serialize round-trip instead of
 * being silently stripped (the predecessor blocker). Required known fields
 * remain strictly validated; unknown CUSTOM WIDGET TYPES are preserved the
 * same way (they are never rejected here — the registry decides what can be
 * ADDED, persistence only decides what must SURVIVE).
 */
export const WidgetConfigSchema = z.looseObject({
  /** Stable widget id (unique within the dashboard). */
  id: z.string().min(1, 'Widget id is required'),
  /** Registered widget type (see the widget registry). */
  type: z.string().min(1, 'Widget type is required'),
  /** Optional display title (defaults to the definition label). */
  title: z.string().optional(),
  /**
   * Optional room this widget belongs to. Widgets without a room are global
   * (visible under every room filter).
   */
  roomId: z.string().min(1).optional(),
  /** Optional binding to a device capability (source of live data). */
  binding: z
    .object({
      /** Id of the bound device. */
      deviceId: z.string().min(1, 'Binding device id is required'),
      /** Capability to read/command on the bound device (open string). */
      capability: CapabilitySchema,
    })
    .optional(),
  /** Grid position + size. */
  layout: WidgetLayoutSchema,
});

/** A persisted widget on a dashboard. */
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

/** The binding part of a {@link WidgetConfig} (`deviceId + capability`). */
export type WidgetBinding = NonNullable<WidgetConfig['binding']>;
