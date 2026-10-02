import { linear } from './color.js';

/**
 * What a surface is made of, as plain data the renderer turns into uniforms.
 * There are three shaders behind these — lit, unlit, and the backdrop — and a
 * material only says which one it wants and what to feed it.
 *
 * Colours are given as theme hex and held decoded to linear light. Opacity
 * and emissive intensity are read every frame, so they can be animated; the
 * rest is read once and should be treated as fixed.
 */

let ids = 0;

const COMMON = {
  transparent: false,
  opacity: 1,
  /** 'normal' or 'additive'. Normal blending only blends when transparent. */
  blending: 'normal',
  depthTest: true,
  depthWrite: true,
  /** 'front', 'back' or 'double': which faces are drawn. */
  side: 'front',
  fog: true,
  toneMapped: true,
  polygonOffset: false,
  polygonOffsetFactor: 0,
  polygonOffsetUnits: 0,
};

const COLOURS = new Set(['color', 'emissive', 'sheenColor']);

class Material {
  constructor(shader, defaults, params) {
    this.id = ids++;
    this.shader = shader;
    Object.assign(this, COMMON, defaults);
    for (const [key, value] of Object.entries(params)) {
      this[key] = COLOURS.has(key) ? linear(value) : value;
    }
    for (const key of COLOURS) {
      if (typeof this[key] === 'number' || typeof this[key] === 'string') this[key] = linear(this[key]);
    }
  }

  /** The same material, as a separate thing to animate. */
  clone() {
    const copy = Object.create(Object.getPrototypeOf(this));
    Object.assign(copy, this, { id: ids++ });
    for (const key of COLOURS) if (Array.isArray(this[key])) copy[key] = [...this[key]];
    return copy;
  }
}

/** Unlit: a colour, optionally a texture, optionally vertex colours. */
export class BasicMaterial extends Material {
  constructor(params = {}) {
    super('basic', { color: 0xffffff, map: null, vertexColors: false }, params);
  }
}

/** Unlit, for one-pixel lines. */
export class LineMaterial extends Material {
  constructor(params = {}) {
    super('basic', { color: 0xffffff, map: null, vertexColors: false }, params);
  }
}

/** Metal/rough PBR, lit by the scene's lights and its environment. */
export class StandardMaterial extends Material {
  constructor(params = {}) {
    super('lit', {
      color: 0xffffff,
      map: null,
      roughness: 1,
      metalness: 0,
      emissive: 0x000000,
      emissiveIntensity: 1,
      emissiveMap: null,
      bumpMap: null,
      bumpScale: 1,
      clearcoat: 0,
      clearcoatRoughness: 0,
      sheen: 0,
      sheenColor: 0x000000,
      sheenRoughness: 1,
    }, params);
  }
}

/** Standard, plus a clear lacquer over the top and a soft sheen at the edges. */
export class PhysicalMaterial extends StandardMaterial {}
