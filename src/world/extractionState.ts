/**
 * Night 4 ("Signal Zero") — the extraction pad stops being an instant-win
 * touchpad and becomes a hold-your-ground countdown: stepping into the pad
 * starts a timer, and dying before it elapses fails the run. Plain module
 * singleton, same shape as beaconState/staminaState — components read/mutate
 * it imperatively inside useFrame rather than lifting it into React state.
 */
export type ExtractionPhase = 'waiting' | 'countdown' | 'success' | 'failed';

export const COUNTDOWN_SECONDS = 45;

export const extractionState = {
  phase: 'waiting' as ExtractionPhase,
  countdownStartedAt: 0,
};

/** Called by Extraction.tsx when the player first reaches the pad. */
export function beginCountdown(): void {
  if (extractionState.phase !== 'waiting') return;
  extractionState.phase = 'countdown';
  extractionState.countdownStartedAt = performance.now();
}

/** Called by App.tsx's attack callback when a zombie hits the player mid-countdown. */
export function failExtraction(): void {
  if (extractionState.phase !== 'countdown') return;
  extractionState.phase = 'failed';
}

/** Seconds left, clamped to [0, COUNTDOWN_SECONDS]. COUNTDOWN_SECONDS before
 *  the countdown starts so a HUD reading this pre-emptively shows the full time. */
export function countdownRemaining(): number {
  if (extractionState.phase !== 'countdown') return COUNTDOWN_SECONDS;
  const elapsed = (performance.now() - extractionState.countdownStartedAt) / 1000;
  return Math.max(0, COUNTDOWN_SECONDS - elapsed);
}
