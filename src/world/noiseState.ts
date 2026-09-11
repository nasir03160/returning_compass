import * as THREE from 'three';

/**
 * Multi-source noise field. Anything the player (or the world) does that a
 * zombie could hear pushes an event in here; `getNoiseIntensityAt` sums the
 * distance-attenuated contributions at a query point. Replaces the old
 * single-purpose `combatState.lastShot*` signal.
 *
 * Plain module singleton (playerState / weaponState pattern) — no React.
 */
export interface NoiseEvent {
  x: number;
  z: number;
  /** peak intensity at the source (~0..1, gunfire = 1) */
  intensity: number;
  /** metres — contributes 0 beyond this */
  radius: number;
  /** performance.now() ms, or Infinity for a permanent source */
  expiresAt: number;
  /** stable id for permanent / updatable sources (beacons); undefined = one-shot */
  key?: string;
}

const events: NoiseEvent[] = [];

export const noiseState = {
  /** [N] toggle — draw translucent spheres for every active event */
  debug: false,
};

/** Fire-and-forget noise burst that fades out after `ttlMs`. */
export function emitNoise(
  x: number,
  z: number,
  intensity: number,
  radius: number,
  ttlMs: number
): void {
  events.push({ x, z, intensity, radius, expiresAt: performance.now() + ttlMs });
}

/** Add or move a permanent (non-expiring) source, keyed so it can be updated / removed. */
export function setPermanentNoise(
  key: string,
  x: number,
  z: number,
  intensity: number,
  radius: number
): void {
  const e = events.find((ev) => ev.key === key);
  if (e) {
    e.x = x;
    e.z = z;
    e.intensity = intensity;
    e.radius = radius;
  } else {
    events.push({ x, z, intensity, radius, expiresAt: Infinity, key });
  }
}

export function clearPermanentNoise(key: string): void {
  const i = events.findIndex((ev) => ev.key === key);
  if (i >= 0) events.splice(i, 1);
}

/** Drop expired one-shots — call once per frame from a single always-mounted driver. */
export function pruneNoise(now = performance.now()): void {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].expiresAt <= now) events.splice(i, 1);
  }
}

/** Summed, linearly-attenuated noise intensity at a world position. */
export function getNoiseIntensityAt(pos: THREE.Vector3): number {
  let sum = 0;
  for (const e of events) {
    const d = Math.hypot(pos.x - e.x, pos.z - e.z);
    if (d < e.radius) sum += e.intensity * (1 - d / e.radius);
  }
  return sum;
}

/** Read-only view for the [N] debug overlay. */
export function activeNoiseEvents(): readonly NoiseEvent[] {
  return events;
}

/* --- rate-limited emitters for the continuous sources (sprint / stealth / breath) --- */
const _last: Record<string, number> = {};
export function emitThrottled(
  tag: string,
  intervalMs: number,
  x: number,
  z: number,
  intensity: number,
  radius: number,
  ttlMs: number
): void {
  const now = performance.now();
  if (now - (_last[tag] ?? -1e9) < intervalMs) return;
  _last[tag] = now;
  emitNoise(x, z, intensity, radius, ttlMs);
}

/** Above this summed intensity a zombie counts a location as "heard". */
export const HEAR_THRESHOLD = 0.12;
