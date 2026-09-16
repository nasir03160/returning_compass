import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { terrainHeightAt } from '../world/terrain';
import { setPermanentNoise, clearPermanentNoise } from '../world/noiseState';
import {
  beaconState,
  CAPTURE_RADIUS,
  CAPTURE_SECONDS,
  type BeaconRuntime,
} from '../world/beaconState';
import { playChoirFragment, CHOIR_SUBTITLES } from '../audio/sfx';
import { showSubtitle } from '../world/subtitleState';

const TOWER_URL = '/assets/broadcast_tower.glb';
useGLTF.preload(TOWER_URL);

const TOWER_HEIGHT = 16; // metres, model normalised to this
const NOISE_KEY = (id: number) => `beacon-${id}`;
// noise while actively capturing vs the permanent hum once lit
const CAPTURE_NOISE = { intensity: 0.85, radius: 42 };
const LIT_NOISE = { intensity: 0.5, radius: 30 };

const _towerMatDone = new WeakSet<THREE.Material>();

function useTowerModel() {
  const { scene } = useGLTF(TOWER_URL);
  return useMemo(() => {
    // darken the shared materials ONCE — scene.clone() shares materials by ref,
    // so mutating them per-instance would stack (0.55^5 ≈ pitch black)
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mm) => {
        const mat = mm as THREE.MeshStandardMaterial;
        if (_towerMatDone.has(mat)) return;
        _towerMatDone.add(mat);
        if (mat.color) mat.color.multiplyScalar(0.55); // it's night — knock it down
        mat.metalness = Math.min(mat.metalness ?? 0.5, 0.6);
        mat.roughness = Math.max(mat.roughness ?? 0.6, 0.6);
      });
    });

    const m = scene.clone(true);
    m.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(m);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = TOWER_HEIGHT / (size.y || 1);
    m.scale.setScalar(s);
    m.updateWorldMatrix(true, true);
    box.setFromObject(m);
    m.position.y -= box.min.y; // sit base on y=0
    m.position.x -= (box.max.x + box.min.x) / 2;
    m.position.z -= (box.max.z + box.min.z) / 2;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = () => null; // never eat a bullet
    });
    return m;
  }, [scene]);
}

export function Beacon({ id }: { id: number }) {
  const b: BeaconRuntime = beaconState.beacons[id];
  const groupRef = useRef<THREE.Group>(null);
  const lampRef = useRef<THREE.PointLight>(null);
  const bulbRef = useRef<THREE.Mesh>(null);
  const model = useTowerModel();

  const baseY = useMemo(() => terrainHeightAt(b.x, b.z) - 0.3, [b.x, b.z]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const dx = playerPosition.x - b.x;
    const dz = playerPosition.z - b.z;
    const inRadius = dx * dx + dz * dz < CAPTURE_RADIUS * CAPTURE_RADIUS;

    if (b.phase === 'unlit' && inRadius) {
      b.phase = 'capturing';
    }

    if (b.phase === 'capturing') {
      if (inRadius) {
        b.progress = Math.min(CAPTURE_SECONDS, b.progress + dt);
        setPermanentNoise(NOISE_KEY(id), b.x, b.z, CAPTURE_NOISE.intensity, CAPTURE_NOISE.radius);
        if (b.progress >= CAPTURE_SECONDS) {
          b.phase = 'lit';
          // Night 2 payoff — fires exactly once: this branch only runs while
          // phase is still 'capturing', and the line above just left it.
          const dist = Math.hypot(dx, dz);
          playChoirFragment(id, dist);
          showSubtitle(CHOIR_SUBTITLES[id] ?? '', 6500);
        }
      } else {
        // leaving pauses the timer (banked progress kept) and silences it
        clearPermanentNoise(NOISE_KEY(id));
      }
    }

    if (b.phase === 'lit') {
      setPermanentNoise(NOISE_KEY(id), b.x, b.z, LIT_NOISE.intensity, LIT_NOISE.radius);
    }

    // --- visuals ---
    const t = state.clock.elapsedTime;
    let lamp = 0;
    let bulb = 0.02;
    if (b.phase === 'capturing') {
      const p = b.progress / CAPTURE_SECONDS;
      const pulse = 0.5 + 0.5 * Math.sin(t * (4 + p * 10));
      lamp = (0.4 + p * 2.2) * pulse;
      bulb = 0.15 + p * 0.7 * pulse;
    } else if (b.phase === 'lit') {
      lamp = 3 + Math.sin(t * 2) * 0.4;
      bulb = 0.9;
    }
    if (lampRef.current) lampRef.current.intensity = lamp;
    if (bulbRef.current) {
      const mat = bulbRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = bulb;
    }
  });

  return (
    <group ref={groupRef} position={[b.x, baseY, b.z]}>
      <primitive object={model} />
      {/* beacon lamp near the top of the mast */}
      <mesh ref={bulbRef} position={[0, TOWER_HEIGHT * 0.92, 0]}>
        <sphereGeometry args={[0.5, 12, 10]} />
        <meshStandardMaterial color="#ff3b28" emissive="#ff3b28" emissiveIntensity={0.02} toneMapped={false} />
      </mesh>
      <pointLight
        ref={lampRef}
        position={[0, TOWER_HEIGHT * 0.92, 0]}
        color="#ff5236"
        intensity={0}
        distance={70}
        decay={2}
      />
    </group>
  );
}
