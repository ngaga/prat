/**
 * Spatial simulation uses abstract units (design: treat as meters).
 * No screen pixels here: the server and game logic use this space only.
 * Rendering converts with simulationToDisplay (Phaser / CSS pixels).
 */

export const WORLD_HALF_EXTENT_SIMULATION_UNITS = 2000;
export const WORLD_MARGIN_SIMULATION_UNITS = 50;

/** Player letter salvo: speed and combat (shared with server). */
export const PLAYER_LETTER_SPEED_SIMULATION_UNITS_PER_SECOND = 400;
export const LETTER_DAMAGE_SIMULATION_UNITS = 10;
export const PROJECTILE_HIT_RADIUS_SIMULATION_UNITS = 40;
/** Approximate rendered boat diameter in simulation units (used for close-range combat rules). */
export const PLAYER_BOAT_DIAMETER_SIMULATION_UNITS = 80;
/**
 * Max travel distance for player-fired letters (half diagonal of a 1920x1080 reference viewport,
 * expressed in simulation units — not display pixels).
 */
export const PLAYER_PROJECTILE_MAX_TRAVEL_SIMULATION_UNITS = 1102;

/** Client-only movement tuning (also expressed in simulation units per second for consistency). */
export const PLAYER_BOAT_SPEED_SIMULATION_UNITS_PER_SECOND = 200;
export const PLAYER_MOVE_ARRIVAL_THRESHOLD_SIMULATION_UNITS = 15;
/** Left-click target selection radius around boats / enemies (client). */
export const CLICK_TARGET_RADIUS_SIMULATION_UNITS = 60;

/** Stingray motion (server). */
export const STINGRAY_SPEED_SIMULATION_UNITS_PER_SECOND = 80;
export const STINGRAY_AMPLITUDE_SIMULATION_UNITS = 25;
/** Server: boat is pulled onto a stingray when within this distance (simulation units). */
export const STINGRAY_PLAYER_CAPTURE_RADIUS_SIMULATION_UNITS = 100;
