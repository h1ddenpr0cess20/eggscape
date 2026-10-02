import { srgbToLinear } from './color.js';

/**
 * Prefiltered environment lighting, from a small equirectangular canvas.
 *
 * A rough surface reflects a blurred world, and how blurred depends on how
 * rough: so the environment is filtered once, at boot, into a ladder of
 * progressively blurrier copies, and the lit shader picks a rung by
 * roughness. The layout is a "cube UV" atlas — the six faces of a small cube
 * map laid out three across and two down, one block per rung, with a texel
 * of padding round every face so a bilinear lookup never needs to know which
 * face is next door.
 *
 * Every step here — the face layout, the padding, the GGX importance
 * sampling, the order the rungs are built in — is the same as the
 * environment this game was lit by before it drew its own pixels, so the
 * shell keeps the light it was designed under. It runs on the CPU because the
 * cube is sixteen texels a side and a run of it costs less than compiling the
 * shaders a GPU pass would need.
 */

const LOD_MIN = 4;
const EXTRA_LODS = 6;
const GGX_SAMPLES = 256;

/** Round to the nearest half float, which is what the atlas is stored as. */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toHalf(value) {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    if ((mant >> (shift - 1)) & 1) half += 1;
    return sign | half;
  }
  if (exp >= 31) return sign | 0x7c00;
  let half = sign | (exp << 10) | (mant >> 13);
  if (mant & 0x1000) half += 1;
  return half;
}

export function fromHalf(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

const quantise = (value) => fromHalf(toHalf(value));

/** The source picture as linear floats, rows from the bottom, with its
 *  mipmap chain — the lookup into it picks a level by screen footprint. */
function sourceLevels({ width, height, data: pixels }) {
  const decode = new Float32Array(256);
  for (let i = 0; i < 256; i++) decode[i] = srgbToLinear(i / 255);

  const base = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const from = (row * width + x) * 4;
      const to = (y * width + x) * 3;
      base[to] = decode[pixels[from]];
      base[to + 1] = decode[pixels[from + 1]];
      base[to + 2] = decode[pixels[from + 2]];
    }
  }

  const levels = [{ data: base, width, height }];
  for (let w = width, h = height; w > 1 || h > 1;) {
    const prev = levels[levels.length - 1];
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    const data = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(x * 2, prev.width - 1), x1 = Math.min(x * 2 + 1, prev.width - 1);
        const y0 = Math.min(y * 2, prev.height - 1), y1 = Math.min(y * 2 + 1, prev.height - 1);
        for (let c = 0; c < 3; c++) {
          data[(y * w + x) * 3 + c] = 0.25 * (
            prev.data[(y0 * prev.width + x0) * 3 + c] + prev.data[(y0 * prev.width + x1) * 3 + c]
            + prev.data[(y1 * prev.width + x0) * 3 + c] + prev.data[(y1 * prev.width + x1) * 3 + c]);
        }
      }
    }
    levels.push({ data, width: w, height: h });
  }
  return levels;
}

function bilinear(level, u, v, out, weight) {
  const { data, width, height } = level;
  const x = u * width - 0.5;
  const y = v * height - 0.5;
  const fx = Math.floor(x), fy = Math.floor(y);
  const tx = x - fx, ty = y - fy;
  const x0 = Math.min(Math.max(fx, 0), width - 1), x1 = Math.min(Math.max(fx + 1, 0), width - 1);
  const y0 = Math.min(Math.max(fy, 0), height - 1), y1 = Math.min(Math.max(fy + 1, 0), height - 1);
  const a = (y0 * width + x0) * 3, b = (y0 * width + x1) * 3;
  const c = (y1 * width + x0) * 3, d = (y1 * width + x1) * 3;
  for (let k = 0; k < 3; k++) {
    const top = data[a + k] + (data[b + k] - data[a + k]) * tx;
    const bottom = data[c + k] + (data[d + k] - data[c + k]) * tx;
    out[k] += (top + (bottom - top) * ty) * weight;
  }
}

function equirectUv(x, y, z, out) {
  const len = Math.hypot(x, y, z);
  out[0] = Math.atan2(z / len, x / len) / (2 * Math.PI) + 0.5;
  out[1] = Math.asin(Math.min(Math.max(y / len, -1), 1)) / Math.PI + 0.5;
}

/** Which way a texel of a face points, from its uv across that face. */
function direction(u, v, face, out) {
  u = 2 * u - 1;
  v = 2 * v - 1;
  switch (face) {
    case 0: out[0] = 1; out[1] = v; out[2] = u; break;
    case 1: out[0] = -u; out[1] = 1; out[2] = -v; break;
    case 2: out[0] = -u; out[1] = v; out[2] = 1; break;
    case 3: out[0] = -1; out[1] = v; out[2] = -u; break;
    case 4: out[0] = -u; out[1] = -1; out[2] = v; break;
    default: out[0] = u; out[1] = v; out[2] = -1;
  }
}

function radicalInverse(bits) {
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10;
}

/**
 * The GGX kernel for one rung, as taps on the hemisphere round +z.
 *
 * Half vectors are importance-sampled from the GGX distribution of visible
 * normals for a view straight down the normal (Heitz 2018), on a Hammersley
 * set. With the view along the normal, each half vector reflects into a light
 * direction whose height above the surface depends on nothing but the sample
 * — so the reflection, the horizon test and the cosine weight are all worked
 * out here, once, and a tap is just the light direction in the tangent frame.
 */
function ggxKernel(roughness) {
  const alpha = roughness * roughness;
  const taps = [];
  let total = 0;
  for (let i = 0; i < GGX_SAMPLES; i++) {
    const r = Math.sqrt(i / GGX_SAMPLES);
    const phi = 2 * Math.PI * radicalInverse(i);
    const t1 = r * Math.cos(phi);
    const t2 = r * Math.sin(phi);
    const nz = Math.sqrt(Math.max(0, 1 - t1 * t1 - t2 * t2));
    const hx = alpha * t1, hy = alpha * t2, hz = Math.max(0, nz);
    const len = Math.sqrt(hx * hx + hy * hy + hz * hz);
    const x = hx / len, y = hy / len, z = hz / len;
    /** L = 2(N·H)H − N, and N·H is the half vector's own height. */
    const lz = 2 * z * z - 1;
    if (lz <= 0) continue;
    taps.push(2 * z * x, 2 * z * y, lz);
    total += lz;
  }
  return { taps: new Float64Array(taps), total };
}

/**
 * The atlas lookup the shaders use, ported line for line: pick the face the
 * direction leaves the cube through, find the texel on it, step over to the
 * rung's block, and filter between the four nearest texels.
 */
function lookup(target, { width, cubeSize }, x, y, z, mipInt, out, weight) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face, u, v;
  if (ax > az && ax > ay) {
    face = x > 0 ? 0 : 3;
    u = (x > 0 ? z : -z) / ax;
    v = y / ax;
  } else if (ax > az || ay >= az) {
    face = y > 0 ? 1 : 4;
    u = -x / ay;
    v = (y > 0 ? -z : z) / ay;
  } else {
    face = z > 0 ? 2 : 5;
    u = (z > 0 ? -x : x) / az;
    v = y / az;
  }

  const filterInt = mipInt < LOD_MIN ? LOD_MIN - mipInt : 0;
  const faceSize = mipInt > LOD_MIN ? 1 << mipInt : 1 << LOD_MIN;
  const half = (faceSize - 2) * 0.5;
  let col = face, row = 0;
  if (face > 2) {
    col -= 3;
    row = faceSize;
  }
  /** Texel-space position less the half texel a linear filter centres on. */
  const px = (u + 1) * half + 0.5 + col * faceSize + filterInt * 48;
  const py = (v + 1) * half + 0.5 + row + 4 * (cubeSize - faceSize);

  const fx = Math.floor(px), fy = Math.floor(py);
  const tx = px - fx, ty = py - fy;
  const a = (fy * width + fx) * 3;
  const c = a + width * 3;
  const top0 = target[a] + (target[a + 3] - target[a]) * tx;
  const top1 = target[a + 1] + (target[a + 4] - target[a + 1]) * tx;
  const top2 = target[a + 2] + (target[a + 5] - target[a + 2]) * tx;
  const bot0 = target[c] + (target[c + 3] - target[c]) * tx;
  const bot1 = target[c + 1] + (target[c + 4] - target[c + 1]) * tx;
  const bot2 = target[c + 2] + (target[c + 5] - target[c + 2]) * tx;
  out[0] += (top0 + (bot0 - top0) * ty) * weight;
  out[1] += (top1 + (bot1 - top1) * ty) * weight;
  out[2] += (top2 + (bot2 - top2) * ty) * weight;
}

/**
 * One GGX-filtered texel: the kernel turned to face the texel's direction,
 * every tap looked up in the rung below and weighted by how square-on it
 * arrives. The lookup is `lookup` again, inlined by hand — this loop runs a
 * couple of million times at boot, and a call per tap was most of the cost.
 */
function gather(atlas, { width, cubeSize }, mipIn, { taps, total }, dir, out) {
  const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  const nx = dir[0] / len, ny = dir[1] / len, nz = dir[2] / len;
  const side = Math.abs(nz) < 0.999;
  const ux = side ? 0 : 1, uz = side ? 1 : 0;
  let tx = -uz * ny, ty = uz * nx - ux * nz, tz = ux * ny;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;

  const filterInt = mipIn < LOD_MIN ? LOD_MIN - mipIn : 0;
  const faceSize = mipIn > LOD_MIN ? 1 << mipIn : 1 << LOD_MIN;
  const half = (faceSize - 2) * 0.5;
  const baseX = 0.5 + filterInt * 48;
  const baseY = 0.5 + 4 * (cubeSize - faceSize);
  const stride = width * 3;

  let r = 0, g = 0, b = 0;
  for (let i = 0; i < taps.length; i += 3) {
    const ta = taps[i], tb = taps[i + 1], w = taps[i + 2];
    const x = ta * tx + tb * bx + w * nx;
    const y = ta * ty + tb * by + w * ny;
    const z = ta * tz + tb * bz + w * nz;
    const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y, az = z < 0 ? -z : z;
    let u, v, col, row;
    if (ax > az && ax > ay) {
      const inv = 1 / ax;
      u = (x > 0 ? z : -z) * inv; v = y * inv;
      col = 0; row = x > 0 ? 0 : faceSize;
    } else if (ax > az || ay >= az) {
      const inv = 1 / ay;
      u = -x * inv; v = (y > 0 ? -z : z) * inv;
      col = faceSize; row = y > 0 ? 0 : faceSize;
    } else {
      const inv = 1 / az;
      u = (z > 0 ? -x : x) * inv; v = y * inv;
      col = 2 * faceSize; row = z > 0 ? 0 : faceSize;
    }
    const px = (u + 1) * half + baseX + col;
    const py = (v + 1) * half + baseY + row;
    const fx = px | 0, fy = py | 0;
    const sx = px - fx, sy = py - fy;
    const at = fy * stride + fx * 3;
    const below = at + stride;
    const t0 = atlas[at] + (atlas[at + 3] - atlas[at]) * sx;
    const t1 = atlas[at + 1] + (atlas[at + 4] - atlas[at + 1]) * sx;
    const t2 = atlas[at + 2] + (atlas[at + 5] - atlas[at + 2]) * sx;
    const b0 = atlas[below] + (atlas[below + 3] - atlas[below]) * sx;
    const b1 = atlas[below + 1] + (atlas[below + 4] - atlas[below + 1]) * sx;
    const b2 = atlas[below + 2] + (atlas[below + 5] - atlas[below + 2]) * sx;
    r += (t0 + (b0 - t0) * sy) * w;
    g += (t1 + (b1 - t1) * sy) * w;
    b += (t2 + (b2 - t2) * sy) * w;
  }
  out[0] = r / total;
  out[1] = g / total;
  out[2] = b / total;
}

/**
 * Filters `canvas` — an equirectangular picture of the surroundings, sky at
 * the top — into an atlas the lit shader can sample. Returns the atlas as
 * half floats with the numbers the shader needs to find its way round it.
 */
export function prefilter(canvas) {
  const { width, height } = canvas;
  return prefilterPixels(canvas.getContext('2d').getImageData(0, 0, width, height));
}

/**
 * The same, off the main thread: a worker does the filtering while the rest
 * of the page boots and the GPU starts, and the environment handed back says
 * `ready: false` until it lands. The renderer holds its first frame until
 * then, so nothing is ever drawn under the wrong light. A browser that will
 * not start the worker gets it done here instead, as it always used to be.
 */
export function prefilterInBackground(canvas) {
  const { width, height } = canvas;
  const image = canvas.getContext('2d').getImageData(0, 0, width, height);
  const env = { ready: false };
  const land = (result) => Object.assign(env, result, { ready: true });
  let worker = null;
  try {
    worker = new Worker(new URL('./environment.worker.js', import.meta.url), { type: 'module' });
  } catch {
    return land(prefilterPixels(image));
  }
  worker.onmessage = ({ data }) => {
    land(data);
    worker.terminate();
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    if (!env.ready) land(prefilterPixels(image));
    worker.terminate();
  };
  worker.postMessage({ width, height, data: image.data });
  return env;
}

/** `prefilter`, from the picture's pixels: `{ width, height, data }`. */
export function prefilterPixels(image) {
  const lodMax = Math.floor(Math.log2(image.width / 4));
  const cubeSize = 2 ** lodMax;
  const width = 3 * Math.max(cubeSize, 16 * 7);
  const height = 4 * cubeSize;
  const texelWidth = 1 / width;
  const texelHeight = 1 / height;

  const sizes = [];
  for (let i = 0, lod = lodMax; i < lodMax - LOD_MIN + 1 + EXTRA_LODS; i++) {
    sizes.push(2 ** lod);
    if (lod > LOD_MIN) lod--;
  }
  const lods = sizes.length;

  const atlas = new Float32Array(width * height * 3);
  const pingpong = new Float32Array(width * height * 3);
  const sample = [0, 0, 0];

  const layout = { width, height, cubeSize };
  const cubeUV = (target, x, y, z, mipInt, out, weight) => lookup(target, layout, x, y, z, mipInt, out, weight);

  /**
   * Every texel of one rung, face by face, as the GPU would rasterise it:
   * texel centres across a quad whose uv runs a padding texel past both
   * edges of the face, so the border texels point into the neighbours.
   */
  function rasterise(lod, shade) {
    const size = sizes[lod];
    const ox = 3 * size * (lod > lodMax - LOD_MIN ? lod - lodMax + LOD_MIN : 0);
    const oy = 4 * (cubeSize - size);
    const pad = 1 / (size - 2);
    const dir = [0, 0, 0];
    for (let face = 0; face < 6; face++) {
      const fx = ox + (face % 3) * size;
      const fy = oy + (face > 2 ? size : 0);
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const u = -pad + ((px + 0.5) / size) * (1 + 2 * pad);
          const v = -pad + ((py + 0.5) / size) * (1 + 2 * pad);
          direction(u, v, face, dir);
          shade((fy + py) * width + fx + px, dir, face, px, py, size, pad);
        }
      }
    }
  }

  /** Rung 0: the picture itself, looked up the way a GPU would, with the
   *  mip level picked from the footprint of each 2×2 block of texels. */
  const source = sourceLevels(image);
  const top = source.length - 1;
  const uv00 = [0, 0], uv10 = [0, 0], uv01 = [0, 0], uv = [0, 0];
  const corner = [0, 0, 0];
  rasterise(0, (at, dir, face, px, py, size, pad) => {
    const qx = px & ~1, qy = py & ~1;
    const across = (q) => -pad + ((q + 0.5) / size) * (1 + 2 * pad);
    direction(across(qx), across(qy), face, corner); equirectUv(corner[0], corner[1], corner[2], uv00);
    direction(across(qx + 1), across(qy), face, corner); equirectUv(corner[0], corner[1], corner[2], uv10);
    direction(across(qx), across(qy + 1), face, corner); equirectUv(corner[0], corner[1], corner[2], uv01);
    const W = source[0].width, H = source[0].height;
    const footprint = Math.max(
      Math.hypot((uv10[0] - uv00[0]) * W, (uv10[1] - uv00[1]) * H),
      Math.hypot((uv01[0] - uv00[0]) * W, (uv01[1] - uv00[1]) * H),
    );
    const lambda = Math.min(Math.max(Math.log2(footprint), 0), top);
    const lo = Math.floor(lambda);
    const t = lambda - lo;

    equirectUv(dir[0], dir[1], dir[2], uv);
    sample[0] = sample[1] = sample[2] = 0;
    bilinear(source[lo], uv[0], uv[1], sample, 1 - t);
    if (t > 0) bilinear(source[Math.min(lo + 1, top)], uv[0], uv[1], sample, t);
    for (let k = 0; k < 3; k++) atlas[at * 3 + k] = quantise(sample[k]);
  });

  /** Each rung after that is the one before it, blurred by GGX samples over
   *  just enough extra roughness to reach its own. */
  for (let lod = 1; lod < lods; lod++) {
    const target = lod / (lods - 1);
    const from = (lod - 1) / (lods - 1);
    const roughness = Math.sqrt(target * target - from * from) * (target * 1.25);
    const kernel = ggxKernel(roughness);
    const mipIn = lodMax - (lod - 1);

    rasterise(lod, (at, dir) => {
      gather(atlas, layout, mipIn, kernel, dir, sample);
      for (let k = 0; k < 3; k++) pingpong[at * 3 + k] = quantise(sample[k]);
    });

    /** And copied back through the same lookup, which is what fills the
     *  padding from the neighbouring faces. */
    rasterise(lod, (at, dir) => {
      sample[0] = sample[1] = sample[2] = 0;
      cubeUV(pingpong, dir[0], dir[1], dir[2], lodMax - lod, sample, 1);
      for (let k = 0; k < 3; k++) atlas[at * 3 + k] = quantise(sample[k]);
    });
  }

  const data = new Uint16Array(width * height * 4);
  for (let i = 0, j = 0; i < atlas.length; i += 3, j += 4) {
    data[j] = toHalf(atlas[i]);
    data[j + 1] = toHalf(atlas[i + 1]);
    data[j + 2] = toHalf(atlas[i + 2]);
    data[j + 3] = 0x3c00;
  }

  return { data, width, height, texelWidth, texelHeight, maxMip: lodMax };
}
