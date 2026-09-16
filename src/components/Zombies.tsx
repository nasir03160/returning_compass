import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Zombie } from './Zombie';
import { playerPosition } from '../world/playerState';
import { capturingBeacon, EXTRACTION_POS } from '../world/beaconState';
import { extractionState } from '../world/extractionState';

const COUNT = 3;
const CAPTURE_EXTRA = 3; // additional slots that only exist during a beacon capture, or Night 4's extraction countdown
const RESPAWN_MIN_MS = 4000;
const RESPAWN_MAX_MS = 9000;
const CAPTURE_RESPAWN_MS = 2200; // faster churn while a beacon is captured OR the extraction countdown is live

const [EX, EZ] = EXTRACTION_POS;

function rndSpawn(): [number, number] {
  const a = Math.random() * Math.PI * 2;
  // Night 4: the extraction countdown reuses the same "extra slots + bias
  // toward the objective" pressure a beacon capture creates, aimed at the pad.
  if (extractionState.phase === 'countdown' && Math.random() < 0.75) {
    const d = 16 + Math.random() * 14;
    return [EX + Math.cos(a) * d, EZ + Math.sin(a) * d];
  }
  const cap = capturingBeacon();
  // during a capture most zombies close in on the tower itself
  if (cap && Math.random() < 0.72) {
    const d = 14 + Math.random() * 12;
    return [cap.x + Math.cos(a) * d, cap.z + Math.sin(a) * d];
  }
  const d = 22 + Math.random() * 16;
  return [playerPosition.x + Math.cos(a) * d, playerPosition.z + Math.sin(a) * d];
}

interface ZombiesProps {
  /** called when a zombie lands an attack on the player */
  onAttack: () => void;
}

interface Slot {
  gen: number;
  spawn: [number, number];
  alive: boolean;
}

/**
 * Zombie pool. Base of COUNT; CAPTURE_EXTRA more slots come online while a
 * beacon is being captured OR (Night 4) the extraction countdown is running
 * — both churn faster and bias spawns onto the relevant objective. When one
 * dies its slot goes empty for a few seconds so a kill reads as progress.
 */
export function Zombies({ onAttack }: ZombiesProps) {
  const TOTAL = COUNT + CAPTURE_EXTRA;
  const [slots, setSlots] = useState<Slot[]>(() =>
    Array.from({ length: TOTAL }, () => ({ gen: 0, spawn: rndSpawn(), alive: true }))
  );
  const [surge, setSurge] = useState(false);
  const timers = useRef<number[]>([]);

  const kill = useCallback((i: number) => {
    setSlots((s) => s.map((sl, idx) => (idx === i ? { ...sl, alive: false } : sl)));
    const delay = capturingBeacon() || extractionState.phase === 'countdown'
      ? CAPTURE_RESPAWN_MS
      : RESPAWN_MIN_MS + Math.random() * (RESPAWN_MAX_MS - RESPAWN_MIN_MS);
    timers.current[i] = window.setTimeout(() => {
      setSlots((s) =>
        s.map((sl, idx) => (idx === i ? { gen: sl.gen + 1, spawn: rndSpawn(), alive: true } : sl))
      );
    }, delay);
  }, []);

  useEffect(() => {
    const t = timers.current;
    const poll = window.setInterval(
      () => setSurge(capturingBeacon() != null || extractionState.phase === 'countdown'),
      500
    );
    return () => {
      window.clearInterval(poll);
      t.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const active = surge ? TOTAL : COUNT;

  return (
    <>
      {slots.map((sl, i) =>
        i < active && sl.alive ? (
          <Zombie
            key={`${i}-${sl.gen}`}
            spawn={sl.spawn}
            onDead={() => kill(i)}
            onAttack={onAttack}
          />
        ) : null
      )}
    </>
  );
}
