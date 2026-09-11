/**
 * Compact 2D simplex noise (public-domain algorithm, Stefan Gustavson).
 * Deterministic — no seeding needed for our purposes.
 */
const grad3 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];

const p = new Uint8Array(256);
for (let i = 0; i < 256; i++) p[i] = i;
// fixed shuffle
let n = 256;
let seed = 1337;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
while (n > 1) {
  n--;
  const k = Math.floor(rnd() * (n + 1));
  const t = p[n];
  p[n] = p[k];
  p[k] = t;
}
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
for (let i = 0; i < 512; i++) {
  perm[i] = p[i & 255];
  permMod12[i] = perm[i] % 12;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** Simplex noise in roughly [-1, 1]. */
export function noise2D(xin: number, yin: number): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = xin - X0;
  const y0 = yin - Y0;

  let i1: number;
  let j1: number;
  if (x0 > y0) {
    i1 = 1;
    j1 = 0;
  } else {
    i1 = 0;
    j1 = 1;
  }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = i & 255;
  const jj = j & 255;

  const contrib = (x: number, y: number, gi: number) => {
    let tt = 0.5 - x * x - y * y;
    if (tt < 0) return 0;
    tt *= tt;
    const g = grad3[gi];
    return tt * tt * (g[0] * x + g[1] * y);
  };

  const gi0 = permMod12[ii + perm[jj]];
  const gi1 = permMod12[ii + i1 + perm[jj + j1]];
  const gi2 = permMod12[ii + 1 + perm[jj + 1]];

  return 70 * (contrib(x0, y0, gi0) + contrib(x1, y1, gi1) + contrib(x2, y2, gi2));
}

/** Multi-octave fractal noise, output roughly [-1, 1]. */
export function fbm2D(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2D(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
