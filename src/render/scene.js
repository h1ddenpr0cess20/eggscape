import * as THREE from 'three';

import { buildEnvironment, buildLights } from './environment.js';
import { createRain } from './rain.js';
import { THEME } from './theme.js';

/**
 * Renderer, camera, fog, backdrop — and the one studio's worth of light in
 * here, which exists for the egg alone. Everything else is a line or a black
 * fill and would look the same in the dark.
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(THEME.void, 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(THEME.void, 26, 108);

  /** 52°, not the 64° this started on: a wide lens stretches whatever sits
   *  away from the middle of the frame, and what sits there is the egg. */
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 260);
  camera.position.set(0, 3.2, -8.4);

  const studio = buildLights(scene);
  buildEnvironment(scene, renderer);

  const rain = createRain();
  if (rain) {
    scene.background = rain.texture;
    scene.backgroundIntensity = 0.32;
  }

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    /** A tall window needs a taller lens, or the course shrinks to a thread. */
    camera.fov = camera.aspect < 1 ? 64 : 52;
    camera.updateProjectionMatrix();
  }

  resize();
  addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    studio,
    resize,
    tick(dt) { rain?.update(dt); },
    render() { renderer.render(scene, camera); },
  };
}
