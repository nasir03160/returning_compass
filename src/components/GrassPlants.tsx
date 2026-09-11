import React, { useMemo } from 'react';
import { useGLTF, Instances, Instance } from '@react-three/drei';
import * as THREE from 'three';
import { terrainHeightAt, ASSET_SINK } from '../world/terrain';

const GRASS_PLANTS_URL = '/assets/grass_plants.glb';
useGLTF.preload(GRASS_PLANTS_URL);

/**
 * Real ground-cover models (a Sketchfab "grass & plants" pack). The source
 * file was 27 MB / ~800k render vertices — almost all of it two giant
 * "Ground_Cover_Bunch" clumps (up to 65k verts each) and two huge
 * "Purple_Flower" heads meant to be looked at up close, not instanced
 * hundreds of times across an endless forest. Trimmed offline with
 * gltf-transform (weld + dedup + prune) down to the 4 small, single-plant
 * meshes below — 1,027 vertices total, ~320 KB. Don't add the untrimmed file
 * back; if a fresh pack ever needs it, repeat that trim rather than loading
 * the whole thing.
 */
const TARGET_HEIGHT: Record<string, number> = {
  '5_leaf_ground_plant': 0.5,
  Grass_Blades: 0.85,
  Grass_Cloves: 0.45,
  dandelion: 0.6,
};

export interface PlantVariant {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

function usePlantVariants(): PlantVariant[] {
  const { scene } = useGLTF(GRASS_PLANTS_URL);
  return useMemo(() => {
    // one mesh per material name — pick the highest-vertex candidate when a
    // material has more than one mesh (the pack has a tiny sliver and a full
    // clump sharing the "Grass_Blades" material; we want the full clump)
    const best = new Map<string, THREE.Mesh>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material)
        ?.name;
      if (!name || !(name in TARGET_HEIGHT)) return;
      const cur = best.get(name);
      if (!cur || mesh.geometry.attributes.position.count > cur.geometry.attributes.position.count) {
        best.set(name, mesh);
      }
    });

    const variants: PlantVariant[] = [];
    for (const [name, mesh] of best) {
      mesh.updateWorldMatrix(true, true);
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const h = bb.max.y - bb.min.y || 1;
      const norm = TARGET_HEIGHT[name] / h;
      geo.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y, -(bb.max.z + bb.min.z) / 2);
      geo.scale(norm, norm, norm);
      geo.computeVertexNormals();

      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const mat = src.clone();
      mat.side = THREE.DoubleSide;
      mat.transparent = true;
      mat.alphaTest = Math.max(mat.alphaTest, 0.35);
      mat.roughness = Math.max(mat.roughness ?? 0.7, 0.85);

      variants.push({ geo, mat });
    }
    return variants;
  }, [scene]);
}

interface PlantScatter {
  key: string;
  pos: [number, number, number];
  rotY: number;
  scale: number;
}

/** One <Instances> batch per plant variant; scatter points are assigned a
 *  variant deterministically from their own rotation seed (no extra state). */
export function GrassPlantsLayer({ items }: { items: PlantScatter[] }) {
  const variants = usePlantVariants();
  if (variants.length === 0) return null;

  const buckets: PlantScatter[][] = variants.map(() => []);
  for (const s of items) {
    const v = Math.floor((s.rotY / (Math.PI * 2)) * variants.length) % variants.length;
    buckets[v].push(s);
  }

  return (
    <>
      {variants.map((v, i) => (
        <Instances key={i} limit={Math.max(1, buckets[i].length)} geometry={v.geo} material={v.mat} receiveShadow>
          {buckets[i].map((s) => (
            <Instance
              key={s.key}
              position={[s.pos[0], terrainHeightAt(s.pos[0], s.pos[2]) - ASSET_SINK * 0.15, s.pos[2]]}
              rotation={[0, s.rotY, 0]}
              scale={s.scale}
            />
          ))}
        </Instances>
      ))}
    </>
  );
}
