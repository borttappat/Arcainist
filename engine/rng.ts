// Seeded PRNG (mulberry32). The state is a single uint32 kept in GameState.rng so
// a game replays identically from its seed and action log.

export function next(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function int(state: { rng: number }, n: number): number {
  return Math.floor(next(state) * n);
}

export function shuffle<T>(state: { rng: number }, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = int(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Random opaque id, so ids reveal nothing about deck order or card identity. */
export function id(state: { rng: number }): string {
  let s = "";
  for (let i = 0; i < 3; i++) s += int(state, 0x10000).toString(16).padStart(4, "0");
  return s;
}
