import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { nearestLitBeaconDist, ROOT_SIGNAL_RADIUS } from '../world/beaconState';

const SPORE_COUNT = 200;
const SPORE_BOX = 13; // particles live in a cube this wide around the camera

/**
 * Night 3 — a second mote layer, same camera-wrap technique as
 * FlashlightFX's dust, but spore-like: denser, drifts UP instead of down,
 * faint green instead of neutral, and only actually visible once the player
 * is inside a lit beacon's ROOT_SIGNAL_RADIUS (opacity ramps with proximity,
 * same distance-based blend as the fog/ground tint — no hard on/off).
 */
export function SporeFX() {
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);

  const spores = useMemo(() => {
    const pos = new Float32Array(SPORE_COUNT * 3);
    const vel = new Float32Array(SPORE_COUNT * 3);
    for (let i = 0; i < SPORE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * SPORE_BOX;
      pos[i * 3 + 1] = (Math.random() - 0.5) * SPORE_BOX;
      pos[i * 3 + 2] = (Math.random() - 0.5) * SPORE_BOX;
      vel[i * 3] = (Math.random() - 0.5) * 0.015;
      vel[i * 3 + 1] = 0.006 + Math.random() * 0.01; // upward drift, not down
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.015;
    }
    return { pos, vel };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const dLit = nearestLitBeaconDist(playerPosition.x, playerPosition.z);
    const k = Math.max(0, Math.min(1, 1 - dLit / ROOT_SIGNAL_RADIUS));

    if (matRef.current) matRef.current.opacity = k * 0.6;
    const pts = ref.current;
    if (!pts) return;
    pts.visible = k > 0.01;
    if (!pts.visible) return;

    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const cx = playerPosition.x;
    const cy = playerPosition.y + 1.0;
    const cz = playerPosition.z;
    for (let i = 0; i < SPORE_COUNT; i++) {
      spores.vel[i * 3] += (Math.random() - 0.5) * 0.3 * dt;
      spores.vel[i * 3 + 2] += (Math.random() - 0.5) * 0.3 * dt;
      spores.vel[i * 3] *= 0.95;
      spores.vel[i * 3 + 1] = Math.min(0.02, spores.vel[i * 3 + 1] + 0.002 * dt); // keeps rising
      spores.vel[i * 3 + 2] *= 0.95;
      arr[i * 3] += spores.vel[i * 3] * dt * 30;
      arr[i * 3 + 1] += spores.vel[i * 3 + 1] * dt * 30;
      arr[i * 3 + 2] += spores.vel[i * 3 + 2] * dt * 30;
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? cx : a === 1 ? cy : cz;
        const local = arr[i * 3 + a] - c;
        if (local > SPORE_BOX / 2) arr[i * 3 + a] -= SPORE_BOX;
        else if (local < -SPORE_BOX / 2) arr[i * 3 + a] += SPORE_BOX;
      }
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[spores.pos, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        color="#8fdc7a"
        size={0.045}
        sizeAttenuation
        transparent
        opacity={0}
        depthWrite={false}
        fog
      />
    </points>
  );
}
