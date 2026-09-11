import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { weaponState } from '../world/weaponState';
import { terrainHeightAt } from '../world/terrain';
import { BEACON_POSITIONS } from '../world/beaconState';

const PICKUP_RADIUS = 2.2;
const REFILL_AMOUNT = 120;
const RESPAWN_MS = 25_000;

// the two starter crates + one beside every beacon (offset out of the tower base)
const SPOTS: [number, number][] = [
  [3.5, -7],
  [-4.5, -13],
  ...BEACON_POSITIONS.map(([x, z]): [number, number] => [x + 3.5, z + 3.5]),
];

/* procedural crate — the supplied ammo_box.glb carried ~28 MB of 4K textures
 * which blew VRAM, so it's a simple box now. */
function useCrate() {
  return useMemo(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.32, 0.34),
      new THREE.MeshStandardMaterial({ color: '#4b5238', roughness: 0.85, metalness: 0.05, emissive: '#20240f', emissiveIntensity: 0.4 })
    );
    body.position.y = 0.16;
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.06, 0.36),
      new THREE.MeshStandardMaterial({ color: '#3a4030', roughness: 0.9 })
    );
    lid.position.y = 0.35;
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.34, 0.36),
      new THREE.MeshStandardMaterial({ color: '#2a2c22', roughness: 1 })
    );
    strap.position.set(0.14, 0.17, 0);
    g.add(body, lid, strap);
    return g;
  }, []);
}

function AmmoBox({ x, z, crate }: { x: number; z: number; crate: THREE.Group }) {
  const ref = useRef<THREE.Group>(null);
  const takenUntil = useRef(0);
  const obj = useMemo(() => crate.clone(true), [crate]);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const now = performance.now();
    const gone = now < takenUntil.current;
    g.visible = !gone;
    if (gone) return;

    const t = state.clock.elapsedTime;
    g.rotation.y = t * 0.5;
    g.position.y = terrainHeightAt(x, z) + 0.12 + Math.sin(t * 2) * 0.04;

    const dx = playerPosition.x - x;
    const dz = playerPosition.z - z;
    if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && weaponState.reserve < 500) {
      weaponState.reserve += REFILL_AMOUNT;
      takenUntil.current = now + RESPAWN_MS;
    }
  });

  return (
    <group ref={ref} position={[x, 0, z]}>
      <primitive object={obj} />
      <pointLight color="#c8b46a" intensity={0.4} distance={2.5} decay={2} position={[0, 0.4, 0]} />
    </group>
  );
}

/** Walk over a glowing ammo crate to top up reserve rounds. */
export function AmmoBoxes() {
  const crate = useCrate();
  return (
    <>
      {SPOTS.map(([x, z], i) => (
        <AmmoBox key={i} x={x} z={z} crate={crate} />
      ))}
    </>
  );
}
