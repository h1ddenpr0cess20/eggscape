const KEY = 'eggscape:best';

/** The only thing that survives a run. A browser that refuses storage just
 *  gets a shorter memory, not an error. */
export function readBest(storage = globalThis.localStorage) {
  try {
    const value = Number(storage?.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function writeBest(score, storage = globalThis.localStorage) {
  const best = Math.max(readBest(storage), Math.floor(score) || 0);
  try {
    storage?.setItem(KEY, String(best));
  } catch {
  }
  return best;
}
