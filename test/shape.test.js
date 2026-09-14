import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { eggHeight, eggWireframe, MARC_PROFILE, shapeEgg, spherePoint, WIRE_PROFILE } from '../src/core/shape.js';

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
  it('puts a sphere point where the sphere is', () => {
    assert.deepEqual(spherePoint(0, 0).map(Math.round), [0, 1, 0]);
    assert.deepEqual(spherePoint(0, 1).map(Math.round), [0, -1, 0]);
    const side = spherePoint(0, 0.5);
    assert.ok(Math.abs(Math.hypot(side[0], side[1], side[2]) - 1) < 1e-9);
  });

  it('turns a sphere into something taller than it is wide', () => {
    const sphere = new Float32Array([1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1]);
    const box = bounds(shapeEgg(sphere.slice()));
    assert.ok(box.maxY - box.minY > (box.maxX - box.minX) * 2, 'the shell came out round');
  });

  it('keeps the fat end at the bottom, which is what makes it an egg', () => {
    for (const profile of [MARC_PROFILE, WIRE_PROFILE]) {
      const { at } = waist(eggWireframe({ profile }));
      assert.ok(at < 0, `the widest ring sat at ${at.toFixed(3)}, at or above the middle`);
    }
  });

  it('pushes the wireframe profile further than the one Marc wears', () => {
    const marc = waist(eggWireframe({ profile: MARC_PROFILE }));
    const wire = waist(eggWireframe({ profile: WIRE_PROFILE }));
    assert.ok(wire.at < marc.at, 'the wireframe waist should sit lower');
    assert.ok(wire.widest < marc.widest, 'and the wireframe shell should be slimmer');
  });

  it('reports the height the renderer scales the egg by', () => {
    for (const profile of [MARC_PROFILE, WIRE_PROFILE]) {
      const box = bounds(eggWireframe({ profile }));
      assert.ok(Math.abs((box.maxY - box.minY) - eggHeight(profile)) < 1e-6);
    }
  });

  it('draws lines in pairs, and only lines', () => {
    const positions = eggWireframe({ meridians: 4, rings: 2, steps: 6, arc: 8 });
    assert.equal(positions.length % 6, 0, 'a segment needs two ends');
    assert.equal(positions.length / 6, 4 * 6 + 2 * 8);
    assert.ok(positions.every(Number.isFinite));
  });
});
