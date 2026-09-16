import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { Physics, RigidBody, CylinderCollider, RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { EndlessForest } from './components/EndlessForest';
import { ForestGround, GroundPlane } from './components/ForestGround';
import { SkyDome } from './components/SkyDome';
import { Moon } from './components/Moon';
import { CanopyLayer } from './components/CanopyLayer';
import { ForestAnimals } from './components/WanderingAnimal';
import { Zombies } from './components/Zombies';
import { HorrorAtmosphereLighting } from './components/HorrorAtmosphereLighting';
import { FlashlightRig } from './components/FlashlightRig';
import { FlashlightFX } from './components/FlashlightFX';
import { WeaponRig } from './components/WeaponRig';
import { AmmoBoxes } from './components/AmmoBoxes';
import { playerPosition, playerState } from './world/playerState';
import { weaponState } from './world/weaponState';
import { combatState } from './world/combatState';
import { staminaState, staminaFrac, STAMINA_LOW_FRAC } from './world/staminaState';
import { subtitleState, SUBTITLE_FADE_MS } from './world/subtitleState';
import {
  noiseState,
  pruneNoise,
  emitThrottled,
  activeNoiseEvents,
} from './world/noiseState';
import {
  beaconState,
  litBeaconCount,
  allBeaconsLit,
  capturingBeacon,
  nearestUnlitBeacon,
  EXTRACTION_POS,
  CAPTURE_SECONDS,
} from './world/beaconState';
import { Beacons } from './components/Beacons';
import { Extraction } from './components/Extraction';
import { extractionState, countdownRemaining, failExtraction } from './world/extractionState';
import { NoiseDebug } from './components/NoiseDebug';
import { RootGrowths } from './components/RootGrowth';
import { SporeFX } from './components/SporeFX';
import { SafeAsset } from './components/SafeAsset';
import { MoonFallback } from './components/MoonFallback';
import { initAudio, setLocomotion, playJump, playLand, setWinded } from './audio/sfx';

// --- Stamina tuning (units/sec) ---
const SPRINT_DRAIN = 17;
const STEALTH_DRAIN = 4;
const STAMINA_REGEN = 13;
const SPRINT_SPEED = 6.8;
const WALK_SPEED = 4.0;
const STEALTH_SPEED = 2.2;
// once fully spent, stamina must climb back to this before sprint re-enables
const SPRINT_REARM = 20;

// Pre-allocated math to keep the render loop allocation-free (60 FPS).
const _moveDir = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();

interface PlayerProps {
  onToggleFlashlight: () => void;
}

/**
 * First-person controller.
 * - Camera-yaw-locked WASD with smooth acceleration / deceleration
 * - Rapier jump with grounded validation + landing detection
 * - Flashlight toggle (Q)
 * - Distance-based footstep audio; jump / land cues
 */
function Player({ onToggleFlashlight }: PlayerProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const { camera } = useThree();

  const moveStateRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    stealth: false,
    jumpRequested: false,
  });

  const wasGroundedRef = useRef(true);
  const prevVyRef = useRef(0);
  const exhaustedRef = useRef(false); // true after stamina hits 0 until it re-arms

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const m = moveStateRef.current;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') m.forward = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') m.backward = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') m.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') m.right = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') m.sprint = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') m.stealth = true;
      if (e.code === 'Space') m.jumpRequested = true;
      if ((e.code === 'KeyQ' || e.code === 'KeyF') && !e.repeat) onToggleFlashlight();
      if (e.code === 'KeyH' && !e.repeat) combatState.debugHitboxes = !combatState.debugHitboxes;
      if (e.code === 'KeyN' && !e.repeat) noiseState.debug = !noiseState.debug;
    };
    const up = (e: KeyboardEvent) => {
      const m = moveStateRef.current;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') m.forward = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') m.backward = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') m.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') m.right = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') m.sprint = false;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') m.stealth = false;
      if (e.code === 'Space') m.jumpRequested = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onToggleFlashlight]);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    if (!body) return;
    const dt = Math.min(delta, 1 / 30); // clamp huge frames for stable physics

    const vel = body.linvel();
    const pos = body.translation();

    // Safety net: if we've somehow dropped through the world, drop back in.
    if (pos.y < -6) {
      body.setTranslation({ x: pos.x, y: 3, z: pos.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    // Sync camera + shared player state.
    camera.position.set(pos.x, pos.y + 0.8, pos.z);
    playerPosition.set(pos.x, pos.y, pos.z);

    const grounded = Math.abs(vel.y) < 0.18 && pos.y <= 1.4;

    // --- Landing cue ---
    if (grounded && !wasGroundedRef.current && prevVyRef.current < -1.5) {
      playLand(THREE.MathUtils.clamp(-prevVyRef.current / 6, 0.4, 1));
    }
    wasGroundedRef.current = grounded;
    prevVyRef.current = vel.y;

    // --- Movement input ---
    const m = moveStateRef.current;
    const inX = (m.right ? 1 : 0) - (m.left ? 1 : 0);
    const inZ = (m.backward ? 1 : 0) - (m.forward ? 1 : 0);
    const moving = inX !== 0 || inZ !== 0;

    // --- Stamina + movement mode ---
    const stam = staminaState;
    if (exhaustedRef.current && stam.current >= SPRINT_REARM) exhaustedRef.current = false;
    const canSprint = stam.current > 0 && !exhaustedRef.current;
    const sprinting = m.sprint && moving && grounded && canSprint;
    // Ctrl = stealth-walk; sprint wins if both are held and usable
    const stealthing = !sprinting && m.stealth && moving && grounded;

    if (sprinting) {
      stam.current = Math.max(0, stam.current - SPRINT_DRAIN * dt);
      if (stam.current === 0) exhaustedRef.current = true;
    } else if (stealthing) {
      stam.current = Math.max(0, stam.current - STEALTH_DRAIN * dt);
    } else {
      stam.current = Math.min(stam.max, stam.current + STAMINA_REGEN * dt); // walk or idle
    }
    stam.depleting = sprinting || stealthing;

    playerState.moving = moving;
    playerState.sprinting = sprinting;
    playerState.stealthWalking = stealthing;
    playerState.grounded = grounded;
    // camera yaw (0 = -Z). extract from quaternion, no euler-order mutation.
    _camForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    playerState.yaw = Math.atan2(_camForward.x, -_camForward.z);

    // Movement basis derived straight from the camera quaternion, projected
    // onto the ground plane. Never touch camera.rotation / .order — doing so
    // fights PointerLockControls and rolls the horizon.
    _moveDir.set(0, 0, 0);
    if (moving) {
      _camForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      _camForward.y = 0;
      _camForward.normalize();
      // right = forward × worldUp  →  (-fz, 0, fx)
      _camRight.set(-_camForward.z, 0, _camForward.x);
      _moveDir
        .addScaledVector(_camForward, -inZ) // inZ: +1 = backward, -1 = forward
        .addScaledVector(_camRight, inX) // inX: +1 = right (D), -1 = left (A)
        .normalize();
    }

    const speed = sprinting ? SPRINT_SPEED : stealthing ? STEALTH_SPEED : WALK_SPEED;
    const targetVx = _moveDir.x * speed;
    const targetVz = _moveDir.z * speed;

    // Smooth acceleration / deceleration (exponential approach).
    const accel = moving ? 16 : 12;
    const k = 1 - Math.exp(-accel * dt);
    const nvx = vel.x + (targetVx - vel.x) * k;
    const nvz = vel.z + (targetVz - vel.z) * k;
    let nvy = vel.y;

    // --- Jump ---
    if (m.jumpRequested && grounded) {
      nvy = 5.2;
      m.jumpRequested = false;
      playJump();
    }

    body.setLinvel({ x: nvx, y: nvy, z: nvz }, true);

    // --- Footstep loop + winded breathing ---
    // stealth-walk keeps footsteps silent — the quiet is the whole point
    const winded = staminaFrac() < STAMINA_LOW_FRAC;
    setLocomotion(
      stealthing || !grounded ? 'idle' : sprinting ? 'run' : moving ? 'walk' : 'idle'
    );
    setWinded(winded);

    // --- Noise emission (Stage B) ---
    pruneNoise(); // single per-frame driver for the whole noise field
    if (sprinting) {
      // medium radius, lingers ~1.3 s after you stop
      emitThrottled('sprint', 220, pos.x, pos.z, 0.6, 22, 1300);
    } else if (stealthing) {
      // tiny + always below HEAR_THRESHOLD — deliberately near-undetectable
      emitThrottled('stealth', 400, pos.x, pos.z, 0.08, 4, 500);
    }
    if (winded) {
      emitThrottled('breath', 2000, pos.x, pos.z, 0.4, 11, 1600);
    }
  });

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      type="dynamic"
      position={[0, 1.2, 0]}
      enabledRotations={[false, false, false]}
      friction={0.15}
      linearDamping={0.05}
    >
      <CylinderCollider args={[0.85, 0.4]} />
    </RigidBody>
  );
}

function SceneExpose() {
  const { scene, camera, gl } = useThree();
  useEffect(() => {
    Object.assign(window as unknown as Record<string, unknown>, {
      __scene: scene,
      __cam: camera,
      __gl: gl,
      __ppos: playerPosition,
      __combat: combatState,
      __pstate: playerState,
      __stam: staminaState,
      __noise: noiseState,
      __noiseEvents: activeNoiseEvents,
      __beacons: beaconState,
    });
  }, [scene, camera, gl]);
  return null;
}

// --- DIEGETIC TOP COMPASS STRIP — heading + nearest objective bearing ---
const DEG_PER_PX = 360 / 340; // strip: 16 marks (=360°) span the 340px container

function CompassBar() {
  const stripRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const yawDeg = (playerState.yaw * 180) / Math.PI;
      const el = stripRef.current;
      if (el) {
        const frac = ((yawDeg % 360) + 360) % 360 / 360;
        el.style.transform = `translateX(${-(frac * 33.333 + 33.333)}%)`;
      }

      // objective bearing
      const px = playerPosition.x;
      const pz = playerPosition.z;
      let tx: number | null = null;
      let tz = 0;
      let label = '';
      if (allBeaconsLit()) {
        tx = EXTRACTION_POS[0];
        tz = EXTRACTION_POS[1];
        label = 'EXTRACTION';
      } else {
        const b = nearestUnlitBeacon(px, pz);
        if (b) {
          tx = b.x;
          tz = b.z;
          label = `BEACON ${litBeaconCount() + 1} / 5`;
        }
      }
      const mk = markRef.current;
      const lb = labelRef.current;
      if (tx !== null && mk && lb) {
        const bearingDeg = (Math.atan2(tx - px, -(tz - pz)) * 180) / Math.PI;
        let delta = bearingDeg - yawDeg;
        delta = ((delta % 360) + 540) % 360 - 180; // wrap to [-180,180]
        const offset = Math.max(-155, Math.min(155, delta / DEG_PER_PX));
        mk.style.transform = `translateX(calc(-50% + ${offset}px))`;
        mk.style.opacity = Math.abs(delta) > 150 ? '0.35' : '1';
        lb.textContent = label;
        lb.style.transform = `translateX(calc(-50% + ${offset}px))`;
      } else if (mk && lb) {
        mk.style.opacity = '0';
        lb.textContent = '';
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const marks = ['N', '', 'NE', '', 'E', '', 'SE', '', 'S', '', 'SW', '', 'W', '', 'NW', ''];
  const triple = [...marks, ...marks, ...marks];

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[340px] h-9 pointer-events-none">
      <div
        className="absolute inset-x-0 top-0 h-7 overflow-hidden opacity-90"
        style={{
          maskImage: 'linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)',
        }}
      >
        <div ref={stripRef} className="absolute top-0 left-0 h-full flex items-center" style={{ width: '300%' }}>
          {triple.map((mk, i) => (
            <span
              key={i}
              className={`flex-1 text-center text-[11px] tracking-widest ${
                mk ? 'text-cyan-200/90 font-bold' : 'text-slate-500/70'
              }`}
            >
              {mk || '·'}
            </span>
          ))}
        </div>
      </div>
      {/* current-heading tick */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-7 bg-amber-300/80 shadow-[0_0_6px_#fcd34d]" />
      {/* objective marker + label */}
      <div ref={markRef} className="absolute top-0 left-1/2 text-[13px] leading-7 text-emerald-300 drop-shadow-[0_0_5px_rgba(52,255,154,0.8)]">
        ◆
      </div>
      <div ref={labelRef} className="absolute top-[26px] left-1/2 text-[8px] uppercase tracking-widest text-emerald-400/90 whitespace-nowrap" />
    </div>
  );
}

/** Objective status line under the compass: beacons lit, active capture timer. */
function ObjectiveHUD() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const cap = capturingBeacon();
        if (cap) {
          const left = Math.ceil(CAPTURE_SECONDS - cap.progress);
          el.textContent = `▲ CAPTURING — ${left}s`;
          el.style.color = '#ffd24a';
        } else if (allBeaconsLit()) {
          el.textContent = '◆ ALL BEACONS LIT — REACH EXTRACTION';
          el.style.color = '#39ff9a';
        } else {
          el.textContent = `◆ BEACONS  ${litBeaconCount()} / 5`;
          el.style.color = 'rgba(148,163,184,0.9)';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      className="absolute top-[52px] left-1/2 -translate-x-1/2 z-20 pointer-events-none text-[10px] font-bold uppercase tracking-[0.2em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
    />
  );
}

/** rAF poll for the extraction flag — flips App into the end state. */
function ExtractionWatch({ onExtract }: { onExtract: () => void }) {
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (beaconState.extracted) onExtract();
      else raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [onExtract]);
  return null;
}

/** Night 4 — rAF poll for extractionState flipping to 'failed' (a zombie hit
 *  landed mid-countdown). Separate from ExtractionWatch since this is a
 *  distinct terminal state, not a variant of success. */
function ExtractFailWatch({ onFail }: { onFail: () => void }) {
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (extractionState.phase === 'failed') onFail();
      else raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [onFail]);
  return null;
}

/** Night 4 — countdown readout, shown only once the extraction pad has been
 *  reached and the timer is live. A separate overlay from ObjectiveHUD/the
 *  compass (not a replacement) so "beacons lit" and "hold on" never fight
 *  for the same line. Reddens and enlarges under 10s for urgency. */
function CountdownHUD() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        if (extractionState.phase === 'countdown') {
          const left = Math.ceil(countdownRemaining());
          const urgent = left <= 10;
          el.textContent = `EXTRACTION IN ${left}s — SURVIVE`;
          el.style.display = 'block';
          el.style.color = urgent ? '#ff5a4a' : '#ffb14a';
          el.style.fontSize = urgent ? '22px' : '15px';
        } else {
          el.style.display = 'none';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      className="absolute top-[84px] left-1/2 -translate-x-1/2 z-20 pointer-events-none font-bold uppercase tracking-[0.15em] drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] transition-[font-size] duration-150"
      style={{ display: 'none' }}
    />
  );
}

/** Centered aiming crosshair. */
function Crosshair() {
  return (
    <div className="absolute inset-0 z-[14] pointer-events-none flex items-center justify-center">
      <svg width="26" height="26" viewBox="-13 -13 26 26">
        <g stroke="#e6f2ff" strokeWidth="1.4" strokeLinecap="round" opacity="0.85">
          <line x1="0" y1="-11" x2="0" y2="-4" />
          <line x1="0" y1="4" x2="0" y2="11" />
          <line x1="-11" y1="0" x2="-4" y2="0" />
          <line x1="4" y1="0" x2="11" y2="0" />
        </g>
        <circle r="1" fill="#e6f2ff" opacity="0.9" />
      </svg>
    </div>
  );
}

/** Ammo readout, lower-right. Reads weaponState via rAF (no per-frame re-render). */
function AmmoHUD() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const w = weaponState;
      if (ref.current) {
        ref.current.textContent = w.reloading
          ? `RELOADING…   / ${w.reserve}`
          : `${w.mag} / ${w.reserve}`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="absolute bottom-6 right-8 z-20 pointer-events-none text-right">
      <div ref={ref} className="font-mono text-2xl font-bold text-amber-200 tracking-wider drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]" />
      <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-0.5">
        AKM &nbsp;·&nbsp; [R] Reload
      </div>
    </div>
  );
}

/** Minimal stamina bar, lower-left. rAF-driven, no per-frame React re-render. */
function StaminaHUD() {
  const fill = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const f = staminaFrac();
      if (fill.current) {
        fill.current.style.width = `${Math.round(f * 100)}%`;
        fill.current.style.background =
          f < STAMINA_LOW_FRAC ? '#e0503a' : staminaState.depleting ? '#d9b44a' : '#6f8fae';
      }
      if (wrap.current) wrap.current.style.opacity = f > 0.99 ? '0.35' : '0.9';
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={wrap}
      className="absolute bottom-7 left-8 z-20 pointer-events-none transition-opacity"
    >
      <div className="h-[4px] w-[140px] bg-black/55 rounded-sm overflow-hidden ring-1 ring-white/10">
        <div ref={fill} className="h-full transition-[width] duration-100 ease-linear" />
      </div>
      <div className="text-[9px] uppercase tracking-widest text-slate-500 mt-1">
        [Shift] Sprint &nbsp;·&nbsp; [Ctrl] Sneak
      </div>
    </div>
  );
}

/** Night 2 — a found-audio transcription line, shown while a beacon
 *  transmission plays and faded out after. Not a dialogue box: one line,
 *  center-low, out of the way of the crosshair and both side HUD clusters. */
function SubtitleHUD() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const remain = subtitleState.showUntil - performance.now();
        if (remain > 0 && subtitleState.text) {
          if (el.textContent !== subtitleState.text) el.textContent = subtitleState.text;
          el.style.opacity = remain < SUBTITLE_FADE_MS ? String(Math.max(0, remain / SUBTITLE_FADE_MS)) : '1';
        } else {
          el.style.opacity = '0';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[70%] text-center text-[13px] italic text-slate-200/95 tracking-wide opacity-0 transition-opacity duration-300"
      style={{ textShadow: '0 1px 5px rgba(0,0,0,0.95)' }}
    />
  );
}

// --- MAIN GAME APPLICATION CONTAINER ---
export default function App() {
  const [isLocked, setIsLocked] = useState(false);
  // Dev: `?peek` hides the start overlay so the scene is visible without pointer lock.
  const peek = typeof window !== 'undefined' && window.location.search.includes('peek');
  const showHud = isLocked || peek;

  // Flashlight — simple on/off, no battery.
  const [isFlashlightOn, setIsFlashlightOn] = useState(true);
  const flashlightPower = 1;

  // brief red edge-flash when a zombie hits the player
  const [hurt, setHurt] = useState(false);
  const hurtTimer = useRef<number | null>(null);
  const onZombieAttack = useCallback(() => {
    setHurt(true);
    if (hurtTimer.current) window.clearTimeout(hurtTimer.current);
    hurtTimer.current = window.setTimeout(() => setHurt(false), 320);
    // Night 4: no player-HP system exists (never has, this whole game), so a
    // hit landing during the extraction countdown fails the run outright
    // rather than building out a health bar just for this one window.
    if (extractionState.phase === 'countdown') failExtraction();
  }, []);

  const [extracted, setExtracted] = useState(false);
  const onExtract = useCallback(() => {
    setExtracted(true);
    document.exitPointerLock?.();
  }, []);

  const [extractFailed, setExtractFailed] = useState(false);
  const onExtractFail = useCallback(() => {
    setExtractFailed(true);
    document.exitPointerLock?.();
  }, []);

  return (
    <div className="relative w-screen h-screen bg-[#03070d] select-none font-mono overflow-hidden">
      {showHud && <Crosshair />}
      {showHud && <AmmoHUD />}
      {showHud && <StaminaHUD />}
      {showHud && <ObjectiveHUD />}
      {showHud && <SubtitleHUD />}
      {showHud && <CountdownHUD />}

      {extracted && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#02120a]/92 backdrop-blur-md">
          <p className="text-xs uppercase tracking-[0.4em] text-emerald-400/80 mb-3">Signal Restored</p>
          <h1 className="text-5xl font-bold tracking-[0.2em] text-emerald-200 drop-shadow-[0_0_20px_rgba(52,255,154,0.5)]">
            EXTRACTED
          </h1>
          <p className="text-sm text-slate-400 mt-6">
            {litBeaconCount()} / 5 beacons lit &nbsp;·&nbsp; reload the page to run it again
          </p>
        </div>
      )}

      {extractFailed && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#120202]/92 backdrop-blur-md">
          <p className="text-xs uppercase tracking-[0.4em] text-red-400/80 mb-3">Signal Lost</p>
          <h1 className="text-5xl font-bold tracking-[0.2em] text-red-300 drop-shadow-[0_0_20px_rgba(255,60,60,0.5)]">
            EXTRACTION FAILED
          </h1>
          <p className="text-sm text-slate-400 mt-6">reload the page to try again</p>
        </div>
      )}

      {hurt && (
        <div
          className="absolute inset-0 pointer-events-none z-[18]"
          style={{ boxShadow: 'inset 0 0 160px 30px rgba(150,10,10,0.55)' }}
        />
      )}

      {/* --- POST FX (CSS): vignette, film grain, cool colour grade --- */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{ boxShadow: 'inset 0 0 140px 20px rgba(2,4,9,0.95), inset 0 0 400px rgba(2,4,9,0.55)' }}
      />
      <div
        className="absolute inset-0 pointer-events-none z-[11] mix-blend-soft-light"
        style={{ background: 'radial-gradient(ellipse at center, rgba(40,90,120,0.10), rgba(0,0,0,0) 60%)' }}
      />
      <div
        className="absolute inset-0 pointer-events-none z-[12] opacity-[0.06] mix-blend-overlay grain"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {showHud && <CompassBar />}

      {!isLocked && !peek && (
        <div
          id="overlay-start"
          onClick={() => {
            initAudio();
            document.querySelector('canvas')?.requestPointerLock?.();
          }}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#03070d]/95 text-neutral-200 cursor-pointer backdrop-blur-md"
        >
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-400/80 mb-2">The Returning Compass</p>
          <h1 className="text-2xl font-bold tracking-wider mb-6 text-slate-100">CLICK TO ENTER THE FOG</h1>
          <div className="text-xs text-slate-300 space-y-1.5 text-left font-mono border border-cyan-900/50 bg-slate-950/80 px-8 py-5 rounded-md shadow-2xl backdrop-blur-lg">
            <p><span className="text-cyan-300 font-bold">WASD / Arrow Keys</span> — Move</p>
            <p><span className="text-cyan-300 font-bold">Space</span> — Jump</p>
            <p><span className="text-cyan-300 font-bold">Shift</span> — Sprint (uses stamina)</p>
            <p><span className="text-cyan-300 font-bold">Ctrl</span> — Sneak (slow &amp; silent)</p>
            <p><span className="text-amber-300 font-bold">Q / F</span> — Toggle Flashlight</p>
            <p><span className="text-cyan-300 font-bold">Mouse</span> — Look Around</p>
            <p className="pt-1 text-emerald-300/90">Light all 5 beacons, then reach extraction.</p>
            <p className="text-slate-500">Stand in a beacon ring 20s to light it — it draws the dead.</p>
          </div>
        </div>
      )}

      <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
        <div
          onClick={() => setIsFlashlightOn((p) => !p)}
          className={`px-3 py-1.5 rounded text-xs border cursor-pointer transition flex items-center gap-2.5 ${
            isFlashlightOn
              ? 'bg-amber-950/80 border-amber-500 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
              : 'bg-slate-950/80 border-slate-700 text-slate-400'
          }`}
        >
          <span className="font-bold">[Q/F]</span>
          <span>Flashlight: {isFlashlightOn ? 'ON' : 'OFF'}</span>
        </div>
      </div>

      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.7, 0], rotation: [0, 0, 0], fov: 62, near: 0.1, far: 470 }}
        gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.25 }}
        // Real-time shadows were tried (`shadows="soft"` + a shadow-casting
        // flashlight) and turned back off — see FlashlightRig.tsx's class doc
        // comment. No `shadows` prop = shadow mapping fully disabled, which is
        // the safer default until that's root-caused.
        style={{ filter: 'contrast(1.08) saturate(0.82) brightness(0.98)' }}
      >
        <HorrorAtmosphereLighting />
        {peek && <SceneExpose />}

        {/* SafeAsset = Suspense + an error boundary: one missing/bad GLB degrades
            to its fallback instead of unmounting the whole scene. */}
        <SafeAsset fallback={null}>
          <SkyDome />
        </SafeAsset>
        <SafeAsset fallback={<MoonFallback />}>
          <Moon />
        </SafeAsset>
        <CanopyLayer />

        <Physics gravity={[0, -9.81, 0]}>
          <Player onToggleFlashlight={() => setIsFlashlightOn((p) => !p)} />

          {/* Always-on physics floor + fallback plane — never gated by asset loads */}
          <GroundPlane />

          <SafeAsset fallback={null}>
            <ForestGround />
          </SafeAsset>
          <SafeAsset fallback={null}>
            <EndlessForest />
          </SafeAsset>
          <SafeAsset fallback={null}>
            <ForestAnimals />
          </SafeAsset>
          <SafeAsset fallback={null}>
            <AmmoBoxes />
          </SafeAsset>
          <SafeAsset fallback={null}>
            <Zombies onAttack={onZombieAttack} />
          </SafeAsset>
          <SafeAsset fallback={null}>
            <Beacons />
          </SafeAsset>
          <RootGrowths />
          <Extraction />
          <NoiseDebug />
          <ExtractionWatch onExtract={onExtract} />
          <ExtractFailWatch onFail={onExtractFail} />

          <FlashlightFX on={isFlashlightOn && flashlightPower > 0.2} />
          <SporeFX />
        </Physics>

        {/* first-person AKM — camera-tracked, fires from screen centre */}
        <SafeAsset fallback={null}>
          <WeaponRig />
        </SafeAsset>

        {/* camera-tracked flashlight rig — no hand meshes */}
        <FlashlightRig on={isFlashlightOn} power={flashlightPower} />

        <PointerLockControls onLock={() => setIsLocked(true)} onUnlock={() => setIsLocked(false)} />
      </Canvas>
    </div>
  );
}
