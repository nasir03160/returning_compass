/**
 * Shared weapon state — written by WeaponRig each time it fires / reloads,
 * read by the HUD. Plain singleton so no per-frame React re-renders.
 */
export const weaponState = {
  magSize: 30,
  mag: 30,
  reserve: 150,
  reloading: false,
};
