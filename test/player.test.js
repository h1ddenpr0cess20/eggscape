import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { advance, createPlayer, respawn } from '../src/core/player.js';
import {
  AIRTIME, APEX, COYOTE, DIVE_SPEED, JUMP_BUFFER, laneBounds, LANES, laneX,
  PLAYER, RUN, SNAP, speedAt, VOID_Y,
} from '../src/core/tuning.js';

const DT = 1 / 120;

const JUMP = { left: false, right: false, jump: true, dive: false };
const LEFT = { left: true, right: false, jump: false, dive: false };
const RIGHT = { left: false, right: true, jump: false, dive: false };
const DIVE = { left: false, right: false, jump: false, dive: true };

/** A course of exactly one slab, so the physics has something to stand on. */
function floor({ y = 0, z0 = -20, z1 = 500, lane = 0, span = LANES } = {}) {
  const seg = { id: 0, z0, z1, y, lane, span, ...laneBounds(lane, span) };
  return {
    seg,
    groundAt(x, z) {
      return z >= seg.z0 && z < seg.z1 && x >= seg.xMin - 0.25 && x <= seg.xMax + 0.25 ? seg : null;
    },
  };
}

/** A slab that only starts at `at` — past its near edge there is only void. */
function ledge(at, y = 0) {
  return floor({ z0: -20, z1: at, y });
}

function settle(player, course, seconds = 0.2, intent = null) {
  let last;
  for (let t = 0; t < seconds; t += DT) last = advance(player, DT, intent, course);
  return last;
}

describe('player', () => {
  it('runs itself, faster the further it gets, up to a ceiling', () => {
    const course = floor();
    const player = createPlayer();
    settle(player, course, 1);
    assert.ok(player.z > 10 && player.z < 13, `a second of running put it at ${player.z}`);
    /** The speed recorded is the speed that tick ran at, a frame behind z. */
    assert.ok(Math.abs(player.speed - speedAt(player.z)) < 0.01);
    assert.equal(speedAt(1e6), RUN.max);
  });

  it('settles onto the slab it starts over', () => {
    const course = floor();
    const player = createPlayer();
    settle(player, course, 0.2);
    assert.equal(player.y, 0);
    assert.ok(player.grounded);
  });

  it('jumps to the apex the course is measured against', () => {
    const course = floor();
    const player = createPlayer();
    settle(player, course, 0.2);

    let peak = 0;
    advance(player, DT, JUMP, course);
    for (let t = 0; t < AIRTIME; t += DT) {
      advance(player, DT, null, course);
      peak = Math.max(peak, player.y);
    }
    assert.ok(Math.abs(peak - APEX) < 0.05, `peaked at ${peak.toFixed(3)} against an apex of ${APEX.toFixed(3)}`);
  });

  it('lands again, and says so exactly once', () => {
    const course = floor();
    const player = createPlayer();
    settle(player, course, 0.2);

    advance(player, DT, JUMP, course);
    let landings = 0;
    for (let t = 0; t < AIRTIME + 0.3; t += DT) {
      if (advance(player, DT, null, course).landed) landings += 1;
    }
    assert.equal(landings, 1);
    assert.equal(player.y, 0);
    assert.ok(player.grounded);
  });

  it('spends one jump per press, however long it is held', () => {
    const course = floor();
    const player = createPlayer();
    settle(player, course, 0.2);

    advance(player, DT, JUMP, course);
    const first = player.vy;
    for (let t = 0; t < 0.2; t += DT) advance(player, DT, JUMP, course);
    assert.ok(player.vy < first, 'holding jump kept lifting it');
  });

  it('allows exactly one flip in the air', () => {
    const course = floor();
    const player = createPlayer();
    settle(player, course, 0.2);

    assert.ok(advance(player, DT, JUMP, course).jumped, 'the ground jump');
    settle(player, course, 0.2);
    assert.ok(advance(player, DT, JUMP, course).jumped, 'the air jump');
    settle(player, course, 0.2);
    assert.ok(!advance(player, DT, JUMP, course).jumped, 'and no more than that');
  });

  it('still jumps just after the edge, and just before the floor', () => {
    const late = createPlayer();
    const edge = ledge(6);
    settle(late, edge, 0.2);
    while (edge.groundAt(late.x, late.z)) advance(late, DT, null, edge);
    settle(late, edge, COYOTE * 0.5);
    assert.ok(advance(late, DT, JUMP, edge).jumped, 'coyote time did not cover it');

    const early = createPlayer();
    const course = floor();
    settle(early, course, 0.2);
    advance(early, DT, JUMP, course);
    settle(early, course, AIRTIME - JUMP_BUFFER * 0.5);
    early.airJumps = 0;
    advance(early, DT, JUMP, course);
    const before = early.y;
    settle(early, course, 0.1);
    assert.ok(early.y > before || early.vy > 0, 'the buffered jump was dropped on landing');
  });

  it('changes one lane per press and stops at the edges', () => {
    const course = floor();
    const player = createPlayer();
    advance(player, DT, LEFT, course);
    assert.equal(player.lane, 0);
    advance(player, DT, LEFT, course);
    assert.equal(player.lane, 0, 'there is no lane -1');

    for (let i = 0; i < 4; i++) advance(player, DT, RIGHT, course);
    assert.equal(player.lane, LANES - 1);

    settle(player, course, 0.6);
    assert.ok(Math.abs(player.x - laneX(LANES - 1)) < 0.02, 'it never arrived in the lane');
  });

  it('falls off the side of a narrow slab', () => {
    const course = floor({ lane: 1, span: 1 });
    const player = createPlayer();
    settle(player, course, 0.2);
    assert.ok(player.grounded);

    for (let i = 0; i < 3; i++) advance(player, DT, RIGHT, course);
    const out = settle(player, course, 1.5);
    assert.ok(!player.grounded, 'it kept standing on nothing');
    assert.ok(player.y < 0);
    assert.equal(out.fell, player.y < VOID_Y);
  });

  it('does not get caught on the lip of a slab it came up short against', () => {
    const player = createPlayer({ y: 0 });
    const raised = floor({ y: SNAP + 0.4, z0: 4, z1: 200 });
    player.vy = -1;
    settle(player, raised, 0.4);
    assert.ok(!player.grounded, 'it snapped up through the front of the slab');
    assert.ok(player.y < 0);
  });

  it('slams down when told to, and only in the air', () => {
    const course = floor();
    const player = createPlayer();
    settle(player, course, 0.2);

    advance(player, DT, DIVE, course);
    assert.equal(player.vy, 0, 'a grounded egg has nothing to slam into');

    advance(player, DT, JUMP, course);
    settle(player, course, 0.2);
    const height = player.y;
    advance(player, DT, DIVE, course);
    assert.ok(player.vy <= DIVE_SPEED, `slammed at ${player.vy}`);
    assert.ok(player.diving);

    settle(player, course, 0.2);
    assert.ok(player.grounded, 'a slam should reach the floor fast');
    assert.ok(height > 0.5, 'the test should have slammed from a height');
  });

  it('goes under eventually, and the void is the only way to lose height', () => {
    const course = floor({ z1: 2 });
    const player = createPlayer();
    let fell = false;
    for (let t = 0; t < 3 && !fell; t += DT) fell = advance(player, DT, null, course).fell;
    assert.ok(fell);
    assert.ok(player.y < VOID_Y);
  });

  it('puts a fallen egg back on a slab, in a lane that slab has', () => {
    const { seg } = floor({ lane: 2, span: 1, z0: 300, z1: 340 });
    const player = createPlayer();
    player.lane = 0;
    player.y = -40;
    respawn(player, seg);

    assert.equal(player.lane, 2);
    assert.equal(player.x, laneX(2));
    assert.ok(player.z > seg.z0 && player.z < seg.z1);
    assert.ok(player.y > seg.y);
    assert.equal(player.vy, 0);
    assert.ok(player.y + PLAYER.height > seg.y);
  });
});
