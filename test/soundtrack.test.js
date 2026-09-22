import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compile, createMusic, hz } from '../src/ui/music.js';
import { SOUNDTRACK } from '../src/ui/soundtrack.js';
import { fakeAudio } from './helpers/audio.js';

/** What `main.js` asks for, and when. */
const ASKED = ['title', 'run', 'over'];

const cues = compile(SOUNDTRACK.cues);
const instruments = SOUNDTRACK.instruments({ ctx: fakeAudio(), voice: () => null });

function running(distance) {
  return { state: 'running', distance };
}

describe('soundtrack', () => {
  it('has every cue the page asks for', () => {
    for (const name of ASKED) assert.ok(cues[name], `no "${name}" cue`);
  });

  it('plays every part on an instrument it has', () => {
    for (const cue of Object.values(cues)) {
      for (const part of cue.parts) {
        assert.equal(typeof instruments[part.play], 'function', `${cue.name} plays "${part.play}"`);
      }
    }
  });

  it('writes every part in whole bars, and loops them together', () => {
    for (const cue of Object.values(cues)) {
      for (const [i, part] of cue.parts.entries()) {
        const where = `${cue.name}, part ${i} (${part.play})`;
        assert.equal(part.steps.length % cue.bar, 0, `${where} is ${part.steps.length} steps`);
        assert.equal(cue.length % part.steps.length, 0, `${where} drifts against the rest of the cue`);
      }
    }
  });

  it('hands every sting on to a cue that exists', () => {
    for (const cue of Object.values(cues)) {
      if (cue.once && cue.then) assert.ok(cues[cue.then], `${cue.name} hands on to "${cue.then}"`);
    }
  });

  it('keeps every note where a speaker can play it', () => {
    for (const cue of Object.values(cues)) {
      for (const part of cue.parts) {
        for (const step of part.steps) {
          for (const note of step?.notes ?? []) {
            const freq = hz(note);
            assert.ok(freq > 30 && freq < 5000, `${cue.name}/${part.play} has a note at ${freq.toFixed(0)}Hz`);
          }
        }
      }
    }
  });

  it('builds up the deeper the run gets, and never back down', () => {
    let last = 0;
    for (let distance = 0; distance < 3000; distance += 10) {
      const level = SOUNDTRACK.level(running(distance));
      assert.ok(Number.isInteger(level) && level >= last && level <= 3, `level ${level} at ${distance}m`);
      last = level;
    }
    assert.equal(SOUNDTRACK.level(running(0)), 0);
    assert.equal(last, 3);
    assert.equal(SOUNDTRACK.level({ state: 'over', distance: 900 }), 0);
  });

  it('has something playing at every level of the run', () => {
    for (let level = 0; level <= 3; level++) {
      const on = cues.run.parts.filter((part) => part.at <= level && level < part.until);
      assert.ok(on.length > 0, `nothing plays at level ${level}`);
      if (level > 0) {
        assert.ok(cues.run.parts.some((part) => part.at === level), `level ${level} adds nothing`);
      }
    }
  });

  it('gets through a whole run, all the way up and out, on real parts', () => {
    const ctx = fakeAudio();
    const music = createMusic(SOUNDTRACK, { context: ctx });
    const frame = (snapshot) => {
      ctx.advance(1 / 30);
      music.update(snapshot);
    };
    music.play('title');
    for (let t = 0; t < 12; t += 1 / 30) frame({ state: 'ready' });
    music.play('run');
    for (let t = 0; t < 40; t += 1 / 30) frame(running(t * 25));
    assert.equal(music.level, 3);
    music.duck();
    music.play('over');
    for (let t = 0; t < 20; t += 1 / 30) frame({ state: 'over' });
    assert.equal(music.cue, 'title', 'the sting did not hand back to the title');

    const sources = ctx.started;
    assert.ok(sources.length > 500, `only ${sources.length} sources in a minute of music`);
    for (const source of sources) {
      assert.ok(source.stoppedAt > source.startedAt, 'a source was never stopped');
    }
    const ended = sources.filter((source) => source.ended);
    assert.ok(ended.length > sources.length * 0.9);
    assert.ok(ended.every((source) => source.outputs.size === 0), 'a finished note was left wired up');
  });
});
