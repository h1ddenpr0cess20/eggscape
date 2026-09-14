import * as THREE from 'three';

import { approach, clamp, spring } from '../core/motion.js';
import { laneX, PLAYER } from '../core/tuning.js';
import { createEgg, createShadow, EGG_SCALE } from './egg.js';
import { createBit, createHazard, createSlab, createUnderGrid, disposeSlab } from './props.js';

/**
 * Two framings. A phone held upright has a narrow, tall window: the same
 * camera puts half the screen in the sky, so it gets pulled in, lifted, and
 * tilted down until the track fills the frame again.
 */
const WIDE = { back: 6.8, up: 2.45, lead: 8, aim: 1.1 };
const TALL = { back: 5.8, up: 3.3, lead: 5, aim: 0.2 };
const CHASE = 6;
const DRAW = { behind: 12, ahead: 130 };
const ROLL_RADIUS = 0.5;

function createPool(scene, make) {
  const items = [];
  let cursor = 0;

  return {
    begin() { cursor = 0; },
    take() {
      let item = items[cursor];
      if (!item) {
        item = make();
        items[cursor] = item;
        scene.add(item);
      }
      item.visible = true;
      cursor += 1;
      return item;
    },
    end() { for (let i = cursor; i < items.length; i++) items[i].visible = false; },
  };
}

/**
 * The one place that knows both the game and the scene graph. Everything it
 * draws is derived from a snapshot — it holds no state the run depends on, so
 * a restart is a `reset()` and nothing more.
 */
export function createView({ scene, camera }) {
  const egg = createEgg();
  const shadow = createShadow();
  const grid = createUnderGrid();
  scene.add(egg.object, shadow, grid.object);

  const slabs = new Map();
  const agents = createPool(scene, createHazard);
  const bits = createPool(scene, createBit);

  const squash = { p: 0, v: 0 };
  const target = new THREE.Vector3();
  const focus = new THREE.Vector3();

  let level = 0;
  let placed = false;
  let tumble = 0;
  let shake = 0;

  function syncSlabs(course) {
    const live = new Set();
    for (const seg of course.segments) {
      live.add(seg.id);
      if (slabs.has(seg.id)) continue;
      const slab = createSlab(seg);
      slabs.set(seg.id, slab);
      scene.add(slab);
    }
    for (const [id, slab] of slabs) {
      if (live.has(id)) continue;
      scene.remove(slab);
      disposeSlab(slab);
      slabs.delete(id);
    }
  }

  function syncProps(course, player, time) {
    agents.begin();
    for (const hazard of course.hazards) {
      if (hazard.hit || hazard.z < player.z - DRAW.behind) continue;
      if (hazard.z > player.z + DRAW.ahead) break;
      const mesh = agents.take();
      mesh.position.set(hazard.x, hazard.y, hazard.z);
      mesh.getObjectByName('core').rotation.set(time * 0.9, time * 1.4, 0);
    }
    agents.end();

    bits.begin();
    for (const bit of course.bits) {
      if (bit.taken || bit.z < player.z - DRAW.behind) continue;
      if (bit.z > player.z + DRAW.ahead) break;
      const mesh = bits.take();
      mesh.position.set(bit.x, bit.y + Math.sin(time * 2.6 + bit.z) * 0.12, bit.z);
      mesh.rotation.set(time * 1.1, time * 1.7, 0);
    }
    bits.end();
  }

  function syncEgg(snapshot, dt, time) {
    const { player, state, invulnerable } = snapshot;

    spring(squash, 190, 11, dt, 0);
    const s = clamp(squash.p, -0.45, 0.45);

    egg.object.position.set(player.x, player.y + PLAYER.height / 2, player.z);
    egg.object.scale.set(1 + s * 0.4, 1 - s, 1 + s * 0.4);
    egg.object.scale.multiplyScalar(EGG_SCALE);
    egg.object.rotation.z = clamp((laneX(player.lane) - player.x) * -0.5, -0.45, 0.45);

    egg.body.rotation.x = player.z / ROLL_RADIUS;
    egg.halo.rotation.y = time * 0.6;

    if (state === 'ready') {
      /** Nothing is running yet, so the egg does what Marc does: it rocks. */
      egg.object.position.y += Math.sin(time * 1.4) * 0.05;
      egg.object.rotation.z = Math.sin(time * 0.9) * 0.09;
      egg.body.rotation.x = Math.sin(time * 0.5) * 0.25;
      egg.object.rotation.y = time * 0.35;
    } else {
      egg.object.rotation.y = 0;
    }

    if (state === 'over') {
      tumble += dt;
      egg.object.position.y -= tumble * tumble * 4;
      egg.object.rotation.z += tumble * 2.2;
    } else {
      tumble = 0;
    }

    /** Invulnerable is a blink, not a tint — the materials are shared. */
    egg.body.visible = invulnerable <= 0 || Math.floor(time * 16) % 2 === 0;
  }

  function syncShadow(course, player) {
    const ground = course.groundAt(player.x, player.z);
    shadow.visible = Boolean(ground);
    if (!ground) return;
    const height = Math.max(0, player.y - ground.y);
    shadow.position.set(player.x, ground.y + 0.02, player.z);
    shadow.scale.setScalar(clamp(1 - height * 0.1, 0.4, 1.05));
  }

  return {
    /** A landing, a pickup and a hit all read as a kick in the springs. */
    kick(force) { squash.v += force; },
    jolt(force) { shake = Math.min(1, shake + force); },

    reset() {
      for (const [id, slab] of slabs) {
        scene.remove(slab);
        disposeSlab(slab);
        slabs.delete(id);
      }
      squash.p = 0;
      squash.v = 0;
      tumble = 0;
      shake = 0;
      placed = false;
    },

    sync(snapshot, dt, time) {
      const { course, player } = snapshot;

      syncSlabs(course);
      syncProps(course, player, time);
      syncEgg(snapshot, dt, time);
      syncShadow(course, player);

      grid.object.position.z = Math.round(player.z / grid.spacing) * grid.spacing;

      if (player.grounded) level = approach(level, player.y, 6, dt);
      shake = approach(shake, 0, 6, dt);

      const rig = camera.aspect < 1 ? TALL : WIDE;
      target.set(
        player.x * 0.4 + (Math.random() - 0.5) * shake * 0.7,
        Math.max(player.y, level - 0.8) + rig.up + (Math.random() - 0.5) * shake * 0.5,
        player.z - rig.back,
      );
      if (placed) camera.position.lerp(target, 1 - Math.exp(-dt * CHASE));
      else {
        camera.position.copy(target);
        placed = true;
      }

      focus.set(player.x * 0.55, level + rig.aim, player.z + rig.lead);
      camera.lookAt(focus);
    },
  };
}
