import { createCourse } from './course.js';
import { createEmitter } from './emitter.js';
import { advance, createPlayer, respawn } from './player.js';
import {
  AHEAD, BEHIND, BIT, HAZARD, INVULNERABLE, LIVES, PLAYER, SCORE,
} from './tuning.js';

const STEP = 1 / 120;
const MAX_STEPS = 6;

/**
 * How far the landing of a slam reaches: a shock through the deck, not a
 * blast. Narrower than a lane, so it only ever takes the agent the egg came
 * down on — and short enough that it has to be aimed.
 */
const SMASH = { z: 2.2, x: 1.2, y: 1 };

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
 * Fold a frame's intent into whatever is still waiting to be spent. Lane
 * presses add up, so a double tap crosses two lanes even when both taps landed
 * inside one frame; a jump and a slam are flags, and pressing either twice
 * before a tick is still one of it.
 */
function hold(into, intent) {
  if (!intent) return into;
  const out = into ?? { left: 0, right: 0, jump: false, dive: false };
  out.left += Number(intent.left ?? 0);
  out.right += Number(intent.right ?? 0);
  out.jump = out.jump || Boolean(intent.jump);
  out.dive = out.dive || Boolean(intent.dive);
  return out;
}

/**
 * The run, with no pixels in it: course, egg, lives, score. Everything the
 * renderer shows and the HUD reads is here, and nothing here knows either
 * exists.
 *
 * Events: 'start' 'jump' 'land' 'bit' 'smash' 'hit' 'respawn' 'over'.
 */
export function createGame({ seed = 1, lives = LIVES } = {}) {
  const emitter = createEmitter();

  let course = createCourse({ seed }).ensure(AHEAD);
  let player = createPlayer();
  let state = 'ready';
  let livesLeft = lives;
  let taken = 0;
  let smashed = 0;
  let distance = 0;
  let invulnerable = 0;
  let elapsed = 0;
  let carry = 0;
  let held = null;

  function score() {
    return Math.floor(distance * SCORE.perMetre)
      + taken * SCORE.perBit
      + smashed * SCORE.perAgent;
  }

  function snapshot() {
    return {
      state,
      player,
      course,
      lives: livesLeft,
      bits: taken,
      agents: smashed,
      distance,
      score: score(),
      invulnerable,
      elapsed,
    };
  }

  /** The only way a run ends. Setting `state` on its own left the page with
   *  no overlay, no best score, and an egg standing still. */
  function finish() {
    livesLeft = Math.max(0, livesLeft);
    state = 'over';
    emitter.emit('over', snapshot());
  }

  function damage(reason) {
    livesLeft -= 1;
    invulnerable = INVULNERABLE;
    emitter.emit('hit', { reason, lives: livesLeft });
    if (livesLeft <= 0) finish();
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

  function shatter(hazard) {
    hazard.hit = true;
    smashed += 1;
    emitter.emit('smash', { hazard, agents: smashed });
  }

  /**
   * The landing of a slam, gone through the deck. Coming down at 24m/s crosses
   * the whole of an agent in a couple of ticks, so catching one purely on the
   * way through would be a window no hand can hit; the landing is what the
   * player is aiming, so the landing is what breaks it.
   */
  function shockwave() {
    for (const hazard of course.hazards) {
      if (hazard.hit || hazard.z < player.z - SMASH.z) continue;
      if (hazard.z > player.z + SMASH.z) break;
      /** Its own lane, on its own slab — not one a storey up or down. */
      if (Math.abs(hazard.x - player.x) > SMASH.x) continue;
      if (Math.abs(hazard.y - player.y) > SMASH.y) continue;
      shatter(hazard);
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
    if (moved.slammed) shockwave();

    collect();

    if (moved.fell) {
      damage('void');
      if (state === 'running') {
        const seg = course.ensure(player.z + AHEAD).landingAfter(player.z);
        if (!seg) finish();
        else {
          respawn(player, seg);
          emitter.emit('respawn', { player, seg });
        }
      }
      return;
    }

    /**
     * An agent met on the way down with the slam on is an agent broken, grace
     * or no grace. That is what the slam is for, and the reason to spend a
     * jump getting above one instead of weaving round it.
     */
    const hazard = invulnerable > 0 && !player.diving ? null : struck();
    if (hazard && player.diving) shatter(hazard);
    else if (hazard) {
      hazard.hit = true;
      damage('agent');
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
      smashed = 0;
      distance = 0;
      invulnerable = 0;
      elapsed = 0;
      carry = 0;
      held = null;
      tick.intent = null;
      emitter.emit('start', snapshot());
      return snapshot();
    },

    /**
     * Real seconds in, fixed ticks out. Physics at a steady 120Hz keeps a
     * landing a landing whatever the display is doing; a tab that was in the
     * background hands back a huge dt, and the clamp eats it rather than
     * teleporting the egg through the floor.
     *
     * Intent is *held* until a tick spends it, which is not fussiness: a frame
     * shorter than the step runs no tick at all, and a display faster than
     * 120Hz has one of those every few frames. Handing intent straight to the
     * first tick threw away a press each time — roughly one in six on a 144Hz
     * screen, always the press you meant.
     */
    advance(dt, intent) {
      if (state !== 'running') return snapshot();
      held = hold(held, intent);
      carry = Math.min(carry + dt, STEP * MAX_STEPS);
      while (carry >= STEP) {
        carry -= STEP;
        tick.intent = held;
        held = null;
        tick(STEP);
        if (state !== 'running') break;
      }
      return snapshot();
    },
  };
}
