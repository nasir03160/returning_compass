import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { RigidBody, RapierRigidBody, CapsuleCollider } from '@react-three/rapier';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { playerPosition } from '../world/playerState';

useGLTF.preload('/assets/Deer.glb');
useGLTF.preload('/assets/Wolf.glb');

export interface WanderingAnimalProps {
  modelPath: string;
  /** real-world height in metres to normalise the model to */
  targetHeight: number;
  speed?: number;
  name?: string;
  seed?: number;
}

const FLEE_RADIUS = 15; // player this close -> bolt
const CALM_RADIUS = 30; // ...calm down past this
const RELOCATE_DIST = 160;

function firstClip(actions: Record<string, THREE.AnimationAction | null>, re: RegExp) {
  // Prefer the armature-bound clip name, then a bare one, then anything matching.
  const keys = Object.keys(actions);
  return (
    keys.find((k) => re.test(k) && k.includes('|')) ||
    keys.find((k) => re.test(k)) ||
    null
  );
}

/**
 * A wandering forest animal (Deer / Wolf): auto-scaled to a believable size,
 * skeletally animated — Walk while roaming, Gallop when the player gets close —
 * and it bolts away from the player rather than standing there.
 */
export function WanderingAnimal({
  modelPath,
  targetHeight,
  speed = 1.6,
  name = 'Animal',
  seed = 1,
}: WanderingAnimalProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const yawRef = useRef<THREE.Group>(null);

  const gltf = useGLTF(modelPath);

  // Deep clone (skeleton included) so each animal animates independently.
  const model = useMemo(() => SkeletonUtils.clone(gltf.scene) as THREE.Group, [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = targetHeight / (size.y || 1);
    return { scale, foot: -box.min.y * scale };
  }, [gltf.scene, targetHeight]);

  const clips = useMemo(
    () => ({
      walk: firstClip(actions, /walk/i) || firstClip(actions, /idle/i),
      run: firstClip(actions, /gallop|run/i) || firstClip(actions, /walk/i),
    }),
    [actions]
  );

  const ai = useRef({
    heading: Math.random() * Math.PI * 2,
    target: Math.random() * Math.PI * 2,
    timer: THREE.MathUtils.randFloat(3, 6),
    fleeing: false,
    clip: '',
  });

  const spawn = useRef<[number, number, number]>([
    playerPosition.x + Math.cos(seed) * 20,
    targetHeight + 0.5,
    playerPosition.z + Math.sin(seed * 1.7) * 20,
  ]);

  const play = (clip: string | null) => {
    const s = ai.current;
    if (!clip || clip === s.clip || !actions[clip]) return;
    if (s.clip && actions[s.clip]) actions[s.clip]!.fadeOut(0.2);
    actions[clip]!.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    s.clip = clip;
  };

  useEffect(() => {
    play(clips.walk);
    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.walk, actions]);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const yaw = yawRef.current;
    if (!body || !yaw) return;

    const t = body.translation();
    const s = ai.current;
    const dx = t.x - playerPosition.x;
    const dz = t.z - playerPosition.z;
    const distSq = dx * dx + dz * dz;

    if (distSq > RELOCATE_DIST * RELOCATE_DIST) {
      const a = Math.random() * Math.PI * 2;
      body.setTranslation(
        {
          x: playerPosition.x + Math.cos(a) * (RELOCATE_DIST * 0.5),
          y: targetHeight + 0.5,
          z: playerPosition.z + Math.sin(a) * (RELOCATE_DIST * 0.5),
        },
        true
      );
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    if (!s.fleeing && distSq < FLEE_RADIUS * FLEE_RADIUS) s.fleeing = true;
    else if (s.fleeing && distSq > CALM_RADIUS * CALM_RADIUS) s.fleeing = false;

    if (s.fleeing) {
      s.target = Math.atan2(dx, dz); // straight away from the player
      play(clips.run);
    } else {
      s.timer -= delta;
      if (s.timer <= 0) {
        s.timer = THREE.MathUtils.randFloat(3, 6);
        const toPlayer = Math.atan2(-dx, -dz);
        const wander = (Math.random() - 0.5) * Math.PI * 1.3;
        s.target = THREE.MathUtils.lerp(s.heading + wander, toPlayer, 0.2);
      }
      play(clips.walk);
    }

    const turn = (s.fleeing ? 5 : 2.2) * delta;
    const diff =
      THREE.MathUtils.euclideanModulo(s.target - s.heading + Math.PI, Math.PI * 2) - Math.PI;
    s.heading += Math.sign(diff) * Math.min(Math.abs(diff), turn);
    yaw.rotation.y = s.heading;

    const spd = s.fleeing ? speed * 3.2 : speed;
    body.setLinvel(
      { x: Math.sin(s.heading) * spd, y: body.linvel().y, z: Math.cos(s.heading) * spd },
      true
    );
  });

  const capHalf = 0.3 * targetHeight;
  const capRad = 0.22 * targetHeight;

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders={false}
      position={spawn.current}
      enabledRotations={[false, false, false]}
      friction={0.4}
      linearDamping={0.2}
      name={name}
    >
      <CapsuleCollider args={[capHalf, capRad]} position={[0, capHalf + capRad, 0]} />
      <group ref={yawRef}>
        <group position={[0, fit.foot, 0]} scale={fit.scale}>
          <primitive object={model} />
        </group>
      </group>
    </RigidBody>
  );
}

/** A small herd that keeps you company in the endless woods. */
export function ForestAnimals() {
  return (
    <group name="forest-animals">
      <WanderingAnimal name="Deer-1" modelPath="/assets/Deer.glb" targetHeight={1.9} seed={1.3} speed={1.7} />
      <WanderingAnimal name="Deer-2" modelPath="/assets/Deer.glb" targetHeight={1.8} seed={4.1} speed={1.9} />
      <WanderingAnimal name="Deer-3" modelPath="/assets/Deer.glb" targetHeight={2.0} seed={5.9} speed={1.6} />
      <WanderingAnimal name="Wolf-1" modelPath="/assets/Wolf.glb" targetHeight={0.9} seed={2.7} speed={2.2} />
      <WanderingAnimal name="Wolf-2" modelPath="/assets/Wolf.glb" targetHeight={0.95} seed={3.4} speed={2.4} />
    </group>
  );
}
