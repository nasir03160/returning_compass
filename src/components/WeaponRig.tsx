import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { weaponState } from '../world/weaponState';
import { registerShot, combatState, HitZone } from '../world/combatState';
import { playerPosition } from '../world/playerState';
import {
  playGunshot,
  playReload,
  playDryFire,
  playMagVoice,
  beginAutoFire,
  endAutoFire,
} from '../audio/sfx';

const BASE_DMG = 30; // scaled by the zone multiplier zombie-side

const AKM_URL = '/assets/akm.glb';
useGLTF.preload(AKM_URL);

const FIRE_INTERVAL = 0.1; // s between shots while held (~600 RPM)
const RELOAD_FALLBACK_MS = 1900; // used only if the GLB has no Reload clip
const MUZZLE_LEN = 0.15; // muzzle-flash lifetime, seconds
let RELOAD_MS = RELOAD_FALLBACK_MS; // set from the actual Reload clip duration

// --- viewmodel placement (weaponHolder is a child of the camera) ---
// Tuned to read like a held rifle (see the CS-style reference): centred a little
// right, dropped, close to the lens, barrel level and pointing down -Z.
const HOLDER_POS = new THREE.Vector3(0.11, -0.17, -0.22);
// barrel aims along the model's +X, so +90° Y turns it down -Z; the slight yaw
// off it shows the receiver's left side (the "held from behind-left" CS look),
// the X term levels the muzzle, the Z term is the inward cant.
const MODEL_ROT = new THREE.Euler(-0.04, Math.PI / 2 - 0.13, -0.06);
const MODEL_TARGET_SIZE = 0.58; // longest side, metres
const MUZZLE_LOCAL = new THREE.Vector3(0.16, -0.14, -0.62); // camera-local barrel tip

const _ray = new THREE.Raycaster();
const _screenCentre = new THREE.Vector2(0, 0);
const _box = new THREE.Box3();
const _v = new THREE.Vector3();

export function WeaponRig() {
  const { camera, scene } = useThree();
  const { scene: gltf, animations } = useGLTF(AKM_URL);

  // imperatively-built objects, driven each frame
  const recoilRef = useRef<THREE.Group | null>(null);
  const flashLightRef = useRef<THREE.PointLight | null>(null);
  const flashMeshRef = useRef<THREE.Mesh | null>(null);
  const impactRef = useRef<THREE.PointLight | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actRef = useRef<{ idle?: THREE.AnimationAction; reload?: THREE.AnimationAction }>({});

  const st = useRef({
    firing: false,
    lastShot: -1,
    recoil: 0,
    flash: 0,
    impact: 0,
    reloadUntil: 0,
    dryClicked: false,
    burstShots: 0, // consecutive shots this trigger-pull (drives single vs burst SFX)
    autoLoop: false, // the ak_burst loop is currently running
  });

  // === STRICT HIERARCHY SETUP (runs once) ===
  useEffect(() => {
    // 1. camera must be in the scene graph or its children never render
    scene.add(camera);

    // 2. dedicated pivot wrapper, parented to the camera
    const weaponHolder = new THREE.Group();
    weaponHolder.name = 'weaponHolder';
    weaponHolder.position.copy(HOLDER_POS);
    camera.add(weaponHolder);

    // an inner pivot that ONLY the recoil animation touches — the holder and the
    // model transforms are never written per-frame
    const recoil = new THREE.Group();
    recoil.name = 'weaponRecoil';
    weaponHolder.add(recoil);
    recoilRef.current = recoil;

    // 3. reset + centre the model, set its transform ONCE
    const model = SkeletonUtils.clone(gltf) as THREE.Object3D;
    model.updateMatrixWorld(true);
    _box.setFromObject(model);
    _box.getSize(_v);
    model.scale.setScalar(MODEL_TARGET_SIZE / (Math.max(_v.x, _v.y, _v.z) || 1));
    model.rotation.copy(MODEL_ROT);
    model.updateMatrixWorld(true);
    _box.setFromObject(model);
    _box.getCenter(_v);
    model.position.sub(_v); // pin the bounding-box centre to the holder origin
    model.matrixAutoUpdate = true;

    const GUNMETAL = new THREE.Color('#141619');
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.renderOrder = 20; // over the world, never clips into geometry
      m.raycast = () => null; // out of every raycast (hitscan / terrain / physics)
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mm) => {
        const mat = mm as THREE.MeshStandardMaterial;
        if (!mat.color) return;
        const name = (mat.name || '').toLowerCase();
        const isMetal = /metal|black|plastic|bolt|steel|iron/.test(name);
        const isCloth = /shirt|skin|glove|hand/.test(name);
        if (isMetal) {
          // dark gunmetal, slightly rough, no ambient reflections
          mat.color.copy(GUNMETAL);
          mat.metalness = 0.75;
          mat.roughness = 0.52;
        } else if (!isCloth) {
          // wood / bakelite furniture — just knock it down a touch
          mat.color.multiplyScalar(0.75);
          mat.metalness = 0;
          mat.roughness = Math.max(mat.roughness ?? 0.6, 0.7);
        } else {
          mat.color.multiplyScalar(0.85);
        }
        mat.envMapIntensity = 0;
        // faint emissive floor only — was too strong before and washed it white
        if (mat.emissive) {
          mat.emissive.copy(mat.color).multiplyScalar(0.08);
          mat.emissiveIntensity = 0.25;
        }
        mat.needsUpdate = true;
      });
    });
    recoil.add(model);

    // --- animation: Idle loop (this is what poses the hands onto the gun), plus
    //     a one-shot Reload clip ---
    const mixer = new THREE.AnimationMixer(model);
    mixerRef.current = mixer;
    const idleClip = THREE.AnimationClip.findByName(animations, 'Armature|Idle');
    const reloadClip = THREE.AnimationClip.findByName(animations, 'Armature|Reload');
    if (idleClip) {
      const idle = mixer.clipAction(idleClip);
      idle.play();
      actRef.current.idle = idle;
    }
    if (reloadClip) {
      RELOAD_MS = reloadClip.duration * 1000;
      const rl = mixer.clipAction(reloadClip);
      rl.setLoop(THREE.LoopOnce, 1);
      rl.clampWhenFinished = true;
      actRef.current.reload = rl;
    }

    // dedicated viewmodel light — very short range so it barely touches the world
    const vmLight = new THREE.PointLight('#9fb0c4', 1.05, 1.5, 2);
    vmLight.position.set(0, 0.15, 0.1);
    weaponHolder.add(vmLight);

    // muzzle flash — child of the holder (NOT the recoil pivot)
    const flashGroup = new THREE.Group();
    flashGroup.position.copy(MUZZLE_LOCAL).sub(HOLDER_POS);
    const flashLight = new THREE.PointLight('#ffd58a', 0, 7, 2);
    flashGroup.add(flashLight);
    flashLightRef.current = flashLight;
    const flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: '#fff1c9',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      })
    );
    flashMesh.visible = false;
    flashMesh.renderOrder = 21;
    flashMesh.scale.setScalar(0.001);
    flashGroup.add(flashMesh);
    flashMeshRef.current = flashMesh;
    weaponHolder.add(flashGroup);

    return () => {
      camera.remove(weaponHolder); // leave the camera in the scene — it's the render camera
      mixer.stopAllAction();
      mixerRef.current = null;
      actRef.current = {};
      weaponHolder.traverse((o) => {
        const mm = o as THREE.Mesh;
        mm.geometry?.dispose?.();
      });
      (flashMesh.material as THREE.Material).dispose();
      recoilRef.current = null;
      flashLightRef.current = null;
      flashMeshRef.current = null;
    };
  }, [scene, camera, gltf, animations]);

  const stopAutoSfx = () => {
    if (st.current.burstShots > 0 || st.current.autoLoop) {
      endAutoFire();
      st.current.burstShots = 0;
      st.current.autoLoop = false;
    }
  };

  const reload = () => {
    const w = weaponState;
    if (w.reloading || w.mag >= w.magSize || w.reserve <= 0) return;
    stopAutoSfx();
    w.reloading = true;
    st.current.reloadUntil = performance.now() + RELOAD_MS;
    playReload();
    const { idle, reload: rl } = actRef.current;
    if (rl && idle) {
      rl.reset();
      rl.setEffectiveTimeScale(1);
      rl.fadeIn(0.12);
      rl.play();
      idle.fadeOut(0.12);
    }
  };

  const shoot = () => {
    const w = weaponState;
    w.mag -= 1;
    // SFX cadence: first shot of a pull = single crack; from the 2nd on, run the
    // looping burst bed (fall back to per-shot cracks if that sample is missing).
    st.current.burstShots += 1;
    if (st.current.burstShots >= 2) {
      if (!st.current.autoLoop) st.current.autoLoop = beginAutoFire();
      if (!st.current.autoLoop) playGunshot();
    } else {
      playGunshot();
    }
    registerShot(playerPosition.x, playerPosition.z); // zombies can "hear" this
    if (w.mag === 5) playMagVoice(); // low-ammo voice line
    if (w.mag === 0 && w.reserve > 0) reload(); // last round chambered
    st.current.recoil = 1;
    st.current.flash = MUZZLE_LEN;

    // CCD-ish: rebuild the camera's world matrix RIGHT NOW so the ray originates
    // from the player's exact current position, not last frame's — fixes shots
    // that "lagged behind" while moving.
    camera.updateMatrixWorld(true);
    _ray.setFromCamera(_screenCentre, camera);
    _ray.far = 120;

    // 1) zombie limb hitboxes — a tight curated list, nearest wins.
    // Force each box's matrixWorld to THIS frame's bone pose/rotation before the
    // ray runs — don't trust the renderer's last auto-update (it can be a frame
    // stale relative to the Zombie useFrame that moves the boxes). 33 boxes max,
    // free.
    for (let i = 0; i < combatState.hitboxes.length; i++) {
      // updateParents=true so a stale root-group matrix can't drag the box off
      combatState.hitboxes[i].updateWorldMatrix(true, false);
    }
    const zHits = _ray.intersectObjects(combatState.hitboxes, false);
    if (zHits.length) {
      const h = zHits[0];
      const zone = (h.object.userData.zone as HitZone) ?? 'torso';
      const cb = h.object.userData.onHit as
        | ((d: number, p: THREE.Vector3, dir: THREE.Vector3, z: HitZone) => void)
        | undefined;
      cb?.(BASE_DMG, h.point, _ray.ray.direction.clone(), zone);
      if (impactRef.current) {
        impactRef.current.position.copy(h.point);
        st.current.impact = 1;
      }
      return;
    }

    // 2) otherwise, a spark where the round hit the world
    const wHit = _ray
      .intersectObjects(scene.children, true)
      .find((x) => x.distance > 0.8 && x.object.type !== 'Points');
    if (wHit && impactRef.current) {
      impactRef.current.position.copy(wHit.point);
      st.current.impact = 1;
    }
  };

  // --- input: LMB fire (single + hold-to-auto), R reload ---
  useEffect(() => {
    const locked = () => document.pointerLockElement != null;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !locked()) return;
      st.current.firing = true;
      st.current.dryClicked = false;
      st.current.burstShots = 0;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) {
        st.current.firing = false;
        stopAutoSfx();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat && locked()) reload();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Per-frame: ONLY the recoil pivot + flash/impact intensities are touched.
  // weaponHolder and the model transform are never written here.
  useFrame((state, delta) => {
    const s = st.current;
    const dt = Math.min(delta, 0.05);
    const now = performance.now();
    const w = weaponState;

    mixerRef.current?.update(dt);

    if (w.reloading && now >= s.reloadUntil) {
      const take = Math.min(w.magSize - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloading = false;
      const { idle, reload: rl } = actRef.current;
      if (rl && idle) {
        rl.fadeOut(0.2);
        idle.reset().fadeIn(0.2).play();
      }
    }

    const triggerHeld = s.firing && document.pointerLockElement != null;
    if (triggerHeld && !w.reloading && w.mag > 0) {
      const tSec = state.clock.elapsedTime;
      if (tSec - s.lastShot >= FIRE_INTERVAL) {
        s.lastShot = tSec;
        shoot();
      }
    } else if (triggerHeld && w.mag === 0 && !w.reloading) {
      stopAutoSfx();
      if (w.reserve > 0) reload();
      else if (!s.dryClicked) {
        s.dryClicked = true;
        playDryFire();
      }
    } else {
      stopAutoSfx(); // trigger released / unlocked / reloading
    }

    // recoil — kick the inner pivot back + muzzle-up, ease home
    s.recoil = Math.max(0, s.recoil - dt * 6);
    const kick = s.recoil * s.recoil;
    const rec = recoilRef.current;
    if (rec) {
      rec.position.set(0, kick * 0.012, kick * 0.05);
      rec.rotation.set(-kick * 0.14, 0, kick * 0.03);
    }

    s.flash = Math.max(0, s.flash - dt);
    const fl = s.flash / MUZZLE_LEN;
    if (flashLightRef.current) flashLightRef.current.intensity = fl * 14;
    const fm = flashMeshRef.current;
    if (fm) {
      fm.visible = fl > 0.05;
      const sc = 0.04 + fl * 0.1;
      fm.scale.setScalar(sc);
      (fm.material as THREE.MeshBasicMaterial).opacity = fl;
    }

    s.impact = Math.max(0, s.impact - dt * 5);
    if (impactRef.current) impactRef.current.intensity = s.impact * 5;
  });

  // only the world-space impact flash is a normal R3F node
  return <pointLight ref={impactRef} color="#ffca7a" intensity={0} distance={4} decay={2} />;
}
