import { DFG, DFG_SIZE } from './dfg.js';
import { DRAW, FRAME, stateKey, stateOf } from './frame.js';
import background from './shaders/background.wgsl?raw';
import basic from './shaders/basic.wgsl?raw';
import common from './shaders/common.wgsl?raw';
import lit from './shaders/lit.wgsl?raw';
import mipmap from './shaders/mipmap.wgsl?raw';

/**
 * The WebGPU backend. One pipeline layout serves every pipeline: the frame
 * block and the environment in group 0, a 256-byte slice of the draw buffer
 * in group 1 at a dynamic offset, and a material's three textures in group 2.
 * Pipelines are made the first time a combination of state is drawn, and
 * kept.
 *
 * The canvas is configured in a plain (not sRGB) format and the shaders
 * encode their own output, exactly as they do under WebGL — so blending
 * happens on the same numbers, and a translucent thing comes out the same
 * shade on either.
 */

const STRIDE = DRAW.stride * 4;
const DEPTH = 'depth24plus';

const VERTEX_BUFFERS = [
  { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
  { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
  { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
  { arrayStride: 12, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x3' }] },
];

const BLENDS = {
  none: undefined,
  normal: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  },
  additive: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  },
};

export async function createWebGPU(canvas, { clear, antialias }) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();

  /** Compile everything and look at the result before the canvas is
   *  claimed: a canvas that has handed out a WebGPU context can never hand
   *  out a WebGL one, so this is the last moment to change our minds. */
  const modules = {};
  for (const [name, code] of Object.entries({ lit, basic, background, mipmap })) {
    modules[name] = device.createShaderModule({ label: name, code: name === 'mipmap' ? code : `${common}\n${code}` });
    const info = await modules[name].getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) {
      device.destroy();
      throw new Error(`${name}.wgsl: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
    }
  }

  const context = canvas.getContext('webgpu');
  if (!context) {
    device.destroy();
    throw new Error('the canvas would not give a WebGPU context');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  device.addEventListener('uncapturederror', (event) => console.error('WebGPU:', event.error.message));
  device.lost.then((info) => console.error('WebGPU device lost:', info.message));

  const samples = antialias ? 4 : 1;
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const fragment = GPUShaderStage.FRAGMENT;

  const frameLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: both, buffer: { type: 'uniform' } },
      { binding: 1, visibility: fragment, texture: { sampleType: 'float' } },
      { binding: 2, visibility: fragment, sampler: { type: 'filtering' } },
      { binding: 3, visibility: fragment, texture: { sampleType: 'float' } },
    ],
  });
  const drawLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: both, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: STRIDE } }],
  });
  const materialLayout = device.createBindGroupLayout({
    entries: [0, 1, 2].flatMap((i) => [
      { binding: i * 2, visibility: fragment, texture: { sampleType: 'float' } },
      { binding: i * 2 + 1, visibility: fragment, sampler: { type: 'filtering' } },
    ]),
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, drawLayout, materialLayout] });

  const frameBuffer = device.createBuffer({ size: FRAME.size * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let drawBuffer = null;
  let drawGroup = null;

  function ensureDraws(bytes) {
    if (drawBuffer && drawBuffer.size >= bytes) return;
    const size = Math.max(bytes, (drawBuffer?.size ?? 0) * 2, STRIDE * 256);
    drawBuffer?.destroy();
    drawBuffer = device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    drawGroup = device.createBindGroup({
      layout: drawLayout,
      entries: [{ binding: 0, resource: { buffer: drawBuffer, size: STRIDE } }],
    });
  }

  const samplers = new Map();
  function sampler(wrapS = 'clamp', wrapT = 'clamp', anisotropy = 1, mipmapped = true) {
    const key = `${wrapS}|${wrapT}|${anisotropy}|${mipmapped}`;
    if (!samplers.has(key)) {
      const address = (mode) => (mode === 'repeat' ? 'repeat' : 'clamp-to-edge');
      samplers.set(key, device.createSampler({
        addressModeU: address(wrapS),
        addressModeV: address(wrapT),
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: mipmapped ? 'linear' : 'nearest',
        maxAnisotropy: Math.min(Math.max(Math.floor(anisotropy), 1), 16),
      }));
    }
    return samplers.get(key);
  }

  function dataTexture(texFormat, width, height, data, bytesPerTexel) {
    const tex = device.createTexture({
      size: [width, height],
      format: texFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: width * bytesPerTexel }, [width, height]);
    return tex;
  }

  const white = dataTexture('rgba8unorm', 1, 1, new Uint8Array([255, 255, 255, 255]), 4);
  const black = dataTexture('rgba16float', 1, 1, new Uint16Array(4), 8);
  const dfg = dataTexture('rg16float', DFG_SIZE, DFG_SIZE, DFG, 4);
  const clampLinear = sampler('clamp', 'clamp', 1, false);
  const environments = new WeakMap();
  const frameGroups = new WeakMap();
  let noEnvironmentGroup = null;

  function frameGroup(env) {
    const cached = env ? frameGroups.get(env) : noEnvironmentGroup;
    if (cached) return cached;
    let tex = black;
    if (env) {
      tex = dataTexture('rgba16float', env.width, env.height, env.data, 8);
      environments.set(env, tex);
    }
    const group = device.createBindGroup({
      layout: frameLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: tex.createView() },
        { binding: 2, resource: clampLinear },
        { binding: 3, resource: dfg.createView() },
      ],
    });
    if (env) frameGroups.set(env, group);
    else noEnvironmentGroup = group;
    return group;
  }

  /** Mipmaps, a level at a time, each drawn from the one above. */
  const mipPipelines = {};
  const mipSampler = sampler('clamp', 'clamp', 1, false);
  function generateMipmaps(encoder, tex) {
    const texFormat = tex.format;
    mipPipelines[texFormat] ??= device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: modules.mipmap, entryPoint: 'vs' },
      fragment: { module: modules.mipmap, entryPoint: 'fs', targets: [{ format: texFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    const pipeline = mipPipelines[texFormat];
    for (let level = 1; level < tex.mipLevelCount; level++) {
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: tex.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: mipSampler },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: tex.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    }
  }

  const textures = new WeakMap();
  function texture(encoder, source) {
    if (!source?.image) return null;
    let entry = textures.get(source);
    const { width, height } = source.image;
    if (entry && (entry.width !== width || entry.height !== height)) {
      entry.tex.destroy();
      entry = null;
    }
    if (!entry) {
      const tex = device.createTexture({
        size: [width, height],
        format: source.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
        mipLevelCount: Math.floor(Math.log2(Math.max(width, height))) + 1,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      entry = { tex, view: tex.createView(), width, height, version: -1 };
      textures.set(source, entry);
    }
    if (entry.version !== source.version) {
      device.queue.copyExternalImageToTexture(
        { source: source.image, flipY: false },
        { texture: entry.tex, premultipliedAlpha: false },
        [width, height],
      );
      generateMipmaps(encoder, entry.tex);
      entry.version = source.version;
    }
    return entry;
  }

  const whiteView = white.createView();

  /** A bind group for up to three textures, the missing ones white. */
  function textureGroup(encoder, given) {
    const sources = [0, 1, 2].map((i) => given[i] ?? null);
    const entries = sources.map((source) => texture(encoder, source));
    return {
      entries,
      group: device.createBindGroup({
        layout: materialLayout,
        entries: entries.flatMap((entry, i) => [
          { binding: i * 2, resource: entry ? entry.view : whiteView },
          { binding: i * 2 + 1, resource: entry ? sampler(sources[i].wrapS, sources[i].wrapT, sources[i].anisotropy) : clampLinear },
        ]),
      }),
    };
  }

  /** Kept per material, and rebuilt only if one of its textures had to be
   *  made again at a new size. */
  const materialGroups = new WeakMap();
  function materialGroup(encoder, owner, sources) {
    const cached = materialGroups.get(owner);
    if (cached) {
      const fresh = sources.map((source) => texture(encoder, source));
      if (fresh.every((entry, i) => entry === cached.entries[i])) return cached.group;
    }
    const made = textureGroup(encoder, sources);
    materialGroups.set(owner, made);
    return made.group;
  }

  const geometries = new WeakMap();
  function release(event) {
    const entry = geometries.get(event.target);
    if (!entry) return;
    for (const buffer of entry.buffers) buffer?.destroy();
    entry.index?.destroy();
    geometries.delete(event.target);
    event.target.removeEventListener('dispose', release);
  }

  function upload(data, usage) {
    const size = Math.ceil(data.byteLength / 4) * 4;
    const buffer = device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
    write(buffer, data);
    return buffer;
  }

  function write(buffer, data) {
    if (data.byteLength % 4 === 0) {
      device.queue.writeBuffer(buffer, 0, data);
    } else {
      const padded = new Uint8Array(Math.ceil(data.byteLength / 4) * 4);
      padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      device.queue.writeBuffer(buffer, 0, padded);
    }
  }

  const defaults = new Map();
  /** A constant attribute for a geometry that does not carry one: no normal,
   *  uv at the origin, white vertex colour. Shared by every geometry of the
   *  same vertex count. */
  function constant(location, count) {
    const key = `${location}:${count}`;
    if (!defaults.has(key)) {
      const size = location === 2 ? 2 : 3;
      const data = new Float32Array(count * size);
      if (location === 1) for (let i = 2; i < data.length; i += 3) data[i] = 1;
      if (location === 3) data.fill(1);
      defaults.set(key, upload(data, GPUBufferUsage.VERTEX));
    }
    return defaults.get(key);
  }

  function geometry(source) {
    let entry = geometries.get(source);
    const arrays = [source.position, source.normal, source.uv, source.color];
    if (entry && entry.version !== source.version) {
      arrays.forEach((data, i) => { if (data && entry.own[i]) write(entry.buffers[i], data); });
      entry.version = source.version;
    }
    if (entry) return entry;

    const count = source.count;
    const own = arrays.map((data) => Boolean(data));
    const buffers = arrays.map((data) => (data ? upload(data, GPUBufferUsage.VERTEX) : null));
    const bound = buffers.map((buffer, i) => buffer ?? constant(i, count));
    const index = source.index ? upload(source.index, GPUBufferUsage.INDEX) : null;
    entry = {
      buffers,
      bound,
      own,
      index,
      indexFormat: source.index instanceof Uint32Array ? 'uint32' : 'uint16',
      version: source.version,
    };
    geometries.set(source, entry);
    source.addEventListener('dispose', release);
    return entry;
  }

  const pipelines = new Map();
  function pipeline(state) {
    const key = stateKey(state);
    if (pipelines.has(key)) return pipelines.get(key);
    const module = modules[state.shader];
    const lines = state.topology === 'lines';
    const made = device.createRenderPipeline({
      label: key,
      layout,
      vertex: { module, entryPoint: 'vs', buffers: state.shader === 'background' ? [] : VERTEX_BUFFERS },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: BLENDS[state.blending] }] },
      primitive: {
        topology: lines ? 'line-list' : 'triangle-list',
        cullMode: state.cull,
        frontFace: 'ccw',
      },
      depthStencil: {
        format: DEPTH,
        depthWriteEnabled: state.depthTest && state.depthWrite,
        depthCompare: state.depthTest ? 'less-equal' : 'always',
        depthBias: lines ? 0 : state.biasUnits,
        depthBiasSlopeScale: lines ? 0 : state.biasFactor,
      },
      multisample: { count: samples },
    });
    pipelines.set(key, made);
    return made;
  }

  let colorTarget = null;
  let depthTarget = null;
  function targets() {
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    if (depthTarget && depthTarget.width === width && depthTarget.height === height) return;
    colorTarget?.destroy();
    depthTarget?.destroy();
    colorTarget = samples > 1
      ? device.createTexture({ size: [width, height], format, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT })
      : null;
    depthTarget = device.createTexture({ size: [width, height], format: DEPTH, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  const backgroundState = {
    shader: 'background', topology: 'triangles', cull: 'none', blending: 'none',
    depthTest: false, depthWrite: false, biasFactor: 0, biasUnits: 0,
  };

  return {
    name: 'webgpu',
    zeroToOne: true,

    render(frame, draws, list, scene) {
      targets();
      const encoder = device.createCommandEncoder();

      device.queue.writeBuffer(frameBuffer, 0, frame);
      const bytes = list.length * STRIDE;
      ensureDraws(bytes);
      if (bytes > 0) device.queue.writeBuffer(drawBuffer, 0, draws, 0, list.length * DRAW.stride);

      const env = frameGroup(scene.environment);
      const backdrop = scene.background?.image ? materialGroup(encoder, scene.background, [scene.background]) : null;
      const prepared = list.map((it) => ({
        pipeline: pipeline(stateOf(it.material, it.lines)),
        group: materialGroup(encoder, it.material, [it.material.map, it.material.emissiveMap, it.material.bumpMap]),
        geometry: geometry(it.node.geometry),
        source: it.node.geometry,
        offset: it.offset * 4,
      }));

      const view = context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: colorTarget ? colorTarget.createView() : view,
          resolveTarget: colorTarget ? view : undefined,
          clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
          loadOp: 'clear',
          storeOp: colorTarget ? 'discard' : 'store',
        }],
        depthStencilAttachment: {
          view: depthTarget.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      });
      pass.setBindGroup(0, env);

      if (backdrop) {
        pass.setPipeline(pipeline(backgroundState));
        pass.setBindGroup(1, drawGroup, [0]);
        pass.setBindGroup(2, backdrop);
        pass.draw(3);
      }

      for (const it of prepared) {
        pass.setPipeline(it.pipeline);
        pass.setBindGroup(1, drawGroup, [it.offset]);
        pass.setBindGroup(2, it.group);
        const g = it.geometry;
        for (let i = 0; i < 4; i++) pass.setVertexBuffer(i, g.bound[i]);
        if (g.index) {
          pass.setIndexBuffer(g.index, g.indexFormat);
          pass.drawIndexed(it.source.index.length);
        } else {
          pass.draw(it.source.count);
        }
      }

      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}
