import { LANES, laneX } from '../../src/core/tuning.js';

/**
 * A crude autopilot: jump what has to be jumped, sidestep what does not. It
 * plays worse than a person — one frame of lookahead, no double jump — which
 * is the point. If this thing can get a few hundred metres down a seed, the
 * course is fair.
 */
export function pilot(game) {
  const { player, course } = game.snapshot();
  const intent = { left: false, right: false, jump: false, dive: false };

  const blocked = (lane, from, to) => course.hazards.some(
    (hazard) => !hazard.hit && hazard.lane === lane && hazard.z > from && hazard.z < to,
  );
  const paved = (lane, z) => Boolean(course.groundAt(laneX(lane), z));

  const ahead = player.z + player.speed * 0.42;
  if (!course.groundAt(player.x, ahead) && player.grounded) intent.jump = true;

  const sidestep = (test) => {
    for (const lane of [player.lane - 1, player.lane + 1]) {
      if (lane < 0 || lane >= LANES || !test(lane)) continue;
      if (lane < player.lane) intent.left = true;
      else intent.right = true;
      return true;
    }
    return false;
  };

  if (blocked(player.lane, player.z + 1, player.z + player.speed * 0.45)) {
    sidestep((lane) => !blocked(lane, player.z, player.z + player.speed * 0.5) && paved(lane, ahead));
  } else if (!paved(player.lane, player.z + 3) && player.grounded) {
    sidestep((lane) => paved(lane, player.z + 3) && !blocked(lane, player.z, player.z + 6));
  }

  return intent;
}

/** Play a seed out, to the end or to `seconds`, and report what happened. */
export function run(game, { seed = 1, seconds = 120, fps = 60, drive = pilot } = {}) {
  const hits = [];
  game.on('hit', (hit) => hits.push(hit.reason));
  game.start(seed);
  for (let i = 0; i < seconds * fps && game.state === 'running'; i++) {
    game.advance(1 / fps, drive ? drive(game) : null);
  }
  return { ...game.snapshot(), hits };
}
