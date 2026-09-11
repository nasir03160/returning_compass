import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const SKY_URL = '/assets/sky.glb';
useGLTF.preload(SKY_URL);

// Effective diameter (world units) the dome is normalised to. Big enough to sit
// well behind the fog, comfortably inside the camera far plane.
const DOME_DIAMETER = 900;

// The photosphere ("PanoSphere") mesh doesn't have real geometry at its poles —
// looking straight up/down falls through to whatever's behind it, which used to
// be the flat scene background colour and read as a hard, out-of-place disc.
// This backing sphere (measured average tone of the actual star texture) sits
// just behind it so any gap blends into the starfield instead of standing out.
const FILLER_COLOR = '#191312';

/**
 * Panoramic star sky (sky.glb). Its equirect photo sits on the emissive channel;
 * we rebuild the material as an unlit MeshBasicMaterial so it always shows,
 * normalise the dome to a fixed size (the GLB ships with an odd internal scale),
 * render it from the inside, ignore fog, draw it first, and keep it centred on
 * the camera so the horizon never moves.
 */
export function SkyDome() {
  const ref = useRef<THREE.Group>(null);
  const { scene } = useGLTF(SKY_URL);

  const { dome, norm } = useMemo(() => {
    const s = scene.clone(true);
    s.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = -1000;

      const srcMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        | THREE.MeshStandardMaterial
        | undefined;
      const tex = srcMat?.emissiveMap || srcMat?.map || null;
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;

      mesh.material = new THREE.MeshBasicMaterial({
        map: tex,
        // this PanoSphere is authored with inward-facing normals — view it as FrontSide
        color: new THREE.Color('#ffffff'), // full brightness — the photo is already dark
        side: THREE.FrontSide,
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
    return { dome: s, norm: DOME_DIAMETER / maxDim };
  }, [scene]);


  useFrame(({ camera }) => {
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <group ref={ref}>
      {/* backing fill — plugs the photosphere's pole gaps, drawn first/behind */}
      <mesh renderOrder={-1001}>
        <sphereGeometry args={[DOME_DIAMETER * 0.48, 16, 12]} />
        <meshBasicMaterial color={FILLER_COLOR} side={THREE.BackSide} fog={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <group scale={norm}>
        <primitive object={dome} />
      </group>
    </group>
  );
}
