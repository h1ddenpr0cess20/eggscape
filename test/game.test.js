import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGame } from '../src/core/game.js';
import { HAZARD, INVULNERABLE, LIVES, SCORE, VOID_Y } from '../src/core/tuning.js';
import { pilot, run } from './helpers/pilot.js';

const SEEDS = [1, 3, 9, 42, 77];

function started(seed = 1, lives = LIVES) {
  const game = createGame({ seed, lives });
  game.start(seed);
  return game;
}

function play(game, seconds, intent = null) {
  for (let i = 0; i < seconds * 60 && game.state === 'running'; i++) game.advance(1 / 60, intent);
  return game.snapshot();
}

describe('game', () => {
  it('waits to be started, and does not move until it is', () => {
    const game = createGame({ seed: 1 });
    assert.equal(game.state, 'ready');
    const before = game.player.z;
    play(game, 2);
    assert.equal(game.player.z, before);
    assert.equal(game.state, 'ready');
  });

  it('runs once started, and scores the ground it covers', () => {
    const game = started();
    const snapshot = play(game, 3);
    assert.equal(snapshot.state, 'running');
    assert.ok(snapshot.distance > 25);
    assert.equal(snapshot.score, Math.floor(snapshot.distance * SCORE.perMetre) + snapshot.bits * SCORE.perBit);
  });

  it('never scores less than it did a moment ago', () => {
    const game = started(9);
    let last = 0;
    for (let i = 0; i < 60 * 20 && game.state === 'running'; i++) {
      game.advance(1 / 60, pilot(game));
      assert.ok(game.score >= last, 'the score went backwards');
      last = game.score;
    }
  });

  it('pays for a bit once', () => {
    const game = started(2);
    let taken = 0;
    game.on('bit', () => { taken += 1; });
    const snapshot = play(game, 12, null);
    assert.equal(snapshot.bits, taken);
    assert.equal(game.course.bits.filter((bit) => bit.taken).length + countGone(game), taken);

    function countGone() {
      return taken - game.course.bits.filter((bit) => bit.taken).length;
    }
  });

  it('costs a shell to meet an agent, and gives a moment of grace after', () => {
    const game = started(1);
    const hazard = { z: game.player.z + 30, lane: 1, x: 0, y: 0, hit: false };
    game.course.hazards.length = 0;
    game.course.hazards.push(hazard, { ...hazard, z: hazard.z + 1.2 });

    const hits = [];
    game.on('hit', (hit) => hits.push(hit));
    play(game, 4);

    assert.equal(hits.length, 1, 'the second agent should have been passed through');
    assert.equal(hits[0].reason, 'agent');
    assert.equal(hits[0].lives, LIVES - 1);
    assert.ok(game.snapshot().invulnerable > 0);
    assert.ok(game.snapshot().invulnerable <= INVULNERABLE);
  });

  it('lets a jump clear an agent', () => {
    const game = started(1);
    game.course.hazards.length = 0;
    game.course.hazards.push({ z: game.player.z + 14, lane: 1, x: 0, y: 0, hit: false });

    const hits = [];
    game.on('hit', (hit) => hits.push(hit.reason));

    /** Jumped from four metres out the arc carries the whole agent; from
     *  seven it is already coming down on the far edge of one. */
    const agent = game.course.hazards[0];
    while (game.player.z < agent.z - 4.2) game.advance(1 / 120, null);
    game.advance(1 / 120, { left: false, right: false, jump: true, dive: false });
    while (game.player.z < agent.z + 2 && game.state === 'running') game.advance(1 / 120, null);

    assert.ok(!hits.includes('agent'), `an agent ${HAZARD.height}m tall stopped a jump`);
    assert.ok(game.player.z > agent.z, 'the egg never reached the agent');
  });

  it('costs a shell to fall, and puts the egg back down still running', () => {
    const game = started(4);
    play(game, 1);
    game.player.y = VOID_Y - 1;

    const hits = [];
    game.on('hit', (hit) => hits.push(hit.reason));
    play(game, 2);

    assert.equal(hits[0], 'void');
    assert.equal(game.state, 'running');
    assert.ok(game.player.y > VOID_Y, 'the egg was left in the void');
    assert.ok(game.course.groundAt(game.player.x, game.player.z) || game.player.vy <= 0);
  });

  it('ends after the last shell, and stops moving then', () => {
    const game = started(1, 1);
    play(game, 1);
    game.player.y = VOID_Y - 1;

    let over = null;
    game.on('over', (snapshot) => { over = snapshot; });
    play(game, 2);

    assert.equal(game.state, 'over');
    assert.equal(over.lives, 0);
    assert.equal(over.score, game.score);

    const resting = game.player.z;
    play(game, 2);
    assert.equal(game.player.z, resting);
  });

  it('starts clean every time, on a course of its own', () => {
    const game = started(5, 1);
    play(game, 1);
    game.player.y = VOID_Y - 1;
    play(game, 2);
    assert.equal(game.state, 'over');

    const before = game.course;
    game.start(6);
    assert.equal(game.state, 'running');
    assert.equal(game.snapshot().lives, 1);
    assert.equal(game.snapshot().bits, 0);
    assert.equal(game.snapshot().distance, 0);
    assert.notEqual(game.course, before);
  });

  it('eats a frame that was gone for a minute instead of teleporting', () => {
    const steady = started(8);
    const stalled = started(8);
    play(steady, 1);
    stalled.advance(60, null);
    assert.ok(stalled.player.z < steady.player.z, 'one huge frame outran a second of play');
    assert.ok(stalled.player.z > 0);
  });

  it('keeps the course to a working set however far the egg gets', () => {
    const game = started(3);
    play(game, 40);
    assert.ok(game.course.segments.length < 60, `${game.course.segments.length} slabs still live`);
    assert.ok(game.course.segments[0].z1 > game.player.z - 60);
  });

  it('is survivable: a crude autopilot gets a long way down every seed', () => {
    for (const seed of SEEDS) {
      const result = run(createGame({ seed }), { seed, seconds: 150 });
      assert.ok(result.distance > 250, `seed ${seed} stopped the autopilot at ${result.distance.toFixed(0)}m`);
      assert.ok(result.bits > 5, `seed ${seed} gave up only ${result.bits} bits`);
    }
  });
});
