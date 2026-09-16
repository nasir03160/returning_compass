import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { terrainHeightAt } from '../world/terrain';
import { beaconState } from '../world/beaconState';

/**
 * Night 3's "one environmental detail per lit beacon" — a procedural cluster
 * of root tendrils with a few bioluminescent pods, radiating from the tower
 * base. Purely visual, reuses the low-poly-procedural-prop budget already
 * established for AmmoBoxes/EndlessForest's logs (no GLB, no texture).
 *
 * Reads `beaconState.beacons[id].phase` imperatively in useFrame — same
 * pattern Beacon.tsx and Extraction.tsx already use for plain-singleton state
 * that doesn't trigger React re-renders on its own — rather than editing
 * Beacon.tsx to add this (kept as a fully separate component reading the same
 * shared state, per Night 3's "no Beacon.tsx capture-logic changes" scope).
 */
const ROOT_COUNT = 6;
const POD_PER_ROOT = 2;

function useGrowthModel() {
  return useMemo(() => {
    const g = new THREE.Group();
    const barkMat = new THREE.MeshStandardMaterial({ color: '#241d12', roughness: 1, metalness: 0 });
    const podMat = new THREE.MeshStandardMaterial({
      color: '#6b3a1c',
      emissive: '#8fdc7a',
      emissiveIntensity: 0.5,
      roughness: 0.6,
      metalness: 0,
      toneMapped: false,
    });
    const podGeo = new THREE.SphereGeometry(0.07, 8, 6);

    for (let i = 0; i < ROOT_COUNT; i++) {
      const ang = (i / ROOT_COUNT) * Math.PI * 2 + (i % 2) * 0.3;
      const len = 1.1 + (i % 3) * 0.35;
      const rootGeo = new THREE.CylinderGeometry(0.03, 0.09, len, 5, 1);
      rootGeo.translate(0, len / 2, 0);
      rootGeo.rotateZ(Math.PI / 2 - 0.35 - (i % 2) * 0.15); // lean outward, mostly along the ground
      const root = new THREE.Mesh(rootGeo, barkMat);
      root.rotation.y = ang;
      g.add(root);

      // a couple of glowing pods along each tendril
      for (let p = 0; p < POD_PER_ROOT; p++) {
        const t = 0.35 + p * 0.4;
        const pod = new THREE.Mesh(podGeo, podMat);
        const r = t * len * 0.9;
        pod.position.set(Math.cos(ang) * r, 0.05 + t * 0.25, Math.sin(ang) * r);
        pod.userData.isPod = true;
        g.add(pod);
      }
    }
    return g;
  }, []);
}

function GrowthInstance({ id }: { id: number }) {
  const b = beaconState.beacons[id];
  const groupRef = useRef<THREE.Group>(null);
  const model = useGrowthModel();

  const instance = useMemo(() => {
    const obj = model.clone(true);
    const pods: THREE.Mesh[] = [];
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.isPod) pods.push(o as THREE.Mesh);
    });
    return { obj, pods };
  }, [model]);

  const baseY = useMemo(() => terrainHeightAt(b.x, b.z) - 0.05, [b.x, b.z]);
  const rotY = useMemo(() => (b.id * 137.5) % (Math.PI * 2), [b.id]); // stable per-beacon rotation

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const lit = b.phase === 'lit';
    g.visible = lit;
    if (!lit) return;
    const t = state.clock.elapsedTime;
    const pulse = 0.6 + 0.4 * Math.sin(t * 1.6 + b.id);
    for (const pod of instance.pods) {
      (pod.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + pulse * 0.5;
    }
  });

  return (
    <group ref={groupRef} position={[b.x, baseY, b.z]} rotation={[0, rotY, 0]} visible={false}>
      <primitive object={instance.obj} />
    </group>
  );
}

export function RootGrowths() {
  return (
    <>
      {beaconState.beacons.map((b) => (
        <GrowthInstance key={b.id} id={b.id} />
      ))}
    </>
  );
}
