import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EGG_HEIGHT, shapeEgg } from '../src/core/shape.js';

/** The same sphere the shell is built from, as a bare position array. */
function sphere(segments = 24, rings = 18) {
  const points = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    for (let s = 0; s < segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      points.push(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    }
  }
  return new Float32Array(points);
}

function bounds(positions) {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    box.minX = Math.min(box.minX, positions[i]);
    box.maxX = Math.max(box.maxX, positions[i]);
    box.minY = Math.min(box.minY, positions[i + 1]);
    box.maxY = Math.max(box.maxY, positions[i + 1]);
  }
  return box;
}

/** The widest ring of the shell, and where up the shell it sits. */
function waist(positions) {
  let widest = 0;
  let at = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 2]);
    if (r > widest) {
      widest = r;
      at = positions[i + 1];
    }
  }
  return { widest, at };
}

describe('shape', () => {
  it('is Marc\'s profile, to the number', () => {
    const point = shapeEgg(new Float32Array([1, 0.5, 1]));
    const taper = 1 - 0.075 * 0.5 - 0.055 * 0.25;
    assert.ok(Math.abs(point[0] - 0.84 * taper) < 1e-6);
    assert.ok(Math.abs(point[2] - 0.84 * taper) < 1e-6);
    assert.ok(Math.abs(point[1] - (0.5 * 1.03 + 0.01)) < 1e-6);
  });

  it('turns a sphere into a shell taller than it is wide', () => {
    const box = bounds(shapeEgg(sphere()));
    assert.ok(box.maxY - box.minY > box.maxX - box.minX, 'the shell came out round');
  });

  it('keeps the fat end at the bottom, which is what makes it an egg', () => {
    const { at } = waist(shapeEgg(sphere(64, 48)));
    assert.ok(at < 0, `the widest ring sat at ${at.toFixed(3)}, at or above the middle`);
  });

  it('reports the height the renderer scales the egg by', () => {
    const box = bounds(shapeEgg(sphere(32, 96)));
    assert.ok(Math.abs((box.maxY - box.minY) - EGG_HEIGHT) < 1e-3);
  });

  it('leaves the array it was handed, and hands it back', () => {
    const positions = sphere(8, 6);
    assert.equal(shapeEgg(positions), positions);
    assert.ok([...positions].every(Number.isFinite));
  });
});
