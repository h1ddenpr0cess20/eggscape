import { display, linear } from './color.js';
import { DirectionalLight, HemisphereLight, Lines, Mesh } from './graph.js';
import { frustum, mat4, maxScale, multiply, normalMatrix, perspective } from './math.js';

/**
 * One frame's worth of decisions, made once and handed to whichever backend
 * is drawing: what is visible, in what order, and the exact bytes of every
 * uniform block. The two backends only differ in how they say "draw this";
 * nothing they draw is worked out twice, so they cannot disagree.
 *
 * The uniform layouts below are written out a second time in `shaders/` —
 * in GLSL as std140 blocks and in WGSL as structs — using nothing but vec4
 * and mat4 so the two languages lay them out identically. The offsets here
 * are in floats.
 */

export const FRAME = {
  projection: 0,
  view: 16,
  fogColor: 32,
  fogParams: 36,
  hemiSky: 40,
  hemiGround: 44,
  hemiDirection: 48,
  lightDirection: 52,
  lightColor: 68,
  envParams: 84,
  counts: 88,
  size: 92,
};

export const DRAW = {
  modelView: 0,
  normalMatrix: 16,
  color: 32,
  emissive: 36,
  surface: 40,
  coat: 44,
  sheen: 48,
  flags: 52,
  /** Every draw gets a 256-byte slot, which is the offset alignment both
   *  APIs guarantee for binding a range of a uniform buffer. */
  stride: 64,
};

export const MAX_LIGHTS = 4;

const TONE_MAPPING = { none: 0, aces: 1 };

/**
 * Pipeline state for a material on a kind of primitive — everything that has
 * to be fixed before a draw rather than fed in as a uniform.
 */
export function stateOf(material, lines) {
  const blending = material.blending === 'additive'
    ? 'additive'
    : material.transparent ? 'normal' : 'none';
  return {
    shader: material.shader,
    topology: lines ? 'lines' : 'triangles',
    cull: lines || material.side === 'double' ? 'none' : material.side === 'back' ? 'front' : 'back',
    blending,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    /** Polygon offset moves filled triangles only, never lines. */
    biasFactor: !lines && material.polygonOffset ? material.polygonOffsetFactor : 0,
    biasUnits: !lines && material.polygonOffset ? material.polygonOffsetUnits : 0,
  };
}

export function stateKey(s) {
  return `${s.shader}|${s.topology}|${s.cull}|${s.blending}|${s.depthTest}|${s.depthWrite}|${s.biasFactor}|${s.biasUnits}`;
}

/** Opaque first and near to far; then see-through, far to near. */
function opaqueOrder(a, b) {
  return a.node.renderOrder - b.node.renderOrder
    || a.material.id - b.material.id
    || a.z - b.z
    || a.node.id - b.node.id;
}

function transparentOrder(a, b) {
  return a.node.renderOrder - b.node.renderOrder
    || b.z - a.z
    || a.node.id - b.node.id;
}

export function createFrameBuilder() {
  const frame = new Float32Array(FRAME.size);
  let draws = new Float32Array(DRAW.stride * 256);

  const view = mat4();
  const projection = mat4();
  const cull = mat4();
  const modelView = mat4();
  const normals = mat4();
  const planes = Array.from({ length: 6 }, () => new Float64Array(4));
  const opaque = [];
  const transparent = [];
  const hemis = [];
  const directionals = [];
  const pool = [];
  let used = 0;

  function item() {
    if (used === pool.length) pool.push({});
    return pool[used++];
  }

  function visible(node) {
    if (!node.frustumCulled) return true;
    const { center, radius } = node.geometry.boundingSphere;
    const m = node.matrixWorld;
    const x = m[0] * center[0] + m[4] * center[1] + m[8] * center[2] + m[12];
    const y = m[1] * center[0] + m[5] * center[1] + m[9] * center[2] + m[13];
    const z = m[2] * center[0] + m[6] * center[1] + m[10] * center[2] + m[14];
    const r = -radius * maxScale(m);
    for (const p of planes) if (p[0] * x + p[1] * y + p[2] * z + p[3] < r) return false;
    return true;
  }

  function collect(node) {
    if (!node.visible) return;
    if (node instanceof Mesh) {
      if (node.geometry && node.material && visible(node)) {
        const { center } = node.geometry.boundingSphere;
        const m = node.matrixWorld;
        const wx = m[0] * center[0] + m[4] * center[1] + m[8] * center[2] + m[12];
        const wy = m[1] * center[0] + m[5] * center[1] + m[9] * center[2] + m[13];
        const wz = m[2] * center[0] + m[6] * center[1] + m[10] * center[2] + m[14];
        const it = item();
        it.node = node;
        it.material = node.material;
        it.lines = node instanceof Lines;
        /** Distance in front of the camera, for sorting. */
        it.z = -(view[2] * wx + view[6] * wy + view[10] * wz + view[14]);
        (node.material.transparent ? transparent : opaque).push(it);
      }
    } else if (node instanceof HemisphereLight) {
      hemis.push(node);
    } else if (node instanceof DirectionalLight) {
      directionals.push(node);
    }
    for (const child of node.children) collect(child);
  }

  /** A direction through the view's rotation, normalised. */
  function toView(out, at, x, y, z) {
    const vx = view[0] * x + view[4] * y + view[8] * z;
    const vy = view[1] * x + view[5] * y + view[9] * z;
    const vz = view[2] * x + view[6] * y + view[10] * z;
    const len = Math.hypot(vx, vy, vz) || 1;
    out[at] = vx / len;
    out[at + 1] = vy / len;
    out[at + 2] = vz / len;
  }

  function writeLights() {
    frame.fill(0, FRAME.hemiSky, FRAME.envParams);
    const hemi = hemis[0];
    if (hemi) {
      frame.set(linear(hemi.skyColor, hemi.intensity), FRAME.hemiSky);
      frame.set(linear(hemi.groundColor, hemi.intensity), FRAME.hemiGround);
      frame[FRAME.hemiSky + 3] = 1;
      const m = hemi.matrixWorld;
      toView(frame, FRAME.hemiDirection, m[12], m[13], m[14]);
    }
    const count = Math.min(directionals.length, MAX_LIGHTS);
    for (let i = 0; i < count; i++) {
      const light = directionals[i];
      const m = light.matrixWorld;
      const t = light.target.matrixWorld;
      toView(frame, FRAME.lightDirection + i * 4, m[12] - t[12], m[13] - t[13], m[14] - t[14]);
      frame.set(linear(light.color, light.intensity), FRAME.lightColor + i * 4);
    }
    return count;
  }

  function writeDraw(it, offset) {
    const { node, material } = it;
    multiply(modelView, view, node.matrixWorld);
    normalMatrix(normals, modelView);
    draws.set(modelView, offset + DRAW.modelView);
    draws.set(normals, offset + DRAW.normalMatrix);

    const c = material.color;
    draws[offset + DRAW.color] = c[0];
    draws[offset + DRAW.color + 1] = c[1];
    draws[offset + DRAW.color + 2] = c[2];
    draws[offset + DRAW.color + 3] = material.opacity;

    if (material.shader === 'lit') {
      const e = material.emissive;
      const k = material.emissiveIntensity;
      draws[offset + DRAW.emissive] = e[0] * k;
      draws[offset + DRAW.emissive + 1] = e[1] * k;
      draws[offset + DRAW.emissive + 2] = e[2] * k;
      draws[offset + DRAW.surface] = material.roughness;
      draws[offset + DRAW.surface + 1] = material.metalness;
      draws[offset + DRAW.surface + 2] = material.bumpMap ? material.bumpScale : 0;
      draws[offset + DRAW.surface + 3] = material.clearcoat;
      draws[offset + DRAW.coat] = material.clearcoatRoughness;
      draws[offset + DRAW.coat + 1] = material.sheenRoughness;
      const s = material.sheenColor;
      draws[offset + DRAW.sheen] = s[0] * material.sheen;
      draws[offset + DRAW.sheen + 1] = s[1] * material.sheen;
      draws[offset + DRAW.sheen + 2] = s[2] * material.sheen;
      draws[offset + DRAW.sheen + 3] = material.sheen > 0 ? 1 : 0;
    }

    draws[offset + DRAW.flags] = material.fog ? 1 : 0;
    draws[offset + DRAW.flags + 1] = material.toneMapped ? 1 : 0;
    draws[offset + DRAW.flags + 2] = !material.transparent && material.blending === 'normal' ? 1 : 0;
    draws[offset + DRAW.flags + 3] = material.vertexColors ? 1 : 0;
  }

  return {
    frame,
    get draws() { return draws; },

    /**
     * Everything the backend needs to draw `scene` from `camera`: the frame
     * block filled in, the draw blocks packed in draw order, and the list of
     * what to draw. `zeroToOne` is the clip-space depth range of the API.
     */
    build(scene, camera, { zeroToOne, toneMapping = 'none', exposure = 1 }) {
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      view.set(camera.matrixWorldInverse);
      perspective(projection, camera.fov, camera.aspect, camera.near, camera.far, zeroToOne);
      multiply(cull, camera.projectionMatrix, view);
      frustum(planes, cull);

      used = 0;
      opaque.length = 0;
      transparent.length = 0;
      hemis.length = 0;
      directionals.length = 0;
      collect(scene);
      opaque.sort(opaqueOrder);
      transparent.sort(transparentOrder);

      frame.set(projection, FRAME.projection);
      frame.set(view, FRAME.view);
      const fog = scene.fog;
      if (fog) frame.set([...display(fog.color), 1], FRAME.fogColor);
      else frame.fill(0, FRAME.fogColor, FRAME.fogColor + 4);
      frame[FRAME.fogParams] = fog ? fog.near : 0;
      frame[FRAME.fogParams + 1] = fog ? fog.far : 1;
      frame[FRAME.fogParams + 2] = exposure;
      frame[FRAME.fogParams + 3] = TONE_MAPPING[toneMapping] ?? 0;
      const lights = writeLights();
      const env = scene.environment;
      frame[FRAME.envParams] = env ? env.texelWidth : 0;
      frame[FRAME.envParams + 1] = env ? env.texelHeight : 0;
      frame[FRAME.envParams + 2] = env ? env.maxMip : 0;
      frame[FRAME.envParams + 3] = env ? 1 : 0;
      frame[FRAME.counts] = lights;
      frame[FRAME.counts + 1] = scene.backgroundIntensity;

      const list = [...opaque, ...transparent];
      const needed = list.length * DRAW.stride;
      if (needed > draws.length) {
        let size = draws.length;
        while (size < needed) size *= 2;
        draws = new Float32Array(size);
      }
      list.forEach((it, i) => {
        it.offset = i * DRAW.stride;
        writeDraw(it, it.offset);
      });

      return { list, count: list.length };
    },
  };
}
