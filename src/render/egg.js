import * as THREE from 'three';

import { eggHeight, eggWireframe, shapeEgg, WIRE_PROFILE } from '../core/shape.js';
import { PLAYER } from '../core/tuning.js';
import { fill, segments, wire } from './materials.js';
import { THEME } from './theme.js';

/** The shaped shell has its own height; the egg has to fit the collider. */
export const EGG_SCALE = PLAYER.height / eggHeight();
const WIRE = { meridians: 13, rings: 5, steps: 26, arc: 30 };

export function createEgg() {
  const egg = new THREE.Group();
  egg.name = 'egg';

  const solid = new THREE.SphereGeometry(0.97, 20, 14);
  shapeEgg(solid.attributes.position.array, WIRE_PROFILE);
  solid.computeVertexNormals();
  const shell = new THREE.Mesh(solid, fill(THEME.void));
  shell.name = 'shell';
  /** The fill goes down first and writes depth; the lines, which do not,
   *  then draw over the front of it and get depth-tested off the back. */
  shell.renderOrder = -1;

  const lines = segments(eggWireframe(WIRE), wire(THEME.wire));
  lines.name = 'wireframe';

  const halo = segments(eggWireframe({ meridians: 7, rings: 2, steps: 16, arc: 20 }), wire(THEME.glow, 0.3));
  halo.scale.setScalar(1.06);

  const body = new THREE.Group();
  body.add(shell, lines, halo);
  body.name = 'body';
  egg.add(body);
  egg.scale.setScalar(EGG_SCALE);

  return { object: egg, body, lines, halo };
}

/** The ring the egg casts on whatever it is standing over. */
export function createShadow(radius = 0.6, points = 32) {
  const positions = new Float32Array(points * 6);
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const b = ((i + 1) / points) * Math.PI * 2;
    positions.set([
      Math.cos(a) * radius, 0, Math.sin(a) * radius,
      Math.cos(b) * radius, 0, Math.sin(b) * radius,
    ], i * 6);
  }
  return segments(positions, wire(THEME.dim, 0.7));
}
