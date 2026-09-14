import * as THREE from 'three';

import { shapeEgg } from '../core/shape.js';
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
  const skin = createShellSkin(THREE);

  const geometry = new THREE.SphereGeometry(1, 128, 96);
  shapeEgg(geometry.attributes.position.array);
  geometry.computeVertexNormals();

  const material = new THREE.MeshPhysicalMaterial({
    name: 'eggshell',
    color: new THREE.Color(skin.map ? '#ffffff' : '#f0e3cd'),
    map: skin.map,
    bumpMap: skin.bumpMap,
    bumpScale: 0.7,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.6,
    sheen: 0.4,
    sheenColor: new THREE.Color('#fff2dd'),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'shell';

  return { mesh, geometry, material };
}
