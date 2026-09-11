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
 * Shadow-casting is deliberately scoped to ONE light (this SpotLight) with a
 * tight shadow-camera frustum — that's what keeps soft real-time shadows
 * affordable across an endless, densely-instanced forest. Don't add
 * `castShadow` to the fill/feet lights below; that would multiply the shadow
 * pass cost for no visual gain (they're soft ambient fills, not the source of
 * directional shadow detail).
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

    // Real-time shadow map — tightly scoped so it stays cheap:
    primary.castShadow = true;
    primary.shadow.mapSize.set(1024, 1024); // sharp enough up close, not GPU-heavy
    // Near/far are the light's OWN shadow-camera depth range, not the beam's
    // visual falloff distance. Keeping this tight (0.3–22, matching how far
    // the beam actually reads before fog/decay swallow it) is what gives the
    // depth buffer enough precision to avoid banding/"stripe" artifacts on the
    // ground — a far plane left at some huge default value is the classic
    // cause of that look.
    primary.shadow.camera.near = 0.3;
    primary.shadow.camera.far = 22;
    // Soft PCF filtering needs a wider blur radius than the default to read as
    // "soft" rather than "slightly fuzzy" — paired with `shadows="soft"` on
    // the <Canvas> (PCFSoftShadowMap) in App.tsx.
    primary.shadow.radius = 4;
    // Bias pair that eliminates both classic shadow artifacts at once:
    //   bias        (small negative) — stops "shadow acne" (self-shadowing
    //               moiré noise on lit surfaces)
    //   normalBias  (small positive, scaled to world units) — stops "peter
    //               panning" (shadows detaching from the object casting them)
    // Tuned for this scene's scale (a person-sized light a few metres off the
    // ground); if shadows ever creep or detach again after a geometry change,
    // these two are the first values to revisit.
    primary.shadow.bias = -0.0003;
    primary.shadow.normalBias = 0.045;

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
