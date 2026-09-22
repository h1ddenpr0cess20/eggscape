import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createMusic, diatonic, hit, hz, midi, noteName, parse, retune,
} from '../src/ui/music.js';
import { fakeAudio } from './helpers/audio.js';

/** 120 a minute: a step is an eighth of a second and a bar is two. */
const STEP = 0.125;
const BAR = 2;

const TRACK = {
  instruments: ({ voice }) => ({
    beep(out, t, _dur, freqs, vel) {
      const note = voice(t);
      const osc = note.osc('square', freqs[0] ?? 100);
      const amp = note.gain();
      osc.connect(amp).connect(out);
      note.play(hit(amp.gain, t, 0.05, 0.3 * vel));
    },
  }),
  level: (snapshot) => snapshot.level ?? 0,
  cues: {
    loop: {
      bpm: 120,
      parts: [
        { play: 'beep', notes: 'c4 . . . c4 . . . c4 . . . c4 . . .' },
        { play: 'beep', at: 1, notes: 'e5 e5 e5 e5 e5 e5 e5 e5 e5 e5 e5 e5 e5 e5 e5 e5' },
      ],
    },
    sting: {
      bpm: 120,
      once: true,
      then: 'loop',
      parts: [{ play: 'beep', notes: 'g4 - - - . . . .' }],
    },
  },
};

const C4 = hz(60);
const E5 = hz(76);
const G4 = hz(67);

function rig(track = TRACK) {
  const ctx = fakeAudio();
  const source = { context: null };
  const music = createMusic(track, source);
  return { ctx, source, music };
}

/** Every note that has been put down, as when and what. */
function heard(ctx, since = 0) {
  return ctx.started
    .filter((node) => node.kind === 'oscillator' && node.startedAt >= since)
    .map((node) => ({ at: node.startedAt, freq: node.frequency.events[0].value }));
}

/** Run the page's frame loop for a while. */
function run(ctx, music, seconds, snapshot = {}) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    ctx.advance(1 / 60);
    music.update(snapshot);
  }
}

const near = (a, b) => Math.abs(a - b) < 1e-6;
const onGrid = (at, origin) => near(Math.round((at - origin) / STEP), (at - origin) / STEP);

describe('notation', () => {
  it('reads notes, chords, holds, rests, hits and marks', () => {
    const steps = parse('e2 - - . e3+g3+b3! | x X o c#4? . bb3 -');
    assert.equal(steps.length, 12, 'bar lines are for the reader, not the count');
    assert.deepEqual(steps[0], { notes: [40], vel: 1, len: 3 });
    assert.equal(steps[1], null);
    assert.deepEqual(steps[4].notes, [52, 55, 59]);
    assert.ok(steps[4].vel > 1, 'an accent is louder');
    assert.deepEqual(steps[5], { notes: [], vel: 1, len: 1 });
    assert.ok(steps[6].vel > steps[5].vel);
    assert.ok(steps[7].vel < steps[5].vel);
    assert.ok(steps[8].vel < 1, 'a ghost is quieter');
    assert.equal(steps[8].notes[0], 61);
    assert.equal(steps[10].len, 2);
    assert.equal(steps[11], null);
  });

  it('does not let a hold carry across a rest', () => {
    const steps = parse('c4 . - -');
    assert.equal(steps[0].len, 1);
  });

  it('refuses what is not music', () => {
    assert.throws(() => parse('c4 h2 .'), /h2/);
    assert.throws(() => parse('c4 C4'), /C4/);
  });

  it('names notes the way it reads them', () => {
    assert.equal(hz(69), 440);
    assert.equal(midi('a4'), 69);
    assert.equal(midi('bb3'), midi('a#3'));
    for (let note = 24; note < 108; note++) assert.equal(midi(noteName(note)), note);
  });

  it('finds a second part a third under the first, in the key', () => {
    const G = [7, 9, 11, 0, 2, 4, 6];
    assert.equal(retune('b4 - d5! . g4 f#5 c5', diatonic(G, -2)), 'g4 - b4! . e4 d5 a4');
    assert.equal(retune('c4+e4 x', (note) => note + 12), 'c5+e5 x');
  });
});

describe('music', () => {
  it('waits for a context rather than building one', () => {
    const { ctx, music } = rig();
    music.play('loop');
    music.update({});
    assert.equal(music.cue, 'loop');
    assert.deepEqual(ctx.nodes.map((node) => node.kind), ['destination']);
  });

  it('puts notes down on the grid, and only a little way ahead', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    const first = heard(ctx);
    assert.ok(first.length > 0, 'nothing was scheduled');
    assert.ok(first.every(({ at }) => at > 0 && at <= 1), 'scheduled too far ahead');
    run(ctx, music, 3);
    const settled = ctx.currentTime;
    const ahead = heard(ctx).filter(({ at }) => at > settled);
    assert.ok(ahead.every(({ at }) => at - settled <= 0.3), 'still reaching a long way ahead at 60fps');

    run(ctx, music, 4);
    const all = heard(ctx);
    const origin = all[0].at;
    assert.ok(all.every(({ at }) => onGrid(at, origin)), 'a note came off the grid');
    const beats = all.filter(({ freq }) => near(freq, C4)).map(({ at }) => at - origin);
    assert.ok(beats.length >= 8);
    beats.forEach((at, i) => assert.ok(near(at, i * 4 * STEP), `beat ${i} at ${at}`));
  });

  it('drops what a stall missed instead of playing it all at once', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    run(ctx, music, 1);
    const origin = heard(ctx)[0].at;

    ctx.advance(3);
    const before = ctx.started.length;
    music.update({});
    const burst = heard(ctx).slice(-(ctx.started.length - before));
    assert.ok(burst.length <= 3, `${burst.length} notes landed at once`);
    assert.ok(burst.every(({ at }) => at >= ctx.currentTime - 0.02), 'a note was put down in the past');
    assert.ok(burst.every(({ at }) => onGrid(at, origin)), 'the stall knocked it off the grid');
  });

  it('does not fall apart when the frames come slowly', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    const origin = heard(ctx)[0].at;
    /** Two and a half frames a second: slower than the look-ahead. */
    for (let t = 0; t < 6; t += 0.4) {
      ctx.advance(0.4);
      music.update({});
    }
    const beats = heard(ctx).filter(({ freq }) => near(freq, C4)).map(({ at }) => at - origin);
    assert.ok(beats.length >= 12, `${beats.length} beats in six seconds`);
    beats.forEach((at, i) => assert.ok(near(at, i * 4 * STEP), `beat ${i} was dropped or moved`));
  });

  it('keeps time while it is muted, and plays nothing', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    const origin = heard(ctx)[0].at;
    music.muted = true;
    const count = ctx.started.length;
    run(ctx, music, 3);
    assert.equal(ctx.started.length, count);

    music.muted = false;
    run(ctx, music, 1);
    const after = heard(ctx).slice(count);
    assert.ok(after.length > 0);
    assert.ok(after.every(({ at }) => onGrid(at, origin)));
  });

  it('brings a layer in on the next bar line, not the moment it is asked for', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    const origin = heard(ctx)[0].at;
    run(ctx, music, 0.9, { level: 0 });
    run(ctx, music, 3, { level: 1 });
    const layer = heard(ctx).filter(({ freq }) => near(freq, E5));
    assert.ok(layer.length > 0, 'the layer never came in');
    assert.ok(near(layer[0].at - origin, BAR), `it came in at ${layer[0].at - origin}s`);
  });

  it('plays a sting once and then what comes after it, on the beat', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('sting');
    run(ctx, music, 2);
    const notes = heard(ctx);
    const stings = notes.filter(({ freq }) => near(freq, G4));
    assert.equal(stings.length, 1);
    const next = notes.find(({ freq }) => near(freq, C4));
    assert.ok(next, 'nothing came after the sting');
    assert.ok(near(next.at - stings[0].at, 8 * STEP), 'the loop did not start where the sting ended');
    assert.equal(music.cue, 'loop');
  });

  it('does not restart a cue that is already playing', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    run(ctx, music, 0.6);
    const origin = heard(ctx)[0].at;
    music.play('loop');
    run(ctx, music, 1.5);
    assert.ok(heard(ctx).every(({ at }) => onGrid(at, origin)), 'it started again off the grid');
  });

  it('fades out whatever it is replacing', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    run(ctx, music, 0.5);
    const gains = ctx.nodes.filter((node) => node.kind === 'gain');
    music.play('sting');
    assert.ok(gains.some((node) => node.gain.events.some((e) => e.kind === 'target' && e.value === 0
      && near(e.time, ctx.currentTime))), 'the old cue was left playing under the new one');
  });

  it('lets go of every note once it is over', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    run(ctx, music, 5, { level: 1 });
    music.stop();
    run(ctx, music, 2);
    const voices = ctx.started;
    assert.ok(voices.length > 20);
    assert.ok(voices.every((node) => node.ended), 'a source never ended');
    assert.ok(voices.every((node) => node.outputs.size === 0), 'a note was left wired up');
  });

  it('muffles itself when the game takes a hit, and comes back', () => {
    const { ctx, source, music } = rig();
    source.context = ctx;
    music.play('loop');
    music.duck();
    const filter = ctx.nodes.find((node) => node.kind === 'filter');
    const ramps = filter.frequency.events.filter((e) => e.kind === 'exponential');
    assert.equal(ramps.length, 2);
    assert.ok(ramps[0].value < 1000, 'it did not muffle');
    assert.ok(ramps[1].value > 10000, 'it did not come back');
  });

  it('refuses a cue it does not have', () => {
    const { music } = rig();
    assert.throws(() => music.play('encore'), /encore/);
  });
});
