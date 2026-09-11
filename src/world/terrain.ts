import { fbm2D } from './noise';

/**
 * Single source of truth for the displaced forest floor.
 * `ForestGround` builds its tile geometry from `terrainHeightAt`, and every
 * scattered asset samples the same function so nothing floats or sinks.
 */
// Vertical displacement amplitude — gentle rolling, not choppy. The player's
// physics floor (GroundPlane) is a FLAT collider, so pushing this much higher
// starts to show as visible gaps in deep valleys / clipping on tall rises;
// 0.55 is a modest bump over the original 0.45 that reads as real terrain
// without breaking that illusion.
export const DISP_AMP = 0.55;
export const DISP_BIAS = 0.4; // most of the surface sits below the walk plane
export const NOISE_SCALE = 0.028; // world-space frequency of the terrain hills (lower = longer rolls)

/** World-space Y of the forest floor at (x, z) — identical maths to the ground
 *  tile geometry so nothing can float or sink relative to it. */
export function terrainHeightAt(x: number, z: number): number {
  return (fbm2D(x * NOISE_SCALE, z * NOISE_SCALE, 4) - DISP_BIAS) * DISP_AMP;
}

/** How far the base of a solid asset (trunk, rock, bush) is buried below the
 *  leaf surface so there is never a visible gap. */
export const ASSET_SINK = 0.35;

/** Y to plant a base-pivoted asset at. */
export function groundY(x: number, z: number, sink = ASSET_SINK): number {
  return terrainHeightAt(x, z) - sink;
}
