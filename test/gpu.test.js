import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { display, linear, linearToSrgb, srgbToLinear } from '../src/gpu/color.js';
import { prefilter, fromHalf, toHalf } from '../src/gpu/environment.js';
import { createFrameBuilder, DRAW, FRAME } from '../src/gpu/frame.js';
import { cylinder, octahedron, octahedronEdges, plane, sphere, torus } from '../src/gpu/geometry.js';
import { Group, Lines, Mesh, PerspectiveCamera, Scene } from '../src/gpu/graph.js';
import { BasicMaterial, LineMaterial, StandardMaterial } from '../src/gpu/material.js';

const shader = (name) => readFileSync(new URL(`../src/gpu/shaders/${name}`, import.meta.url), 'utf8');

/** Field names and sizes in floats, in declaration order, from a GLSL block
 *  or a WGSL struct — enough to lay it out, given only vec4 and mat4 in it. */
function fields(source, pattern) {
  const body = source.match(pattern)[1];
  const out = [];
  for (const line of body.split('\n')) {
    const glsl = line.match(/^\s*(vec4|mat4)\s+(\w+)(?:\[(\d+)\])?;/);
    const wgsl = line.match(/^\s*(\w+):\s*(vec4f|mat4x4f|array<vec4f,\s*(\d+)>),/);
    if (glsl) out.push([glsl[2], (glsl[1] === 'mat4' ? 16 : 4) * Number(glsl[3] ?? 1)]);
    else if (wgsl) out.push([wgsl[1], wgsl[2] === 'mat4x4f' ? 16 : 4 * Number(wgsl[3] ?? 1)]);
  }
  return out;
}

function offsets(list) {
  let at = 0;
  return list.map(([, size]) => {
    const here = at;
    at += size;
    return here;
  }).concat(at);
}

function surfaceNormal(geometry, triangle) {
  const p = geometry.position;
  const i = geometry.index ? [...geometry.index.slice(triangle * 3, triangle * 3 + 3)] : [0, 1, 2].map((k) => triangle * 3 + k);
  const [a, b, c] = i.map((v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return { centre: [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3), normal: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
}

/** A canvas stand-in the prefilter can read pixels from. */
function solid(width, height, [r, g, b]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return { width, height, getContext: () => ({ getImageData: () => ({ width, height, data }) }) };
}

describe('the uniform layouts', () => {
  /**
   * The frame and draw blocks are written out three times — packed by
   * frame.js, declared in GLSL and declared again in WGSL. A field added to
   * one and not the others reads garbage on one backend and is fine on the
   * other, which is the worst way for it to go wrong.
   */
  it('agree between frame.js, the GLSL blocks and the WGSL structs', () => {
    const glsl = shader('common.glsl');
    const wgsl = shader('common.wgsl');
    for (const [name, layout, glslBlock, wgslStruct] of [
      ['Frame', FRAME, /uniform Frame \{([\s\S]*?)\};/, /struct Frame \{([\s\S]*?)\n\}/],
      ['Draw', DRAW, /uniform Draw \{([\s\S]*?)\};/, /struct Draw \{([\s\S]*?)\n\}/],
    ]) {
      const fromGlsl = offsets(fields(glsl, glslBlock));
      const fromWgsl = offsets(fields(wgsl, wgslStruct));
      assert.deepEqual(fromGlsl, fromWgsl, `${name}: GLSL and WGSL disagree`);
      const packed = Object.entries(layout).filter(([key]) => key !== 'size' && key !== 'stride').map(([, at]) => at);
      assert.deepEqual(fromGlsl.slice(0, -1), packed, `${name}: frame.js packs it differently`);
      if (layout.size) assert.equal(fromGlsl.at(-1), layout.size, `${name}: wrong size`);
      if (layout.stride) assert.ok(fromGlsl.at(-1) <= layout.stride, `${name}: overflows its 256-byte slot`);
    }
  });
});

describe('colour', () => {
  it('decodes theme hex to linear light and encodes it back', () => {
    assert.deepEqual(linear(0xffffff), [1, 1, 1]);
    assert.deepEqual(linear(0x000000), [0, 0, 0]);
    for (const c of [0, 0.02, 0.2, 0.5, 0.9, 1]) assert.ok(Math.abs(linearToSrgb(srgbToLinear(c)) - c) < 1e-4);
    assert.ok(Math.abs(linear('#808080')[0] - 0.2158605) < 1e-6);
    const [r, g, b] = display(0x101a2e);
    assert.ok(Math.abs(r - 0x10 / 255) < 1e-3 && Math.abs(g - 0x1a / 255) < 1e-3 && Math.abs(b - 0x2e / 255) < 1e-3);
  });
});

describe('the shapes', () => {
  /** A face wound the wrong way is culled from outside and solid from
   *  within, so every generator is checked from the outside in. */
  it('winds every triangle of a closed shape to face outwards', () => {
    for (const [name, g] of [['sphere', sphere(1, 16, 12)], ['cylinder', cylinder(1, 1, 2, 12)], ['cone', cylinder(0, 1, 2, 12)], ['octahedron', octahedron(1)]]) {
      const triangles = g.index ? g.index.length / 3 : g.count / 3;
      for (let t = 0; t < triangles; t++) {
        const { centre, normal } = surfaceNormal(g, t);
        const out = normal[0] * centre[0] + normal[1] * centre[1] + normal[2] * centre[2];
        if (Math.hypot(...normal) < 1e-9) continue;
        assert.ok(out > 0, `${name} triangle ${t} faces in`);
      }
    }
  });

  it('lays a plane facing +z with the top of the texture at the top', () => {
    const g = plane(2, 4);
    assert.ok(surfaceNormal(g, 0).normal[2] > 0);
    const top = [...g.uv].filter((_, i) => i % 2 === 1 && g.position[Math.floor(i / 2) * 3 + 1] > 0);
    assert.ok(top.every((v) => v === 1));
  });

  it('gives a sphere its seam and its poles, as the egg was shaped on', () => {
    const g = sphere(1, 128, 96);
    assert.equal(g.count, 129 * 97);
    assert.equal(g.index.length, 128 * 95 * 2 * 3);
  });

  it('draws an octahedron cage as its twelve edges', () => {
    const edges = octahedronEdges(0.3);
    assert.equal(edges.count, 24);
    for (let i = 0; i < edges.count; i += 2) {
      const p = edges.position;
      const length = Math.hypot(p[i * 3] - p[i * 3 + 3], p[i * 3 + 1] - p[i * 3 + 4], p[i * 3 + 2] - p[i * 3 + 5]);
      assert.ok(Math.abs(length - 0.3 * Math.SQRT2) < 1e-6, 'an edge runs through the middle');
    }
  });

  it('works out normals that point away from a torus tube', () => {
    const g = torus(1, 0.25, 6, 12);
    for (let v = 0; v < g.count; v++) {
      const [x, y] = [g.position[v * 3], g.position[v * 3 + 1]];
      const ring = [x / Math.hypot(x, y), y / Math.hypot(x, y), 0];
      const away = [x - ring[0], y - ring[1], g.position[v * 3 + 2]];
      const n = [g.normal[v * 3], g.normal[v * 3 + 1], g.normal[v * 3 + 2]];
      assert.ok(n[0] * away[0] + n[1] * away[1] + n[2] * away[2] > 0);
    }
  });
});

describe('the environment', () => {
  it('stores half floats the way the GPU reads them', () => {
    for (const v of [0, 1, 0.5, 0.04, 1e-3, 65504]) assert.ok(Math.abs(fromHalf(toHalf(v)) - v) <= v * 1e-3);
    assert.equal(toHalf(1), 0x3c00);
  });

  /** However hard a uniform world is blurred, it is the same uniform world —
   *  so every rung of a solid grey environment has to come out that grey. */
  it('keeps a uniform environment uniform at every roughness', () => {
    const env = prefilter(solid(64, 32, [128, 128, 128]));
    assert.equal(env.width, 336);
    assert.equal(env.height, 64);
    assert.equal(env.maxMip, 4);
    const expected = srgbToLinear(128 / 255);
    for (let lod = 0; lod < 7; lod++) {
      for (let y = 0; y < 32; y++) {
        for (let x = lod * 48; x < lod * 48 + 48; x++) {
          const v = fromHalf(env.data[(y * env.width + x) * 4]);
          assert.ok(Math.abs(v - expected) < 2e-3, `rung ${lod} drifted to ${v} at ${x},${y}`);
        }
      }
    }
  });
});

describe('a frame', () => {
  function stage() {
    const scene = new Scene();
    const camera = new PerspectiveCamera(52, 16 / 9, 0.1, 100);
    camera.position.set(0, 0, -10);
    camera.lookAt({ x: 0, y: 0, z: 0 });
    return { scene, camera, builder: createFrameBuilder() };
  }

  it('draws what is solid first, then what is see-through from far to near', () => {
    const { scene, camera, builder } = stage();
    const glass = new BasicMaterial({ transparent: true, opacity: 0.5 });
    const near = new Mesh(plane(), glass);
    const far = new Mesh(plane(), glass);
    near.position.z = -5;
    far.position.z = 5;
    const solidOne = new Mesh(plane(), new StandardMaterial());
    scene.add(near, far, solidOne);
    const { list } = builder.build(scene, camera, { zeroToOne: false });
    assert.deepEqual(list.map((it) => it.node), [solidOne, far, near]);
  });

  it('leaves out anything hidden, or behind the camera', () => {
    const { scene, camera, builder } = stage();
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(new Mesh(plane(), new BasicMaterial()));
    const behind = new Mesh(plane(), new BasicMaterial());
    behind.position.z = -30;
    const seen = new Lines(octahedronEdges(1), new LineMaterial());
    scene.add(hidden, behind, seen);
    const { list } = builder.build(scene, camera, { zeroToOne: false });
    assert.deepEqual(list.map((it) => it.node), [seen]);
    assert.equal(list[0].lines, true);
  });

  it('reads a material’s opacity and glow every frame, and a clone keeps its own', () => {
    const { scene, camera, builder } = stage();
    const shared = new StandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1 });
    const own = shared.clone();
    scene.add(new Mesh(plane(), shared), new Mesh(plane(), own));
    own.emissiveIntensity = 3;
    const { list } = builder.build(scene, camera, { zeroToOne: false });
    const glow = list.map((it) => builder.draws[it.offset + DRAW.emissive]);
    assert.deepEqual(glow.sort(), [1, 3]);
  });
});
