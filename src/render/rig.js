/**
 * Where the chase camera sits and what it looks at, as plain arithmetic.
 *
 * It lives apart from the rest of the renderer so the framing can be asserted
 * without a WebGL context, and there is one thing worth asserting: the camera
 * sits *behind* the egg and looks the way the egg runs, down +z. That mirrors
 * the view — world +x lands on the left of the screen — which is the whole
 * reason `laneX` descends with the lane index.
 */

/**
 * Two framings. A phone held upright has a narrow, tall window: the same
 * camera puts half the screen in the sky, so it gets pulled in, lifted, and
 * tilted down until the track fills the frame again.
 */
export const WIDE = { back: 6.8, up: 2.45, lead: 8, aim: 1.1 };
export const TALL = { back: 5.8, up: 3.3, lead: 5, aim: 0.2 };

export function rigFor(aspect) {
  return aspect < 1 ? TALL : WIDE;
}

/** The seat: behind the egg, over it, leaning a little the way it is going. */
export function seat(out, player, level, rig, shake = 0, rand = Math.random) {
  return out.set(
    player.x * 0.4 + (rand() - 0.5) * shake * 0.7,
    Math.max(player.y, level - 0.8) + rig.up + (rand() - 0.5) * shake * 0.5,
    player.z - rig.back,
  );
}

/** And what it aims at: down the course, ahead of the egg. */
export function focus(out, player, level, rig) {
  return out.set(player.x * 0.55, level + rig.aim, player.z + rig.lead);
}
