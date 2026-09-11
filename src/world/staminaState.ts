/**
 * Shared stamina resource — written once per frame by the Player controller,
 * read by the stamina HUD bar and the low-stamina breathing SFX. Plain module
 * singleton (same pattern as playerState / weaponState) so no per-frame React
 * re-renders.
 */
export const staminaState = {
  current: 100,
  max: 100,
  /** true while sprinting or stealth-walking is actively draining it */
  depleting: false,
};

/** Fraction 0..1 — convenience for the HUD. */
export function staminaFrac(): number {
  return staminaState.max > 0 ? staminaState.current / staminaState.max : 0;
}

/** Below this fraction the player is winded → heavier breathing, sprint feels risky. */
export const STAMINA_LOW_FRAC = 0.25;
