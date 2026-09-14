import { createCourse } from './course.js';
import { createEmitter } from './emitter.js';
import { advance, createPlayer, respawn } from './player.js';
import {
  AHEAD, BEHIND, BIT, HAZARD, INVULNERABLE, LIVES, PLAYER, SCORE,
} from './tuning.js';

const STEP = 1 / 120;
const MAX_STEPS = 6;

function overlaps(player, hazard) {
  return Math.abs(player.x - hazard.x) < PLAYER.radius + HAZARD.halfWidth
    && Math.abs(player.z - hazard.z) < PLAYER.radius + HAZARD.halfDepth
    && player.y < hazard.y + HAZARD.height
    && player.y + PLAYER.height > hazard.y;
}

function within(player, bit) {
  return Math.abs(player.x - bit.x) < BIT.reach
    && Math.abs(player.z - bit.z) < BIT.reach
    && Math.abs(player.y + PLAYER.height / 2 - bit.y) < 1.15;
}

/**
 * The run, with no pixels in it: course, egg, lives, score. Everything the
 * renderer shows and the HUD reads is here, and nothing here knows either
 * exists.
 *
 * Events: 'start' 'jump' 'land' 'bit' 'hit' 'over'.
 */
export function createGame({ seed = 1, lives = LIVES } = {}) {
  const emitter = createEmitter();

  let course = createCourse({ seed }).ensure(AHEAD);
  let player = createPlayer();
  let state = 'ready';
  let livesLeft = lives;
  let taken = 0;
  let distance = 0;
  let invulnerable = 0;
  let elapsed = 0;
  let carry = 0;

  function score() {
    return Math.floor(distance * SCORE.perMetre) + taken * SCORE.perBit;
  }

  function snapshot() {
    return {
      state,
      player,
      course,
      lives: livesLeft,
      bits: taken,
      distance,
      score: score(),
      invulnerable,
      elapsed,
    };
  }

  function damage(reason) {
    livesLeft -= 1;
    invulnerable = INVULNERABLE;
    emitter.emit('hit', { reason, lives: livesLeft });
    if (livesLeft <= 0) {
      livesLeft = 0;
      state = 'over';
      emitter.emit('over', snapshot());
    }
  }

  function collect() {
    for (const bit of course.bits) {
      if (bit.taken || bit.z < player.z - 2) continue;
      if (bit.z > player.z + 2) break;
      if (within(player, bit)) {
        bit.taken = true;
        taken += 1;
        emitter.emit('bit', { bit, bits: taken });
      }
    }
  }

  function struck() {
    for (const hazard of course.hazards) {
      if (hazard.hit || hazard.z < player.z - 2) continue;
      if (hazard.z > player.z + 2) break;
      if (overlaps(player, hazard)) return hazard;
    }
    return null;
  }

  function tick(dt) {
    elapsed += dt;
    const moved = advance(player, dt, tick.intent, course);
    tick.intent = null;

    course.ensure(player.z + AHEAD);
    course.prune(player.z - BEHIND);

    distance = Math.max(distance, player.z);
    if (invulnerable > 0) invulnerable = Math.max(0, invulnerable - dt);

    if (moved.jumped) emitter.emit('jump', { player });
    if (moved.landed) emitter.emit('land', { player });

    collect();

    if (moved.fell) {
      damage('void');
      if (state === 'running') {
        const seg = course.ensure(player.z + AHEAD).landingAfter(player.z);
        if (seg) respawn(player, seg);
        else state = 'over';
      }
      return;
    }

    if (invulnerable <= 0) {
      const hazard = struck();
      if (hazard) {
        hazard.hit = true;
        damage('agent');
      }
    }
  }

  return {
    on: emitter.on,
    snapshot,

    get state() { return state; },
    get player() { return player; },
    get course() { return course; },
    get score() { return score(); },

    start(nextSeed = seed) {
      course = createCourse({ seed: nextSeed }).ensure(AHEAD);
      player = createPlayer();
      state = 'running';
      livesLeft = lives;
      taken = 0;
      distance = 0;
      invulnerable = 0;
      elapsed = 0;
      carry = 0;
      emitter.emit('start', snapshot());
      return snapshot();
    },

    /**
     * Real seconds in, fixed ticks out. Physics at a steady 120Hz keeps a
     * landing a landing whatever the display is doing; a tab that was in the
     * background hands back a huge dt, and the clamp eats it rather than
     * teleporting the egg through the floor.
     */
    advance(dt, intent) {
      if (state !== 'running') return snapshot();
      carry = Math.min(carry + dt, STEP * MAX_STEPS);
      let first = intent;
      while (carry >= STEP) {
        carry -= STEP;
        tick.intent = first;
        first = null;
        tick(STEP);
        if (state !== 'running') break;
      }
      return snapshot();
    },
  };
}
