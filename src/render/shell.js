import { shapeEgg } from '../core/shape.js';
import { sphere } from '../gpu/geometry.js';
import { Mesh } from '../gpu/graph.js';
import { PhysicalMaterial } from '../gpu/material.js';
import { createShellSkin } from './skin.js';

/**
 * Marc's shell, verbatim from src/client/egg/shell.js: the same 128×96 sphere
 * pushed through the same profile, wearing the same physical material —
 * speckled cream, a bump off the speckles, clearcoat and sheen on top.
 *
 * It is the one thing in this world that is not made of lines, which is the
 * point: the egg is the thing that does not belong here.
 */
export function createShell() {
  const skin = createShellSkin();

  const geometry = sphere(1, 128, 96);
  shapeEgg(geometry.position);
  geometry.computeVertexNormals();

  const material = new PhysicalMaterial({
    name: 'eggshell',
    color: skin.map ? '#ffffff' : '#f0e3cd',
    map: skin.map,
    bumpMap: skin.bumpMap,
    bumpScale: 0.7,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.6,
    sheen: 0.4,
    sheenColor: '#fff2dd',
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'shell';

  return { mesh, geometry, material };
}
