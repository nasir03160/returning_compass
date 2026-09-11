import * as THREE from 'three';

/**
 * Lightweight shared player state, updated once per frame by the Player controller
 * and read by the endless-world systems (chunk streaming, wandering animals).
 * Kept as plain module singletons so no React re-renders are triggered per frame.
 */
export const playerPosition = new THREE.Vector3(0, 1.2, 0);
export const playerState = {
  grounded: true,
  moving: false,
  sprinting: false,
  /** Ctrl held + moving — slow, quiet. Read by the noise system (Stage B). */
  stealthWalking: false,
  /** camera yaw in radians (0 = facing -Z / "north") */
  yaw: 0,
  /** cumulative horizontal distance travelled, metres */
  distanceTravelled: 0,
};
