import { DFG, DFG_SIZE } from './dfg.js';
import { DRAW, FRAME, stateOf } from './frame.js';
import backgroundFragment from './shaders/background.frag.glsl?raw';
import backgroundVertex from './shaders/background.vert.glsl?raw';
import basicFragment from './shaders/basic.frag.glsl?raw';
import basicVertex from './shaders/basic.vert.glsl?raw';
import common from './shaders/common.glsl?raw';
import litFragment from './shaders/lit.frag.glsl?raw';
import litVertex from './shaders/lit.vert.glsl?raw';

/**
 * The WebGL 2 backend. Uniforms go up as two std140 blocks — one for the
 * frame, and one big buffer of per-draw blocks bound a 256-byte range at a
 * time — so it reads exactly the bytes the WebGPU backend reads.
 */

const UNITS = { colorMap: 0, emissiveMap: 1, bumpMap: 2, envMap: 3, dfgLut: 4 };
const STRIDE = DRAW.stride * 4;

export function createWebGL(canvas, { clear, antialias }) {
  const gl = canvas.getContext('webgl2', {
    antialias,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL 2 is not available');
  if (gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) > STRIDE) {
    throw new Error('uniform buffer offsets are too coarse for 256-byte draw blocks');
  }

  const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');
  const maxAnisotropy = anisotropic ? gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;

  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, `#version 300 es\n${common}\n${source}`);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`shader did not compile: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  }

  function program(vertex, fragment) {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`program did not link: ${gl.getProgramInfoLog(p)}`);
    }
    for (const [name, binding] of [['Frame', 0], ['Draw', 1]]) {
      const block = gl.getUniformBlockIndex(p, name);
      if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, block, binding);
    }
    gl.useProgram(p);
    for (const [name, unit] of Object.entries(UNITS)) {
      const location = gl.getUniformLocation(p, name);
      if (location) gl.uniform1i(location, unit);
    }
    return p;
  }

  const programs = {
    lit: program(litVertex, litFragment),
    basic: program(basicVertex, basicFragment),
    background: program(backgroundVertex, backgroundFragment),
  };

  /** Attributes a geometry does not carry read these constants instead. */
  gl.vertexAttrib3f(1, 0, 0, 1);
  gl.vertexAttrib2f(2, 0, 0);
  gl.vertexAttrib3f(3, 1, 1, 1);

  const frameBuffer = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, frameBuffer);
  gl.bufferData(gl.UNIFORM_BUFFER, FRAME.size * 4, gl.DYNAMIC_DRAW);
  const drawBuffer = gl.createBuffer();
  let drawCapacity = 0;

  function dataTexture(internal, format, width, height, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, data instanceof Uint16Array ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  const white = dataTexture(gl.RGBA8, gl.RGBA, 1, 1, new Uint8Array([255, 255, 255, 255]));
  const black = dataTexture(gl.RGBA16F, gl.RGBA, 1, 1, new Uint16Array(4));
  const dfg = dataTexture(gl.RG16F, gl.RG, DFG_SIZE, DFG_SIZE, DFG);
  const environments = new WeakMap();

  function environment(env) {
    if (!env) return black;
    if (!environments.has(env)) environments.set(env, dataTexture(gl.RGBA16F, gl.RGBA, env.width, env.height, env.data));
    return environments.get(env);
  }

  const textures = new WeakMap();

  function texture(source) {
    if (!source?.image) return white;
    let entry = textures.get(source);
    if (!entry) {
      entry = { tex: gl.createTexture(), version: -1 };
      textures.set(source, entry);
    }
    if (entry.version !== source.version) {
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, source.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source.image);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (entry.version < 0) {
        const wrap = (mode) => (mode === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(source.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(source.wrapT));
        if (anisotropic && source.anisotropy > 1) {
          gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(source.anisotropy, maxAnisotropy));
        }
      }
      entry.version = source.version;
    }
    return entry.tex;
  }

  const geometries = new WeakMap();

  function release(event) {
    const entry = geometries.get(event.target);
    if (!entry) return;
    gl.deleteVertexArray(entry.vao);
    for (const buffer of entry.buffers) gl.deleteBuffer(buffer);
    geometries.delete(event.target);
    event.target.removeEventListener('dispose', release);
  }

  /** Attribute name, shader location, and floats per vertex. */
  const ATTRIBUTES = [['position', 0, 3], ['normal', 1, 3], ['uv', 2, 2], ['color', 3, 3]];

  function geometry(source) {
    let entry = geometries.get(source);
    if (entry && entry.version !== source.version) {
      for (const [buffer, name] of entry.attributes) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, source[name]);
      }
      entry.version = source.version;
    }
    if (entry) return entry;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = [];
    const attributes = [];
    for (const [name, location, size] of ATTRIBUTES) {
      if (!source[name]) continue;
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, source[name], gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      buffers.push(buffer);
      attributes.push([buffer, name]);
    }
    let indexType = 0;
    if (source.index) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, source.index, gl.STATIC_DRAW);
      buffers.push(buffer);
      indexType = source.index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
    gl.bindVertexArray(null);

    entry = { vao, buffers, attributes, indexType, version: source.version };
    geometries.set(source, entry);
    source.addEventListener('dispose', release);
    return entry;
  }

  const current = {};

  function apply(state) {
    if (current.cull !== state.cull) {
      if (state.cull === 'none') gl.disable(gl.CULL_FACE);
      else {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(state.cull === 'front' ? gl.FRONT : gl.BACK);
      }
      current.cull = state.cull;
    }
    if (current.blending !== state.blending) {
      if (state.blending === 'none') gl.disable(gl.BLEND);
      else {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        if (state.blending === 'additive') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
        else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      current.blending = state.blending;
    }
    if (current.depthTest !== state.depthTest) {
      if (state.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      current.depthTest = state.depthTest;
    }
    if (current.depthWrite !== state.depthWrite) {
      gl.depthMask(state.depthWrite);
      current.depthWrite = state.depthWrite;
    }
    const bias = state.biasFactor !== 0 || state.biasUnits !== 0;
    if (current.bias !== bias || (bias && (current.biasFactor !== state.biasFactor || current.biasUnits !== state.biasUnits))) {
      if (bias) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(state.biasFactor, state.biasUnits);
      } else gl.disable(gl.POLYGON_OFFSET_FILL);
      current.bias = bias;
      current.biasFactor = state.biasFactor;
      current.biasUnits = state.biasUnits;
    }
  }

  function bind(unit, tex) {
    if (current[`unit${unit}`] === tex) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    current[`unit${unit}`] = tex;
  }

  function use(p) {
    if (current.program === p) return;
    gl.useProgram(p);
    current.program = p;
  }

  gl.depthFunc(gl.LEQUAL);
  gl.frontFace(gl.CCW);

  return {
    name: 'webgl',
    zeroToOne: false,

    render(frame, draws, list, scene) {
      for (const key of Object.keys(current)) delete current[key];

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(clear[0], clear[1], clear[2], 1);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.bindBuffer(gl.UNIFORM_BUFFER, frameBuffer);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, frame);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, frameBuffer);

      const bytes = list.length * STRIDE;
      gl.bindBuffer(gl.UNIFORM_BUFFER, drawBuffer);
      if (bytes > drawCapacity) {
        drawCapacity = Math.max(bytes, drawCapacity * 2, STRIDE * 256);
        gl.bufferData(gl.UNIFORM_BUFFER, drawCapacity, gl.DYNAMIC_DRAW);
      }
      if (bytes > 0) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, draws, 0, list.length * DRAW.stride);

      /** Textures first, so their uploads do not disturb the units bound
       *  for drawing. */
      const env = environment(scene.environment);
      const background = scene.background?.image ? texture(scene.background) : null;
      for (const it of list) {
        const m = it.material;
        texture(m.map);
        if (m.shader === 'lit') {
          texture(m.emissiveMap);
          texture(m.bumpMap);
        }
      }

      bind(UNITS.envMap, env);
      bind(UNITS.dfgLut, dfg);

      if (background) {
        use(programs.background);
        apply({ cull: 'none', blending: 'none', depthTest: false, depthWrite: false, biasFactor: 0, biasUnits: 0 });
        bind(UNITS.colorMap, background);
        gl.bindVertexArray(null);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      for (const it of list) {
        const m = it.material;
        const state = stateOf(m, it.lines);
        use(programs[m.shader]);
        apply(state);
        bind(UNITS.colorMap, texture(m.map));
        if (m.shader === 'lit') {
          bind(UNITS.emissiveMap, texture(m.emissiveMap));
          bind(UNITS.bumpMap, texture(m.bumpMap));
        }
        gl.bindBufferRange(gl.UNIFORM_BUFFER, 1, drawBuffer, it.offset * 4, STRIDE);

        const g = it.node.geometry;
        const entry = geometry(g);
        gl.bindVertexArray(entry.vao);
        const mode = it.lines ? gl.LINES : gl.TRIANGLES;
        if (g.index) gl.drawElements(mode, g.index.length, entry.indexType, 0);
        else gl.drawArrays(mode, 0, g.count);
      }
      gl.bindVertexArray(null);
    },
  };
}
