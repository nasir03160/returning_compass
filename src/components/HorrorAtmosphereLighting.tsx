import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { MOON_DIR, MOON_LIGHT_COLOR } from '../world/moon';

// Cold-night fog/background tone — dark forest default. Fog colour matches the
// background colour exactly: that's what lets distant geometry fade OUT
// rather than fade to a visibly different colour (a common "fog looks like a
// grey wall" mistake).
const NIGHT_COLOR = '#080b12';
// THREE.FogExp2 density: exponential falloff (unlike linear THREE.Fog), so it
// thickens gradually with distance rather than having a hard start/end plane —
// reads as real atmospheric haze instead of a fade-out trick. 0.045 is tuned
// so the flashlight's ~22m practical throw (see FlashlightRig.tsx) still
// clearly punches through the murk before fog fully swallows it; push this
// higher for a more claustrophobic feel, lower to let the player see further.
const FOG_DENSITY = 0.045;

/**
 * Suffocating night-forest atmosphere:
 *  - thick exponential fog that swallows the ground and hides map edges
 *  - very low ambient — the flashlight is the primary light, but never so low
 *    that unlit terrain drops to a flat, featureless #000 (see the
 *    hemisphere/ambient lights below — "silhouettes, not solid black")
 *  - a dim, cool-blue directional "moonlight" for faint rim highlights
 *  - a few faint low haze wisps that catch the flashlight beam
 */
/** Vertical gradient (fog colour -> transparent) for the horizon band. */
function horizonGradient(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(8,11,18,1)');
  g.addColorStop(0.35, 'rgba(8,11,18,0.85)');
  g.addColorStop(0.75, 'rgba(8,11,18,0.15)');
  g.addColorStop(1, 'rgba(8,11,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function HorrorAtmosphereLighting() {
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hazeRef = useRef<THREE.Group>(null);
  const bandRef = useRef<THREE.Group>(null);
  const { scene } = useThree();
  const bandTex = useMemo(horizonGradient, []);

  useMemo(() => {
    // Fog colour == the sky's lower-horizon tone, so ground fades into sky with
    // no visible horizontal seam. Same density/reach as before — colour only.
    scene.background = new THREE.Color(NIGHT_COLOR);
    scene.fog = new THREE.FogExp2(NIGHT_COLOR, FOG_DENSITY);
  }, [scene]);

  const haze = useMemo(
    () =>
      Array.from({ length: 6 }).map((_, i) => ({
        id: i,
        y: 0.15 + Math.random() * 0.7,
        s: 14 + Math.random() * 16,
        ox: (Math.random() - 0.5) * 40,
        oz: (Math.random() - 0.5) * 40,
        rot: Math.random() * Math.PI,
        spd: 0.02 + Math.random() * 0.03,
        op: 0.02 + Math.random() * 0.025,
      })),
    []
  );

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    if (moonRef.current) {
      // same steep bearing the visible Moon disc sits along (world/moon.ts) —
      // the light always rakes in from where the disc actually is.
      moonRef.current.position.copy(playerPosition).addScaledVector(MOON_DIR, 40);
      moonRef.current.target.position.copy(playerPosition);
      moonRef.current.target.updateMatrixWorld();
    }

    if (bandRef.current) {
      bandRef.current.position.set(playerPosition.x, 0, playerPosition.z);
    }

    if (hazeRef.current) {
      hazeRef.current.position.set(playerPosition.x, 0, playerPosition.z);
      hazeRef.current.children.forEach((child, i) => {
        const h = haze[i];
        child.position.x = h.ox + Math.sin(t * h.spd + i) * 8;
        child.position.z = h.oz + Math.cos(t * h.spd * 0.8 + i * 1.7) * 8;
        child.rotation.z = h.rot + t * h.spd * 0.15;
      });
    }
  });

  return (
    <>
      {/* Fill floor: a soft hemisphere light — sky colour from above, ground-
          bounce colour from below — so unlit terrain and tree silhouettes
          stay faintly readable instead of dropping to pure black outside the
          flashlight cone. This (not the directional light alone) is what
          gives "unlit but not void" per the ground-material brief: bumped
          from 0.16 to 0.22 so those silhouettes are reliably visible instead
          of a coin-flip depending on tone-mapping curve. */}
      <hemisphereLight args={['#3c5170', '#0d0f0c', 0.22]} />
      {/* Small extra flat ambient so very tight enclosed pockets (between
          rocks, under thickets) never go fully flat-black even when the
          hemisphere light's directionality doesn't reach them. */}
      <ambientLight intensity={0.08} color="#18243b" />

      {/* Moonlight — the scene's secondary fill, aimed from the same bearing
          the visible Moon disc sits at. Deliberately kept well under the
          flashlight: enough to read shapes at distance, not enough to compete
          with it. No shadow-casting on this light — real-time shadows are
          deliberately scoped to the single flashlight SpotLight (see
          FlashlightRig.tsx); a second shadow-casting light here would double
          the shadow pass cost across ~900 trees for very little visual gain,
          since this light is barely brighter than the ambient floor above. */}
      <directionalLight ref={moonRef} intensity={0.26} color={MOON_LIGHT_COLOR} />

      {/* Horizon band: a fog-coloured skirt around the player that both the
          ground and the distant tree bases dissolve into — kills any seam
          between the ground plane and the sky. */}
      <group ref={bandRef}>
        <mesh position={[0, 9, 0]}>
          <cylinderGeometry args={[150, 150, 48, 40, 1, true]} />
          <meshBasicMaterial
            map={bandTex}
            transparent
            depthWrite={false}
            side={THREE.BackSide}
            fog={false}
          />
        </mesh>
      </group>

      <group ref={hazeRef}>
        {haze.map((h) => (
          <mesh key={h.id} position={[h.ox, h.y, h.oz]} rotation={[-Math.PI / 2, 0, h.rot]}>
            <planeGeometry args={[h.s, h.s]} />
            <meshBasicMaterial
              color="#2a3a54"
              transparent
              opacity={h.op}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              fog={false}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}
