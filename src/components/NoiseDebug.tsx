import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { noiseState, activeNoiseEvents } from '../world/noiseState';
import { terrainHeightAt } from '../world/terrain';

const POOL = 32;

/** [N] toggle — a translucent sphere at every active noise event, radius = its
 *  hearing radius. Same throwaway-overlay pattern as the [H] hitbox view. */
export function NoiseDebug() {
  const group = useRef<THREE.Group>(null);

  const spheres = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    return Array.from({ length: POOL }, () => {
      const mat = new THREE.MeshBasicMaterial({
        color: '#39d0ff',
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        wireframe: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      return mesh;
    });
  }, []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const on = noiseState.debug;
    g.visible = on;
    if (!on) return;
    const events = activeNoiseEvents();
    for (let i = 0; i < POOL; i++) {
      const s = spheres[i];
      const e = events[i];
      if (!e) {
        s.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(e.x, terrainHeightAt(e.x, e.z) + 0.5, e.z);
      s.scale.setScalar(Math.max(0.5, e.radius));
      const permanent = !Number.isFinite(e.expiresAt);
      (s.material as THREE.MeshBasicMaterial).color.set(permanent ? '#ff5a3c' : '#39d0ff');
      (s.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.14 * Math.min(1, e.intensity);
    }
  });

  return <group ref={group}>{spheres.map((s, i) => <primitive key={i} object={s} />)}</group>;
}
