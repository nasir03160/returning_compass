import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Zombie } from './Zombie';
import { playerPosition } from '../world/playerState';
import { capturingBeacon } from '../world/beaconState';

const COUNT = 3;
const CAPTURE_EXTRA = 3; // additional slots that only exist during a beacon capture
const RESPAWN_MIN_MS = 4000;
const RESPAWN_MAX_MS = 9000;
const CAPTURE_RESPAWN_MS = 2200; // faster churn while a beacon is being captured

function rndSpawn(): [number, number] {
  const cap = capturingBeacon();
  const a = Math.random() * Math.PI * 2;
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
 * Zombie pool. Base of COUNT; CAPTURE_EXTRA more slots come online only while a
 * beacon is being captured (and churn faster + spawn on the tower). When one
 * dies its slot goes empty for a few seconds so a kill reads as progress.
 */
export function Zombies({ onAttack }: ZombiesProps) {
  const TOTAL = COUNT + CAPTURE_EXTRA;
  const [slots, setSlots] = useState<Slot[]>(() =>
    Array.from({ length: TOTAL }, () => ({ gen: 0, spawn: rndSpawn(), alive: true }))
  );
  const [capturing, setCapturing] = useState(false);
  const timers = useRef<number[]>([]);

  const kill = useCallback((i: number) => {
    setSlots((s) => s.map((sl, idx) => (idx === i ? { ...sl, alive: false } : sl)));
    const delay = capturingBeacon()
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
    const poll = window.setInterval(() => setCapturing(capturingBeacon() != null), 500);
    return () => {
      window.clearInterval(poll);
      t.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const active = capturing ? TOTAL : COUNT;

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
