/**
 * Beacon-tower objective state. 5 fixed towers; light them all, then reach the
 * extraction point. Plain module singleton — components mutate `.phase` /
 * `.progress` directly and the HUD / compass read it (same pattern as the
 * other world/* state).
 */
export type BeaconPhase = 'unlit' | 'capturing' | 'lit';

export const CAPTURE_SECONDS = 20;
export const CAPTURE_RADIUS = 6; // player-to-tower distance that starts/holds a capture
export const BEACON_CLEAR_RADIUS = 10; // forest streamer skips trees/scatter within this

/** Hardcoded world (x, z) — the endless forest is random per chunk, so the
 *  objective towers have to be fixed points. Spaced ~60–130 u apart & from spawn. */
export const BEACON_POSITIONS: readonly [number, number][] = [
  [44, -64],
  [-88, -34],
  [66, 58],
  [-54, 96],
  [6, 150],
];

export const EXTRACTION_POS: readonly [number, number] = [0, -200];
export const EXTRACTION_RADIUS = 7;

export interface BeaconRuntime {
  id: number;
  x: number;
  z: number;
  phase: BeaconPhase;
  /** banked capture time in seconds, 0..CAPTURE_SECONDS (never resets, only pauses) */
  progress: number;
}

export const beaconState = {
  beacons: BEACON_POSITIONS.map(
    ([x, z], id): BeaconRuntime => ({ id, x, z, phase: 'unlit', progress: 0 })
  ),
  /** set true by Extraction.tsx when the player reaches the pad after all 5 are lit */
  extracted: false,
};

export function litBeaconCount(): number {
  return beaconState.beacons.reduce((n, b) => n + (b.phase === 'lit' ? 1 : 0), 0);
}

export function allBeaconsLit(): boolean {
  return beaconState.beacons.every((b) => b.phase === 'lit');
}

/** The beacon currently mid-capture (there is only ever one), or null. */
export function capturingBeacon(): BeaconRuntime | null {
  return beaconState.beacons.find((b) => b.phase === 'capturing') ?? null;
}

/** Nearest not-yet-lit beacon to a point — the compass target until all are lit. */
export function nearestUnlitBeacon(x: number, z: number): BeaconRuntime | null {
  let best: BeaconRuntime | null = null;
  let bd = Infinity;
  for (const b of beaconState.beacons) {
    if (b.phase === 'lit') continue;
    const d = (b.x - x) ** 2 + (b.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** True if (x,z) is inside any beacon's forest-exclusion disc. */
export function insideBeaconClearing(x: number, z: number): boolean {
  const r2 = BEACON_CLEAR_RADIUS * BEACON_CLEAR_RADIUS;
  for (const [bx, bz] of BEACON_POSITIONS) {
    if ((bx - x) ** 2 + (bz - z) ** 2 < r2) return true;
  }
  return false;
}
