/**
 * Minimal subtitle line for found-audio transcriptions (Night 2's beacon
 * transmissions). Plain module singleton (playerState/weaponState pattern) —
 * SubtitleHUD in App.tsx polls it via rAF, nothing pushes React state.
 */
export const subtitleState = {
  text: '',
  /** performance.now() ms — the line is visible until this, fading over the
   *  last FADE_MS of that window. */
  showUntil: 0,
};

export const SUBTITLE_FADE_MS = 900;

/** Show a line for `durationMs` (default 6s — long enough to read a short
 *  transcription without lingering after the audio's done). */
export function showSubtitle(text: string, durationMs = 6000): void {
  subtitleState.text = text;
  subtitleState.showUntil = performance.now() + durationMs;
}
