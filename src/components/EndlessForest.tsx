import React, { Suspense, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instances, Instance } from '@react-three/drei';
import { RigidBody, CylinderCollider, BallCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { fbm2D } from '../world/noise';
import { terrainHeightAt, ASSET_SINK } from '../world/terrain';
import { insideBeaconClearing } from '../world/beaconState';
import { TreeField, TREE_VARIANT_COUNT, TreeInst } from './TreeField';
import { SafeAsset } from './SafeAsset';
import { GrassPlantsLayer } from './GrassPlants';

/* ------------------------------------------------------------------ *
 *  Endless chunked forest — ultra-dense
 * ------------------------------------------------------------------ */

const CHUNK = 55;
const RADIUS = 2;

// Flat per-chunk density (see generateGrid: positions used to depend on
// distance from the *player's current* chunk, which meant a chunk's trees
// were recomputed to a different layout every time the player crossed a
// chunk boundary — that's what caused both the near-field "open field" look
// and the mid-walk pop-in. Every chunk now gets the same density regardless
// of where the player is standing, so trees exist near/mid/far alike and a
// given chunk's layout never changes once generated for that position.
const TREES_MIN = 26;
const TREES_MAX = 36;
const TREE_MIN_GAP = 2.1; // tight — the forest is meant to feel impassable-ish
const GRASS_PER_CHUNK = 22;
const ROCKS_PER_CHUNK = 6;
const BRANCHES_PER_CHUNK = 4;
const PINE_BUSH_PER_CHUNK = 8;
const THICKET_PER_CHUNK = 5;
const LOG_CHANCE = 0.4;

function hash(x: number, y: number, s = 0): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/* -------- grass tuft (procedural) -------------------------------- */
let _grassTex: THREE.Texture | null = null;
function grassTexture(): THREE.Texture {
  if (_grassTex) return _grassTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 14; i++) {
    const x = 10 + Math.random() * 108;
    const w = 4 + Math.random() * 7;
    const h = 60 + Math.random() * 60;
    const lean = (Math.random() - 0.5) * 26;
    const shade = 90 + Math.floor(Math.random() * 70);
    g.fillStyle = `rgb(${Math.floor(shade * 0.7)},${shade},${Math.floor(shade * 0.5)})`;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.5, 128 - h * 0.6, x + lean, 128 - h);
    g.quadraticCurveTo(x + lean * 0.5 + w, 128 - h * 0.6, x + w, 128);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _grassTex = tex;
  return tex;
}

function grassTuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const q = new THREE.PlaneGeometry(0.6, 0.7).toNonIndexed();
    q.translate(0, 0.35, 0);
    q.rotateY((i * Math.PI) / 3);
    parts.push(q);
  }
  const pArrs = parts.map((g) => g.getAttribute('position').array as Float32Array);
  const nArrs = parts.map((g) => g.getAttribute('normal').array as Float32Array);
  const uArrs = parts.map((g) => g.getAttribute('uv').array as Float32Array);
  const pLen = pArrs.reduce((a, b) => a + b.length, 0);
  const uLen = uArrs.reduce((a, b) => a + b.length, 0);
  const pos = new Float32Array(pLen);
  const nrm = new Float32Array(pLen);
  const uv = new Float32Array(uLen);
  let po = 0;
  let uo = 0;
  for (let i = 0; i < parts.length; i++) {
    pos.set(pArrs[i], po);
    nrm.set(nArrs[i], po);
    po += pArrs[i].length;
    uv.set(uArrs[i], uo);
    uo += uArrs[i].length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/* -------- leafy bush / thicket clusters (procedural) ------------ *
 *  Overlapping displaced dodecahedron blobs — reads as clumpy foliage
 *  rather than geometric cones. Rendered double-sided.
 */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const pc = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(pc * 3);
  let po = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, po);
    po += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

function foliageCluster(
  blobs: { x: number; y: number; z: number; r: number }[],
  wobble: number
): THREE.BufferGeometry {
  const parts = blobs.map((b) =>
    new THREE.DodecahedronGeometry(b.r, 1).toNonIndexed().translate(b.x, b.y, b.z)
  );
  const geo = mergeSimple(parts);
  // push every vertex out/in along its direction from origin by noise
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm2D(v.x * 1.6 + 11, v.z * 1.6 + v.y * 0.8, 3);
    const d = 1 + n * wobble;
    pos.setXYZ(i, v.x * d, Math.max(0, v.y) * d * 0.95 + v.y * 0.05, v.z * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

function bushGeometry(): THREE.BufferGeometry {
  return foliageCluster(
    [
      { x: 0, y: 0.45, z: 0, r: 0.55 },
      { x: 0.4, y: 0.55, z: 0.15, r: 0.42 },
      { x: -0.35, y: 0.5, z: -0.2, r: 0.4 },
      { x: 0.1, y: 0.85, z: -0.1, r: 0.38 },
      { x: -0.15, y: 0.35, z: 0.35, r: 0.36 },
    ],
    0.35
  );
}

function thicketGeometry(): THREE.BufferGeometry {
  return foliageCluster(
    [
      { x: 0, y: 0.6, z: 0, r: 0.8 },
      { x: 0.9, y: 0.7, z: 0.2, r: 0.6 },
      { x: -0.8, y: 0.55, z: -0.3, r: 0.6 },
      { x: 0.2, y: 1.15, z: -0.2, r: 0.55 },
      { x: -0.3, y: 1.0, z: 0.6, r: 0.5 },
      { x: 0.6, y: 0.4, z: -0.7, r: 0.5 },
      { x: -0.6, y: 0.4, z: 0.7, r: 0.5 },
      { x: 0.1, y: 1.6, z: 0.1, r: 0.42 },
    ],
    0.4
  );
}

/* -------- per-grid generation ----------------------------------- */
interface Scatter {
  key: string;
  pos: [number, number, number];
  rotY: number;
  scale: number;
}

function generateGrid(ccx: number, ccz: number) {
  const trees: TreeInst[] = [];
  const grass: Scatter[] = [];
  const dryGrass: Scatter[] = [];
  const branches: Scatter[] = [];
  const rocks: Scatter[] = [];
  const logs: Scatter[] = [];
  const pineBushes: Scatter[] = [];
  const thickets: Scatter[] = [];

  for (let gx = ccx - RADIUS; gx <= ccx + RADIUS; gx++) {
    for (let gz = ccz - RADIUS; gz <= ccz + RADIUS; gz++) {
      const baseX = gx * CHUNK;
      const baseZ = gz * CHUNK;
      const originChunk = gx === 0 && gz === 0;

      // Density and placement depend ONLY on this chunk's own absolute (gx,gz) —
      // never on the player's current chunk — so a chunk's tree layout is fixed
      // forever once generated for that position, regardless of which direction
      // the player approaches from or how many times the radius re-triggers.
      const tCount = TREES_MIN + Math.floor(hash(gx, gz, 1) * (TREES_MAX - TREES_MIN + 1));
      const placed: [number, number][] = [];
      for (let i = 0; i < tCount; i++) {
        const rx = hash(gx, gz, i * 5 + 10);
        const rz = hash(gx, gz, i * 5 + 11);
        const x = baseX + (rx - 0.5) * CHUNK;
        const z = baseZ + (rz - 0.5) * CHUNK;
        // small clearing right at spawn so the player isn't boxed in on load
        if (originChunk && x * x + z * z < 20) continue;
        // keep the beacon towers out in the open
        if (insideBeaconClearing(x, z)) continue;

        let tooClose = false;
        for (const [px, pz] of placed) {
          if ((px - x) * (px - x) + (pz - z) * (pz - z) < TREE_MIN_GAP * TREE_MIN_GAP) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        placed.push([x, z]);

        // weighted: the heavy twisted-tree variant (0) is rare; maples fill in.
        const vr = hash(gx, gz, i * 5 + 12);
        const variant =
          vr < 0.1 ? 0 : 1 + Math.floor(((vr - 0.1) / 0.9) * (TREE_VARIANT_COUNT - 1));
        trees.push({
          key: `t_${gx}_${gz}_${i}`,
          variant,
          // bury the trunk base well under the leaf surface — no floating gap
          pos: [x, terrainHeightAt(x, z) - ASSET_SINK, z],
          rotY: hash(gx, gz, i * 5 + 13) * Math.PI * 2,
          scale: 0.8 + hash(gx, gz, i * 5 + 14) * 0.5, // 0.8 – 1.3
          yScale: 1.6 + hash(gx, gz, i * 5 + 15) * 0.5, // 1.6 – 2.1
          wScale: 1.05 + hash(gx, gz, i * 5 + 16) * 0.35,
        });
      }

      // every scattered asset stores the exact terrain surface Y at its (x,z)
      const scatter = (arr: Scatter[], n: number, seed: number, sMin: number, sRange: number) => {
        for (let i = 0; i < n; i++) {
          const x = baseX + (hash(gx, gz, seed + i * 3) - 0.5) * CHUNK;
          const z = baseZ + (hash(gx, gz, seed + i * 3 + 1) - 0.5) * CHUNK;
          if (insideBeaconClearing(x, z)) continue;
          arr.push({
            key: `${seed}_${gx}_${gz}_${i}`,
            pos: [x, terrainHeightAt(x, z), z],
            rotY: hash(gx, gz, seed + i * 3 + 2) * Math.PI * 2,
            scale: sMin + hash(gx, gz, seed + i * 7 + 5) * sRange,
          });
        }
      };

      scatter(grass, GRASS_PER_CHUNK, 200, 0.6, 0.9);
      scatter(dryGrass, 16, 1200, 0.75, 0.6);
      scatter(branches, BRANCHES_PER_CHUNK, 3200, 0.7, 0.9);
      scatter(rocks, ROCKS_PER_CHUNK, 2200, 0.22, 0.55);
      scatter(pineBushes, PINE_BUSH_PER_CHUNK, 5100, 0.7, 0.8);
      scatter(thickets, THICKET_PER_CHUNK, 6300, 0.9, 0.9);

      if (hash(gx, gz, 900) < LOG_CHANCE && !originChunk) {
        const lx = baseX + (hash(gx, gz, 901) - 0.5) * CHUNK * 0.7;
        const lz = baseZ + (hash(gx, gz, 902) - 0.5) * CHUNK * 0.7;
        if (!insideBeaconClearing(lx, lz)) {
          logs.push({
            key: `log_${gx}_${gz}`,
            pos: [lx, terrainHeightAt(lx, lz) - ASSET_SINK, lz],
            rotY: hash(gx, gz, 903) * Math.PI * 2,
            scale: 0.9 + hash(gx, gz, 904) * 0.5,
          });
        }
      }
    }
  }

  return { trees, grass, dryGrass, branches, rocks, logs, pineBushes, thickets };
}


/* Procedural fallen log — the supplied mossy_old_tree_log.glb carried ~22 MB of
 * 4K PBR textures that blew VRAM on load. This is a tapered cylinder with a
 * dark bark material; reads fine at fog distance. */
const LOG_GEO = new THREE.CylinderGeometry(0.32, 0.42, 5.2, 7, 1);
LOG_GEO.rotateZ(Math.PI / 2); // lie it on its side (long axis = X)
const LOG_MAT = new THREE.MeshStandardMaterial({ color: '#241c14', roughness: 1, metalness: 0 });
const MOSS_MAT = new THREE.MeshStandardMaterial({ color: '#2f3a1c', roughness: 1, emissive: '#0c1206', emissiveIntensity: 0.2 });

function Logs({ items }: { items: Scatter[] }) {
  return (
    <>
      {items.map((l) => (
        <RigidBody key={l.key} type="fixed" colliders={false} position={l.pos} rotation={[0, l.rotY, 0]}>
          <CylinderCollider
            args={[(5.2 * l.scale) / 2, 0.42 * l.scale + 0.1]}
            rotation={[0, 0, Math.PI / 2]}
            position={[0, 0.42 * l.scale, 0]}
          />
          <group scale={l.scale} position={[0, 0.4, 0]}>
            <mesh geometry={LOG_GEO} material={LOG_MAT} />
            <mesh geometry={LOG_GEO} material={MOSS_MAT} scale={[1, 1.04, 0.55]} position={[0, 0.18, 0]} />
          </group>
        </RigidBody>
      ))}
    </>
  );
}

/** scatter position lifted/sunk by a per-asset offset relative to the terrain */
const atGround = (s: Scatter, off: number): [number, number, number] => [
  s.pos[0],
  s.pos[1] + off,
  s.pos[2],
];

/* -------- near-player colliders for ground scatter -------------- */
function ScatterColliders({
  rocks,
  thickets,
  bushes,
}: {
  rocks: Scatter[];
  thickets: Scatter[];
  bushes: Scatter[];
}) {
  const [near, setNear] = useState<{
    rocks: Scatter[];
    thickets: Scatter[];
    bushes: Scatter[];
  }>({ rocks: [], thickets: [], bushes: [] });
  const last = useRef<[number, number]>([1e9, 1e9]);

  useFrame(() => {
    const dx = playerPosition.x - last.current[0];
    const dz = playerPosition.z - last.current[1];
    if (dx * dx + dz * dz < 64) return;
    last.current = [playerPosition.x, playerPosition.z];
    const R = 26;
    const inRange = (s: Scatter) => {
      const ex = s.pos[0] - playerPosition.x;
      const ez = s.pos[2] - playerPosition.z;
      return ex * ex + ez * ez < R * R;
    };
    setNear({
      rocks: rocks.filter((r) => r.scale > 0.32 && inRange(r)),
      thickets: thickets.filter(inRange),
      bushes: bushes.filter((b) => b.scale > 1.0 && inRange(b)),
    });
  });

  return (
    <>
      {near.rocks.map((r) => (
        <RigidBody
          key={r.key}
          type="fixed"
          colliders={false}
          position={[r.pos[0], r.pos[1] - ASSET_SINK + r.scale * 0.8, r.pos[2]]}
        >
          <BallCollider args={[r.scale * 0.9]} />
        </RigidBody>
      ))}
      {near.thickets.map((t) => (
        <RigidBody key={t.key} type="fixed" colliders={false} position={[t.pos[0], t.pos[1] - ASSET_SINK, t.pos[2]]}>
          <CylinderCollider args={[t.scale * 0.8, t.scale * 1.1]} position={[0, t.scale * 0.8 + ASSET_SINK, 0]} />
        </RigidBody>
      ))}
      {near.bushes.map((b) => (
        <RigidBody key={b.key} type="fixed" colliders={false} position={[b.pos[0], b.pos[1] - ASSET_SINK, b.pos[2]]}>
          <CylinderCollider args={[b.scale * 0.5, b.scale * 0.6]} position={[0, b.scale * 0.5 + ASSET_SINK, 0]} />
        </RigidBody>
      ))}
    </>
  );
}

/* ================================================================ */
export function EndlessForest() {
  const grassGeo = useMemo(grassTuftGeometry, []);
  const grassMap = useMemo(grassTexture, []);
  const bushGeo = useMemo(bushGeometry, []);
  const thicketGeo = useMemo(thicketGeometry, []);

  const [cell, setCell] = useState<[number, number]>([0, 0]);
  const cellRef = useRef(cell);
  cellRef.current = cell;

  useFrame(() => {
    const cx = Math.round(playerPosition.x / CHUNK);
    const cz = Math.round(playerPosition.z / CHUNK);
    if (cx !== cellRef.current[0] || cz !== cellRef.current[1]) setCell([cx, cz]);
  });

  const g = useMemo(() => generateGrid(cell[0], cell[1]), [cell]);

  return (
    <group name="endless-forest">
      <TreeField trees={g.trees} />
      <ScatterColliders rocks={g.rocks} thickets={g.thickets} bushes={g.pineBushes} />

      <Suspense fallback={null}>
        <Logs items={g.logs} />
      </Suspense>

      {/* Fine grass tufts. Fixed `limit` + no per-chunk key: a limit/key that
          changes on every chunk crossing forces drei to fully reallocate (an
          unmount/remount under the hood) — that's what was causing scatter
          props to visibly pop while walking, on top of being expensive. */}
      <Instances limit={600} range={g.grass.length} geometry={grassGeo} receiveShadow>
        <meshStandardMaterial
          map={grassMap}
          alphaMap={grassMap}
          alphaTest={0.4}
          transparent
          side={THREE.DoubleSide}
          color="#556a38"
          roughness={0.85}
          emissive="#101a0a"
          emissiveIntensity={0.35}
        />
        {g.grass.map((s) => (
          <Instance key={s.key} position={atGround(s, -0.05)} rotation={[0, s.rotY, 0]} scale={[s.scale, s.scale * 1.1, s.scale]} />
        ))}
      </Instances>

      {/* real ground-cover plants (trimmed grass_plants.glb) — isolated so a
          missing/bad file drops only this decorative layer, not the trees */}
      <SafeAsset fallback={null}>
        <GrassPlantsLayer items={g.dryGrass} />
      </SafeAsset>

      {/* Leafy bushes */}
      <Instances limit={250} range={g.pineBushes.length} geometry={bushGeo} castShadow receiveShadow>
        <meshStandardMaterial
          color="#1e2c16"
          roughness={1}
          metalness={0}
          side={THREE.DoubleSide}
          emissive="#0a1206"
          emissiveIntensity={0.25}
          flatShading
        />
        {g.pineBushes.map((s) => (
          <Instance key={s.key} position={atGround(s, -ASSET_SINK)} rotation={[0, s.rotY, 0]} scale={[s.scale, s.scale * (0.8 + s.scale * 0.35), s.scale]} />
        ))}
      </Instances>

      {/* Thickets — bigger, denser bramble clumps */}
      <Instances limit={160} range={g.thickets.length} geometry={thicketGeo} castShadow receiveShadow>
        <meshStandardMaterial
          color="#232d15"
          roughness={1}
          metalness={0}
          side={THREE.DoubleSide}
          emissive="#0b1305"
          emissiveIntensity={0.22}
          flatShading
        />
        {g.thickets.map((s) => (
          <Instance key={s.key} position={atGround(s, -ASSET_SINK)} rotation={[0, s.rotY, 0]} scale={[s.scale * 1.1, s.scale * (0.9 + s.scale * 0.3), s.scale * 1.1]} />
        ))}
      </Instances>

      {/* Fallen branches — small/thin, not worth a shadow-casting pass */}
      <Instances limit={130} range={g.branches.length} receiveShadow>
        <cylinderGeometry args={[0.04, 0.06, 1.6, 5]} />
        <meshStandardMaterial color="#241a10" roughness={1} />
        {g.branches.map((s) => (
          <Instance
            key={s.key}
            position={atGround(s, 0.04)}
            rotation={[Math.PI / 2, s.rotY, s.rotY * 0.3]}
            scale={[s.scale, s.scale * (0.7 + s.scale), s.scale]}
          />
        ))}
      </Instances>

      {/* Ground rocks (planted / half-buried) — small, not worth a shadow-casting pass */}
      <Instances limit={180} range={g.rocks.length} receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#15100b" roughness={0.95} metalness={0.04} flatShading />
        {g.rocks.map((s) => (
          <Instance
            key={s.key}
            position={atGround(s, -ASSET_SINK + s.scale * 0.8)}
            rotation={[s.rotY * 0.5, s.rotY, s.rotY * 0.3]}
            scale={[s.scale * 1.3, s.scale * 0.8, s.scale]}
          />
        ))}
      </Instances>
    </group>
  );
}
