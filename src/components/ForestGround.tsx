import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { terrainHeightAt } from '../world/terrain';
import { fbm2D } from '../world/noise';
import { nearestLitBeaconDist, ROOT_SIGNAL_RADIUS } from '../world/beaconState';

/* ---- tuning --------------------------------------------------- */
const SPAN = 150; // one big ground mesh, this wide (fog hides the edge)
const SEGMENTS = 110; // grid resolution — enough to read real curvature, cheap to move
const SNAP = 34; // re-anchor the mesh every N units of travel
const TEX_WORLD = 9; // texture repeats every N world units
const DISPLACE_FRAMES = 6; // spread the vertex update over this many frames

// Night 3 — ground colour lerps toward this near a lit beacon (same radius +
// intent as the fog tint in HorrorAtmosphereLighting.tsx: a gradual "this
// patch of dirt looks wrong," not a hard-edged colour swap).
const GROUND_BASE_COLOR = '#8a9270';
const GROUND_ROOT_TINT = '#6b6a3f';
const _groundBase = new THREE.Color(GROUND_BASE_COLOR);
const _groundTint = new THREE.Color(GROUND_ROOT_TINT);

/**
 * Always-mounted physics floor + a plain dark fallback plane.
 * OUTSIDE any <Suspense> so the player can never fall through while the detailed
 * ground is still loading (or if it fails).
 */
export function GroundPlane() {
  const [cell, setCell] = useState<[number, number]>([0, 0]);
  const ref = useRef(cell);
  ref.current = cell;

  useFrame(() => {
    const cx = Math.round(playerPosition.x / 60);
    const cz = Math.round(playerPosition.z / 60);
    if (cx !== ref.current[0] || cz !== ref.current[1]) setCell([cx, cz]);
  });

  return (
    <RigidBody type="fixed" colliders={false} position={[cell[0] * 60, 0, cell[1] * 60]}>
      <CuboidCollider args={[400, 0.3, 400]} position={[0, -0.25, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#100d09" roughness={1} metalness={0} />
      </mesh>
    </RigidBody>
  );
}

/**
 * Procedural mottled dirt/moss ground texture — canvas-baked, no GLB.
 * (A supplied `ground.glb` used to drive this; its mesh wasn't a flat tile —
 * scaling its own shape to fill a square produced a bizarre cross/plus-shaped
 * artifact on the ground, and its 54k-vertex mesh + three 1-2MB textures were
 * a chunk of the frame-time cost. Fully procedural fixes both.)
 */
function groundTexture(): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  // smoothstep-style contrast curve — pushes mid-grey fbm output toward the
  // extremes so mossy patches read as distinct blobs instead of a flat wash.
  // Without this the texture technically varies but the contrast is so low
  // (see dirt/moss below) it's imperceptible under the flashlight — which is
  // exactly what read as "the ground isn't there" even though a real,
  // correctly-lit mesh was underneath it the whole time.
  const contrast = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = x * 0.09;
      const wy = y * 0.09;
      // large mossy patches + fine dirt grain, layered
      const patch = fbm2D(wx * 0.3, wy * 0.3, 3) * 0.5 + 0.5;
      const grain = fbm2D(wx * 2.2 + 40, wy * 2.2 + 40, 2) * 0.5 + 0.5;
      // contrast() applied twice = a steeper S-curve — punchier, more clearly
      // separated blobs of dirt vs. moss rather than a soft gradient between
      // them (a single pass still read as too flat/subtle in practice).
      const t = contrast(contrast(Math.max(0, Math.min(1, patch * 0.75 + grain * 0.25))));
      // dark dirt -> visible moss — a much wider RGB spread than before so the
      // interpolation actually shows up once multiplied by the material's
      // tint colour and the scene's dim ambient/flashlight lighting.
      const dirt = [8, 6, 3];
      const moss = [90, 106, 54];
      const r = dirt[0] + (moss[0] - dirt[0]) * t;
      const g = dirt[1] + (moss[1] - dirt[1]) * t;
      const b = dirt[2] + (moss[2] - dirt[2]) * t;
      const i = (y * S + x) * 4;
      const speck = grain > 0.85 ? 22 : 0; // small bright grit/leaf flecks
      img.data[i] = r + speck;
      img.data[i + 1] = g + speck;
      img.data[i + 2] = b + speck * 0.8;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // RepeatWrapping on both axes: the ground's UVs are world-locked (set below
  // in useGroundBase, `uv = worldPos / TEX_WORLD`) rather than 0..1-per-tile,
  // so a large mesh reads as many small repeats of one seamless-ish texture
  // instead of one texture stretched huge (which is what actually causes a
  // ground plane to look flat/washed-out or "solid black" at a distance —
  // not the material settings themselves).
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4; // keeps the tiling crisp at a grazing flashlight angle
  return tex;
}

interface GroundBase {
  geo: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

function useGroundBase(): GroundBase {
  return useMemo(() => {
    // regular grid, centred on origin — displaced + UV'd below
    const geo = new THREE.PlaneGeometry(SPAN, SPAN, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2); // lie flat (PlaneGeometry is XY by default)

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeightAt(x, z));
      uv.setXY(i, x / TEX_WORLD, z / TEX_WORLD);
    }
    geo.computeVertexNormals();

    const map = groundTexture();
    const material = new THREE.MeshStandardMaterial({
      map, // procedural mottled dirt/moss texture (groundTexture(), above)
      color: GROUND_BASE_COLOR, // tints the texture rather than washing it grey
      // High roughness = a matte, diffuse-dominated surface (dirt/leaf litter,
      // not polished stone) — this is what lets the hemisphere/ambient fill
      // light actually show up as a visible (if dim) silhouette instead of
      // the surface either mirroring the black sky or absorbing everything.
      roughness: 0.85,
      // A touch of metalness (not 0) puts a small, tight specular highlight
      // under the flashlight — reads as damp ground/wet leaves catching the
      // beam, rather than a perfectly flat, lightless plane.
      metalness: 0.05,
    });

    return { geo, material };
  }, []);
}

export function ForestGround() {
  const { geo, material } = useGroundBase();
  const meshRef = useRef<THREE.Mesh>(null);
  const anchor = useRef<[number, number]>([1e9, 1e9]);
  const job = useRef<{ ox: number; oz: number; i: number } | null>(null);

  useEffect(() => {
    return () => {
      geo.dispose();
      material.map?.dispose();
      material.dispose();
    };
  }, [geo, material]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Night 3 — same distance-based tint lerp as the fog, applied to the
    // ground material's colour (which multiplies the procedural texture).
    const dLit = nearestLitBeaconDist(playerPosition.x, playerPosition.z);
    const k = Math.max(0, Math.min(1, 1 - dLit / ROOT_SIGNAL_RADIUS));
    material.color.copy(_groundBase).lerp(_groundTint, k);

    const sx = Math.round(playerPosition.x / SNAP) * SNAP;
    const sz = Math.round(playerPosition.z / SNAP) * SNAP;
    if (sx !== anchor.current[0] || sz !== anchor.current[1]) {
      anchor.current = [sx, sz];
      mesh.position.set(sx, 0, sz);
      job.current = { ox: sx, oz: sz, i: 0 }; // begin a spread displacement
      material.map!.offset.set(sx / TEX_WORLD, -sz / TEX_WORLD);
    }

    // process a slice of the vertex update per frame (no stutter)
    if (job.current) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const per = Math.ceil(pos.count / DISPLACE_FRAMES);
      const end = Math.min(pos.count, job.current.i + per);
      for (let k = job.current.i; k < end; k++) {
        pos.setY(k, terrainHeightAt(pos.getX(k) + job.current.ox, pos.getZ(k) + job.current.oz));
      }
      job.current.i = end;
      pos.needsUpdate = true;
      if (end >= pos.count) {
        // re-slope the normals once the whole tile has its new heights — cheap
        // at this vertex count (~12k) and only happens once per 34 units walked
        geo.computeVertexNormals();
        job.current = null;
      }
    }
  });

  return <mesh ref={meshRef} name="forest-ground" geometry={geo} material={material} receiveShadow />;
}
