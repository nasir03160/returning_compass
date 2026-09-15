import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { fbm2D } from '../world/noise';

/**
 * Overhead foliage canopy — discrete trees can't close over your head, so this
 * is a dark, alpha-mottled leaf sheet ~16 m up that follows the player, blocks
 * most of the sky, and lets only small pinpricks of moonlight through.
 * Deliberately doesn't cast a shadow (see below) — the dappled-light look
 * comes from its own alpha-mottled texture blocking the sky, not real-time
 * shadow casting.
 */
const HEIGHT = 16;
const SPAN = 130;
const SNAP = 20;

let _leafTex: THREE.Texture | null = null;
function canopyTexture(): THREE.Texture {
  if (_leafTex) return _leafTex;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // clumpy foliage mask: near-solid cover, only a few pinprick gaps (~85%+)
      const n = fbm2D(x * 0.02, y * 0.02, 4) * 0.6 + fbm2D(x * 0.08, y * 0.08, 3) * 0.4;
      const fine = fbm2D(x * 0.35, y * 0.35, 2);
      let a = 0.9 + n * 0.35 + fine * 0.08;
      a = Math.max(0, Math.min(1, a));
      // punch just a handful of hard holes for moonlight pinpricks
      if (n < -0.58 && fine < -0.2) a = 0;
      const shade = 12 + (n * 0.5 + 0.5) * 26; // very dark green-brown
      const i = (y * S + x) * 4;
      img.data[i] = shade * 0.8;
      img.data[i + 1] = shade;
      img.data[i + 2] = shade * 0.55;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  _leafTex = tex;
  return tex;
}

export function CanopyLayer() {
  const ref = useRef<THREE.Group>(null);
  const originRef = useRef<[number, number]>([0, 0]);
  const tex = useMemo(canopyTexture, []);

  useFrame(() => {
    const sx = Math.round(playerPosition.x / SNAP) * SNAP;
    const sz = Math.round(playerPosition.z / SNAP) * SNAP;
    if (sx !== originRef.current[0] || sz !== originRef.current[1]) {
      originRef.current = [sx, sz];
      if (ref.current) ref.current.position.set(sx, 0, sz);
      tex.offset.set((sx / SPAN) * 3, -(sz / SPAN) * 3);
    }
  });

  return (
    <group ref={ref}>
      {/* two slightly offset layers = thicker, more broken cover.
          No castShadow: this is a huge (130x130) alpha-tested plane 16m up —
          shadow-casting it means an expensive per-fragment alpha-tested depth
          pass every frame for a shadow the flashlight's tight, forward-facing
          22-unit frustum essentially never actually reaches. */}
      <mesh position={[0, HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SPAN, SPAN]} />
        <meshStandardMaterial
          map={tex}
          alphaMap={tex}
          transparent
          alphaTest={0.35}
          side={THREE.DoubleSide}
          color="#1c2416"
          roughness={1}
          metalness={0}
          depthWrite
        />
      </mesh>
      <mesh position={[6, HEIGHT + 3.5, -5]} rotation={[Math.PI / 2, 0.15, 0.3]}>
        <planeGeometry args={[SPAN, SPAN]} />
        <meshStandardMaterial
          map={tex}
          alphaMap={tex}
          transparent
          alphaTest={0.4}
          side={THREE.DoubleSide}
          color="#141b10"
          roughness={1}
          metalness={0}
          depthWrite
        />
      </mesh>
    </group>
  );
}
