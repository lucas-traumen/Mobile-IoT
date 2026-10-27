/**
 * Widget registry — type registry mapping widget types to their definitions.
 *
 * A {@link WidgetDefinition} declares what a widget type supports (capabilities
 * + sizes) and which React component renders it. The registry is a pure,
 * mutable-by-register collection: `register` throws on duplicate types, `get`
 * returns definitions by type and {@link suggestForCapabilities} filters by
 * available device capabilities.
 */

import type { ComponentType } from 'react';

import type { CapabilityDef, CapabilityType } from '@modules/devices/api';
import type { Result } from '@core/errors';
import { err, ok } from '@core/errors';

import type { WidgetConfig, WidgetSize } from './widgetTypes';

/** Category a widget type belongs to (Add Widget flow grouping, CP3). */
export const WIDGET_CATEGORIES = [
  'sensor',
  'control',
  'history',
  'system',
] as const;

/** Widget category ('sensor' | 'control' | 'history' | 'system'). */
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

/** A registered widget type: metadata + rendering component. */
export interface WidgetDefinition {
  /** Registry type key (e.g. 'sensor-value'); unique per registry. */
  readonly type: string;
  /** Human-readable label (shown in the Add Widget flow). */
  readonly label: string;
  /** Short description (Add Widget flow row subtitle). */
  readonly description: string;
  /** Ionicons glyph name shown next to the label (e.g. 'thermometer-outline'). */
  readonly icon: string;
  /** Functional category (used to group widget types in the Add flow). */
  readonly category: WidgetCategory;
  /**
   * Capabilities the widget can bind to. Empty means the widget needs no
   * binding (e.g. the connection widget).
   */
  readonly supportedCapabilities: readonly CapabilityType[];
  /**
   * When set, the widget additionally accepts every catalog capability whose
   * `kind` is listed here (CP5/CP6: a user-defined "Áp suất" sensor becomes
   * bindable to `sensor-value` without editing the static list). The
   * catalog is supplied at validation time.
   */
  readonly acceptsCatalogKinds?: readonly ('sensor' | 'switch')[];
  /** Grid sizes the widget can occupy. */
  readonly supportedSizes: readonly WidgetSize[];
  /** The component that renders one widget instance of this type. */
  readonly component: ComponentType<{ config: WidgetConfig }>;
}

/**
 * A widget registry — map from widget type → definition.
 *
 * Pure data + rules; no side effects. Instances are created per app (or per
 * test) so definitions can be registered incrementally and duplicated type
 * registrations are rejected.
 */
export interface WidgetRegistry {
  /**
   * Register a definition.
   *
   * @throws when a definition with the same `type` is already registered.
   */
  register(def: WidgetDefinition): void;
  /** Get the definition for a type (`undefined` when unknown). */
  get(type: string): WidgetDefinition | undefined;
  /** All registered definitions (ordered by registration). */
  list(): WidgetDefinition[];
  /**
   * Definitions whose supported capabilities intersect the given available
   * capabilities, ordered by registration order.
   */
  suggestForCapabilities(caps: readonly CapabilityType[]): WidgetDefinition[];
}

/** Create an empty {@link WidgetRegistry}. */
export function createWidgetRegistry(): WidgetRegistry {
  const defs = new Map<string, WidgetDefinition>();

  return {
    register: (def: WidgetDefinition) => {
      if (defs.has(def.type)) {
        throw new Error(
          `Widget type "${def.type}" is already registered; duplicates are not allowed`,
        );
      }
      defs.set(def.type, def);
    },
    get: (type: string) => defs.get(type),
    list: () => Array.from(defs.values()),
    suggestForCapabilities: (caps: readonly CapabilityType[]) => {
      const available = new Set(caps);
      return Array.from(defs.values()).filter(def =>
        def.supportedCapabilities.some(cap => available.has(cap)),
      );
    },
  };
}

/**
 * The capabilities a definition can bind, combining the static
 * `supportedCapabilities` with any catalog capability whose `kind` is listed
 * in `acceptsCatalogKinds` (CP5/CP6). Without a catalog the static list is
 * returned unchanged.
 */
export function effectiveCapabilities(
  def: WidgetDefinition,
  catalog: readonly CapabilityDef[] = [],
): readonly CapabilityType[] {
  if (!def.acceptsCatalogKinds || def.acceptsCatalogKinds.length === 0) {
    return def.supportedCapabilities;
  }
  const extra = catalog
    .filter(cap => def.acceptsCatalogKinds?.includes(cap.kind))
    .map(cap => cap.type)
    .filter(type => !def.supportedCapabilities.includes(type));
  return [...def.supportedCapabilities, ...extra];
}

/**
 * Validate a widget config against its definition's capability rules.
 *
 * - A definition with capabilities requires a binding whose capability is in
 *   `supportedCapabilities` (or accepted via the catalog, when provided).
 * - A definition with empty capabilities forbids a binding.
 *
 * @param def - the widget definition from the registry.
 * @param config - the widget config to validate.
 * @param catalog - optional capability catalog (CP5/CP6 custom capabilities).
 * @returns `ok(void)` when valid, else `err(errorMessage)` (pure).
 */
export function validateWidgetBinding(
  def: WidgetDefinition,
  config: WidgetConfig,
  catalog: readonly CapabilityDef[] = [],
): Result<void, string> {
  const supported = effectiveCapabilities(def, catalog);
  if (supported.length === 0) {
    if (config.binding) {
      return err(
        `Widget "${def.type}" does not support a binding, but one was provided`,
      );
    }
    return ok(undefined);
  }
  if (!config.binding) {
    return err(`Widget "${def.type}" requires a binding`);
  }
  if (!supported.includes(config.binding.capability)) {
    return err(
      `Widget "${def.type}" does not support capability "${config.binding.capability}"`,
    );
  }
  return ok(undefined);
}
