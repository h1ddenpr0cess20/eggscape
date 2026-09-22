import * as THREE from 'three';

import { HAZARD, LANE_WIDTH } from '../core/tuning.js';
import { fill, segments, wire } from './materials.js';
import { THEME } from './theme.js';

const DEPTH = 0.8;
const RUNG = 2.5;

function box(out, x0, x1, y0, y1, z0, z1) {
  const corners = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [a, b] of edges) out.push(...corners[a], ...corners[b]);
}

/**
 * A slab, drawn where it is rather than pooled and scaled: the rungs have to
 * keep their spacing, and a run only ever has a dozen slabs in the air.
 */
export function createSlab(seg) {
  const group = new THREE.Group();
  group.name = `slab-${seg.id}`;

  const w = seg.xMax - seg.xMin;
  const l = seg.z1 - seg.z0;

  const frame = [];
  box(frame, -w / 2, w / 2, -DEPTH, 0, -l / 2, l / 2);
  group.add(segments(new Float32Array(frame), wire(THEME.wire, 0.85)));

  const grid = [];
  for (let lane = 1; lane < seg.span; lane++) {
    const x = -w / 2 + lane * LANE_WIDTH;
    grid.push(x, 0, -l / 2, x, 0, l / 2);
  }
  for (let z = RUNG; z < l; z += RUNG) {
    grid.push(-w / 2, 0, -l / 2 + z, w / 2, 0, -l / 2 + z);
  }
  if (grid.length) group.add(segments(new Float32Array(grid), wire(THEME.dim, 0.75)));

  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, l), fill(0x021007, 0.92));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.01;
  deck.renderOrder = -1;
  group.add(deck);

  group.position.set((seg.xMin + seg.xMax) / 2, seg.y, (seg.z0 + seg.z1) / 2);
  return group;
}

/** Line materials are shared and stay; the deck's fill belongs to this slab. */
export function disposeSlab(group) {
  group.traverse((node) => {
    node.geometry?.dispose();
    if (node.isMesh) node.material.dispose();
  });
}

/** An agent: a cage with something turning inside it. */
export function createHazard() {
  const group = new THREE.Group();

  const cage = [];
  box(cage, -HAZARD.halfWidth, HAZARD.halfWidth, 0, HAZARD.height, -HAZARD.halfDepth, HAZARD.halfDepth);
  group.add(segments(new Float32Array(cage), wire(THEME.agent, 0.9)));

  const core = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.34)),
    wire(THEME.agent, 0.55),
  );
  core.position.y = HAZARD.height / 2;
  group.add(core);

  /** Handed over rather than looked up: the renderer turns this every frame
   *  for every agent in shot, and a search of the group is a search. */
  group.userData.core = core;

  return group;
}

/** A bit: the loose data the egg is out here collecting. */
export function createBit() {
  const bit = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.3, 0)),
    wire(THEME.bit, 0.95),
  );
  bit.name = 'bit';
  return bit;
}

/** The floor of the void — far enough down to be scenery, close enough to
 *  tell you how far there is to fall. */
export function createUnderGrid({ half = 44, spacing = 4, y = -12 } = {}) {
  const lines = [];
  for (let x = -half; x <= half; x += spacing) lines.push(x, y, -half, x, y, half);
  for (let z = -half; z <= half; z += spacing) lines.push(-half, y, z, half, y, z);
  const grid = segments(new Float32Array(lines), wire(THEME.faint, 0.8));
  grid.name = 'undergrid';
  return { object: grid, spacing };
}
