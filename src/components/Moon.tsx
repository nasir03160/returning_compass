import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { MOON_DIR, MOON_COLOR } from '../world/moon';

const MOON_URL = '/assets/moon.glb';
useGLTF.preload(MOON_URL);

const DISTANCE = 380; // inside the camera far plane, well behind the fog
const DISC_DIAMETER = 26; // world units at DISTANCE — reads as a clear disc, not a dot

function haloTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(200,215,235,0.55)');
  g.addColorStop(0.25, 'rgba(160,185,215,0.22)');
  g.addColorStop(0.6, 'rgba(140,165,200,0.06)');
  g.addColorStop(1, 'rgba(140,165,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Visible moon disc + soft halo, hung in the sky along MOON_DIR — the visual
 *  counterpart to the moonlight DirectionalLight in HorrorAtmosphereLighting. */
export function Moon() {
  const ref = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MOON_URL);
  const halo = useMemo(haloTexture, []);

  const moon = useMemo(() => {
    const s = scene.clone(true);
    s.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = -999; // draw with the sky, just after the star sphere

      const srcMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        | THREE.MeshStandardMaterial
        | undefined;
      const tex = srcMat?.map || srcMat?.emissiveMap || null;
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;

      mesh.material = new THREE.MeshBasicMaterial({
        map: tex,
        color: tex ? new THREE.Color('#e8ecf4') : new THREE.Color(MOON_COLOR),
        fog: false,
        depthWrite: false,
        toneMapped: false,
      });
    });

    s.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const center = new THREE.Vector3();
    box.getCenter(center);
    s.position.sub(center); // re-center on its own pivot
    return { obj: s, scale: DISC_DIAMETER / maxDim };
  }, [scene]);

  useFrame(({ camera }) => {
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <group ref={ref}>
      <group position={MOON_DIR.clone().multiplyScalar(DISTANCE).toArray()}>
        {/* soft halo, always facing the camera */}
        <sprite scale={[DISC_DIAMETER * 3.2, DISC_DIAMETER * 3.2, 1]} renderOrder={-999}>
          <spriteMaterial map={halo} transparent depthWrite={false} fog={false} toneMapped={false} />
        </sprite>
        <group scale={moon.scale}>
          <primitive object={moon.obj} />
        </group>
      </group>
    </group>
  );
}
