import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MOON_DIR, MOON_COLOR } from '../world/moon';

const DISTANCE = 380;
const DISC_DIAMETER = 26;

function haloTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(220,228,240,0.9)');
  g.addColorStop(0.18, 'rgba(200,215,235,0.55)');
  g.addColorStop(0.45, 'rgba(160,185,215,0.22)');
  g.addColorStop(1, 'rgba(140,165,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * `moon.glb` fallback — used by <SafeAsset> when the real model is missing.
 * No GLB dependency at all: a plain unlit disc + the same halo sprite, so the
 * sky still reads correctly instead of just going blank.
 */
export function MoonFallback() {
  const ref = useRef<THREE.Group>(null);
  const halo = useMemo(haloTexture, []);

  useFrame(({ camera }) => {
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <group ref={ref}>
      <group position={MOON_DIR.clone().multiplyScalar(DISTANCE).toArray()}>
        <sprite scale={[DISC_DIAMETER * 3.2, DISC_DIAMETER * 3.2, 1]} renderOrder={-999}>
          <spriteMaterial map={halo} transparent depthWrite={false} fog={false} toneMapped={false} />
        </sprite>
        {/* sprite, not a mesh — always faces the camera regardless of view angle */}
        <sprite scale={[DISC_DIAMETER, DISC_DIAMETER, 1]} renderOrder={-999}>
          <spriteMaterial color={MOON_COLOR} fog={false} depthWrite={false} toneMapped={false} />
        </sprite>
      </group>
    </group>
  );
}
