import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface FlashlightRigProps {
  on: boolean;
  power: number; // 0..1 (battery / flicker)
}

/**
 * Head-lamp: SpotLights attached directly to the camera (true children, not a
 * per-frame transform copy) so the beam always points exactly where the player
 * looks. The target is also a camera child one unit ahead, so it moves with the
 * view automatically.
 *
 * Real-time shadow-casting was tried here (2026-09) — one SpotLight, a tight
 * shadow-camera frustum — and **turned back off**: on at least one machine it
 * produced a full-scene white-out after some play (not reproducible in this
 * dev environment — no console error, no obvious trigger, survived static
 * camera moves, distance, and re-renders here — so it reads as a
 * driver/GPU-specific shadow-map fault rather than a logic bug). Given how
 * severe "the whole game goes white" is versus what shadows add visually
 * here, reliability wins: `castShadow` stays `false` below until this can be
 * root-caused on the affected hardware (get exact GPU + browser console
 * output before re-attempting). Don't re-enable it blind.
 */
export function FlashlightRig({ on, power }: FlashlightRigProps) {
  const { camera, scene } = useThree();
  const primaryRef = useRef<THREE.SpotLight | null>(null);
  const fillRef = useRef<THREE.SpotLight | null>(null);

  useEffect(() => {
    // camera must be in the scene graph for its light children to affect anything
    scene.add(camera);

    // aim point — a child of the camera, straight ahead
    const target = new THREE.Object3D();
    target.position.set(0, 0, -1);
    camera.add(target);

    // --- primary beam ---------------------------------------------------
    // SpotLight(color, intensity, distance, angle, penumbra, decay)
    //   angle    30°(ish) cone — a handheld flashlight, not a searchlight
    //   penumbra 0.92 (near 1.0): almost the WHOLE cone is soft falloff, only
    //            a small inner core stays full-bright. This is what kills the
    //            "sharp-edged disc" look — a low penumbra (the old 0.4) keeps
    //            60%+ of the cone at flat full intensity right up to an abrupt
    //            cutoff, which reads as a hard-edged circle on the ground.
    //   decay    1.6: between the old, too-slow 1.1 (stays bright almost to
    //            `distance`, then dies fast — another source of a "hard edge"
    //            at the far end of the throw) and the physically-correct 2.0
    //            (falls off a little too quickly for a stylised night scene).
    const primary = new THREE.SpotLight(0xfff2df, 0, 26, Math.PI / 6.2, 0.92, 1.6);
    primary.position.set(0.15, -0.1, 0); // roughly head/shoulder height
    primary.target = target;

    // Real-time shadow map — DISABLED (see the class doc comment above: caused
    // a full white-out on at least one machine). The tuned config is left
    // here, commented, so re-enabling later is a one-line flip once the
    // underlying cause is understood rather than re-deriving these numbers.
    primary.castShadow = false;
    // primary.shadow.mapSize.set(1024, 1024);
    // primary.shadow.camera.near = 0.3;
    // primary.shadow.camera.far = 22;
    // primary.shadow.radius = 4;
    // primary.shadow.bias = -0.0003;
    // primary.shadow.normalBias = 0.045;

    camera.add(primary);
    primaryRef.current = primary;

    // soft cool fill so the immediate foreground never goes pure black —
    // no shadow (see note above)
    const fill = new THREE.SpotLight('#b7c8e4', 0, 20, 1.0, 1, 1.6);
    fill.position.set(0.15, -0.1, 0);
    fill.target = target;
    camera.add(fill);
    fillRef.current = fill;

    // faint ground bounce at the player's feet — no shadow
    const feet = new THREE.PointLight('#8ea6c6', 1.1, 9, 2);
    feet.position.set(0, -0.6, -0.1);
    camera.add(feet);

    return () => {
      camera.remove(target);
      camera.remove(primary);
      camera.remove(fill);
      camera.remove(feet);
      primary.dispose();
      fill.dispose();
      feet.dispose();
      primaryRef.current = null;
      fillRef.current = null;
    };
  }, [camera, scene]);

  useFrame(() => {
    const beam = on ? power : 0;
    // spec intensity (3.0) is far too dim for this ACES-tonemapped night scene —
    // these are tuned up so the beam actually reads. Bumped alongside the
    // decay change above (a faster falloff needs a brighter source to still
    // reach the same practical distance).
    if (primaryRef.current) primaryRef.current.intensity = 58 * beam;
    if (fillRef.current) fillRef.current.intensity = 4 * beam + (on ? 1.2 : 0.5);
  });

  return null;
}
