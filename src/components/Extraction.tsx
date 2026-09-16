import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { terrainHeightAt } from '../world/terrain';
import {
  beaconState,
  allBeaconsLit,
  EXTRACTION_POS,
  EXTRACTION_RADIUS,
} from '../world/beaconState';
import { extractionState, beginCountdown, countdownRemaining } from '../world/extractionState';
import { playChoirFinale } from '../audio/sfx';

const [EX, EZ] = EXTRACTION_POS;
const _padColorWaiting = new THREE.Color('#4dffb0');
const _padColorCounting = new THREE.Color('#ffb14a');

/**
 * Extraction pad. Hidden until all 5 beacons are lit. Night 4 ("Signal
 * Zero"): stepping into the radius no longer extracts instantly — it starts
 * `extractionState`'s countdown (Zombies.tsx piles on pressure while it
 * runs). The pad stays lit/visible through the whole countdown; only when it
 * elapses does this flip `beaconState.extracted` and play the success
 * stinger. Leaving the radius during the countdown does nothing — by
 * design, only dying (App.tsx's onZombieAttack -> failExtraction) fails it.
 */
export function Extraction() {
  const group = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const baseY = terrainHeightAt(EX, EZ) - 0.2;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const active = allBeaconsLit();
    g.visible = active;
    if (!active) return;

    const t = state.clock.elapsedTime;
    const counting = extractionState.phase === 'countdown';
    const pulseHz = counting ? 7 : 2; // frantic flicker once the countdown is live
    if (beam.current) {
      (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * pulseHz);
      beam.current.rotation.y = t * (counting ? 1.1 : 0.3);
    }
    if (light.current) {
      light.current.intensity = 3 + Math.sin(t * (counting ? 8 : 3)) * (counting ? 1.2 : 0.6);
      light.current.color.copy(counting ? _padColorCounting : _padColorWaiting);
    }

    if (extractionState.phase === 'waiting') {
      const dx = playerPosition.x - EX;
      const dz = playerPosition.z - EZ;
      if (dx * dx + dz * dz < EXTRACTION_RADIUS * EXTRACTION_RADIUS) {
        beginCountdown();
      }
    } else if (counting && countdownRemaining() <= 0) {
      extractionState.phase = 'success';
      playChoirFinale();
      beaconState.extracted = true;
    }
  });

  return (
    <group ref={group} position={[EX, baseY, EZ]} visible={false}>
      {/* pad ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[EXTRACTION_RADIUS - 0.6, EXTRACTION_RADIUS, 40]} />
        <meshBasicMaterial color="#39ff9a" transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* light column */}
      <mesh ref={beam} position={[0, 30, 0]}>
        <cylinderGeometry args={[1.4, 2.2, 60, 18, 1, true]} />
        <meshBasicMaterial
          color="#39ff9a"
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={light} position={[0, 3, 0]} color="#4dffb0" intensity={3} distance={40} decay={2} />
    </group>
  );
}
