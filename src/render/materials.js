import { Geometry } from '../gpu/geometry.js';
import { Lines } from '../gpu/graph.js';
import { BasicMaterial, LineMaterial } from '../gpu/material.js';
import { THEME } from './theme.js';

const lines = new Map();

/** Line materials are shared — a run makes hundreds of slabs out of four. */
export function wire(color, opacity = 1) {
  const key = `${color}:${opacity}`;
  if (!lines.has(key)) {
    lines.set(key, new LineMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      blending: 'additive',
      depthWrite: false,
    }));
  }
  return lines.get(key);
}

/** The black the wireframe sits on, so the far side of a thing stays hidden. */
export function fill(color = THEME.void, opacity = 1) {
  return new BasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function segments(positions, material) {
  return new Lines(new Geometry({ position: positions }), material);
}
