# The Returning Compass — Architecture & Codebase Guide (`CLAUDE.md`)

Fast-onboarding reference for the current build. Read this instead of crawling the repo.

> **Status (2026-09):** All original psychological-horror story content (runs, clues, journals,
> compass objectives, watcher, narrative FX, opening VO sequence) has been **deleted**. The project
> is now a **first-person zombie shooter**: a dark, endless, procedurally-streamed night forest, an
> AKM weapon, and a pool of pursuing zombies. The name and the cold horror-forest atmosphere are all
> that remain of the original concept.

---

## 1. Tech Stack

- **Framework**: React 18 + Vite + TypeScript
- **3D**: `@react-three/fiber` (Three.js v0.185+)
- **Helpers**: `@react-three/drei` (`PointerLockControls`, `useGLTF`, `Instances`/`Instance`, `useAnimations`)
- **Physics**: `@react-three/rapier` (`RigidBody`, `CuboidCollider`, `CylinderCollider`, `BallCollider`)
- **Rigged-model cloning**: `three-stdlib` `SkeletonUtils.clone` (never plain `.clone()` on skinned GLBs)
- **Styling**: Tailwind CSS v4 (HUD only)

### Commands

- `npm run dev` — dev server, port **3000**, host `0.0.0.0`
- `npm run build` — `vite build` → `dist/`
- `npm run lint` — `tsc --noEmit` (this is the type-check; there is no eslint step)

### Verifying changes

The in-app browser preview **cannot run this scene** — it freezes `useFrame` when the pane is hidden,
so AI motion, animation, and audio can't be observed there. Verify with **`npm run lint` + `npm run build`**,
static code inspection, and `?peek` scene-graph JS (`window.__scene`, `window.__cam`). Real gameplay
feel must be tested in the user's own browser (hard-refresh `Ctrl+Shift+R` after any bundle change —
stale Vite cache has repeatedly caused "it still looks wrong" confusion).

If the game "won't open", it's almost always a pile of stale Vite processes: kill **all** node, start one.

---

## 2. Directory & Module Structure

```
public/
├── assets/                       # GLB models — ALL sizes below are post-compression (2026-09-11, see §10)
│   ├── akm.glb                   # (0.85 MB) first-person weapon. Rigged arms+rifle. Anims: Idle, Reload, Shoot. 12 materials, 0 embedded images.
│   ├── broadcast_tower.glb       # (1.5 MB — was 6.7 MB) objective tower. 6 textures resized 1024²→512². 2 meshes (tower_1/tower_2). Normalised to 16 m in Beacon.tsx.
│   ├── zombie.glb                # (2.1 MB) Mixamo-rigged zombie. 1 material "ColorSwatch" (white), 1 texture (335 KB). 13 anims: Walk, Walk2, Attack, Hit_reaction, Die, Die2, crawl, etc.
│   ├── sky.glb                   # (0.3 MB — was 4.2 MB) equirect star photosphere ("PanoSphere"), panorama resized 4096×2048→2048×1024.
│   ├── moon.glb                  # MISSING as of 2026-09-11 — Moon.tsx falls back to MoonFallback.tsx (see §10)
│   ├── grass_plants.glb          # (0.3 MB, trimmed from a 27 MB / ~800k-vert Sketchfab pack — see §10) real ground-cover, replaces the old dry_grass.glb slot
│   ├── S1Tree1.glb (1.0 MB, was 3.2) / S1Tree2.glb (0.7 MB, was 2.9) — low-poly tree variants (instanced), textures resized 1024²→512²
│   ├── Deer.glb / Wolf.glb       # ambient wildlife (~1 MB each, no embedded textures)
│   └── (orphaned, still on disk, DO NOT load — 4K-texture OOM):
│       ammo_box.glb (28 MB), mossy_old_tree_log.glb (23 MB), forest_ruins.glb (159 MB)
│       — `ground.glb` deleted 2026-09-11 (was already unused, ForestGround is procedural — see §10)
├── audio/
│   ├── sfx/  ak_singleshot.mp3 · ak_burst.mp3 · reload.mp3 · mag_voice.mp3 · zombie.wav   (stale: heartbeat_hum.wav)
│   └── vo/   (empty — story removed)
└── assets/sound/  walk.mp3 (0.4 MB, was a 6 MB .wav) · run.mp3 (0.17 MB, was 2.6 MB) · wolf_echo.wav · jump.wav · land.wav  (last three optional; synth fallbacks exist)

src/
├── App.tsx                       # Canvas, <Physics>, Player controller, HUD (Crosshair / AmmoHUD / CompassBar / hurt-flash), start overlay
├── main.tsx                      # React root
├── world/                        # framework-free shared singletons (no React re-renders per frame)
│   ├── playerState.ts            # playerPosition (Vector3) + playerState {grounded,moving,sprinting,yaw,distanceTravelled}
│   ├── weaponState.ts            # {magSize:30, mag, reserve, reloading} — written by WeaponRig, read by AmmoHUD
│   ├── staminaState.ts           # {current:100, max:100, depleting} + staminaFrac(), STAMINA_LOW_FRAC 0.25 — Player writes, StaminaHUD + winded-breathing SFX read
│   ├── noiseState.ts             # multi-source noise field: emitNoise / emitThrottled / setPermanentNoise / clearPermanentNoise / pruneNoise / getNoiseIntensityAt(pos) / HEAR_THRESHOLD 0.12; noiseState.debug ([N])
│   ├── beaconState.ts            # 5 fixed BEACON_POSITIONS + EXTRACTION_POS; beaconState.beacons[] {phase,progress}; litBeaconCount/allBeaconsLit/capturingBeacon/nearestUnlitBeacon/insideBeaconClearing; CAPTURE_SECONDS 20, CAPTURE_RADIUS 6, BEACON_CLEAR_RADIUS 10
│   ├── combatState.ts            # hitboxes[] + zombies[] registries; HitZone type; registerShot(x,z) → folds into noiseState (emitNoise int 1, r 55); addHitbox / addZombie
│   ├── terrain.ts                # terrainHeightAt(x,z) — single source of truth for floor height; groundY(), ASSET_SINK
│   ├── noise.ts                  # fbm2D
│   └── moon.ts                   # MOON_DIR / MOON_COLOR / MOON_LIGHT_COLOR
├── audio/
│   └── sfx.ts                    # all sound: footsteps, gunshot(synth), reload/mag_voice/zombie_voice(samples), jump/land, dry-fire, wolf echo
└── components/
    ├── WeaponRig.tsx             # first-person AKM — imperative camera child, hitscan shooting, hitbox raycast, recoil, muzzle flash, reload anim
    ├── Zombie.tsx                # one zombie: FSM + bone-tracked limb hitboxes + zone damage + knockback + voice; aggro = line-of-sight OR getNoiseIntensityAt ≥ HEAR_THRESHOLD
    ├── Zombies.tsx               # pool of 3 (+3 more only while a beacon is capturing); rndSpawn biases 72% toward the capturing beacon; empty slot 4–9 s (2.2 s during capture)
    ├── Beacon.tsx / Beacons.tsx  # the 5 objective towers (broadcast_tower.glb, normalised to 16 m). unlit→capturing (player in CAPTURE_RADIUS)→lit at 20 s banked; leaving pauses+silences, doesn't reset. Emits noise (r 42 capturing / r 30 lit) + a red lamp light.
    ├── Extraction.tsx            # green light column at EXTRACTION_POS, hidden until allBeaconsLit(); player in EXTRACTION_RADIUS 7 → beaconState.extracted = true
    ├── NoiseDebug.tsx            # [N] overlay — pooled wireframe spheres over activeNoiseEvents()
    ├── SafeAsset.tsx             # Suspense + error boundary — wrap every top-level GLB consumer in this, not bare <Suspense> (see §10)
    ├── MoonFallback.tsx          # no-GLB fallback for <Moon> — halo + billboard sprite disc
    ├── GrassPlants.tsx           # GrassPlantsLayer — 4 trimmed real-plant variants instanced across EndlessForest's old dry-grass scatter points (see §10)
    ├── FlashlightRig.tsx         # SpotLights parented to camera; [Q]/[F] toggle
    ├── FlashlightFX.tsx          # camera-space dust motes (beam cone removed)
    ├── AmmoBoxes.tsx             # procedural ammo crates (2 spots) — +120 reserve on pickup, respawn 25 s
    ├── EndlessForest.tsx         # chunked streaming forest (55 u chunks, radius 2) — trees via TreeField + instanced grass + procedural logs
    ├── TreeField.tsx             # instanced S1Tree1/S1Tree2 with per-chunk Rapier trunk colliders
    ├── ForestGround.tsx          # GroundPlane (always-on physics floor) + displaced detailed ground that re-anchors as you walk
    ├── CanopyLayer.tsx           # overhead alpha-mottled leaf sheet ~16 m up, follows player, dapples moonlight
    ├── SkyDome.tsx               # unlit star photosphere, camera-locked
    ├── Moon.tsx                  # moon disc + halo along MOON_DIR
    ├── HorrorAtmosphereLighting.tsx # fog (#080b12, expo 0.05), low ambient, cool moonlight DirectionalLight, haze wisps
    └── WanderingAnimal.tsx       # ForestAnimals — autonomous Deer/Wolf wander + flee-from-player AI
```

---

## 3. Controls & Gameplay

| Input | Action | Notes |
|---|---|---|
| **W/A/S/D** / Arrows | Move | Camera-quaternion basis projected to ground plane (never mutate `camera.rotation`/`.order` — it fights PointerLockControls). Walk 4.0 u/s. |
| **Shift** (hold) | Sprint | 6.8 u/s. Drains `staminaState` at 17/s; disabled at 0 until it re-arms at 20. |
| **Ctrl** (hold) | Stealth-walk | 2.2 u/s, footsteps silenced, drains stamina 4/s, sets `playerState.stealthWalking` (noise payoff lands in Stage B). |
| **Space** | Jump | `vel.y = 5.2`, gated by `grounded` (`|vel.y| < 0.18 && y ≤ 1.4`). |
| **Left Click** | Fire | Single click = 1 round; hold = full-auto at `FIRE_INTERVAL = 0.1 s` (~600 RPM). |
| **R** | Reload | Plays baked `Armature|Reload` clip; also auto-fires when the mag hits 0 with reserve left. |
| **Q** / **F** | Toggle flashlight | Simple on/off — no battery/charge (removed). |
| **H** | Debug: limb hitboxes | Toggles `combatState.debugHitboxes` — renders the 11 zombie hitboxes as coloured wireframes (head red / torso green / arm cyan / leg yellow) to eyeball tracking vs the animated mesh. |
| **N** | Debug: noise field | Toggles `noiseState.debug` — translucent wireframe sphere per active noise event (blue = one-shot, red = permanent), radius = hearing radius. |
| **Mouse** | Look | `PointerLockControls`. Start overlay calls `initAudio()` + `requestPointerLock()`. `?peek` skips the overlay for dev. |

**HUD** (`App.tsx`, gated on `isLocked || ?peek`): centered SVG `Crosshair`; lower-right `AmmoHUD` (`mag / reserve`, "RELOADING…", "AKM · [R] Reload") driven by rAF reading `weaponState`; lower-left `StaminaHUD` (140×4px bar, rAF reading `staminaState` — blue idle / amber draining / red winded, fades when full); top `CompassBar` heading strip (nav aid only, no objectives); red inset edge-flash `hurt` overlay for 320 ms on a zombie hit.

**Stamina** (`world/staminaState.ts`, driven in the Player `useFrame`): sprint −17/s, stealth −4/s, walk/idle +13/s (regen beats both drains). Hitting 0 sets `exhaustedRef` → sprint locked out until stamina climbs back to 20. Below `STAMINA_LOW_FRAC` (25%), `sfx.setWinded(true)` loops a breathing cue (`breath.mp3` → synth inhale/exhale fallback).

**Noise system** (`world/noiseState.ts`) — the single "did the player make a sound" mechanic (the old `combatState.lastShot*` is gone). Events carry `{x, z, intensity, radius, expiresAt}`; `getNoiseIntensityAt(pos)` sums `intensity·(1−d/radius)` over all events in range. `pruneNoise()` is called once per frame from the Player loop. Emitters: gunfire (`registerShot` → int 1, r 55, 0.4 s), sprint (`emitThrottled` int 0.6, r 22, lingers 1.3 s), stealth (int 0.08, r 4 — deliberately always < `HEAR_THRESHOLD` 0.12, i.e. inaudible to zombies), winded breathing (int 0.4, r 11, every 2 s), beacons (permanent, keyed `beacon-<id>`). Zombie aggro fires when `getNoiseIntensityAt(zombiePos) ≥ HEAR_THRESHOLD` or line-of-sight (`SEE_RANGE` 14).

**Objective loop** (`world/beaconState.ts`): 5 fixed towers at `BEACON_POSITIONS`, spaced 60–150 u out. Stand inside a tower's `CAPTURE_RADIUS` (6 m) for `CAPTURE_SECONDS` (20 s, banked — leaving pauses, never resets) → `phase: 'lit'`. A capturing/lit beacon is a loud permanent noise source (draws zombies) and spawns +3 pool slots biased onto the tower. `CompassBar` points at `nearestUnlitBeacon(playerPos)`, then at `EXTRACTION_POS` once `allBeaconsLit()`. `Extraction.tsx` reveals a light column there; entering `EXTRACTION_RADIUS` sets `beaconState.extracted` → App shows the "EXTRACTED" end screen and releases pointer lock. `EndlessForest` skips trees/scatter/logs within `BEACON_CLEAR_RADIUS` (10 m) of each tower; `AmmoBoxes` drops a crate 3.5 m off each tower base.

---

## 4. Weapon System — `WeaponRig.tsx`

**Rendering model — fully imperative, camera-attached.** R3F's default camera is **not** in the scene
graph (`camera.parent === null`), so the setup `useEffect` calls **`scene.add(camera)`** or nothing
parented to the camera renders. Then:

- `weaponHolder` (named group) at `HOLDER_POS = (0.11, -0.17, -0.22)` → `camera.add(weaponHolder)`
- inner `weaponRecoil` group (recoil pivot only — never writes to the model each frame)
- `model = SkeletonUtils.clone(gltf)`, normalized so longest side = `MODEL_TARGET_SIZE 0.58 m`,
  `rotation = MODEL_ROT (-0.04, π/2 - 0.13, -0.06)` (barrel is model +X → +90° Y aims it down -Z),
  geometry recentered, `matrixAutoUpdate = true`
- every mesh: `castShadow/receiveShadow = false`, `frustumCulled = false`, `renderOrder = 20`,
  **`raycast = () => null`** (weapon must never appear in any raycast)
- `AnimationMixer`: `Armature|Idle` (loop, poses the hands — without it the rig renders in bind pose,
  which reads as "both hands on one side / gun on the ground"), `Armature|Reload` (LoopOnce,
  `clampWhenFinished`, sets `RELOAD_MS` from clip duration)
- a dim cool viewmodel `PointLight('#9fb0c4', 1.05, 1.5)` + muzzle-flash group at `MUZZLE_LOCAL`

**Material treatment (gunmetal pass).** In the mesh traverse, per material name:
`/metal|black|plastic|bolt|steel|iron/` → `color #141619`, `metalness 0.75`, `roughness 0.52`;
wood/bakelite furniture → `color ×0.75`, non-metallic, `roughness ≥ 0.7`;
skin/glove/shirt → `color ×0.85`. **All** materials: `envMapIntensity = 0`, emissive floor only
`emissive = color ×0.08`, `emissiveIntensity 0.25`. (Earlier a `×0.35 / intensity 0.5` emissive boost
+ a bright `2.4` light made the gun look white — that is the thing this pass reversed.)

**Shooting is instant hitscan** (no projectile), in `shoot()`:

```ts
w.mag -= 1;
playGunshot();
registerShot(playerPosition.x, playerPosition.z);   // so zombies can "hear" it
if (w.mag === 5) playMagVoice();                     // low-ammo voice line
camera.updateMatrixWorld(true);                      // CCD-style: ray from the EXACT current camera transform
_ray.setFromCamera(_screenCentre /* (0,0) */, camera);
_ray.far = 120;
const zHits = _ray.intersectObjects(combatState.hitboxes, false);  // curated list, non-recursive
if (zHits.length) {
  const h = zHits[0];
  const zone = h.object.userData.zone as HitZone;
  (h.object.userData.onHit)(BASE_DMG /* 30 */, h.point, _ray.ray.direction.clone(), zone);
  // + world-space impact spark
  return;
}
// else raycast scene.children for a wall/ground impact spark
```

`camera.updateMatrixWorld(true)` immediately before `setFromCamera` is the fix for "bullets miss while
moving" — R3F updates the camera matrix later in the frame than the click handler runs, so without it
the ray originated from a stale (lagging) transform.

`useFrame`: `mixer.update(dt)`; reload-finish crossfade back to idle; hold-auto fire timing; recoil
applied to the **recoil pivot only** (`rec.position.set(0, kick*0.012, kick*0.05)`,
`rec.rotation.set(-kick*0.14, 0, kick*0.03)`); muzzle-flash + impact-light decay.

---

## 5. Hit Detection & Limb Hitboxes — `combatState.ts` + `Zombie.tsx`

**This is the load-bearing design — understand it before touching combat.**

- The zombie `SkinnedMesh` has `raycast = () => null`. Skinned-mesh raycasting is slow and inaccurate
  against an animated pose, so the skin never takes a shot directly.
- **11 invisible box meshes** are created per zombie — `BoxGeometry` + `MeshBasicMaterial({ colorWrite:false, depthWrite:false })`
  (renders nothing, still hit by a raycaster; the mesh stays `visible`). They are children of the
  zombie's **root group**, *not* parented to bones.
- Every frame in `useFrame` each box copies its bone's world **position and rotation** (a
  position-only box visibly drifts off the limb as it swings). The box is a child of the root group,
  not the bone, so both are brought into group-local space:
  ```ts
  g.getWorldQuaternion(_gInvQ).invert();
  // per box:
  h.bone.getWorldPosition(_bp); _bp.y += h.yOff; g.worldToLocal(_bp); h.mesh.position.copy(_bp);
  h.bone.getWorldQuaternion(_bq); h.mesh.quaternion.copy(_gInvQ).multiply(_bq);
  ```
  Box local +Y runs along the bone (Mixamo rig convention) so `size[1]` is the limb length. Sizes
  carry a ~10% forgiveness margin over the visible mesh (standard FPS practice). `[H]` toggles a
  wireframe view for tuning. The boxes are always `visible:false` and flipped to `true` by `[H]`
  (`combatState.debugHitboxes`) — a hidden mesh is still raycast (three's `Raycaster` checks only
  `layers`, never `visible`), so `.visible` is the safe show/hide switch.
- **GOTCHA (this bit us):** `GLTFLoader` strips `:` `.` `/` from node names, so the rig's
  `mixamorig:Head` bone loads into the scene as `mixamorigHead`. The `HITBOXES` table keeps the
  readable colon names but lookup goes through `normBone()` (strip non-alphanumerics, lowercase) on
  both sides. A bad match here silently creates **zero** hitboxes → every shot misses. A
  `[Zombie] hitbox bone not found` console warning fires if any entry fails to resolve.
- `WeaponRig.shoot()` calls `hitbox.updateWorldMatrix(true, false)` on every entry in
  `combatState.hitboxes` immediately before the raycast, so the ray always tests this frame's true
  bone pose regardless of `useFrame` callback ordering (33 boxes — free).
- Each box carries `userData.zone` and `userData.onHit`. On mount → `addHitbox(mesh)` pushes it into
  the module-level **`combatState.hitboxes`** array; on unmount → `removeHitbox(mesh)` + dispose.
  The weapon raycasts **only that array** — never `scene.children`, never the skin — so it's cheap and
  can't be fooled by trees/terrain, and dead/despawned zombies leave the list immediately.

**Hitbox table** (`HITBOXES` in `Zombie.tsx`, Mixamo bone names): `mixamorig:Head` (head);
`mixamorig:Spine1` + `mixamorig:Spine` (torso); `Left/RightArm` + `Left/RightForeArm` (arm);
`Left/RightUpLeg` + `Left/RightLeg` (leg). Sizes in metres, `yOff` nudges the box along the limb.

**Zone damage** — `BASE_DMG = 30`, `MAX_HP = 100`, table `ZONE` in `Zombie.tsx`:

| Zone | mult | dmg | knock impulse | effect |
|---|---|---|---|---|
| head  | 6.0 | 180 | 1.4 | one-shot kill |
| torso | 1.0 | 30  | 0.9 | ~4 shots to kill, no stagger |
| arm   | 0.45| 13.5| 2.2 | chip damage + big stagger |
| leg   | 0.5 | 15  | 1.8 | chip damage + stagger + 2.5 s move-speed slow (`LEG_SLOW_MS`) |

**`onHit(dmg, point, dir, zone)`** (bound to every hitbox): sets `alerted`; `hp -= dmg * ZONE[zone].mult`;
`knock.addScaledVector(dir, ZONE[zone].knock)`; leg → `legSlowUntil = now + LEG_SLOW_MS`; if `hp ≤ 0` →
state `dead` + extra `2.6` knock + **`deregister()`** (see below); else if `stagger && state !== 'attack'
&& now ≥ restaggerUntil` → state `hit`, and set `restaggerUntil = now + RESTAGGER_LOCK_MS` (650 ms) so
spraying a zombie's arms/legs can't freeze it in place forever while torso/head damage still lands.

**Corpse deregistration** — on death, `deregister()` immediately splices that zombie's 11 hitboxes out
of `combatState.hitboxes` and the zombie out of `combatState.zombies`. Without this a fresh corpse
keeps being the nearest raycast hit for the whole 5 s `CORPSE_MS`, and `onHit` early-returns on dead,
so every follow-up shot is silently eaten and the zombies behind it never take damage — it *feels*
like the gun stopped working.

**Separation** — every live zombie is in `combatState.zombies`. Each frame a zombie sums a repulsion
vector from every other zombie within `SEP_RADIUS` (1.35 m) and adds `_sep * SEP_STRENGTH (3.2) * dt`
to its position, so the pack fans out in an arc around the player instead of collapsing into one body
you can't pick a target out of.

**Knockback** (bullet impact response, no physics body): the `knock` `Vector3` is added to
`group.position` per frame and decayed `knock.multiplyScalar(Math.exp(-9*dt))`.

---

## 6. Zombie AI FSM — `Zombie.tsx` / `Zombies.tsx`

Model: `SkeletonUtils.clone`, normalized to `1.85 / size.y` tall, base at y=0, XZ recentered, skin
`raycast = () => null`. `AnimationMixer` clips: `walkA = Armature|Walk`, `walkB = Armature|Walk2`
(fallback Walk), `attack = Armature|Attack` (fallback Headbutt), `hitR = Armature|Hit_reaction` (once),
`die`/`die2` (once). `playOnly(action, fade)` cross-fades and tracks `cur`.

**Tuning consts**: `WALK_SPEED 0.85`, `RUN_SPEED 3.4`, `RUN_TIMESCALE 1.95` (there is **no** run clip —
alerted zombies speed up the walk clip's `timeScale` and move faster), `ATTACK_RANGE 1.9`,
`SEE_RANGE 14`, `HEAR_RANGE 45`, `SHOT_MEMORY_MS 4000`, `CORPSE_MS 5000`, `HIT_STUN_MS 260`,
`LEG_SLOW_MS 2500`.

**Aggro** (`alerted`, permanent once set): heard a shot — `now - combatState.lastShotAt < SHOT_MEMORY_MS`
AND within `HEAR_RANGE` of `combatState.lastShot{X,Z}` — OR saw the player (`dist < SEE_RANGE`). On
aggro: `playZombieVoice(dist)`, then periodic snarl every 4–8 s while active.

**States**: `move` (play walk; `timeScale` and speed scaled by `alerted` × `legSlowed`; walk toward
player; → `attack` when `dist < ATTACK_RANGE`) · `attack` (play attack; `onAttack()` callback every
1.7 s → App's hurt flash; → `move` when `dist > ATTACK_RANGE + 0.9`) · `hit` (play `hitR`; → `move`
after `HIT_STUN_MS`) · `dead` (play `die`/`die2` once; → `onDead()` after `CORPSE_MS`). Yaw lerps to
face the player every frame (faster when alerted). `g.position.y = terrainHeightAt(x,z) - 0.05` each
frame.

`Zombies.tsx`: fixed pool of `COUNT = 3`. `rndSpawn()` = random angle, 22–38 m from `playerPosition`.
When a zombie calls `onDead`, its slot goes `alive:false` (zombie unmounts) and stays **empty for
4–9 s** before respawning with a bumped `gen` + fresh `rndSpawn` — so a kill reads as progress instead
of an instant replacement in your face.

---

## 7. Audio — `audio/sfx.ts`

Single module, no React. `initAudio()` must be called from a user gesture (start overlay).

- **Footsteps**: looped `walk.wav` / `run.wav` if present, driven by `setLocomotion('idle'|'walk'|'run')`
  (cheap to call every frame — only acts on change). Each has a **synth fallback** — an `error` event on
  the `<audio>` element flips `walkFileOk`/`runFileOk`, and that locomotion mode switches to a
  timer-driven synthesised footstep thud (`startSynthSteps`, 300 ms cadence running / 430 ms walking)
  instead of going silent. See §10 if the files are missing.
- **Gunshot**: two user samples. `playGunshot()` → `ak_singleshot.mp3` (one crack, cloned per call so
  shots overlap, ±4% pitch jitter) for tap fire and shot 1 of a hold. From shot 2 of a hold,
  `WeaponRig` calls `beginAutoFire()` which starts `ak_burst.mp3` as a **looping bed**; `endAutoFire()`
  stops it on release / empty mag / reload. If `ak_burst.mp3` is missing, auto fire falls back to
  per-shot `playGunshot()`. `synthGunshot()` (layered crack/body/tail + per-call randomisation) is the
  load-failure fallback for the single. `playSample(url, vol, {rate, jitter})` — `killPitchLock` makes
  `playbackRate` shift pitch, not tempo.
- **Reload**: `playReload()` → `reload.mp3` (`synthReload()` clack-sequence fallback).
- **Low ammo**: `playMagVoice()` → `mag_voice.mp3`, fired once when the mag drops to exactly 5.
- **Zombie**: `playZombieVoice(distToPlayer)` → `zombie.wav` on aggro + periodic snarls, volume
  `clamp(1 - dist/42, 0.05, 1)`. No death sound — removed by request; `die.wav` is still on disk
  (orphaned) but nothing references it.
- **Jump/land**: `jump.wav`/`land.wav` with synth `noiseThud` fallback. **Wolf echo**: every 60 s.
- `playSample(url, volume)` caches the `Audio` element, **clones it per play** so shots overlap,
  caches `false` on error (falls back to synth).
- The old constant synthesised "wind bed" was **removed** (user reported it as a radio-static hum).

---

## 8. World Streaming & Terrain

- **`terrain.ts` is the single source of floor height.** `terrainHeightAt(x,z) = (fbm2D(x*0.028, z*0.028, 4) - 0.4) * 0.55`.
  `ForestGround` builds its tile geometry from it and **every** scattered asset (trees, grass, logs,
  zombies, ammo boxes, beacons) samples the same function so nothing floats or sinks.
- **`ForestGround.tsx`**: `GroundPlane` is an always-mounted Rapier `CuboidCollider` + plain dark plane
  **outside all `<Suspense>`** so the player can never fall through during a load. The detailed ground
  is a **fully procedural** `PlaneGeometry(SPAN 150, 150, 110, 110)` (no GLB — see §10 for why) with a
  canvas-baked mottled dirt/moss texture, displaced by `terrainHeightAt` and re-anchored every
  `SNAP 34` units of travel, spreading the vertex update over `DISPLACE_FRAMES 6` and recomputing
  normals once each time a re-anchor's displacement finishes.
- **`EndlessForest.tsx`**: `CHUNK 55`, `RADIUS 2`. Per-chunk density is **flat** (independent of the
  player's chunk) so a chunk's layout is deterministic and never re-shuffles when you cross a boundary.
  `TREES_MIN/MAX 26/36`, `TREE_MIN_GAP 2.1`, `GRASS_PER_CHUNK 22`. Trees delegated to `TreeField`
  (instanced S1Tree1/S1Tree2 + per-chunk Rapier `CylinderCollider` trunks). Procedural fallen logs
  (`CylinderGeometry` + Rapier collider) — the `mossy_old_tree_log.glb` was replaced (OOM).
- **`AmmoBoxes.tsx`**: procedural crate (Group of boxes) — `ammo_box.glb` was replaced (OOM).
  `SPOTS = [[3.5,-7],[-4.5,-13]]`, `PICKUP_RADIUS 2.2`, `REFILL_AMOUNT 120` → `weaponState.reserve`,
  `RESPAWN_MS 25000`.

---

## 9. Lighting, Shadows & Atmosphere

**Shadows: tried, then disabled (2026-09-11 → reverted 2026-09-16).** Real-time shadow mapping was
added — `<Canvas shadows="soft">` + one shadow-casting `SpotLight` (the flashlight, tight shadow-camera
frustum, everything else exempt to keep it cheap) — and then **turned back off** after it produced a
full-scene white-out on at least one machine during real play. Not reproducible in the dev/test
environment (no console error, survived static camera moves, distance, many angles) — reads as a
driver/GPU-specific shadow-map fault rather than a logic bug, which is exactly the kind of thing that's
untestable without the affected hardware's console output. **Current state: `shadows` prop removed
from `<Canvas>`, `primary.castShadow = false` in `FlashlightRig.tsx`, the tuned shadow-map config
(mapSize/near/far/radius/bias) left in as commented-out code** so re-enabling is a one-line flip once
this is actually root-caused — don't flip it back on blind. The beam-shape work (penumbra, decay,
intensity) and the ambient/hemisphere legibility fixes below are unrelated to shadow-casting and stay
in effect; visual quality is unaffected by this reversion, only the extra directional shadow detail is
gone. `castShadow`/`receiveShadow` props still present on various meshes (`pineBushes`, `thickets`,
`CanopyLayer`, etc.) are harmless no-ops while shadow mapping is off — left in place for whenever
shadows get a real second attempt.

**If re-attempting shadows:** get the affected user's exact GPU + browser + a console screenshot
*before* touching code — this class of bug (fine in every test environment, white-out on one real
device) can't be diagnosed by re-guessing tuning values.

- **`HorrorAtmosphereLighting.tsx`**: fog/background `#080b12`, `THREE.FogExp2` density `0.045`
  (exponential, not linear — thickens gradually so it reads as haze, not a fade-out trick; fog colour
  matches background exactly so there's no visible seam where geometry fades out). `hemisphereLight`
  (sky `#3c5170` / ground `#0d0f0c`, intensity `0.22`) + `ambientLight` (`0.08`) are what keep unlit
  terrain a dim, visible silhouette instead of crushing to flat `#000` under ACES tonemapping — this
  is the fix for "ground turns solid black outside the flashlight cone". Cool-blue moonlight
  `DirectionalLight` (intensity `0.26`, no shadow) along `MOON_DIR` (`world/moon.ts`) + faint low haze
  wisps.
- `SkyDome` (unlit star photosphere, camera-locked, drawn first, ignores fog), `Moon` (disc + halo,
  falls back to `MoonFallback` — see §10), `CanopyLayer` (alpha-mottled leaf sheet ~16 m up, follows
  player, `castShadow` — matters now that the flashlight actually casts).
- **`FlashlightRig.tsx`**: `SpotLight`s parented directly to the camera (true children, not a
  per-frame transform copy), target is a camera child 1 u ahead. `useFrame` sets `primary.intensity`
  from the `on` prop. No battery/flicker (removed) — `power` prop is always `1`.
  - **Soft-edged beam, not a hard disc**: `penumbra 0.92` (was `0.4`) — almost the whole cone is soft
    falloff; a low penumbra keeps most of the cone at flat full intensity right up to an abrupt cutoff,
    which is what reads as a harsh-edged circle on the ground. `decay 1.6` (was `1.1`, non-physical and
    too slow — stayed bright almost to `distance` then died fast, another hard-edge source) balanced
    against a physically-correct `2.0` that would fall off too fast for this scene; intensity bumped
    `42 → 58` to compensate.
  - **Shadow config: written but disabled** (`primary.castShadow = false` as of 2026-09-16 — see the
    "Shadows: tried, then disabled" note above). The tuned values are left commented next to it for
    later: `shadow.mapSize` 1024², `shadow.camera.near/far` tightened to `0.3 / 22` (matching the
    beam's *practical* throw, not some large default — this is what gives the shadow depth buffer
    enough precision to avoid banding/stripe artifacts, not the map resolution), `shadow.radius = 4`
    for the PCF soft blur, `shadow.bias -0.0003` + `shadow.normalBias 0.045` (acne / peter-panning).
- **`FlashlightFX.tsx`**: camera-space drifting dust motes only. The volumetric beam cone was removed
  (it was rebuilt every frame down the view axis → read as a dark disc glued to the crosshair).

---

## 10. Asset Resilience — `SafeAsset.tsx` (READ THIS if "the game won't even run")

**What happened (2026-09-11):** `ground.glb`, `moon.glb`, and `dry_grass.glb` went missing from
`public/assets/` (outside any change made in an agent session — not a delete either agent session
ran). Vite's dev server has an SPA history fallback: a request for a path it doesn't recognize
(including a missing static file) returns `index.html` with **HTTP 200**, not a 404. So
`useGLTF('/assets/moon.glb')` didn't fail closed — it tried to parse an HTML document as a GLB and
threw `Unexpected token '<', "<!doctype "...`. That throw happened **inside a bare `<Suspense>`**,
which only catches the loading *promise*, not a load *error* — with no error boundary above it, the
uncaught error unmounted the entire React tree. One missing decorative asset (a moon model, dry
grass tufts) took the whole game down to a blank screen. `ground.glb` was later restored (a new, 7.9 MB
file replaced the old 16 MB one); `moon.glb` and `dry_grass.glb` are still missing as of this writing.

**The fix — every top-level GLB consumer is wrapped in `<SafeAsset fallback={...}>` instead of a bare
`<Suspense>`.** `SafeAsset` = an error boundary (`componentDidCatch` → `console.warn` + render the
fallback) wrapping a `Suspense`. A missing/corrupt GLB now degrades to its fallback instead of
crashing:
- `<Moon>` → `<MoonFallback>` (halo + billboard sprite disc, zero GLB dependency)
- `<ForestGround>`, `<EndlessForest>`, `<ForestAnimals>`, `<AmmoBoxes>`, `<Zombies>`, `<Beacons>`,
  `<WeaponRig>`, `<SkyDome>` → fallback `null` (that system just doesn't render; the rest of the game
  keeps running — `GroundPlane`'s physics floor is outside all Suspense so you never fall through)
- Inside `EndlessForest.tsx`, the dry-grass GLB load is further isolated into its own leaf component
  (`DryGrassLayer`, wrapped in its own `<SafeAsset>`) so a bad `dry_grass.glb` drops only that
  decorative layer, not the trees it used to be co-located with in the same component.

**Rule going forward: any new `useGLTF()` call needs a `<SafeAsset>` (not a bare `<Suspense>`) at its
nearest reasonable boundary**, sized so a failure there only drops that one system. Don't let a GLB
load sit in the same component as something load-bearing (trees, the ground collider, etc.) — give it
its own leaf component if needed, the way `DryGrassLayer` does.

**If the game won't run and you don't know why:** check the browser console for
`Could not load /assets/*.glb: Unexpected token '<'` — that's a missing asset being served the SPA
HTML fallback, not a real 404. `[SafeAsset] a GLB failed to load — using its fallback.` in the console
means the boundary caught it and the game should still be playable; a truly blank screen with no such
warning is a different bug.

**`ForestGround.tsx` is fully procedural (no GLB) as of 2026-09-11.** A replacement `ground.glb` that
appeared during the missing-asset incident above turned out to be the wrong kind of asset — a 54,744-vertex
mesh (not a flat tile) with three 1–2 MB textures. `useGroundBase()` forced it into a `SPAN×SPAN` square
via non-uniform scale, which read as a giant flat cross/plus shape on the ground, and the huge vertex
count added a real per-reanchor cost. Replaced with: a plain `PlaneGeometry(SPAN, SPAN, 110, 110)`
(12,321 verts) displaced by `terrainHeightAt` same as before, and a canvas-baked mottled dirt/moss
`groundTexture()` (512², built once, same technique as `grassTexture()`/`canopyTexture()`). Normals are
now recomputed once whenever a re-anchor's displacement job finishes (cheap at this vertex count) so the
shading actually tracks the slope instead of staying frozen from spawn. `DISP_AMP` bumped `0.45 → 0.55`
and `NOISE_SCALE` lowered `0.035 → 0.028` (longer, gentler rolls) for visible curvature — pushing this
further starts to show as gaps/clipping against `GroundPlane`'s flat physics collider, so it's a
deliberately modest change. Material: `roughness 0.85` / `metalness 0.05` (a small amount of metalness
puts a tight specular highlight under the flashlight — reads as damp ground catching the beam, instead
of a flat, lightless plane) and `RepeatWrapping` on the texture with **world-locked UVs**
(`uv = worldPos / TEX_WORLD`, not 0..1-per-tile) — that combination is what makes a large tiled ground
plane read as many small repeats instead of one texture stretched huge across it.

**Deployed-to-Vercel crash/lag on other people's devices (2026-09-11) — asset weight, not storage.**
"Runs fine on my PC, crashes/lags for everyone else" on a static host is *not* a
where-are-the-files-hosted problem (Vercel serves `public/` fine, same as any static host) — it's a
**decoded GPU memory + total download weight** problem that a beefy dev machine never surfaces.
Measured before this pass: ~23 MB of GLBs + ~8.6 MB of uncompressed footstep `.wav` loops ≈ 32 MB
network payload, ALL fetched eagerly via `useGLTF.preload()` at module import (nothing is lazy —
everything in this game is visible within a second of spawning anyway, so deferring wouldn't have
helped much). Worse than the download size: **decoded texture memory** — `sky.glb`'s single
4096×2048 equirect panorama alone decoded to ~34 MB of GPU memory, `broadcast_tower.glb`'s six
1024² maps to ~24 MB, the two tree GLBs' six 1024² maps to another ~24 MB — roughly **90 MB of
decoded textures** for one player, most of it on a background/decoration asset (the sky) nobody is
ever looking closely at. A gaming PC shrugs this off; a mid-range phone's WebGL context (limited
VRAM budget, stricter Safari/Chrome-mobile limits) does not — that's the actual crash.

**Fix — resize, don't relocate.** Used `@gltf-transform/core` + `@gltf-transform/functions`'s
`textureCompress({ encoder: sharp, resize: [512,512] })` (the same offline toolchain proven in the
`grass_plants.glb` trim above) to downsize every embedded texture: `broadcast_tower.glb` 6.7→1.5 MB,
`S1Tree1.glb` 3.2→1.0 MB, `S1Tree2.glb` 2.9→0.7 MB, `sky.glb` (resized to 2048×1024) 4.2→0.3 MB.
Converted `walk.wav`/`run.wav` (6 MB / 2.6 MB uncompressed loops) to 96 kbps mono MP3 via
`ffmpeg-static` — 6 MB → 0.4 MB, 2.6 MB → 0.17 MB; browsers play looped MP3 exactly the same as WAV,
there was no reason these were ever shipped uncompressed. **Total payload dropped from ~32 MB to
~9 MB**, and decoded texture memory from ~90 MB to roughly ~25 MB. Also deleted the now-fully-orphaned
`ground.glb` (7.5 MB, dead weight in the deploy bundle, nothing has referenced it since the
procedural-ground rewrite above).

**If a future asset needs the same treatment:** `npx @gltf-transform/cli inspect file.glb` first to
see actual embedded image resolutions (file size alone is misleading — a well-compressed JPEG can
still decode to a huge texture); resize with the `textureCompress` script pattern above rather than
re-authoring the model. A texture doesn't need to be 1024² (or bigger) for something viewed through
fog, in the dark, with ACES tonemapping crushing detail anyway — 512² is usually indistinguishable in
this scene and is a 4× memory win.

**GOTCHA (this bit us too): `groundTexture()`'s contrast was originally far too low to see.** The
fbm-driven dirt↔moss blend was real (verified the noise itself varied) but the two colours were close
enough in value that the difference across the whole 512² canvas came out to only a few RGB points —
under the scene's dim lighting + ACES tonemapping it looked like a flat, textureless glow, which read
as "the ground isn't loading" even though the mesh and material were both correct and present. Fixed
by (a) applying the smoothstep `contrast()` curve **twice** (a steeper S-curve → distinct blobs, not a
gradient) and (b) widening the dirt/moss RGB range substantially (`[8,6,3]` → `[90,106,54]`, was
`[20,16,9]` → `[40,52,30]`). If ground texture ever looks flat again, sample actual pixel values from
`material.map.image` (a canvas — `ctx.getImageData(...)`) at a few points before assuming the mesh or
lighting is at fault; a technically-varying-but-low-contrast procedural texture is an easy thing to
misdiagnose as a missing asset.

**Footstep audio has a synth fallback now, and real samples are in.** `walk.wav` / `run.wav` under
`public/assets/sound/` are optional — always were, but there was no fallback if they 404'd, so a
missing file was just silence. `sfx.ts` now listens for the `<audio>` `error` event on each and
switches that locomotion mode to a synthesised footstep loop (filtered noise thud,
`startSynthSteps`/`stopSynthSteps`, cadence 300 ms running / 430 ms walking) — same sample-then-synth
pattern as gunfire/breathing/jump/land — if a file is ever missing again. Real `walk.wav` (5.9 MB) /
`run.wav` (2.5 MB) samples are in place as of 2026-09-11.

**`GrassPlants.tsx` replaces the dead `dry_grass.glb` slot with a trimmed real-plant pack.** The
supplied `grass_plants.glb` was a 27 MB / ~800k-render-vertex Sketchfab scene — almost entirely two
giant "Ground_Cover_Bunch" clumps (up to 65k verts each) and two "Purple_Flower" hero meshes meant to
be viewed up close, not instanced across an endless forest. Trimmed **offline** with
`@gltf-transform/core` + `@gltf-transform/functions` (`weld` + `dedup` + `prune` after disposing every
node/mesh except the 4 small single-plant ones) down to **4 meshes, 1,027 vertices total, 320 KB** —
`5_leaf_ground_plant`, `Grass_Blades`, `Grass_Cloves`, `dandelion`. `GrassPlants.tsx`'s
`usePlantVariants()` normalizes each to a hand-picked target height (0.45–0.85 m), and
`GrassPlantsLayer` renders one `<Instances>` batch per variant, bucketing `EndlessForest`'s existing
`dryGrass` scatter points (`PLANTS_PER_CHUNK` now 16) across variants deterministically from each
point's own rotation seed — no new scatter state needed. **If a fresh "plants" GLB ever needs adding,
repeat this trim** (inspect vertex counts per mesh first — `npx @gltf-transform/cli inspect
file.glb` — and keep only what's cheap enough to instance hundreds of times) rather than loading the
whole pack; that mistake is exactly what made `ground.glb` a problem earlier in this section.

---

## 11. Performance Rules (locked 60 FPS)

1. **Zero allocation in `useFrame`.** No `new THREE.Vector3()` / `Euler` / `Matrix4` / `.clone()` in
   the render loop. Use module-level pre-allocated singletons (`_moveDir`, `_camForward`, `_bp`,
   `_ray`, `_box`, `_v`, …). (`_ray.ray.direction.clone()` in `shoot()` is fine — that's a click
   handler, not the loop.)
2. **Instanced rendering** for anything repeated (trees, grass) via drei `<Instances>`/`<Instance>`.
3. **Framework-free shared state** (`world/*.ts`) as plain module singletons — never lift per-frame
   values into React state.
4. **Skinned models**: clone with `SkeletonUtils.clone`; disable their `raycast`; never raycast
   `scene.children` when a curated registry (`combatState.hitboxes`) will do.
5. **Camera children** (weapon, flashlight) require `scene.add(camera)` once in a setup effect.
6. **Asset weight matters** — GLTFLoader decodes *all* embedded textures into memory before user code
   can strip them. GLBs carrying 4K PBR stacks (`ammo_box.glb`, `mossy_old_tree_log.glb`,
   `forest_ruins.glb`) caused `ERR_BLOB_OUT_OF_MEMORY` and are replaced with procedural meshes. Check
   texture size before adding any new GLB.

---

## 12. Narrative Layer — "The Nights" (Dead Air / Static Bloom fusion)

Staged build per the design dossier — one Night at a time, each verified before the next. **Night 1**
is the MVP itself (§§1–11), played straight, no exposition. This section covers what's actually built
on top of it so far.

### Night 2 — "The Choir" (built 2026-09-17)

Goal: each beacon's `lit` transition plays one fragment of a continuous 5-part numbers-station
transmission; by the time all 5 are lit, the player has heard the whole message. No dialogue, no VO
cast, no new core system — content wired into `Beacon.tsx`'s existing capture FSM and `sfx.ts`'s
sample pattern, exactly as scoped.

- **`world/subtitleState.ts`** (new) — `{ text, showUntil }` plain singleton + `showSubtitle(text,
  durationMs=6000)`. `SubtitleHUD` in `App.tsx` (same rAF-poll pattern as `StaminaHUD`/`ObjectiveHUD`)
  renders one italic line at `bottom-24` (clear of `AmmoHUD`/`StaminaHUD` at `bottom-6`/`bottom-7`),
  fading over the last `SUBTITLE_FADE_MS` (900 ms) of its window.
- **`audio/sfx.ts`** — `playChoirFragment(index, distToPlayer)`: no real audio was supplied for this,
  so all 5 fragments are **synthesised** (`synthChoirFragment`) — a cold two-tone "interval chime"
  bookending 5 filtered-sine "digit" tones (`digitTone`, one frequency per digit 0-9 so each of the 5
  fragments is audibly distinct) over a quiet highpassed-noise static bed. An optional real override
  (`/audio/sfx/choir_0.mp3` … `choir_4.mp3`) is tried first — **not** via the usual `playSample()`
  fire-and-forget helper, which optimistically returns `true` on a URL's first-ever call before it's
  known to 404 (fine for a repeating sound like gunfire, which self-corrects next shot; wrong here
  because each fragment only gets ONE play per playthrough — a wrong guess would just be permanent
  silence). Instead `tryRealAudio()` does a real `fetch(url, {method:'HEAD'})` check before deciding.
  `CHOIR_SUBTITLES` holds the 5 transcriptions (a small arc: "the garden… it hears the call… roots
  before towers… we were never first… it is awake") — deliberately seeding the Night 3 ecological
  reveal.
- **`Beacon.tsx`** — the `playChoirFragment(id, dist)` + `showSubtitle(CHOIR_SUBTITLES[id])` call sits
  directly inside the `if (b.progress >= CAPTURE_SECONDS) { b.phase = 'lit'; ... }` block. Fires
  exactly once by construction: the enclosing `if (b.phase === 'capturing')` guard is only true up to
  the frame that sets `phase = 'lit'`, never again after. No new state, no explicit "already played"
  flag needed.
- **`playZombieVoice()`** — 1-in-4 barks (`Math.random() < 0.25`) now call `synthZombieEcho()` instead
  of playing the usual `zombie.wav` sample: the same interval-chime motif from the choir fragments,
  pitched to 40% and smeared through a lowpass into a groan via a downward-sweeping sawtooth — reads as
  an echo of the transmission, not a spoken phrase (no TTS available), and ties the two sounds together
  for a player who's paying attention without announcing anything. Everything else about
  `playZombieVoice` (distance falloff, call sites, cadence) is untouched — this is a sample-choice
  swap only, per the stage's explicit scope limit (no touching `noiseState.ts` or `Zombie.tsx`'s FSM).

**Verified:** all 5 `playChoirFragment` calls and 12 `playZombieVoice` calls (mix of default/echo
branches) run error-free; `CHOIR_SUBTITLES` text confirmed flowing into `subtitleState`;
`SubtitleHUD` confirmed mounted with correct classes/position. Full audio playback and the on-screen
fade timing need a real browser pass (this project's preview tooling can't run `useFrame`/`rAF` loops
in the background — see the note at the top of this file).

**Not built yet:** Night 3 ("Root Signal" — fog/ground tint + spore particles + zombie detuning near
lit beacons + one environmental prop per tower) and Night 4 ("Signal Zero" — the countdown-extraction
finale, the one stage that adds a genuinely new system). Both are staged for later, one at a time, per
the dossier's own build-order reasoning.
