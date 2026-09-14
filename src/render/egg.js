import * as THREE from 'three';

import { EGG_HEIGHT } from '../core/shape.js';
import { PLAYER } from '../core/tuning.js';
import { segments, wire } from './materials.js';
import { createShell } from './shell.js';
import { THEME } from './theme.js';

/** The shaped shell has its own height; the egg has to fit the collider. */
export const EGG_SCALE = PLAYER.height / EGG_HEIGHT;

/**
 * Marc, as he is, in a world that is not. The shell is the asset — same
 * geometry, same speckled skin, same physical material — and the only thing
 * added is a rim of green light around it, because the lighting in here is
 * green and the shell should admit it.
 */
export function createEgg() {
  const egg = new THREE.Group();
  egg.name = 'egg';

  const shell = createShell();

  const body = new THREE.Group();
  body.name = 'body';
  body.add(shell.mesh);

  egg.add(body);
  egg.scale.setScalar(EGG_SCALE);

  return { object: egg, body, shell };
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
