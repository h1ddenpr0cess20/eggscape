/**
 * Vertex data, and the handful of shapes the city is built from.
 *
 * The generators lay their vertices out in exactly the order, winding and
 * seam the shapes have always had — the egg's sphere in particular, since
 * `shapeEgg` pushes its vertices around by index and the normals are worked
 * out from the triangles afterwards, seam and poles and all. Change the
 * layout and the shell's shading changes with it.
 */

function indexArray(indices, vertexCount) {
  return vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}

export class Geometry {
  /**
   * Flat typed arrays: `position` and `normal` three floats a vertex, `uv`
   * two, `color` three. `index` is optional — without one, every three
   * vertices are a triangle, or every two a line.
   */
  constructor({ position, normal = null, uv = null, color = null, index = null }) {
    this.position = position instanceof Float32Array ? position : new Float32Array(position);
    this.normal = normal && (normal instanceof Float32Array ? normal : new Float32Array(normal));
    this.uv = uv && (uv instanceof Float32Array ? uv : new Float32Array(uv));
    this.color = color && (color instanceof Float32Array ? color : new Float32Array(color));
    this.index = index && (ArrayBuffer.isView(index) ? index : indexArray(index, this.count));
    this.version = 0;
    this.bounds = null;
    this.listeners = new Set();
  }

  get count() {
    return this.position.length / 3;
  }

  /** Mark the arrays as changed, so the next frame uploads them again. */
  set needsUpdate(value) {
    if (value) {
      this.version += 1;
      this.bounds = null;
    }
  }

  /** Centre of the box round every vertex, and the furthest vertex from it. */
  get boundingSphere() {
    if (this.bounds) return this.bounds;
    const p = this.position;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < lo[k]) lo[k] = p[i + k];
        if (p[i + k] > hi[k]) hi[k] = p[i + k];
      }
    }
    const center = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    let r2 = 0;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - center[0];
      const dy = p[i + 1] - center[1];
      const dz = p[i + 2] - center[2];
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    this.bounds = { center, radius: Math.sqrt(r2) };
    return this.bounds;
  }

  /**
   * Smooth normals from the triangles: each face's unnormalised normal, so
   * bigger faces count for more, summed onto its corners and normalised.
   * Without an index every triangle keeps its own, which is flat shading.
   */
  computeVertexNormals() {
    const p = this.position;
    const n = new Float32Array(p.length);
    const index = this.index;
    const triangles = index ? index.length : this.count;

    for (let i = 0; i < triangles; i += 3) {
      const a = index ? index[i] : i;
      const b = index ? index[i + 1] : i + 1;
      const c = index ? index[i + 2] : i + 2;
      const cbx = p[c * 3] - p[b * 3], cby = p[c * 3 + 1] - p[b * 3 + 1], cbz = p[c * 3 + 2] - p[b * 3 + 2];
      const abx = p[a * 3] - p[b * 3], aby = p[a * 3 + 1] - p[b * 3 + 1], abz = p[a * 3 + 2] - p[b * 3 + 2];
      const x = cby * abz - cbz * aby;
      const y = cbz * abx - cbx * abz;
      const z = cbx * aby - cby * abx;
      for (const v of [a, b, c]) {
        n[v * 3] += x;
        n[v * 3 + 1] += y;
        n[v * 3 + 2] += z;
      }
    }

    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= len;
      n[i + 1] /= len;
      n[i + 2] /= len;
    }
    this.normal = n;
    return this;
  }

  addEventListener(type, listener) {
    if (type === 'dispose') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'dispose') this.listeners.delete(listener);
  }

  /** Free the GPU's copy. Drawing it again uploads it again. */
  dispose() {
    for (const listener of [...this.listeners]) listener({ type: 'dispose', target: this });
  }
}

/** A sphere in latitude rows, with a duplicated seam column and a vertex per
 *  segment at each pole — so a texture wraps it without pinching. */
export function sphere(radius = 1, widthSegments = 32, heightSegments = 16) {
  const position = [];
  const normal = [];
  const uv = [];
  const index = [];
  const grid = [];
  let next = 0;

  for (let iy = 0; iy <= heightSegments; iy++) {
    const row = [];
    const v = iy / heightSegments;
    const theta = v * Math.PI;
    const y = radius * Math.cos(theta);
    const ring = Math.sqrt(radius * radius - y * y);
    const offset = iy === 0 ? 0.5 / widthSegments : iy === heightSegments ? -0.5 / widthSegments : 0;

    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      const phi = u * Math.PI * 2;
      const x = -ring * Math.cos(phi);
      const z = ring * Math.sin(phi);
      position.push(x, y, z);
      const len = Math.hypot(x, y, z) || 1;
      normal.push(x / len, y / len, z / len);
      uv.push(u + offset, 1 - v);
      row.push(next++);
    }
    grid.push(row);
  }

  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = grid[iy][ix + 1];
      const b = grid[iy][ix];
      const c = grid[iy + 1][ix];
      const d = grid[iy + 1][ix + 1];
      if (iy !== 0) index.push(a, b, d);
      if (iy !== heightSegments - 1) index.push(b, c, d);
    }
  }

  return new Geometry({ position, normal, uv, index });
}

/** A cylinder, or a cone when the top radius is zero, with its caps. */
export function cylinder(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1) {
  const position = [];
  const normal = [];
  const uv = [];
  const index = [];
  const rows = [];
  const half = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  let next = 0;

  for (let y = 0; y <= heightSegments; y++) {
    const row = [];
    const v = y / heightSegments;
    const radius = v * (radiusBottom - radiusTop) + radiusTop;
    for (let x = 0; x <= radialSegments; x++) {
      const u = x / radialSegments;
      const theta = u * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      position.push(radius * sin, -v * height + half, radius * cos);
      const len = Math.hypot(sin, slope, cos);
      normal.push(sin / len, slope / len, cos / len);
      uv.push(u, 1 - v);
      row.push(next++);
    }
    rows.push(row);
  }

  for (let x = 0; x < radialSegments; x++) {
    for (let y = 0; y < heightSegments; y++) {
      const a = rows[y][x];
      const b = rows[y + 1][x];
      const c = rows[y + 1][x + 1];
      const d = rows[y][x + 1];
      if (radiusTop > 0 || y !== 0) index.push(a, b, d);
      if (radiusBottom > 0 || y !== heightSegments - 1) index.push(b, c, d);
    }
  }

  for (const top of [true, false]) {
    const radius = top ? radiusTop : radiusBottom;
    if (radius <= 0) continue;
    const sign = top ? 1 : -1;
    const centre = next;
    for (let x = 1; x <= radialSegments; x++) {
      position.push(0, half * sign, 0);
      normal.push(0, sign, 0);
      uv.push(0.5, 0.5);
      next++;
    }
    const rim = next;
    for (let x = 0; x <= radialSegments; x++) {
      const theta = (x / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      position.push(radius * sin, half * sign, radius * cos);
      normal.push(0, sign, 0);
      uv.push(cos * 0.5 + 0.5, sin * 0.5 * sign + 0.5);
      next++;
    }
    for (let x = 0; x < radialSegments; x++) {
      const c = centre + x;
      const i = rim + x;
      if (top) index.push(i, i + 1, c);
      else index.push(i + 1, i, c);
    }
  }

  return new Geometry({ position, normal, uv, index });
}

export function cone(radius = 1, height = 1, radialSegments = 32) {
  return cylinder(0, radius, height, radialSegments);
}

/** A ring of tube lying in the XY plane, round the Z axis. */
export function torus(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48) {
  const position = [];
  const normal = [];
  const uv = [];
  const index = [];

  for (let j = 0; j <= radialSegments; j++) {
    const v = (j / radialSegments) * Math.PI * 2;
    for (let i = 0; i <= tubularSegments; i++) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = (radius + tube * Math.cos(v)) * Math.sin(u);
      const z = tube * Math.sin(v);
      position.push(x, y, z);
      const nx = x - radius * Math.cos(u);
      const ny = y - radius * Math.sin(u);
      const len = Math.hypot(nx, ny, z) || 1;
      normal.push(nx / len, ny / len, z / len);
      uv.push(i / tubularSegments, j / radialSegments);
    }
  }

  for (let j = 1; j <= radialSegments; j++) {
    for (let i = 1; i <= tubularSegments; i++) {
      const a = (tubularSegments + 1) * j + i - 1;
      const b = (tubularSegments + 1) * (j - 1) + i - 1;
      const c = (tubularSegments + 1) * (j - 1) + i;
      const d = (tubularSegments + 1) * j + i;
      index.push(a, b, d, b, c, d);
    }
  }

  return new Geometry({ position, normal, uv, index });
}

/** A flat rectangle facing +z, uv (0,1) at its top-left corner. */
export function plane(width = 1, height = 1) {
  const w = width / 2;
  const h = height / 2;
  return new Geometry({
    position: [-w, h, 0, w, h, 0, -w, -h, 0, w, -h, 0],
    normal: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uv: [0, 1, 1, 1, 0, 0, 1, 0],
    index: [0, 2, 1, 2, 3, 1],
  });
}

/** The six corners of an octahedron, and its eight faces. */
const OCTAHEDRON = {
  vertices: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
  faces: [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2],
};

/** Eight flat faces, each with its own three vertices, so it shades faceted. */
export function octahedron(radius = 1) {
  const { vertices, faces } = OCTAHEDRON;
  const position = [];
  for (let i = 0; i < faces.length; i += 3) {
    /** Each face is wound b, c, a — the order it has always been drawn in. */
    for (const k of [faces[i + 1], faces[i + 2], faces[i]]) {
      position.push(vertices[k * 3] * radius, vertices[k * 3 + 1] * radius, vertices[k * 3 + 2] * radius);
    }
  }
  return new Geometry({ position }).computeVertexNormals();
}

/** The twelve edges of an octahedron, as line segments. */
export function octahedronEdges(radius = 1) {
  const { vertices } = OCTAHEDRON;
  const position = [];
  for (let a = 0; a < 6; a++) {
    for (let b = a + 1; b < 6; b++) {
      /** Every pair of corners is an edge except the three opposite pairs. */
      if ((a ^ 1) === b) continue;
      position.push(
        vertices[a * 3] * radius, vertices[a * 3 + 1] * radius, vertices[a * 3 + 2] * radius,
        vertices[b * 3] * radius, vertices[b * 3 + 1] * radius, vertices[b * 3 + 2] * radius,
      );
    }
  }
  return new Geometry({ position });
}
