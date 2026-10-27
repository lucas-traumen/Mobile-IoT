/**
 * Widgets module — public facade.
 *
 * The only entry point other modules may use. Everything else lives in
 * `internal/` and must not be imported across modules (enforced by
 * `eslint-plugin-boundaries`).
 *
 * Exposes: widget size/config types + zod schema, the widget registry (with
 * its 2 built-in types) and the React context widgets use to read live data,
 * send commands and query history.
 */

/** Widget grid size, config/layout/binding types + size utilities. */
export type {
  WidgetBinding,
  WidgetConfig,
  WidgetLayout,
  WidgetSize,
} from '../internal/domain/widgetTypes';
/** All supported widget sizes (`1x1|2x1|1x2|2x2`). */
export {
  parseWidgetSize,
  WidgetConfigSchema,
  WIDGET_SIZES,
} from '../internal/domain/widgetTypes';
/** Widget registry: definitions + capability-based suggestions + binding rule. */
export type {
  WidgetCategory,
  WidgetDefinition,
  WidgetRegistry,
} from '../internal/domain/widgetRegistry';
export {
  createWidgetRegistry,
  effectiveCapabilities,
  validateWidgetBinding,
  WIDGET_CATEGORIES,
} from '../internal/domain/widgetRegistry';
/** Centralized capability accent resolver (built-ins themed, custom catalog). */
export { resolveCapabilityAccent } from '../internal/domain/capabilityColor';
/** Widget uniqueness (approved room-sensor rework): pure key/check/dedupe. */
export {
  dedupeWidgets,
  duplicateWidgetError,
  duplicateWidgetKeys,
  widgetUniquenessKey,
} from '../internal/domain/widgetUniqueness';
/** Default registry with the built-in widget types (history-chart retired). */
export { createDefaultRegistry } from '../internal/domain/widgetRegistryDefaults';
/** Runtime services a widget receives through context. */
export type {
  WidgetConnectionState,
  WidgetServices,
} from '../internal/ui/widgetContext';
export {
  useOptionalWidgetServices,
  useWidgetServices,
  WidgetServicesProvider,
} from '../internal/ui/widgetContext';
