/**
 * The egg profile, verbatim from Marc (github.com/h1ddenpr0cess20/marc,
 * src/client/egg/shell.js): a unit sphere's vertices pushed into a shell —
 * narrower at the top, a touch longer than it is wide. Every egg in here is
 * this function's output; nothing redraws it by hand.
 */
export function shapeEgg(positions) {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const taper = 1 - 0.075 * y - 0.055 * y * y;
    positions[i] *= 0.84 * taper;
    positions[i + 2] *= 0.84 * taper;
    positions[i + 1] = y * 1.03 + 0.01;
  }
  return positions;
}

/** How tall the shaped shell stands, for fitting it to the collider. */
export const EGG_HEIGHT = 2 * 1.03;
