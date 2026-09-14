import { approach, clamp } from './motion.js';
import {
  AIR_JUMPS, COYOTE, DIVE_SPEED, GRAVITY, JUMP_BUFFER, JUMP_SPEED,
  LANES, LANE_CHASE, laneX, SNAP, speedAt, VOID_Y,
} from './tuning.js';

const NONE = { left: false, right: false, jump: false, dive: false };

export function createPlayer({ z = 0, lane = 1, y = 0 } = {}) {
  return {
    z,
    x: laneX(lane),
    y,
    lane,
    vy: 0,
    speed: speedAt(z),
    grounded: false,
    diving: false,
    airJumps: AIR_JUMPS,
    coyote: 0,
    buffer: 0,
  };
}

/**
 * One physics tick. The egg runs itself — input only picks a lane, jumps, and
 * slams. Returns what happened, because the game above cares and the physics
 * doesn't.
 *
 * Forgiveness lives here: a jump pressed just after the edge (coyote) and a
 * jump pressed just before landing (buffer) both count, which is the whole
 * difference between a platformer and an argument.
 */
export function advance(player, dt, intent, course) {
  const act = intent ?? NONE;

  player.speed = speedAt(player.z);
  player.z += player.speed * dt;

  if (act.left) player.lane = Math.max(0, player.lane - 1);
  if (act.right) player.lane = Math.min(LANES - 1, player.lane + 1);
  player.x = approach(player.x, laneX(player.lane), LANE_CHASE, dt);

  player.buffer = act.jump ? JUMP_BUFFER : Math.max(0, player.buffer - dt);
  if (!player.grounded) player.coyote = Math.max(0, player.coyote - dt);

  let jumped = false;
  if (player.buffer > 0 && (player.grounded || player.coyote > 0 || player.airJumps > 0)) {
    if (!player.grounded && player.coyote <= 0) player.airJumps -= 1;
    player.vy = JUMP_SPEED;
    player.grounded = false;
    player.diving = false;
    player.coyote = 0;
    player.buffer = 0;
    jumped = true;
  }

  if (act.dive && !player.grounded) {
    player.vy = Math.min(player.vy, DIVE_SPEED);
    player.diving = true;
  }

  player.vy -= GRAVITY * dt;
  player.y += player.vy * dt;

  const ground = course.groundAt(player.x, player.z);
  const was = player.grounded;
  let landed = false;

  /**
   * A landing only snaps down a little way. Under the lip of a raised slab
   * there is nothing to catch: an egg that came up short goes past it.
   */
  if (ground && player.vy <= 0 && player.y <= ground.y && player.y > ground.y - SNAP) {
    player.y = ground.y;
    player.vy = 0;
    player.grounded = true;
    player.diving = false;
    player.airJumps = AIR_JUMPS;
    player.coyote = COYOTE;
    landed = !was;
  } else {
    player.grounded = false;
  }

  return { jumped, landed, fell: player.y < VOID_Y, ground };
}

/** Put a fallen egg back on the first slab still ahead of it. */
export function respawn(player, seg) {
  player.lane = clamp(player.lane, seg.lane, seg.lane + seg.span - 1);
  player.x = laneX(player.lane);
  player.z = seg.z0 + 1.5;
  player.y = seg.y + 1.4;
  player.vy = 0;
  player.grounded = false;
  player.diving = false;
  player.airJumps = AIR_JUMPS;
  player.coyote = 0;
  player.buffer = 0;
  return player;
}
