import * as THREE from 'three';
import { emitNoise } from './noiseState';

export type HitZone = 'head' | 'torso' | 'arm' | 'leg';

export interface ZombieHitInfo {
  zone: HitZone;
  /** damage multiplier for this zone */
  mult: number;
  /** apply damage + knockback; dir is the (normalised) bullet travel direction */
  onHit: (dmg: number, point: THREE.Vector3, dir: THREE.Vector3, zone: HitZone) => void;
}

/**
 * Shared combat signal + a registry of every live zombie limb-hitbox mesh so
 * the weapon can raycast a tight, curated list (never the whole scene, never
 * the skinned mesh — that's slow and inaccurate).
 */
export const combatState = {
  /** every registered zombie hitbox mesh (bone-parented, so they track the pose) */
  hitboxes: [] as THREE.Object3D[],
  /** live zombie root groups — used for mutual separation so they don't stack */
  zombies: [] as THREE.Object3D[],
  /** [H] toggle — render the limb hitboxes as coloured wireframes for tuning */
  debugHitboxes: false,
};

/** A gunshot — folded into the general noise field (Stage B), not a separate signal. */
export function registerShot(x: number, z: number): void {
  emitNoise(x, z, 1, 55, 400);
}

export function addHitbox(o: THREE.Object3D): void {
  if (!combatState.hitboxes.includes(o)) combatState.hitboxes.push(o);
}
export function removeHitbox(o: THREE.Object3D): void {
  const i = combatState.hitboxes.indexOf(o);
  if (i >= 0) combatState.hitboxes.splice(i, 1);
}

export function addZombie(o: THREE.Object3D): void {
  if (!combatState.zombies.includes(o)) combatState.zombies.push(o);
}
export function removeZombie(o: THREE.Object3D): void {
  const i = combatState.zombies.indexOf(o);
  if (i >= 0) combatState.zombies.splice(i, 1);
}
