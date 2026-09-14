/**
 * Every number the run is tuned by, in one place. The course generator and the
 * tests both read from here, which is what keeps a generated gap a gap the egg
 * can actually clear: reach is derived from these, never guessed.
 */

export const LANES = 3;
export const LANE_WIDTH = 2;

/** Lane index → world x. Lane 1 is the middle of a three-lane course. */
export function laneX(lane) {
  return (lane - (LANES - 1) / 2) * LANE_WIDTH;
}

/**
 * Speed is a function of distance rather than elapsed time, so the generator —
 * which runs metres ahead of the egg — knows exactly how fast the egg will be
 * going when it arrives.
 */
export const RUN = { base: 11, perMetre: 0.0115, max: 24 };

export function speedAt(z) {
  return Math.min(RUN.max, RUN.base + Math.max(0, z) * RUN.perMetre);
}

export const GRAVITY = 26;
export const JUMP_SPEED = 9.4;
export const AIR_JUMPS = 1;
export const DIVE_SPEED = -24;

/** How long a full jump hangs, and how high it gets — the course's ruler. */
export const AIRTIME = (2 * JUMP_SPEED) / GRAVITY;
export const APEX = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);

export const COYOTE = 0.1;
export const JUMP_BUFFER = 0.12;
export const LANE_CHASE = 12;

export const PLAYER = { radius: 0.5, height: 1.4 };
export const HAZARD = { halfWidth: 0.55, halfDepth: 0.45, height: 0.95 };
export const BIT = { reach: 0.95, lift: 0.75 };

/** Below this the egg is gone; slabs never sit lower than zero. */
export const VOID_Y = -5;

/** How far a landing may snap up — under a raised slab's lip, nothing does. */
export const SNAP = 0.55;

export const LIVES = 3;
export const INVULNERABLE = 1.6;
export const SCORE = { perMetre: 1, perBit: 25 };

/** How much course is kept live around the egg. */
export const AHEAD = 180;
export const BEHIND = 40;
