import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';

const DUST_COUNT = 340;
const DUST_BOX = 15; // particles live in a cube this wide around the camera

/**
 * Camera-space atmosphere: slow-drifting dust / spore motes lit faintly around
 * the player.
 *
 * This used to also draw a volumetric beam cone in front of the camera, but
 * because it was rebuilt every frame to point straight down the view axis, it
 * stayed centred on screen no matter which way the player looked — reading as
 * a persistent dark/hazy circle glued to the crosshair rather than a light
 * beam in the world. Removed; the real spotLights in FlashlightRig already
 * carry the actual illumination.
 */
export function FlashlightFX({ on }: { on: boolean }) {
  const dustRef = useRef<THREE.Points>(null);

  const dust = useMemo(() => {
    const pos = new Float32Array(DUST_COUNT * 3);
    const vel = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * DUST_BOX;
      pos[i * 3 + 1] = (Math.random() - 0.5) * DUST_BOX;
      pos[i * 3 + 2] = (Math.random() - 0.5) * DUST_BOX;
      vel[i * 3] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 1] = -0.004 - Math.random() * 0.006;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
    return { pos, vel };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // --- dust ---
    if (dustRef.current) {
      const attr = dustRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const cx = playerPosition.x;
      const cy = playerPosition.y + 1.2;
      const cz = playerPosition.z;
      for (let i = 0; i < DUST_COUNT; i++) {
        // Brownian jitter: random-walk the velocity, lightly damped, with a
        // permanent slow sink so motes drift down through the beam.
        dust.vel[i * 3] += (Math.random() - 0.5) * 0.4 * dt;
        dust.vel[i * 3 + 1] += (Math.random() - 0.5) * 0.35 * dt;
        dust.vel[i * 3 + 2] += (Math.random() - 0.5) * 0.4 * dt;
        dust.vel[i * 3] *= 0.94;
        dust.vel[i * 3 + 1] = dust.vel[i * 3 + 1] * 0.94 - 0.006;
        dust.vel[i * 3 + 2] *= 0.94;
        arr[i * 3] += dust.vel[i * 3] * dt * 30;
        arr[i * 3 + 1] += dust.vel[i * 3 + 1] * dt * 30;
        arr[i * 3 + 2] += dust.vel[i * 3 + 2] * dt * 30;
        // wrap within the box relative to the (moving) player
        for (let a = 0; a < 3; a++) {
          const c = a === 0 ? cx : a === 1 ? cy : cz;
          const local = arr[i * 3 + a] - c;
          if (local > DUST_BOX / 2) arr[i * 3 + a] -= DUST_BOX;
          else if (local < -DUST_BOX / 2) arr[i * 3 + a] += DUST_BOX;
        }
      }
      attr.needsUpdate = true;
    }
  });

  return (
    <group>
      <points ref={dustRef} visible={on} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust.pos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#d6dcec"
          size={0.05}
          sizeAttenuation
          transparent
          opacity={0.55}
          depthWrite={false}
          fog
        />
      </points>
    </group>
  );
}
