import { prefilterInBackground } from '../gpu/environment.js';
import { DirectionalLight, Group, HemisphereLight } from '../gpu/graph.js';

/**
 * Marc's studio, verbatim from src/client/egg/environment.js — a warm sky, a
 * dark ground, and one soft window in it. The world outside is green; the
 * shell is lit by the room it was made in, because that is what makes it read
 * as ceramic instead of as a pale blob.
 */
export function buildEnvironment(scene) {
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#fff6e8'); g.addColorStop(0.5, '#9aa0ad');
    g.addColorStop(0.56, '#33302c'); g.addColorStop(1, '#14120f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = 'rgba(255,247,232,0.95)'; ctx.beginPath();
    ctx.ellipse(20, 6, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    scene.environment = prefilterInBackground(c);
  } catch {
  }
}

/**
 * The neutral studio the stage lights Marc with, at the same intensities and
 * from the same directions (three-d-stage.js `_boot`), minus the shadow map —
 * a green ring on the slab does that job here, and reads better at speed.
 *
 * The rig travels with the egg, so the light on the shell is the same at 400
 * metres as it is at the start line.
 */
export function buildLights(scene) {
  const rig = new Group();
  rig.name = 'studio';

  const hemi = new HemisphereLight(0xffffff, 0xd8d2c4, 1.0);

  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 7, 5);

  const fill = new DirectionalLight(0xfff4e6, 0.5);
  fill.position.set(-5, 3, -4);

  rig.add(hemi, key, key.target, fill, fill.target);
  scene.add(rig);
  return rig;
}
