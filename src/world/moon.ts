import * as THREE from 'three';

/**
 * Single source of truth for "where the moon is" — shared by the visible moon
 * mesh (Moon.tsx) and the moonlight DirectionalLight (HorrorAtmosphereLighting)
 * so the light always rakes in from the same direction the disc sits in.
 */
export const MOON_DIR = new THREE.Vector3(12, 40, 12).normalize();

/** Cool blue-grey moonlight tone — used for the light, the disc tint, and the
 *  fog/background so distant silhouettes fade into it instead of pure black. */
export const MOON_COLOR = '#9db4d6';
export const MOON_LIGHT_COLOR = '#8fa8c4';
