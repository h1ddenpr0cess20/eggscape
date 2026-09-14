/**
 * The egg profile, lifted from Marc (github.com/h1ddenpr0cess20/marc): a unit
 * sphere's vertices pushed into a shell — narrower at the top, a touch longer
 * than it is wide.
 */
export const MARC_PROFILE = { taper: 0.075, curve: 0.055, girth: 0.84, stretch: 1.03, lift: 0.01 };

/**
 * The same shell, pushed. Marc's profile is subtle because his shading sells
 * it; a wireframe has no shading, and a subtle egg in wireframe is a globe.
 */
export const WIRE_PROFILE = { taper: 0.19, curve: 0.1, girth: 0.76, stretch: 1.2, lift: 0.01 };

export function shapeEgg(positions, profile = MARC_PROFILE) {
  const { taper, curve, girth, stretch, lift } = profile;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const narrow = girth * (1 - taper * y - curve * y * y);
    positions[i] *= narrow;
    positions[i + 2] *= narrow;
    positions[i + 1] = y * stretch + lift;
  }
  return positions;
}

/** A point on the unit sphere: u around, v from pole to pole, both 0..1. */
export function spherePoint(u, v) {
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  const r = Math.sin(theta);
  return [r * Math.cos(phi), Math.cos(theta), r * Math.sin(phi)];
}

/**
 * The egg as line segments — meridians and latitude rings, drawn on purpose
 * rather than handed to a wireframe helper, because a helper triangulates and
 * what comes back is a mesh of diagonals instead of a shell.
 */
export function eggWireframe({ meridians = 12, rings = 5, steps = 24, arc = 28, profile = WIRE_PROFILE } = {}) {
  const points = [];
  const push = (a, b) => points.push(a[0], a[1], a[2], b[0], b[1], b[2]);

  for (let m = 0; m < meridians; m++) {
    const u = m / meridians;
    for (let s = 0; s < steps; s++) {
      push(spherePoint(u, s / steps), spherePoint(u, (s + 1) / steps));
    }
  }

  for (let r = 1; r <= rings; r++) {
    const v = r / (rings + 1);
    for (let s = 0; s < arc; s++) {
      push(spherePoint(s / arc, v), spherePoint((s + 1) / arc, v));
    }
  }

  return shapeEgg(new Float32Array(points), profile);
}

/** How tall the shaped shell stands, for fitting it to the collider. */
export function eggHeight(profile = WIRE_PROFILE) {
  return 2 * profile.stretch;
}
