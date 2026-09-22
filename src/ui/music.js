/**
 * The soundtrack, written down rather than recorded: a step sequencer on the
 * page's own AudioContext, reading its parts out of strings and playing them
 * on instruments made of oscillators and noise. There is nothing to download,
 * which is the rule for everything else here too.
 *
 * A part is one token per sixteenth:
 *
 *   e2  c#4  bb3       a note
 *   e3+g3+b3           a chord
 *   e2!  e2?           accented, ghosted
 *   x  X  o            a hit, an accent, a ghost — drums have no pitch
 *   -                  hold whatever is sounding for another step
 *   .                  nothing
 *   |                  a bar line, for the reader; the sequencer skips it
 *
 * The game never talks to this in time. It says which cue it wants and how
 * worked up it is, and the sequencer lands both on the grid: a cue starts on
 * the next step, a new layer comes in on the next bar line.
 */

const LETTERS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
const HITS = { x: 1, X: 1.4, o: 0.5 };
const MARKS = { '!': 1.35, '?': 0.55 };
const SPACERS = new Set(['.', '-', '|']);

/**
 * How far ahead of the clock notes are put down. A frame is sixteen
 * milliseconds and a frame that hitches is a couple of hundred, and a note
 * nobody scheduled before the hitch is a note that arrives late.
 */
const AHEAD = 0.25;
/** And the furthest it will ever go, however slow the frames are coming. */
const REACH = 1;
/** Later than this and a step is dropped rather than played out of time. */
const LATE = 0.02;
/** A cue asked for now starts this far from now, so its first note is not
 *  already late by the time it reaches the speakers. */
const LEAD = 0.05;
/** The master filter, open and ducked. */
const OPEN = 18000;
const DUCKED = 420;

export function midi(name) {
  const match = /^([a-g])(#|b)?(-?\d)$/.exec(name);
  if (!match) return null;
  const accidental = match[2] === '#' ? 1 : (match[2] === 'b' ? -1 : 0);
  return 12 * (Number(match[3]) + 1) + LETTERS[match[1]] + accidental;
}

export function noteName(note) {
  return `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

export const hz = (note) => 440 * 2 ** ((note - 69) / 12);

/** A note held for `steps`, and `steps` of nothing — for writing parts. */
export const hold = (word, steps) => [word, ...Array(steps - 1).fill('-')].join(' ');
export const rest = (steps) => Array(steps).fill('.').join(' ');

function event(word) {
  if (word in HITS) return { notes: [], vel: HITS[word], len: 1 };
  const mark = MARKS[word.at(-1)];
  const notes = (mark ? word.slice(0, -1) : word).split('+').map(midi);
  if (notes.some((note) => note === null)) return null;
  return { notes, vel: mark ?? 1, len: 1 };
}

/** One entry per step: an event, or null for a rest or a held step. */
export function parse(text) {
  const steps = [];
  let sounding = null;
  for (const word of text.trim().split(/\s+/)) {
    if (word === '|' || word === '') continue;
    if (word === '-' || word === '.') {
      if (word === '-' && sounding) sounding.len += 1;
      else sounding = null;
      steps.push(null);
      continue;
    }
    const found = event(word);
    if (!found) throw new Error(`"${word}" is not a note, a hit or a rest`);
    steps.push(found);
    sounding = found;
  }
  return steps;
}

/** Every note in a part put through `map`, rhythm and marks untouched. */
export function retune(text, map) {
  return text.split(/(\s+)/).map((word) => {
    if (!word.trim() || word in HITS || SPACERS.has(word)) return word;
    const mark = word.at(-1) in MARKS ? word.at(-1) : '';
    const body = mark ? word.slice(0, -1) : word;
    return body.split('+').map((name) => noteName(map(midi(name)))).join('+') + mark;
  }).join('');
}

/**
 * Up or down a scale by degrees rather than semitones, which is how a second
 * fiddle finds its part: a third below is two steps down the key, and what
 * that is in semitones depends on where in the key you started.
 */
export function diatonic(scale, degrees) {
  const root = scale[0];
  const steps = scale.map((pc) => (((pc - root) % 12) + 12) % 12).sort((a, b) => a - b);
  return (note) => {
    const rel = note - root;
    const index = steps.indexOf(((rel % 12) + 12) % 12);
    if (index < 0) return note - 3;
    const degree = Math.floor(rel / 12) * 7 + index + degrees;
    return root + Math.floor(degree / 7) * 12 + steps[((degree % 7) + 7) % 7];
  };
}

/** Every cue with its parts parsed, and the defaults filled in. */
export function compile(cues) {
  const out = {};
  for (const [name, cue] of Object.entries(cues)) {
    const parts = cue.parts.map((part) => ({
      at: 0, until: Infinity, gain: 1, wet: 0, echo: 0, pan: 0,
      ...part,
      steps: parse(part.notes),
    }));
    out[name] = {
      bar: 16, swing: 0, once: false, then: null,
      ...cue,
      name,
      parts,
      length: Math.max(...parts.map((part) => part.steps.length)),
    };
  }
  return out;
}

/** A seeded stream of [-1, 1), so the noise is the same noise every time. */
function stream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

function whiteNoise(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const next = stream(7);
  for (let i = 0; i < data.length; i++) data[i] = next();
  return buffer;
}

/** A room, made the cheap way: two channels of noise dying away. */
function impulse(ctx, { seconds = 2, decay = 3 } = {}) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const next = stream(11 + channel);
    for (let i = 0; i < length; i++) data[i] = next() * (1 - i / length) ** decay;
  }
  return buffer;
}

/**
 * An envelope on a param: up to `peak`, down towards `sustain`, and away once
 * the note is over. Returns when it has got there, which is when the voice
 * can stop.
 */
export function shape(param, t, dur, {
  peak = 1, attack = 0.005, decay = 0.2, sustain = 0, release = 0.08,
} = {}) {
  const off = t + Math.max(attack, dur);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(peak * sustain, t + attack, decay / 4);
  param.setTargetAtTime(0, off, release / 5);
  return off + release;
}

/** Something struck: there at once, and gone in `seconds`. */
export function hit(param, t, seconds, peak = 1, attack = 0.002) {
  return shape(param, t, seconds, { peak, attack, decay: seconds, release: 0.03 });
}

/**
 * Plays a soundtrack on whatever context `source.context` has — and never
 * builds one, because the page may only do that inside a gesture and the
 * music is never what the player just pressed.
 */
export function createMusic(soundtrack, source, { ahead = AHEAD } = {}) {
  const cues = compile(soundtrack.cues);
  const volume = soundtrack.volume ?? 0.5;

  let ctx = null;
  let rig = null;
  let voices = null;
  let wanted = null;
  let current = null;
  let level = 0;
  let muted = false;
  let lastPump = null;
  let slack = 0;
  const retired = [];

  /** One note's worth of nodes, let go of together once the last one stops. */
  function voice(start) {
    const nodes = [];
    const sources = [];
    const own = (node) => {
      nodes.push(node);
      return node;
    };
    const run = (node, offset) => {
      sources.push([own(node), offset]);
      return node;
    };
    const note = {
      osc(type, freq, detune = 0) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (detune) osc.detune.setValueAtTime(detune, start);
        return run(osc);
      },
      noise() {
        const src = ctx.createBufferSource();
        src.buffer = rig.noise;
        src.loop = true;
        return run(src, (rig.scatter() + 1) * 0.45);
      },
      buffer(buffer, rate = 1) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.setValueAtTime(rate, start);
        return run(src);
      },
      gain(value = 0) {
        const gain = own(ctx.createGain());
        gain.gain.setValueAtTime(value, start);
        return gain;
      },
      filter(type, freq, q = 0.7) {
        const filter = own(ctx.createBiquadFilter());
        filter.type = type;
        filter.frequency.setValueAtTime(freq, start);
        filter.Q.setValueAtTime(q, start);
        return filter;
      },
      /** A slow oscillator on a param — vibrato, tremolo, a tape that
       *  has been played too often — faded in over `delay`. */
      wobble(param, rate, depth, delay = 0) {
        const lfo = note.osc('sine', rate);
        const amount = note.gain(0);
        amount.gain.linearRampToValueAtTime(depth, start + Math.max(0.001, delay));
        lfo.connect(amount).connect(param);
      },
      play(end) {
        let live = sources.length;
        for (const [node, offset] of sources) {
          node.onended = () => {
            live -= 1;
            if (live === 0) for (const each of nodes) each.disconnect();
          };
          node.start(start, offset);
          node.stop(end);
        }
      },
    };
    return note;
  }

  function build(audio) {
    ctx = audio;
    const space = soundtrack.space ?? {};

    const master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    /** After the volume, and high: this is a safety on the peaks of eight
     *  layers at once, not a squeeze on one. A compressor adds back what it
     *  thinks it took away, so a low threshold would drag every quiet cue up
     *  to the level of the loudest. */
    const squash = ctx.createDynamicsCompressor();
    squash.threshold.value = -8;
    squash.knee.value = 6;
    squash.ratio.value = 6;
    squash.attack.value = 0.004;
    squash.release.value = 0.2;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = OPEN;
    const mix = ctx.createGain();
    mix.connect(tone).connect(master).connect(squash).connect(ctx.destination);

    const room = ctx.createConvolver();
    room.buffer = impulse(ctx, space.reverb);
    const roomOut = ctx.createGain();
    roomOut.gain.value = space.reverb?.level ?? 1;
    room.connect(roomOut).connect(mix);

    const echo = space.echo ?? {};
    const delay = ctx.createDelay(4);
    const dull = ctx.createBiquadFilter();
    dull.type = 'lowpass';
    dull.frequency.value = echo.tone ?? 2600;
    const feedback = ctx.createGain();
    feedback.gain.value = echo.feedback ?? 0.35;
    delay.connect(dull).connect(feedback).connect(delay);
    dull.connect(mix);

    rig = { master, tone, mix, room, delay, noise: whiteNoise(ctx), scatter: stream(3) };
    voices = soundtrack.instruments({ ctx, voice });
  }

  function link(node, to) {
    node.connect(to);
    return node;
  }

  /** A part's own way in: its level, its place in the stereo, its sends. */
  function wire(part, bus, nodes) {
    const input = ctx.createGain();
    input.gain.value = part.gain;
    nodes.push(input);
    let out = input;
    if (part.pan && ctx.createStereoPanner) {
      out = input.connect(ctx.createStereoPanner());
      out.pan.value = part.pan;
      nodes.push(out);
    }
    out.connect(bus.dry);
    for (const send of ['wet', 'echo']) {
      if (!part[send]) continue;
      const amount = link(ctx.createGain(), bus[send]);
      amount.gain.value = part[send];
      out.connect(amount);
      nodes.push(amount);
    }
    return input;
  }

  function begin(request, at) {
    const cue = cues[request.name];
    const bpm = request.bpm ?? cue.bpm;
    const stepTime = 60 / bpm / 4;
    const bus = {
      dry: link(ctx.createGain(), rig.mix),
      wet: link(ctx.createGain(), rig.room),
      echo: link(ctx.createGain(), rig.delay),
    };
    const nodes = Object.values(bus);
    const parts = cue.parts.map((part) => ({ part, input: wire(part, bus, nodes) }));
    /** The frames just after a cue starts are the ones most likely to be
     *  slow — a new run is when the renderer has the most to build — so the
     *  opening goes down further ahead than it needs to, just in case. */
    slack = Math.max(slack, 0.5);
    /** The echo is in time with whatever is playing, so it moves with it —
     *  gently, since there is still some of the last cue in the line. */
    const beats = soundtrack.space?.echo?.beats ?? 0.75;
    rig.delay.delayTime.setTargetAtTime(Math.min(3.9, (beats * 60) / bpm), at, 0.05);
    current = {
      request, cue, stepTime, bus, nodes, parts, level,
      transpose: request.transpose ?? 0,
      step: 0,
      next: at,
    };
  }

  /**
   * Off the clock. A cue that is being replaced fades in a few milliseconds,
   * notes it had already put down included; one that simply finished is left
   * to ring, and its nodes are let go of once everything in it is over.
   */
  function retire(instance, at, fade) {
    if (fade) for (const node of Object.values(instance.bus)) node.gain.setTargetAtTime(0, at, 0.02);
    retired.push({ nodes: instance.nodes, after: at + (fade ? 1 : 12) });
  }

  function sweep(now) {
    for (let i = retired.length - 1; i >= 0; i--) {
      if (retired[i].after > now) continue;
      for (const node of retired[i].nodes) node.disconnect();
      retired.splice(i, 1);
    }
  }

  function strike(instance) {
    const { cue, step, stepTime } = instance;
    const time = instance.next + (step % 2 ? cue.swing * stepTime : 0);
    for (const { part, input } of instance.parts) {
      if (instance.level < part.at || instance.level >= part.until) continue;
      if (cue.once && step >= part.steps.length) continue;
      const hit = part.steps[step % part.steps.length];
      if (!hit) continue;
      const freqs = hit.notes.map((note) => hz(note + instance.transpose));
      voices[part.play](input, time, hit.len * stepTime, freqs, hit.vel);
    }
  }

  function pump() {
    const now = ctx.currentTime;
    /**
     * A slow phone is slow on every frame, not on one: at six frames a second
     * a quarter of a second of notes runs out between two of them, and the
     * music falls to pieces exactly where the game already has. So the notes
     * go down far enough ahead to cover the gaps it is really getting, and
     * come back in as those shrink.
     */
    if (lastPump !== null) slack = Math.max(slack * 0.97, now - lastPump);
    lastPump = now;
    const horizon = now + Math.min(REACH, Math.max(ahead, slack * 1.5 + 0.05));
    while (current && current.next < horizon) {
      const instance = current;
      /** A frame that came back late — a hitch, a tab in the background —
       *  skips the steps it missed and stays on the grid, rather than
       *  playing a second of music in one go. */
      if (instance.next < now - LATE) {
        const missed = Math.ceil((now - instance.next) / instance.stepTime);
        instance.step += missed;
        instance.next += missed * instance.stepTime;
        continue;
      }
      if (instance.cue.once && instance.step >= instance.cue.length) {
        retire(instance, instance.next, false);
        current = null;
        if (instance.cue.then) begin({ name: instance.cue.then }, instance.next);
        continue;
      }
      if (instance.step % instance.cue.bar === 0) instance.level = level;
      if (!muted) strike(instance);
      instance.step += 1;
      instance.next += instance.stepTime;
    }
    sweep(now);
  }

  function same(a, b) {
    return a.name === b.name && a.bpm === b.bpm && (a.transpose ?? 0) === (b.transpose ?? 0);
  }

  const music = {
    get muted() { return muted; },
    set muted(value) {
      muted = Boolean(value);
      if (rig) rig.master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.04);
    },

    /** What is playing, or about to be. */
    get cue() { return (wanted ?? current?.request)?.name ?? null; },

    get level() { return current?.level ?? level; },

    play(name, { bpm, transpose = 0 } = {}) {
      if (!cues[name]) throw new Error(`there is no cue called "${name}"`);
      const request = { name, bpm, transpose };
      const playing = wanted ?? current?.request;
      if (playing && same(playing, request)) return;
      wanted = request;
      music.update();
    },

    stop() {
      wanted = null;
      if (current) retire(current, ctx.currentTime, true);
      current = null;
    },

    /** The music taking the hit too: everything muffled, and back. */
    duck() {
      if (!rig) return;
      const t = ctx.currentTime;
      const freq = rig.tone.frequency;
      freq.cancelScheduledValues(t);
      freq.setValueAtTime(Math.min(OPEN, Math.max(DUCKED, freq.value)), t);
      freq.exponentialRampToValueAtTime(DUCKED, t + 0.04);
      freq.exponentialRampToValueAtTime(OPEN, t + 1.1);
    },

    /** Once a frame. The snapshot is how worked up the game is. */
    update(snapshot) {
      if (snapshot && soundtrack.level) level = soundtrack.level(snapshot);
      if (!ctx) {
        const audio = source.context;
        if (!audio) return;
        build(audio);
      }
      if (wanted) {
        if (current) retire(current, ctx.currentTime, true);
        begin(wanted, ctx.currentTime + LEAD);
        wanted = null;
      }
      if (current) pump();
    },
  };

  return music;
}
