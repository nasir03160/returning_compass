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

const [EX, EZ] = EXTRACTION_POS;

/**
 * Extraction pad. Hidden until all 5 beacons are lit; then a green light column
 * marks the spot the compass points at. Stepping into the radius flips
 * `beaconState.extracted` (App shows the end screen).
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
    if (beam.current) {
      (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(t * 2);
      beam.current.rotation.y = t * 0.3;
    }
    if (light.current) light.current.intensity = 3 + Math.sin(t * 3) * 0.6;

    if (!beaconState.extracted) {
      const dx = playerPosition.x - EX;
      const dz = playerPosition.z - EZ;
      if (dx * dx + dz * dz < EXTRACTION_RADIUS * EXTRACTION_RADIUS) {
        beaconState.extracted = true;
      }
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
