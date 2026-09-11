import React, { useMemo, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, Instances, Instance } from '@react-three/drei';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { terrainHeightAt, ASSET_SINK } from '../world/terrain';

useGLTF.preload('/assets/S1Tree1.glb');
useGLTF.preload('/assets/S1Tree2.glb');

export interface TreeInst {
  key: string;
  variant: number;
  pos: [number, number, number];
  rotY: number;
  /** uniform random size 0.8–1.3 */
  scale: number;
  yScale: number;
  wScale: number;
}

interface Variant {
  trunkGeo: THREE.BufferGeometry;
  trunkMat: THREE.Material;
  leafGeo: THREE.BufferGeometry;
  leafMat: THREE.Material;
  height: number;
  /** trunk radius at the base (metres, at scale 1) for colliders */
  trunkRadius: number;
}

const COLLIDER_RADIUS = 22; // plenty past the flashlight's visible range; fewer live colliders
const COLLIDER_REBUILD = 14; // rebuild less often — each rebuild churns Rapier bodies and can hitch

function nightTune(mat: THREE.MeshStandardMaterial, isBark: boolean) {
  const m = mat.clone();
  if (isBark) {
    m.color.lerp(new THREE.Color('#20160e'), 0.6);
    m.roughness = 0.96;
  } else {
    m.color.lerp(new THREE.Color('#5f2f14'), 0.55);
    m.roughness = 0.75;
    m.emissive = new THREE.Color('#140803');
    m.emissiveIntensity = 0.3;
    m.side = THREE.DoubleSide;
  }
  m.needsUpdate = true;
  return m;
}

/** Snap a matrix's rotation to clean 90° steps and drop its translation —
 *  removes any sub-90° lean baked into the source model so trunks are vertical. */
function uprightMatrix(src: THREE.Matrix4): THREE.Matrix4 {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  src.decompose(pos, quat, scale);
  const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  const half = Math.PI / 2;
  e.x = Math.round(e.x / half) * half;
  e.y = 0; // Y handled per-instance
  e.z = Math.round(e.z / half) * half;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion().setFromEuler(e),
    scale
  );
}

/** Estimate a trunk's lean from base-centroid vs mid-centroid and return a
 *  matrix (rotate about the base) that stands it perfectly vertical. */
function leanCorrection(geo: THREE.BufferGeometry): THREE.Matrix4 | null {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const yMin = bb.min.y;
  const h = bb.max.y - yMin || 1;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let bx = 0;
  let bz = 0;
  let bn = 0;
  let tx = 0;
  let tz = 0;
  let tn = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yMin + h * 0.14) {
      bx += pos.getX(i);
      bz += pos.getZ(i);
      bn++;
    } else if (y > yMin + h * 0.35 && y < yMin + h * 0.75) {
      tx += pos.getX(i);
      tz += pos.getZ(i);
      tn++;
    }
  }
  if (!bn || !tn) return null;
  bx /= bn;
  bz /= bn;
  tx /= tn;
  tz /= tn;
  const dx = tx - bx;
  const dz = tz - bz;
  const dy = h * 0.35;
  // only correct a real lean (> ~13°); ignore branch-asymmetry noise
  if (Math.hypot(dx, dz) < 0.08 * h) return null;
  const from = new THREE.Vector3(dx, dy, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(from, new THREE.Vector3(0, 1, 0));
  // rotate about the base point (bx, yMin, bz)
  const toOrigin = new THREE.Matrix4().makeTranslation(-bx, -yMin, -bz);
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const back = new THREE.Matrix4().makeTranslation(bx, yMin, bz);
  return back.multiply(rot).multiply(toOrigin);
}

function mergePosNrmUv(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const pc = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(pc * 3);
  const nrm = new Float32Array(pc * 3);
  const uv = new Float32Array(pc * 2);
  let po = 0;
  let uo = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, po);
    nrm.set((g.attributes.normal?.array as Float32Array) ?? new Float32Array(g.attributes.position.count * 3), po);
    uv.set((g.attributes.uv?.array as Float32Array) ?? new Float32Array(g.attributes.position.count * 2), uo);
    po += g.attributes.position.array.length;
    uo += g.attributes.uv?.array.length ?? g.attributes.position.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/**
 * Bake a tree's source meshes into normalised, PERFECTLY VERTICAL trunk + leaf
 * geometries with the base at y = 0 and the trunk centred on the origin.
 */
function buildVariant(sceneRoot: THREE.Object3D, meshes: THREE.Mesh[], targetH: number): Variant | null {
  if (!meshes.length) return null;
  sceneRoot.updateWorldMatrix(true, true);

  const barkGeos: THREE.BufferGeometry[] = [];
  const leafGeos: THREE.BufferGeometry[] = [];
  let trunkMat: THREE.MeshStandardMaterial | null = null;
  let leafMat: THREE.MeshStandardMaterial | null = null;

  for (const mesh of meshes) {
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const name = (src?.name || '').toLowerCase();
    const isBark = name.includes('bark') || name.includes('trunk') || name.includes('wood');
    const g = mesh.geometry.clone();
    g.applyMatrix4(uprightMatrix(mesh.matrixWorld));
    for (const attr of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attr)) g.deleteAttribute(attr);
    }
    (isBark ? barkGeos : leafGeos).push(g);
    if (isBark) trunkMat = trunkMat || src;
    else leafMat = leafMat || src;
  }

  const trunkGeo = barkGeos.length
    ? barkGeos.length === 1
      ? barkGeos[0]
      : mergePosNrmUv(barkGeos)
    : new THREE.CylinderGeometry(0.25, 0.35, targetH, 6).translate(0, targetH / 2, 0);
  const leafGeo = leafGeos.length
    ? leafGeos.length === 1
      ? leafGeos[0]
      : mergePosNrmUv(leafGeos)
    : new THREE.IcosahedronGeometry(targetH * 0.35, 1).translate(0, targetH * 0.7, 0);

  // De-lean: if the trunk's authored axis isn't vertical (e.g. the twisted tree),
  // rotate the whole model about its base so it stands straight up.
  const lean = leanCorrection(trunkGeo);
  if (lean) {
    trunkGeo.applyMatrix4(lean);
    leafGeo.applyMatrix4(lean);
  }

  // Combined bbox -> uniform scale to target height, recentre on XZ, base to y=0.
  const box = new THREE.Box3().makeEmpty();
  box.expandByObject(new THREE.Mesh(trunkGeo));
  box.expandByObject(new THREE.Mesh(leafGeo));
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  let s = targetH / (size.y || 1);
  const widest = Math.max(size.x, size.z) * s;
  if (widest > 10) s *= 10 / widest;

  const norm = new THREE.Matrix4().compose(
    new THREE.Vector3(-center.x * s, -box.min.y * s, -center.z * s),
    new THREE.Quaternion(),
    new THREE.Vector3(s, s, s)
  );
  trunkGeo.applyMatrix4(norm);
  leafGeo.applyMatrix4(norm);

  trunkGeo.computeBoundingBox();
  const tb = trunkGeo.boundingBox!;
  const trunkRadius = Math.max(0.28, Math.min(0.6, (tb.max.x - tb.min.x + (tb.max.z - tb.min.z)) * 0.16));

  return {
    trunkGeo,
    trunkMat: nightTune(trunkMat ?? new THREE.MeshStandardMaterial({ color: '#20160e' }), true),
    leafGeo,
    leafMat: nightTune(leafMat ?? new THREE.MeshStandardMaterial({ color: '#3a2412' }), false),
    height: targetH,
    trunkRadius,
  };
}

export const TREE_VARIANT_COUNT = 5;

function useVariants(): Variant[] {
  const t1 = useGLTF('/assets/S1Tree1.glb');
  const t2 = useGLTF('/assets/S1Tree2.glb');
  return useMemo(() => {
    const grab = (scene: THREE.Object3D, prefix: string) => {
      const out: THREE.Mesh[] = [];
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.name.startsWith(prefix)) out.push(m);
      });
      return out;
    };
    const list: (Variant | null)[] = [
      buildVariant(t2.scene, grab(t2.scene, 'TwistedTree_3'), 11),
      buildVariant(t1.scene, grab(t1.scene, 'MapleTree_1'), 9.5),
      buildVariant(t1.scene, grab(t1.scene, 'MapleTree_2'), 8.5),
      buildVariant(t1.scene, grab(t1.scene, 'MapleTree_3'), 10),
      buildVariant(t1.scene, grab(t1.scene, 'MapleTree_1'), 7),
    ];
    return list.filter((v): v is Variant => v != null);
  }, [t1, t2]);
}

function NearColliders({ trees, variants }: { trees: TreeInst[]; variants: Variant[] }) {
  const [near, setNear] = useState<TreeInst[]>([]);
  const last = useRef<[number, number]>([1e9, 1e9]);

  useFrame(() => {
    const dx = playerPosition.x - last.current[0];
    const dz = playerPosition.z - last.current[1];
    if (dx * dx + dz * dz < COLLIDER_REBUILD * COLLIDER_REBUILD) return;
    last.current = [playerPosition.x, playerPosition.z];
    const r2 = COLLIDER_RADIUS * COLLIDER_RADIUS;
    setNear(
      trees.filter((t) => {
        const ex = t.pos[0] - playerPosition.x;
        const ez = t.pos[2] - playerPosition.z;
        return ex * ex + ez * ez < r2;
      })
    );
  });

  return (
    <>
      {near.map((t) => {
        const v = variants[t.variant % variants.length];
        if (!v) return null;
        const h = v.height * t.scale * t.yScale;
        return (
          <RigidBody key={t.key} type="fixed" colliders={false} position={treePos(t)}>
            {/* extra height + radius so Jacob can't clip through a trunk */}
            <CylinderCollider
              args={[h / 2 + ASSET_SINK, Math.max(0.4, v.trunkRadius * t.scale * t.wScale) + 0.1]}
              position={[0, h / 2, 0]}
            />
          </RigidBody>
        );
      })}
    </>
  );
}

/** Terrain-snapped tree position: identical fBm noise as ForestGround, minus
 *  the shared ASSET_SINK so the trunk base is buried under the leaf surface. */
function treePos(t: TreeInst): [number, number, number] {
  return [t.pos[0], terrainHeightAt(t.pos[0], t.pos[2]) - ASSET_SINK, t.pos[2]];
}

/** Instanced tree renderer — ~10 draw calls regardless of count; nearby trees get colliders. */
export function TreeField({ trees }: { trees: TreeInst[] }) {
  const variants = useVariants();

  const byVariant = useMemo(() => {
    const groups: TreeInst[][] = variants.map(() => []);
    for (const t of trees) groups[t.variant % variants.length].push(t);
    return groups;
  }, [trees, variants]);

  return (
    <group name="tree-field">
      {variants.map((v, vi) => {
        const items = byVariant[vi];
        // Generous fixed ceiling instead of Math.max(64, items.length): a limit
        // that changes every chunk crossing forces drei to reallocate the whole
        // InstancedMesh buffer (a full unmount/remount under the hood), which is
        // exactly what was causing trees to visibly pop as the player walked.
        const limit = 900;
        return (
          <group key={vi}>
            <Instances limit={limit} range={items.length} geometry={v.trunkGeo} material={v.trunkMat} receiveShadow>
              {items.map((t) => (
                <Instance
                  key={t.key}
                  position={treePos(t)}
                  rotation={[0, t.rotY, 0]} /* Y-only — trunks stay vertical */
                  scale={[t.scale * t.wScale, t.scale * t.yScale, t.scale * t.wScale]}
                />
              ))}
            </Instances>
            <Instances limit={limit} range={items.length} geometry={v.leafGeo} material={v.leafMat} receiveShadow>
              {items.map((t) => (
                <Instance
                  key={t.key}
                  position={treePos(t)}
                  rotation={[0, t.rotY, 0]}
                  scale={[t.scale * t.wScale * 1.12, t.scale * t.yScale, t.scale * t.wScale * 1.12]}
                />
              ))}
            </Instances>
          </group>
        );
      })}

      <NearColliders trees={trees} variants={variants} />
    </group>
  );
}
