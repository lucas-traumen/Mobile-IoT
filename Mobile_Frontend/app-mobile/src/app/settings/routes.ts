/**
 * Typed Settings stack route contract — ONE navigation system for the
 * Settings tab. The native stack hosts, in hierarchy order:
 *
 *   root (settings summary) → advanced / device-management
 *                           → TemplateList → CreateTemplate
 *                                          → RoomList → CreateRoom
 *                                                     → RoomDashboard
 *                                                     → EditRoomDashboard
 *
 * The Template → Room → Widget management hierarchy is reachable ONLY from
 * here (one management entry on the root screen); the Dashboard tab is the
 * view-only surface and hosts no navigation. The previous hand-written
 * `routeMachine` is retired — transitions are React Navigation's stack
 * (push/pop/back) and are covered by {@link ./SettingsNavigator.test.tsx}.
 */

/**
 * Params of the Settings stack screens (board-discovery-binding added the
 * `boards` route). The hierarchy routes keep the v1 names (`TemplateList`,
 * `RoomList`, …) so screen contracts and tests carry over from the
 * re-parented stack unchanged.
 */
export type SettingsStackParams = {
  /** Settings root: summary + navigation rows (incl. the management entry). */
  readonly root: undefined;
  /** Dedicated MQTT/Influx configuration + diagnostics screen. */
  readonly advanced: undefined;
  /** The devices module's physical room/device management screen. */
  readonly 'device-management': undefined;
  /** The devices module's hardware-board discovery screen (bindings). */
  readonly boards: undefined;
  /** Management hierarchy root: the Template card list. */
  readonly TemplateList: undefined;
  /** The create-Template form (opens the new Template's room list). */
  readonly CreateTemplate: undefined;
  /** One Template's room-card grid. */
  readonly RoomList: { readonly templateId: string };
  /** "+ Thêm phòng" selects an existing physical room for one Template. */
  readonly CreateRoom: { readonly templateId: string };
  /** One room's widget dashboard (view). */
  readonly RoomDashboard: {
    readonly templateId: string;
    readonly roomId: string;
  };
  /** One room's widget dashboard (draft edit). */
  readonly EditRoomDashboard: {
    readonly templateId: string;
    readonly roomId: string;
  };
};

/** Screen names of the Settings stack. */
export type SettingsRouteName = keyof SettingsStackParams;
