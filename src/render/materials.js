import * as THREE from 'three';

import { THEME } from './theme.js';

const lines = new Map();

/** Line materials are shared — a run makes hundreds of slabs out of four. */
export function wire(color, opacity = 1) {
  const key = `${color}:${opacity}`;
  if (!lines.has(key)) {
    lines.set(key, new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
  }
  return lines.get(key);
}

/** The black the wireframe sits on, so the far side of a thing stays hidden. */
export function fill(color = THEME.void, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function segments(positions, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, material);
}
