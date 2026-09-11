import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';
import { terrainHeightAt } from '../world/terrain';
import {
  combatState,
  addHitbox,
  removeHitbox,
  addZombie,
  removeZombie,
  HitZone,
} from '../world/combatState';
import { playZombieVoice } from '../audio/sfx';
import { getNoiseIntensityAt, HEAR_THRESHOLD } from '../world/noiseState';

const ZOMBIE_URL = '/assets/zombie.glb';
useGLTF.preload(ZOMBIE_URL);

const WALK_SPEED = 0.85;
const RUN_SPEED = 3.4;
const RUN_TIMESCALE = 1.95;
const ATTACK_RANGE = 1.9;
const SEE_RANGE = 14;
const MAX_HP = 100;
const CORPSE_MS = 5000;
const HIT_STUN_MS = 220;
const LEG_SLOW_MS = 2500;
// after a stagger, immune to being re-staggered for this long so limb spam can't
// freeze a zombie in place forever while torso/head damage still lands
const RESTAGGER_LOCK_MS = 650;
// mutual separation so zombies fan out around the player instead of merging
const SEP_RADIUS = 1.35;
const SEP_STRENGTH = 3.2;

// per-zone damage multiplier + knockback impulse
const ZONE: Record<HitZone, { mult: number; knock: number; stagger: boolean }> = {
  head: { mult: 6.0, knock: 1.4, stagger: true }, // ~instant kill
  torso: { mult: 1.0, knock: 0.9, stagger: false }, // several shots
  arm: { mult: 0.45, knock: 2.2, stagger: true }, // low dmg, big stagger
  leg: { mult: 0.5, knock: 1.8, stagger: true }, // low dmg, stagger + slow
};

// bone-parented hitboxes. Each frame the box copies its bone's world POSITION
// *and* world ROTATION (a position-only box drifts out of the visible limb as
// the limb swings). Sizes carry a ~10% forgiveness margin over the visible mesh
// — standard FPS practice; a raycast that needs pixel-perfect overlap feels bad
// even when it's "accurate". Box local +Y runs along the bone (Mixamo rig
// convention), so `size[1]` is the limb's length.
const HITBOXES: {
  bone: string;
  zone: HitZone;
  size: [number, number, number];
  yOff: number;
}[] = [
  { bone: 'mixamorig:Head', zone: 'head', size: [0.2, 0.24, 0.22], yOff: 0.05 },
  { bone: 'mixamorig:Spine1', zone: 'torso', size: [0.48, 0.46, 0.33], yOff: 0.06 },
  { bone: 'mixamorig:Spine', zone: 'torso', size: [0.46, 0.31, 0.31], yOff: 0.02 },
  { bone: 'mixamorig:LeftArm', zone: 'arm', size: [0.15, 0.37, 0.15], yOff: -0.14 },
  { bone: 'mixamorig:RightArm', zone: 'arm', size: [0.15, 0.37, 0.15], yOff: -0.14 },
  { bone: 'mixamorig:LeftForeArm', zone: 'arm', size: [0.13, 0.33, 0.13], yOff: -0.13 },
  { bone: 'mixamorig:RightForeArm', zone: 'arm', size: [0.13, 0.33, 0.13], yOff: -0.13 },
  { bone: 'mixamorig:LeftUpLeg', zone: 'leg', size: [0.19, 0.48, 0.19], yOff: -0.2 },
  { bone: 'mixamorig:RightUpLeg', zone: 'leg', size: [0.19, 0.48, 0.19], yOff: -0.2 },
  { bone: 'mixamorig:LeftLeg', zone: 'leg', size: [0.15, 0.46, 0.15], yOff: -0.2 },
  { bone: 'mixamorig:RightLeg', zone: 'leg', size: [0.15, 0.46, 0.15], yOff: -0.2 },
];

// [H] debug wireframe colour per zone
const ZONE_DEBUG_COLOR: Record<HitZone, number> = {
  head: 0xff3030,
  torso: 0x30ff60,
  arm: 0x30c8ff,
  leg: 0xffd030,
};

const _bp = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _gInvQ = new THREE.Quaternion();
const _sep = new THREE.Vector2();

/**
 * GLTFLoader strips `:` `.` `/` etc. from node names, so the rig's
 * `mixamorig:Head` bone loads as `mixamorigHead`. Match on a punctuation-free,
 * lower-case key so the HITBOXES table works regardless of how the exporter
 * wrote the names.
 */
const normBone = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();

type ZState = 'move' | 'attack' | 'hit' | 'dead';

interface ZombieProps {
  spawn: [number, number];
  onDead: () => void;
  onAttack: () => void;
}

export function Zombie({ spawn, onDead, onAttack }: ZombieProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene: gltf, animations } = useGLTF(ZOMBIE_URL);

  const { model, mixer, actions, bones } = useMemo(() => {
    const m = SkeletonUtils.clone(gltf) as THREE.Object3D;
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const size = new THREE.Vector3();
    box.getSize(size);
    m.scale.setScalar(1.85 / (size.y || 1));
    m.updateMatrixWorld(true);
    box.setFromObject(m);
    m.position.y -= box.min.y;
    m.position.x -= (box.max.x + box.min.x) / 2;
    m.position.z -= (box.max.z + box.min.z) / 2;

    const boneMap: Record<string, THREE.Object3D> = {};
    m.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) {
        mm.castShadow = false;
        mm.receiveShadow = false;
        mm.frustumCulled = true;
        mm.raycast = () => null; // limb hitboxes take the shots, not the skin
      }
      if ((o as THREE.Bone).isBone || /mixamorig/i.test(o.name)) boneMap[normBone(o.name)] = o;
    });

    const mx = new THREE.AnimationMixer(m);
    const clip = (n: string, once = false) => {
      const c = THREE.AnimationClip.findByName(animations, n);
      if (!c) return undefined;
      const a = mx.clipAction(c);
      if (once) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      return a;
    };
    return {
      model: m,
      mixer: mx,
      bones: boneMap,
      actions: {
        walkA: clip('Armature|Walk'),
        walkB: clip('Armature|Walk2') ?? clip('Armature|Walk'),
        attack: clip('Armature|Attack') ?? clip('Armature|Headbutt'),
        hitR: clip('Armature|Hit_reaction', true),
        die: clip('Armature|Die', true),
        die2: clip('Armature|Die2', true),
      },
    };
  }, [gltf, animations]);

  const cur = useRef<THREE.AnimationAction | undefined>(undefined);
  const playOnly = (a: THREE.AnimationAction | undefined, fade = 0.25) => {
    if (!a || a === cur.current) return;
    a.reset();
    a.fadeIn(fade);
    a.play();
    cur.current?.fadeOut(fade);
    cur.current = a;
  };

  const st = useRef({
    state: 'move' as ZState,
    hp: MAX_HP,
    yaw: Math.random() * Math.PI * 2,
    stamp: 0,
    attackCd: 0.6,
    alerted: false,
    reported: false,
    legSlowUntil: 0,
    restaggerUntil: 0,
    nextVoice: 0,
    deregistered: false,
    knock: new THREE.Vector3(),
    walkPick: Math.random() < 0.5,
    hitboxes: [] as { mesh: THREE.Mesh; bone: THREE.Object3D; yOff: number }[],
  });

  // deregister every limb hitbox + the zombie from the shared registries so
  // follow-up shots pass straight through a corpse to the live zombies behind it
  const deregister = () => {
    if (st.current.deregistered) return;
    st.current.deregistered = true;
    for (const h of st.current.hitboxes) removeHitbox(h.mesh);
    if (groupRef.current) removeZombie(groupRef.current);
  };

  // limb-specific shot handler (bound to every hitbox mesh)
  const onHit = (dmg: number, _point: THREE.Vector3, dir: THREE.Vector3, zone: HitZone) => {
    const z = st.current;
    if (z.state === 'dead') return;
    const nowMs = performance.now();
    z.alerted = true;
    const zc = ZONE[zone];
    z.hp -= dmg * zc.mult;
    z.knock.addScaledVector(dir, zc.knock); // knockback impulse along the bullet
    if (zone === 'leg') z.legSlowUntil = nowMs + LEG_SLOW_MS;

    if (z.hp <= 0) {
      z.state = 'dead';
      z.stamp = nowMs;
      z.knock.addScaledVector(dir, 2.6); // death lurch
      deregister(); // corpse stops soaking bullets immediately
      return;
    }
    // stagger, but not more often than RESTAGGER_LOCK_MS — otherwise spraying a
    // zombie's arms/legs would freeze it in place forever
    if (zc.stagger && z.state !== 'attack' && nowMs >= z.restaggerUntil) {
      z.state = 'hit';
      z.stamp = nowMs;
      z.restaggerUntil = nowMs + RESTAGGER_LOCK_MS;
    }
  };

  // build the bone-parented hitboxes once
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    addZombie(g);
    st.current.deregistered = false;
    const list: { mesh: THREE.Mesh; bone: THREE.Object3D; yOff: number }[] = [];
    for (const def of HITBOXES) {
      const bone = bones[normBone(def.bone)];
      if (!bone) {
        console.warn(`[Zombie] hitbox bone not found: ${def.bone}`);
        continue;
      }
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...def.size),
        // raycastable always; hidden until [H]. A hidden mesh is still hit by
        // Raycaster (it only checks layers, never `visible`), so toggling
        // `.visible` is the reliable way to show/hide the debug view.
        new THREE.MeshBasicMaterial({
          color: ZONE_DEBUG_COLOR[def.zone],
          depthTest: false,
          wireframe: true,
          transparent: true,
          opacity: 0.9,
        })
      );
      mesh.visible = combatState.debugHitboxes;
      mesh.renderOrder = 999;
      mesh.userData.onHit = onHit;
      mesh.userData.zone = def.zone;
      g.add(mesh);
      addHitbox(mesh);
      list.push({ mesh, bone, yOff: def.yOff });
    }
    st.current.hitboxes = list;
    return () => {
      removeZombie(g);
      list.forEach(({ mesh }) => {
        removeHitbox(mesh);
        g.remove(mesh); // captured g — groupRef.current can be transiently null
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      st.current.hitboxes = [];
    };
  }, [bones]);

  useFrame((_, delta) => {
    const g = groupRef.current;
    const z = st.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);
    const now = performance.now();
    mixer.update(dt);

    // keep the limb hitboxes glued to the (animated) bones — position AND
    // rotation. The boxes are children of the root group, not the bone, so the
    // bone's world quaternion has to be brought back into the group's local
    // space: local = inverse(groupWorld) * boneWorld.
    g.getWorldQuaternion(_gInvQ).invert();
    const dbg = combatState.debugHitboxes;
    for (const h of z.hitboxes) {
      h.bone.getWorldPosition(_bp);
      _bp.y += h.yOff;
      g.worldToLocal(_bp);
      h.mesh.position.copy(_bp);

      h.bone.getWorldQuaternion(_bq);
      h.mesh.quaternion.copy(_gInvQ).multiply(_bq);

      if (h.mesh.visible !== dbg) h.mesh.visible = dbg;
    }

    const dx = playerPosition.x - g.position.x;
    const dz = playerPosition.z - g.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist;
    const nz = dz / dist;

    // separation: push away from any zombie we're overlapping so the pack fans
    // out around the player instead of collapsing into one body
    _sep.set(0, 0); // .x = world x, .y = world z
    if (z.state !== 'dead') {
      for (const other of combatState.zombies) {
        if (other === g) continue;
        const ox = g.position.x - other.position.x;
        const oz = g.position.z - other.position.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > 1e-4 && d2 < SEP_RADIUS * SEP_RADIUS) {
          const d = Math.sqrt(d2);
          const f = (SEP_RADIUS - d) / SEP_RADIUS; // 0..1, strongest when closest
          _sep.x += (ox / d) * f;
          _sep.y += (oz / d) * f;
        }
      }
    }

    // alert (permanent once triggered) — line of sight OR enough noise here
    if (!z.alerted && z.state !== 'dead') {
      const heard = getNoiseIntensityAt(g.position) >= HEAR_THRESHOLD;
      if (heard || dist < SEE_RANGE) {
        z.alerted = true;
        playZombieVoice(dist);
        z.nextVoice = now + 3000 + Math.random() * 3000;
      }
    }
    // periodic snarl while active
    if (z.alerted && z.state !== 'dead' && now > z.nextVoice) {
      playZombieVoice(dist);
      z.nextVoice = now + 4000 + Math.random() * 4000;
    }

    // face the player
    if (z.state !== 'dead') {
      const targetYaw = Math.atan2(dx, dz);
      const d = ((targetYaw - z.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      z.yaw += d * Math.min(1, (z.alerted ? 8 : 4) * dt);
      g.rotation.y = z.yaw;
    }

    const walk = z.walkPick ? actions.walkA : actions.walkB;
    const legSlowed = now < z.legSlowUntil;

    switch (z.state) {
      case 'move': {
        playOnly(walk);
        if (walk) walk.setEffectiveTimeScale((z.alerted ? RUN_TIMESCALE : 1) * (legSlowed ? 0.55 : 1));
        let spd = z.alerted ? RUN_SPEED : WALK_SPEED;
        if (legSlowed) spd *= 0.5;
        g.position.x += nx * spd * dt;
        g.position.z += nz * spd * dt;
        if (dist < ATTACK_RANGE) {
          z.state = 'attack';
          z.attackCd = 0.3;
        }
        break;
      }
      case 'attack':
        playOnly(actions.attack ?? walk);
        z.attackCd -= dt;
        if (z.attackCd <= 0) {
          onAttack();
          z.attackCd = 1.7;
        }
        if (dist > ATTACK_RANGE + 0.9) z.state = 'move';
        break;
      case 'hit':
        playOnly(actions.hitR ?? walk, 0.07);
        if (now - z.stamp > HIT_STUN_MS) z.state = 'move';
        break;
      case 'dead':
        if (!z.reported) {
          z.reported = true;
          deregister(); // safety — also done in onHit
          playOnly((Math.random() < 0.5 ? actions.die : actions.die2) ?? actions.die, 0.05);
        }
        if (now - z.stamp > CORPSE_MS) onDead();
        break;
    }

    // separation shove — keeps the pack spread out (not while dead)
    if ((_sep.x !== 0 || _sep.y !== 0) && z.state !== 'dead') {
      g.position.x += _sep.x * SEP_STRENGTH * dt;
      g.position.z += _sep.y * SEP_STRENGTH * dt;
    }

    // apply + decay the knockback impulse (bullet impact response)
    if (z.knock.lengthSq() > 1e-5) {
      g.position.x += z.knock.x * dt;
      g.position.z += z.knock.z * dt;
      z.knock.multiplyScalar(Math.exp(-9 * dt));
    }

    g.position.y = terrainHeightAt(g.position.x, g.position.z) - 0.05;
  });

  return (
    <group ref={groupRef} position={[spawn[0], 0, spawn[1]]}>
      <primitive object={model} />
    </group>
  );
}
