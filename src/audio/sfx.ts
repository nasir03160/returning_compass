/**
 * Sound effects — map + player only.
 *
 * Optional user-supplied samples under /assets/sound/:
 *   walk.wav       - looped while walking (synth footstep fallback if missing)
 *   run.wav        - looped while sprinting (synth footstep fallback if missing)
 *   wolf_echo.wav  - one-shot, fired every 60s for atmosphere (silently skipped if missing)
 *   jump.wav / land.wav - one-shots (fall back to a synth thud if missing)
 */
import { nearestLitBeaconDist, ROOT_SIGNAL_RADIUS } from '../world/beaconState';

type Loco = 'idle' | 'walk' | 'run';

let walk: HTMLAudioElement | null = null;
let run: HTMLAudioElement | null = null;
let wolf: HTMLAudioElement | null = null;
let wolfTimer: number | null = null;
let started = false;
let loco: Loco = 'idle';

// Whether the real sample loaded. Starts optimistic; an `error` event (404,
// bad file) flips it — from then on that locomotion mode uses the synth
// footstep loop below instead of a silently-failing safePlay().
let walkFileOk = true;
let runFileOk = true;

/** Call from a user gesture (the "click to enter" handler). */
export function initAudio(): void {
  if (started) return;
  started = true;

  walk = new Audio('/assets/sound/walk.mp3');
  walk.loop = true;
  walk.volume = 0.55;
  walk.preload = 'auto';
  walk.addEventListener('error', () => {
    walkFileOk = false;
    if (loco === 'walk') startSynthSteps(false);
  });

  run = new Audio('/assets/sound/run.mp3');
  run.loop = true;
  run.volume = 0.7;
  run.preload = 'auto';
  run.addEventListener('error', () => {
    runFileOk = false;
    if (loco === 'run') startSynthSteps(true);
  });

  wolf = new Audio('/assets/sound/wolf_echo.wav');
  wolf.volume = 0.85;
  wolf.preload = 'auto';
  wolf.addEventListener('error', () => {
    wolf = null; // missing is fine — this one has no synth fallback, just skip it
  });

  wolfTimer = window.setInterval(playWolfEcho, 60_000);
}

export function playWolfEcho(): void {
  if (!wolf) return;
  try {
    wolf.currentTime = 0;
    void wolf.play();
  } catch {
    /* ignore autoplay/timing errors */
  }
}

const safePlay = (a: HTMLAudioElement | null) => {
  if (a && a.paused) void a.play().catch(() => {});
};
const safePause = (a: HTMLAudioElement | null) => {
  if (a && !a.paused) a.pause();
};

/* --- synthesised footstep fallback: crunchy filtered-noise thuds on a timer,
 * cadence matched to walk/run speed --- */
let stepTimer: number | null = null;

function synthFootstep(running: boolean): void {
  const c = synthCtx();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.1;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = running ? 950 : 650;
  const g = c.createGain();
  g.gain.setValueAtTime(running ? 0.32 : 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function stopSynthSteps(): void {
  if (stepTimer != null) {
    window.clearInterval(stepTimer);
    stepTimer = null;
  }
}

function startSynthSteps(running: boolean): void {
  stopSynthSteps();
  const interval = running ? 300 : 430; // ms between footfalls
  synthFootstep(running);
  stepTimer = window.setInterval(() => synthFootstep(running), interval);
}

/**
 * Drive the footstep loop from the player state. Cheap to call every frame —
 * it only acts on a change.
 */
export function setLocomotion(next: Loco): void {
  if (!started || next === loco) return;
  loco = next;
  stopSynthSteps();
  if (next === 'walk') {
    safePause(run);
    if (walkFileOk) safePlay(walk);
    else startSynthSteps(false);
  } else if (next === 'run') {
    safePause(walk);
    if (runFileOk) safePlay(run);
    else startSynthSteps(true);
  } else {
    safePause(walk);
    safePause(run);
  }
}

export function stopAudio(): void {
  safePause(walk);
  safePause(run);
  stopSynthSteps();
  if (wolfTimer != null) window.clearInterval(wolfTimer);
  wolfTimer = null;
  started = false;
  loco = 'idle';
  setWinded(false);
}

/* ------------------------------------------------------------------ *
 * Weapon SFX. Gunshot is layered real samples (ak_shot + optional ak_body /
 * ak_tail) with per-shot pitch jitter; synthGunshot() is the load-failure
 * fallback. Reload + low-ammo voice are user samples.
 * ------------------------------------------------------------------ */
const RELOAD_URL = '/audio/sfx/reload.mp3';
const MAG_VOICE_URL = '/audio/sfx/mag_voice.mp3';
const ZOMBIE_VOICE_URL = '/audio/sfx/zombie.wav'; // aggro snarl / periodic groan

// Gunfire — two user samples:
//   ak_singleshot.mp3  one crack, played per shot for tap fire (and shot 1 of a
//                      hold), cloned so shots overlap, ±4% pitch jitter
//   ak_burst.mp3       a looping full-auto bed, started on shot 2 of a hold and
//                      stopped on release / empty / reload
const GUN_SINGLE_URL = '/audio/sfx/ak_singleshot.mp3';
const GUN_BURST_URL = '/audio/sfx/ak_burst.mp3';

type PitchOpts = { rate?: number; jitter?: number };

const _wpnCache: Record<string, HTMLAudioElement | false> = {};

/** Turn a rate-change into a pitch-change on an <audio> element (all vendors). */
function killPitchLock(a: HTMLAudioElement): void {
  const el = a as HTMLAudioElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  el.preservesPitch = false;
  el.mozPreservesPitch = false;
  el.webkitPreservesPitch = false;
}

const _pitch = (o?: PitchOpts) => {
  const base = o?.rate ?? 1;
  const j = o?.jitter ?? 0;
  return j ? base * (1 + (Math.random() * 2 - 1) * j) : base;
};

/**
 * Play a one-shot sample by URL. Returns false only if it's already known
 * missing. `pitch.rate` sets a base playbackRate (pitch, not tempo-preserved),
 * `pitch.jitter` adds a ± fraction of random variation per call.
 */
function playSample(url: string, volume: number, pitch?: PitchOpts): boolean {
  const cached = _wpnCache[url];
  if (cached === false) return false;
  if (cached) {
    const c = cached.cloneNode() as HTMLAudioElement; // clone so it can overlap
    c.volume = volume;
    if (pitch) {
      killPitchLock(c);
      c.playbackRate = _pitch(pitch);
    }
    void c.play().catch(() => {});
    return true;
  }
  const el = new Audio(url);
  el.volume = volume;
  if (pitch) {
    killPitchLock(el);
    el.playbackRate = _pitch(pitch);
  }
  el.addEventListener('error', () => (_wpnCache[url] = false), { once: true });
  el.addEventListener('canplaythrough', () => (_wpnCache[url] = el), { once: true });
  el.play().then(() => (_wpnCache[url] = el)).catch(() => (_wpnCache[url] = false));
  return true;
}

/**
 * Fallback only — used when ak_shot.mp3 fails to load. Layered like the real
 * thing: bright crack transient, low-end body thump, and a filtered tail that
 * decays over ~0.4 s so the shot has some room around it. Every layer is
 * randomised a little per call so full-auto doesn't machine-gun one waveform.
 */
function synthGunshot(): void {
  const c = synthCtx();
  if (!c) return;
  const t = c.currentTime;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const master = c.createGain();
  master.gain.value = rnd(0.82, 0.98);
  master.connect(c.destination);

  const noiseBuf = (dur: number, shape: (x: number) => number) => {
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * shape(i / d.length);
    return b;
  };

  // crack: very short bright noise burst
  const crackDur = rnd(0.07, 0.1);
  const cs = c.createBufferSource();
  cs.buffer = noiseBuf(crackDur, (x) => (1 - x) ** 2);
  const chp = c.createBiquadFilter();
  chp.type = 'highpass';
  chp.frequency.value = rnd(820, 1000);
  const cg = c.createGain();
  cg.gain.setValueAtTime(rnd(0.82, 0.98), t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + crackDur);
  cs.connect(chp).connect(cg).connect(master);
  cs.start(t);
  cs.stop(t + crackDur + 0.02);

  // body: lowpassed noise thump — the low-end weight
  const bodyDur = rnd(0.19, 0.25);
  const bs = c.createBufferSource();
  bs.buffer = noiseBuf(bodyDur, (x) => 1 - x);
  const blp = c.createBiquadFilter();
  blp.type = 'lowpass';
  blp.frequency.setValueAtTime(rnd(1250, 1550), t);
  blp.frequency.exponentialRampToValueAtTime(rnd(150, 210), t + bodyDur);
  const bg = c.createGain();
  bg.gain.setValueAtTime(rnd(0.6, 0.78), t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + bodyDur);
  bs.connect(blp).connect(bg).connect(master);
  bs.start(t);
  bs.stop(t + bodyDur + 0.02);

  // tail: quiet delayed decay — a hint of the forest around the shot
  const tailDur = rnd(0.32, 0.46);
  const ts = c.createBufferSource();
  ts.buffer = noiseBuf(tailDur, (x) => (1 - x) ** 1.4);
  const tbp = c.createBiquadFilter();
  tbp.type = 'bandpass';
  tbp.frequency.value = rnd(500, 750);
  tbp.Q.value = 0.7;
  const tg = c.createGain();
  const tStart = t + rnd(0.04, 0.07);
  tg.gain.setValueAtTime(0.0001, tStart);
  tg.gain.linearRampToValueAtTime(rnd(0.16, 0.24), tStart + 0.02);
  tg.gain.exponentialRampToValueAtTime(0.0001, tStart + tailDur);
  ts.connect(tbp).connect(tg).connect(master);
  ts.start(tStart);
  ts.stop(tStart + tailDur + 0.02);
}

/** A run of mechanical clicks/clacks — mag out, mag in, charging handle. */
function synthReload(): void {
  const c = synthCtx();
  if (!c) return;
  const clack = (at: number, freq: number, gain: number) => {
    const dur = 0.05;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime + at);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(c.currentTime + at);
    src.stop(c.currentTime + at + dur + 0.02);
  };
  clack(0.0, 320, 0.5); // mag release
  clack(0.18, 260, 0.45); // mag drop
  clack(0.55, 380, 0.55); // fresh mag seats
  clack(0.95, 500, 0.6); // charging handle
  clack(1.05, 220, 0.5); // bolt closes
}

/** One rifle crack — tap fire and the first shot of a burst. Synth fallback. */
export function playGunshot(): void {
  if (!playSample(GUN_SINGLE_URL, 0.9, { jitter: 0.04 })) synthGunshot();
}

/* --- full-auto bed: a single looping element, started/stopped by WeaponRig --- */
let _burstEl: HTMLAudioElement | null = null;
let _burstFailed = false;

function burstEl(): HTMLAudioElement | null {
  if (_burstFailed) return null;
  if (!_burstEl) {
    _burstEl = new Audio(GUN_BURST_URL);
    _burstEl.loop = true;
    _burstEl.volume = 0.85;
    _burstEl.addEventListener(
      'error',
      () => {
        _burstFailed = true;
        _burstEl = null;
      },
      { once: true }
    );
  }
  return _burstEl;
}

/** Start the looping burst bed. Returns false if the sample isn't available
 *  (caller then keeps firing per-shot playGunshot()s instead). */
export function beginAutoFire(): boolean {
  const el = burstEl();
  if (!el) return false;
  if (el.paused) {
    try {
      el.currentTime = 0;
    } catch {
      /* not seekable yet */
    }
    void el.play().catch(() => {});
  }
  return true;
}

/** Stop the burst bed (fire released, mag empty, or reload started). */
export function endAutoFire(): void {
  if (!_burstEl) return;
  _burstEl.pause();
  try {
    _burstEl.currentTime = 0;
  } catch {
    /* ignore */
  }
}
/** Fired on a reload action — reload.mp3, synth fallback. */
export function playReload(): void {
  if (!playSample(RELOAD_URL, 0.85)) synthReload();
}
/** Voice line when only 5 rounds are left in the mag. */
export function playMagVoice(): void {
  playSample(MAG_VOICE_URL, 1);
}

/* ------------------------------------------------------------------ *
 * NIGHT 2 — "The Choir": a 5-part numbers-station transmission, one
 * fragment fired per beacon the instant it's lit (see Beacon.tsx). No real
 * audio was supplied for this, so it's synthesised — same
 * sample-then-synth-fallback shape as everything else here: an optional
 * real file (`/audio/sfx/choir_<n>.mp3`) is tried first via a proper HEAD
 * check (NOT the fire-and-forget `playSample` pattern — that helper
 * optimistically returns `true` on a file's first-ever call before it's
 * known to be missing, which would silently eat the ONE guaranteed play
 * each fragment gets), synth otherwise.
 * ------------------------------------------------------------------ */
const CHOIR_URLS = [0, 1, 2, 3, 4].map((i) => `/audio/sfx/choir_${i}.mp3`);

// Each fragment's "digits" — also its pitch fingerprint (digitTone below maps
// 0-9 to distinct frequencies), so the five transmissions are audibly
// different from each other, not just five copies of the same beep pattern.
const CHOIR_DIGITS: readonly number[][] = [
  [3, 7, 1, 9, 4],
  [1, 8, 2, 6, 5],
  [9, 4, 4, 1, 7],
  [2, 0, 6, 3, 8],
  [5, 5, 5, 5, 5],
];

/** Subtitle transcription per fragment — only reads as one message once all
 *  five have played. Consumed by App.tsx's SubtitleHUD via subtitleState. */
export const CHOIR_SUBTITLES: readonly string[] = [
  '"…three — seven — one — nine — four. The garden. Stand by."',
  '"…one — eight — two — six — five. It hears the call."',
  '"…nine — four — four — one — seven. Roots before towers."',
  '"…two — zero — six — three — eight. We were never first."',
  '"…five — five — five — five — five. It is awake. End transmission."',
];

/** The cold two-tone "this is a transmission" chime — reused (pitched down,
 *  smeared) as the zombie echo-bark motif below, so the two read as connected
 *  even without a shared sample. */
function intervalChime(c: AudioContext, at: number, master: GainNode, pitch = 1): void {
  [520 * pitch, 780 * pitch].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = c.createGain();
    const t0 = c.currentTime + at + i * 0.28;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.3, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  });
}

function digitTone(c: AudioContext, at: number, digit: number, dur: number, master: GainNode): void {
  const freq = 260 + digit * 42; // distinct pitch per digit 0-9
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 6; // narrow — reads as a filtered radio tone, not a pure beep
  const g = c.createGain();
  const t0 = c.currentTime + at;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.5, t0 + 0.03);
  g.gain.setValueAtTime(0.5, t0 + dur - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(bp).connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function staticBed(c: AudioContext, duration: number, master: GainNode): void {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g = c.createGain();
  g.gain.value = 0.035; // very quiet analog hiss bed under the tones
  src.connect(hp).connect(g).connect(master);
  src.start(c.currentTime);
  src.stop(c.currentTime + duration + 0.1);
}

function synthChoirFragment(index: number, volume: number): void {
  const c = synthCtx();
  if (!c) return;
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(c.destination);

  const digits = CHOIR_DIGITS[index] ?? CHOIR_DIGITS[0];
  const totalDur = 0.9 + digits.length * 0.62;
  staticBed(c, totalDur, master);
  intervalChime(c, 0, master);
  let t = 0.75;
  for (const d of digits) {
    digitTone(c, t, d, 0.42, master);
    t += 0.62;
  }
  intervalChime(c, t + 0.1, master); // closing chime — "end of group"
}

/** HEAD-check a URL and, if it exists, play it — unlike playSample() this
 *  never optimistically returns true before knowing, because these fragments
 *  each only get ONE play and a wrong guess would just be silence. */
async function tryRealAudio(url: string, volume: number): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return false;
    const el = new Audio(url);
    el.volume = volume;
    await el.play();
    return true;
  } catch {
    return false;
  }
}

function playChoirFragmentAtVolume(index: number, v: number): void {
  const url = CHOIR_URLS[index];
  if (!url) return;
  void tryRealAudio(url, v).then((ok) => {
    if (!ok) synthChoirFragment(index, v);
  });
}

/** Fired once, from Beacon.tsx, the instant a beacon transitions to `lit` —
 *  plays that beacon's fragment of the shared 5-part transmission. */
export function playChoirFragment(index: number, distToPlayer: number): void {
  const v = Math.max(0.2, Math.min(1, 1 - distToPlayer / 60));
  playChoirFragmentAtVolume(index, v);
}

/** Night 4 — the extraction-success stinger: all 5 fragments of the
 *  transmission play back at once instead of one-per-beacon, "the choir
 *  finishing its sentence." Each voice is quieter than a solo fragment
 *  (fixed volume, not distance-based) since five overlap. */
export function playChoirFinale(): void {
  CHOIR_URLS.forEach((_, i) => playChoirFragmentAtVolume(i, 0.5));
}

/** A groaned echo of the transmission's interval chime — pitched way down
 *  and smeared, not a spoken phrase (no TTS available). Used by
 *  playZombieVoice() below as an occasional variant bark. `rateMul` (Night 3)
 *  scales it further down + stretches the envelope when the zombie is near a
 *  lit beacon, so it reads as "breathing" rather than groaning. */
function synthZombieEcho(volume: number, rateMul = 1): void {
  const c = synthCtx();
  if (!c) return;
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(c.destination);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 480 * rateMul;
  lp.connect(master);
  const stretch = 1 / rateMul; // slower playback = longer envelope
  [520 * 0.4 * rateMul, 780 * 0.4 * rateMul].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const t0 = c.currentTime + i * 0.35 * stretch;
    const dur = 0.9 * stretch;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.4, t0 + 0.15 * stretch);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.1);
  });
}

/** Zombie snarl — volume falls off with distance to the player. 1-in-4 barks
 *  use a synthesised "echo" of the transmission's tone instead of the usual
 *  sample — half-recognisable, not an announcement (Night 2).
 *
 *  Night 3: pass the zombie's own world position (zx, zz) and, within a lit
 *  beacon's ROOT_SIGNAL_RADIUS, both the sample and the echo pitch/slow down
 *  a little — reads as "breathing," not a full sample swap, so it stays
 *  ambiguous. Distance-based (via nearestLitBeaconDist), no hard boundary. */
export function playZombieVoice(distToPlayer: number, zx?: number, zz?: number): void {
  const v = Math.max(0.05, Math.min(1, 1 - distToPlayer / 42));
  let rate = 1;
  if (zx !== undefined && zz !== undefined) {
    const dRoot = nearestLitBeaconDist(zx, zz);
    const k = Math.max(0, Math.min(1, 1 - dRoot / ROOT_SIGNAL_RADIUS));
    rate = 1 - k * 0.22; // up to ~22% slower/lower right at a lit tower
  }
  if (Math.random() < 0.25) {
    synthZombieEcho(v, rate);
    return;
  }
  playSample(ZOMBIE_VOICE_URL, v, { jitter: 0.03, rate });
}
/** Empty-mag click. */
export function playDryFire(): void {
  const c = synthCtx();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.04;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/* ------------------------------------------------------------------ *
 * Winded breathing — loops while stamina is low. Tries breath.mp3, falls
 * back to a synthesised inhale/exhale (same sample-then-synth pattern as
 * the footstep / jump cues).
 * ------------------------------------------------------------------ */
const BREATH_URL = '/audio/sfx/breath.mp3';
let _windedOn = false;
let _breathTimer: number | null = null;
let _breathFile: HTMLAudioElement | null | false = null; // null=unknown, false=missing

function synthBreath(): void {
  const c = synthCtx();
  if (!c) return;
  const t = c.currentTime;
  const puff = (at: number, dur: number, peak: number, f0: number, f1: number) => {
    const n = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const x = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * x); // fade in + out
    }
    const src = c.createBufferSource();
    src.buffer = n;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(f0, t + at);
    bp.frequency.linearRampToValueAtTime(f1, t + at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.linearRampToValueAtTime(peak, t + at + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t + at);
    src.stop(t + at + dur + 0.03);
  };
  puff(0, 0.5, 0.16, 500, 900); // inhale — rising
  puff(0.62, 0.6, 0.13, 800, 350); // exhale — falling
}

function breathTick(): void {
  if (_breathFile === false) {
    synthBreath();
    return;
  }
  if (_breathFile == null) {
    const el = new Audio(BREATH_URL);
    el.volume = 0.5;
    el.addEventListener('error', () => (_breathFile = false), { once: true });
    el.addEventListener('canplaythrough', () => (_breathFile = el), { once: true });
    el.play().then(() => (_breathFile = el)).catch(() => (_breathFile = false));
    return;
  }
  const clone = _breathFile.cloneNode() as HTMLAudioElement;
  clone.volume = 0.5;
  void clone.play().catch(() => {});
}

/** Loop heavy breathing while the player is winded (stamina below the low mark). */
export function setWinded(on: boolean): void {
  if (on === _windedOn) return;
  _windedOn = on;
  if (on) {
    breathTick();
    _breathTimer = window.setInterval(breathTick, 2400);
  } else if (_breathTimer != null) {
    window.clearInterval(_breathTimer);
    _breathTimer = null;
  }
}

/* ------------------------------------------------------------------ *
 * Jump / land. Use /assets/sound/jump.wav & land.wav if present,
 * otherwise a short synthesised effort / thud.
 * ------------------------------------------------------------------ */
let jumpEl: HTMLAudioElement | null = null;
let landEl: HTMLAudioElement | null = null;
let jumpFile = true;
let landFile = true;
let actx: AudioContext | null = null;

function ensureFileEls() {
  if (!jumpEl) {
    jumpEl = new Audio('/assets/sound/jump.wav');
    jumpEl.volume = 0.6;
    jumpEl.addEventListener('error', () => (jumpFile = false));
  }
  if (!landEl) {
    landEl = new Audio('/assets/sound/land.wav');
    landEl.volume = 0.7;
    landEl.addEventListener('error', () => (landFile = false));
  }
}

function synthCtx(): AudioContext | null {
  if (actx) return actx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  actx = new AC();
  return actx;
}

function noiseThud(freq: number, dur: number, gain: number) {
  const c = synthCtx();
  if (!c) return;
  const t = c.currentTime;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 2.5, t);
  lp.frequency.exponentialRampToValueAtTime(freq, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export function playJump(): void {
  ensureFileEls();
  if (jumpFile && jumpEl) {
    jumpEl.currentTime = 0;
    jumpEl.play().catch(() => (jumpFile = false));
  }
  if (!jumpFile) noiseThud(230, 0.14, 0.12);
}

export function playLand(intensity = 0.7): void {
  ensureFileEls();
  if (landFile && landEl) {
    landEl.currentTime = 0;
    landEl.play().catch(() => (landFile = false));
  }
  if (!landFile) noiseThud(90, 0.2, 0.18 + intensity * 0.15);
}
