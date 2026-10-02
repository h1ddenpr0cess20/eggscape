import { compose, invertRigid, mat4, multiply, perspective, Vec3 } from './math.js';

/**
 * The scene graph: nodes with a position, a rotation and a scale, parented
 * into a tree, and a world matrix worked out from the root down once a frame.
 * Meshes and lines are nodes that carry a geometry and a material; lights and
 * the camera are nodes the renderer reads instead of draws.
 */

let ids = 0;

export class Node {
  constructor() {
    this.id = ids++;
    this.name = '';
    this.parent = null;
    this.children = [];
    this.visible = true;
    this.renderOrder = 0;
    this.frustumCulled = true;
    this.userData = {};
    this.position = new Vec3();
    /** Euler angles in radians, applied X, then Y, then Z. */
    this.rotation = new Vec3();
    this.scale = new Vec3(1, 1, 1);
    this.matrixWorld = mat4();
  }

  add(...nodes) {
    for (const node of nodes) {
      node.parent?.remove(node);
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }

  remove(...nodes) {
    for (const node of nodes) {
      const at = this.children.indexOf(node);
      if (at < 0) continue;
      this.children.splice(at, 1);
      node.parent = null;
    }
    return this;
  }

  traverse(visit) {
    visit(this);
    for (const child of this.children) child.traverse(visit);
  }

  /** This node, or the first one under it with the name, depth first. */
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      const found = child.getObjectByName(name);
      if (found) return found;
    }
    return undefined;
  }

  updateMatrixWorld(parent = null) {
    compose(this.matrixWorld, this.position, this.rotation, this.scale);
    if (parent) multiply(this.matrixWorld, parent, this.matrixWorld);
    for (const child of this.children) child.updateMatrixWorld(this.matrixWorld);
  }

  /** A fresh node of the same kind, for `clone` to fill in. */
  blank() {
    return new this.constructor();
  }

  /**
   * A copy of this node and everything under it. Geometry and materials are
   * shared with the original rather than copied — a clone is a new place to
   * draw the same thing, which is the whole reason to clone.
   */
  clone() {
    const node = this.blank();
    node.name = this.name;
    node.visible = this.visible;
    node.renderOrder = this.renderOrder;
    node.frustumCulled = this.frustumCulled;
    node.userData = JSON.parse(JSON.stringify(this.userData));
    node.position.copy(this.position);
    node.rotation.copy(this.rotation);
    node.scale.copy(this.scale);
    for (const child of this.children) node.add(child.clone());
    return node;
  }
}

export class Group extends Node {}

export class Mesh extends Node {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }

  blank() {
    return new this.constructor(this.geometry, this.material);
  }
}

/** Pairs of vertices drawn as one-pixel lines. */
export class Lines extends Mesh {}

/**
 * Light from above and light from below, blended by which way a surface
 * faces. The "up" it blends along is the light's own world position taken as
 * a direction from the origin — so a rig carried down the course drags it
 * with it, and the renderer reproduces that rather than tidying it away.
 */
export class HemisphereLight extends Node {
  constructor(skyColor, groundColor, intensity = 1) {
    super();
    this.skyColor = skyColor;
    this.groundColor = groundColor;
    this.intensity = intensity;
    this.position.set(0, 1, 0);
  }
}

/** Parallel light, shining from its position towards its target's. */
export class DirectionalLight extends Node {
  constructor(color, intensity = 1) {
    super();
    this.color = color;
    this.intensity = intensity;
    this.position.set(0, 1, 0);
    this.target = new Node();
  }
}

/**
 * The root. `background` is a texture stretched over the whole frame behind
 * everything, `environment` is what the lit materials reflect, and `fog` is
 * linear between `near` and `far`.
 */
export class Scene extends Node {
  constructor() {
    super();
    this.background = null;
    this.backgroundIntensity = 1;
    this.environment = null;
    this.fog = null;
  }
}

export class PerspectiveCamera {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.position = new Vec3();
    this.up = new Vec3(0, 1, 0);
    /** Rotation as three basis vectors, set by `lookAt`. */
    this.basis = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.matrixWorld = mat4();
    this.matrixWorldInverse = mat4();
    this.projectionMatrix = mat4();
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix() {
    perspective(this.projectionMatrix, this.fov, this.aspect, this.near, this.far);
  }

  /** Turn to face a point, keeping `up` as near to up as it will go. */
  lookAt(target) {
    const p = this.position;
    let zx = p.x - target.x, zy = p.y - target.y, zz = p.z - target.z;
    if (zx === 0 && zy === 0 && zz === 0) zz = 1;
    let len = Math.hypot(zx, zy, zz);
    zx /= len; zy /= len; zz /= len;

    const u = this.up;
    let xx = u.y * zz - u.z * zy, xy = u.z * zx - u.x * zz, xz = u.x * zy - u.y * zx;
    if (xx === 0 && xy === 0 && xz === 0) {
      if (Math.abs(u.z) === 1) zx += 0.0001; else zz += 0.0001;
      len = Math.hypot(zx, zy, zz);
      zx /= len; zy /= len; zz /= len;
      xx = u.y * zz - u.z * zy; xy = u.z * zx - u.x * zz; xz = u.x * zy - u.y * zx;
    }
    len = Math.hypot(xx, xy, xz);
    xx /= len; xy /= len; xz /= len;

    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    this.basis = [xx, xy, xz, yx, yy, yz, zx, zy, zz];
    this.updateMatrixWorld();
  }

  updateMatrixWorld() {
    const m = this.matrixWorld;
    const b = this.basis;
    m[0] = b[0]; m[1] = b[1]; m[2] = b[2]; m[3] = 0;
    m[4] = b[3]; m[5] = b[4]; m[6] = b[5]; m[7] = 0;
    m[8] = b[6]; m[9] = b[7]; m[10] = b[8]; m[11] = 0;
    m[12] = this.position.x; m[13] = this.position.y; m[14] = this.position.z; m[15] = 1;
    invertRigid(this.matrixWorldInverse, m);
  }
}
