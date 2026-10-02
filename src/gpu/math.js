/**
 * The arithmetic the renderer runs on: a three-component vector, and 4×4
 * matrices stored column-major in Float64Arrays — the order both GLSL and
 * WGSL read them in, kept in double precision until the moment they are
 * handed to the GPU.
 *
 * Double precision is not fussiness. The egg is thousands of metres down the
 * course by the end of a run, and a float32 model matrix at z = 4000 cannot
 * place a vertex closer than half a millimetre — which, under a bump map that
 * reads screen-space derivatives of position, is a shell that crawls. So the
 * model-view product is taken here, where it is exact, and the shader only
 * ever sees positions relative to the camera.
 */

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setScalar(s) {
    return this.set(s, s, s);
  }

  copy(v) {
    return this.set(v.x, v.y, v.z);
  }

  clone() {
    return new Vec3(this.x, this.y, this.z);
  }

  multiplyScalar(s) {
    return this.set(this.x * s, this.y * s, this.z * s);
  }

  lerp(v, t) {
    return this.set(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t,
    );
  }

  length() {
    return Math.hypot(this.x, this.y, this.z);
  }

  /** Through a 4×4 matrix as a point, with the perspective divide. */
  applyMatrix4(m) {
    const { x, y, z } = this;
    const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
    return this.set(
      (m[0] * x + m[4] * y + m[8] * z + m[12]) * w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) * w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) * w,
    );
  }

  /** World space to normalised device coordinates, through a camera. */
  project(camera) {
    camera.updateMatrixWorld();
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  }
}

export function mat4() {
  return identity(new Float64Array(16));
}

export function identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 16; i += 4) {
    const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2], b3 = b[i + 3];
    out[i] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[i + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[i + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[i + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

/**
 * Translation × rotation × scale. The rotation is three Euler angles applied
 * X, then Y, then Z, about the parent's axes — the order every `rotation.set`
 * in this game was written against.
 */
export function compose(out, p, r, s) {
  const a = Math.cos(r.x), b = Math.sin(r.x);
  const c = Math.cos(r.y), d = Math.sin(r.y);
  const e = Math.cos(r.z), f = Math.sin(r.z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;

  out[0] = c * e * s.x;
  out[1] = (af + be * d) * s.x;
  out[2] = (bf - ae * d) * s.x;
  out[3] = 0;
  out[4] = -c * f * s.y;
  out[5] = (ae - bf * d) * s.y;
  out[6] = (be + af * d) * s.y;
  out[7] = 0;
  out[8] = d * s.z;
  out[9] = -b * c * s.z;
  out[10] = a * c * s.z;
  out[11] = 0;
  out[12] = p.x;
  out[13] = p.y;
  out[14] = p.z;
  out[15] = 1;
  return out;
}

/** The inverse of a rigid transform: rotation transposed, translation undone. */
export function invertRigid(out, m) {
  const x = m[12], y = m[13], z = m[14];
  out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = 0;
  out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = 0;
  out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;
  out[12] = -(m[0] * x + m[1] * y + m[2] * z);
  out[13] = -(m[4] * x + m[5] * y + m[6] * z);
  out[14] = -(m[8] * x + m[9] * y + m[10] * z);
  out[15] = 1;
  return out;
}

/**
 * The inverse transpose of a matrix's upper 3×3, written into the first three
 * columns of `out`: what a normal has to go through when the model is scaled
 * unevenly, which the squashed egg is on every landing.
 */
export function normalMatrix(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const det = a00 * b01 + a01 * b11 + a02 * b21;
  const inv = det === 0 ? 0 : 1 / det;

  out[0] = b01 * inv;
  out[1] = b11 * inv;
  out[2] = b21 * inv;
  out[3] = 0;
  out[4] = (-a22 * a01 + a02 * a21) * inv;
  out[5] = (a22 * a00 - a02 * a20) * inv;
  out[6] = (-a21 * a00 + a01 * a20) * inv;
  out[7] = 0;
  out[8] = (a12 * a01 - a02 * a11) * inv;
  out[9] = (-a12 * a00 + a02 * a10) * inv;
  out[10] = (a11 * a00 - a01 * a10) * inv;
  out[11] = 0;
  out[12] = out[13] = out[14] = 0;
  out[15] = 1;
  return out;
}

/**
 * A perspective projection from a vertical field of view in degrees. WebGL
 * clips depth to [-1, 1] and WebGPU to [0, 1]; `zeroToOne` picks which, and
 * nothing else about the picture changes.
 */
export function perspective(out, fov, aspect, near, far, zeroToOne = false) {
  const top = near * Math.tan((Math.PI / 180) * 0.5 * fov);
  const height = 2 * top;
  const width = aspect * height;
  const left = -0.5 * width;
  const right = left + width;
  const bottom = top - height;

  out.fill(0);
  out[0] = (2 * near) / (right - left);
  out[5] = (2 * near) / (top - bottom);
  out[8] = (right + left) / (right - left);
  out[9] = (top + bottom) / (top - bottom);
  out[11] = -1;
  if (zeroToOne) {
    out[10] = -far / (far - near);
    out[14] = (-far * near) / (far - near);
  } else {
    out[10] = -(far + near) / (far - near);
    out[14] = (-2 * far * near) / (far - near);
  }
  return out;
}

/** Largest scale along any axis of a transform, for growing a bounding sphere. */
export function maxScale(m) {
  return Math.sqrt(Math.max(
    m[0] * m[0] + m[1] * m[1] + m[2] * m[2],
    m[4] * m[4] + m[5] * m[5] + m[6] * m[6],
    m[8] * m[8] + m[9] * m[9] + m[10] * m[10],
  ));
}

/**
 * The six planes of a view frustum, from a projection × view matrix, each as
 * [nx, ny, nz, d] with the normal pointing inwards.
 */
export function frustum(out, m) {
  const rows = [
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
  ];
  for (let i = 0; i < 6; i++) {
    const [a, b, c, d] = rows[i];
    const len = Math.hypot(a, b, c) || 1;
    const plane = out[i];
    plane[0] = a / len;
    plane[1] = b / len;
    plane[2] = c / len;
    plane[3] = d / len;
  }
  return out;
}
