import { hit, hold, rest, shape } from './music.js';

/**
 * Eggscape the Matrix: psytrance, because the sequels cut their fights to
 * Juno Reactor, and because a bass that rolls three sixteenths behind every
 * kick is the sound of something that does not stop.
 *
 * E minor, round a progression that goes Em Em C C Am Am F B — and the F is
 * the whole trick. It is a semitone above home, where nothing that belongs in
 * E minor lives, and it is what makes the loop sound like the code is wrong.
 */

const CHORDS = [
  { root: 'e2', pad: 'e3+g3+b3', rain: ['e5', 'g5', 'b5'] },
  { root: 'e2', pad: 'e3+g3+b3', rain: ['e5', 'g5', 'b5'], turn: 'e3' },
  { root: 'c2', pad: 'e3+g3+c4', rain: ['e5', 'g5', 'c6'] },
  { root: 'c2', pad: 'e3+g3+c4', rain: ['e5', 'g5', 'c6'], turn: 'c3' },
  { root: 'a1', pad: 'e3+a3+c4', rain: ['e5', 'a5', 'c6'] },
  { root: 'a1', pad: 'e3+a3+c4', rain: ['e5', 'a5', 'c6'], turn: 'a2' },
  { root: 'f2', pad: 'f3+a3+c4', rain: ['f5', 'a5', 'c6'] },
  { root: 'b1', pad: 'd#3+f#3+b3', rain: ['d#5', 'f#5', 'b5'], turn: 'b2' },
];

const each = (write) => CHORDS.map(write).join(' | ');

/** Kick, bass, bass, bass — and on a turn the last beat jumps the octave. */
const rolling = ({ root, turn }) => {
  const beat = `. ${root} ${root} ${root}`;
  return [beat, beat, beat, turn ? `. ${turn} ${root} ${turn}` : beat].join(' ');
};

/** The green rain: three notes against four beats, so it never lands the
 *  same way twice in a bar. */
const falling = ({ rain }) => Array.from({ length: 16 }, (_, i) => rain[i % 3] + (i % 4 ? '' : '!')).join(' ');

const FOUR = 'x . . . x . . . x . . . x . . .';

const LEAD = [
  'b4 - - - e5 - - - g5 - f#5 - e5 - - -',
  'd5 - - - e5 - - - b4 - - - - - - -',
  'c5 - - - e5 - - - g5 - a5 - g5 - - -',
  'e5 - - - g5 - - - c5 - - - - - - -',
  'a4 - - - c5 - - - e5 - d5 - c5 - - -',
  'b4 - - - c5 - - - a4 - - - - - - -',
  'f5 - - - e5 - - - f5 - a5 - f5 - - -',
  'f#5 - - - d#5 - - - b4 - - - - - - -',
].join(' | ');

/** The title is the pod: the same chords, slowed right down, and a heart. */
const DRIFT = [
  '. . . . e6 . . . . . b5 . . . . .',
  '. . g6 . . . . . . . . . e6 . . .',
  '. . . . c6 . . . . . g5 . . . . .',
  '. . e6 . . . . . . . . . . . g6 .',
  '. . . . a5 . . . . . e6 . . . . .',
  '. . c6 . . . . . . . . . a5 . . .',
  '. . . . f6 . . . . . c6 . . . . .',
  '. . d#6 . . . . . . . . . b5 . . .',
].join(' | ');

function instruments({ voice }) {
  let lastLead = null;

  return {
    kick(out, t, _dur, _freqs, vel) {
      const note = voice(t);
      const body = note.osc('sine', 150);
      body.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      const amp = note.gain();
      body.connect(amp).connect(out);
      const click = note.noise();
      const bite = note.filter('highpass', 2800);
      const clickAmp = note.gain();
      click.connect(bite).connect(clickAmp).connect(out);
      hit(clickAmp.gain, t, 0.012, 0.3 * vel);
      note.play(hit(amp.gain, t, 0.34, 0.95 * vel));
    },

    /** Three hands, a hair apart, and a room behind them. */
    clap(out, t, _dur, _freqs, vel) {
      const note = voice(t);
      const src = note.noise();
      const band = note.filter('bandpass', 1500, 0.9);
      const amp = note.gain();
      src.connect(band).connect(amp).connect(out);
      for (let i = 0; i < 3; i++) {
        amp.gain.setValueAtTime(0.8 * vel, t + i * 0.011);
        amp.gain.setTargetAtTime(0.1, t + i * 0.011, 0.003);
      }
      amp.gain.setValueAtTime(0.8 * vel, t + 0.033);
      amp.gain.setTargetAtTime(0, t + 0.033, 0.045);
      note.play(t + 0.3);
    },

    /** Closed, or open on an accent. */
    hat(out, t, _dur, _freqs, vel) {
      const note = voice(t);
      const src = note.noise();
      const air = note.filter('highpass', 7200);
      const amp = note.gain();
      src.connect(air).connect(amp).connect(out);
      note.play(hit(amp.gain, t, vel > 1.2 ? 0.16 : 0.04, 0.5 * Math.min(vel, 1)));
    },

    tick(out, t, _dur, _freqs, vel) {
      const note = voice(t);
      const src = note.noise();
      const band = note.filter('bandpass', 9500, 1.4);
      const amp = note.gain();
      src.connect(band).connect(amp).connect(out);
      note.play(hit(amp.gain, t, 0.022, 0.6 * vel));
    },

    /** Two saws a little apart, and a resonant filter that snaps open on
     *  every note and shuts again before the next. */
    bass(out, t, dur, [freq], vel) {
      const note = voice(t);
      const low = note.filter('lowpass', 170, 7);
      low.frequency.linearRampToValueAtTime(760 * vel, t + 0.008);
      low.frequency.setTargetAtTime(160, t + 0.008, 0.045);
      for (const cents of [-9, 9]) note.osc('sawtooth', freq, cents).connect(low);
      const body = note.osc('sine', freq);
      const bodyAmp = note.gain(0.5);
      body.connect(bodyAmp).connect(low);
      const amp = note.gain();
      low.connect(amp).connect(out);
      note.play(shape(amp.gain, t, dur * 0.85, {
        peak: 0.55 * vel, attack: 0.003, decay: 0.1, sustain: 0.6, release: 0.03,
      }));
    },

    rain(out, t, _dur, [freq], vel) {
      const note = voice(t);
      const src = note.osc('square', freq);
      const low = note.filter('lowpass', 4200);
      const amp = note.gain();
      src.connect(low).connect(amp).connect(out);
      note.play(hit(amp.gain, t, 0.13, 0.28 * vel));
    },

    pad(out, t, dur, freqs, vel) {
      const note = voice(t);
      const low = note.filter('lowpass', 1300, 1.2);
      note.wobble(low.frequency, 0.13, 380);
      for (const freq of freqs) {
        for (const cents of [-11, 0, 11]) note.osc('sawtooth', freq, cents).connect(low);
      }
      const amp = note.gain();
      low.connect(amp).connect(out);
      note.play(shape(amp.gain, t, dur, {
        peak: (0.2 * vel) / freqs.length, attack: 0.55, decay: 1, sustain: 0.85, release: 1.1,
      }));
    },

    /** A saw with a square under it, sliding in from wherever it last was. */
    lead(out, t, dur, [freq], vel) {
      const note = voice(t);
      const low = note.filter('lowpass', 2600, 2);
      const from = lastLead && Math.abs(Math.log2(lastLead / freq)) < 1 ? lastLead : freq;
      lastLead = freq;
      for (const [type, cents] of [['sawtooth', 0], ['square', 7]]) {
        const osc = note.osc(type, from, cents);
        osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
        note.wobble(osc.detune, 5.4, 14, 0.25);
        osc.connect(low);
      }
      const amp = note.gain();
      low.connect(amp).connect(out);
      note.play(shape(amp.gain, t, dur, {
        peak: 0.3 * vel, attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.18,
      }));
    },

    bleep(out, t, _dur, [freq], vel) {
      const note = voice(t);
      const src = note.osc('sine', freq);
      const edge = note.osc('square', freq * 2);
      const edgeAmp = note.gain(0.12);
      edge.connect(edgeAmp);
      const amp = note.gain();
      src.connect(amp);
      edgeAmp.connect(amp);
      amp.connect(out);
      note.play(hit(amp.gain, t, 0.05, 0.35 * vel));
    },

    sub(out, t, dur, [freq], vel) {
      const note = voice(t);
      const src = note.osc('sine', freq);
      const amp = note.gain();
      src.connect(amp).connect(out);
      note.play(shape(amp.gain, t, dur, {
        peak: 0.6 * vel, attack: 0.5, decay: 1, sustain: 0.9, release: 1.2,
      }));
    },

    /** Somebody asleep in a pod. */
    heart(out, t, _dur, _freqs, vel) {
      const note = voice(t);
      const body = note.osc('sine', 72);
      body.frequency.exponentialRampToValueAtTime(44, t + 0.09);
      const amp = note.gain();
      body.connect(amp).connect(out);
      note.play(hit(amp.gain, t, 0.2, 0.9 * vel, 0.008));
    },

    /** Everything powering down at once, which is what a failure is. */
    drop(out, t, dur, [freq], vel) {
      const note = voice(t);
      const src = note.osc('sawtooth', freq);
      src.frequency.exponentialRampToValueAtTime(freq / 8, t + dur);
      const low = note.filter('lowpass', 2200, 3);
      low.frequency.exponentialRampToValueAtTime(140, t + dur);
      const amp = note.gain();
      src.connect(low).connect(amp).connect(out);
      note.play(shape(amp.gain, t, dur, {
        peak: 0.35 * vel, attack: 0.005, decay: dur, sustain: 0.6, release: 0.3,
      }));
    },
  };
}

export const SOUNDTRACK = {
  volume: 0.22,
  space: {
    reverb: { seconds: 2.6, decay: 3.2, level: 0.9 },
    echo: { beats: 0.75, feedback: 0.42, tone: 2400 },
  },
  instruments,

  /** The deeper the egg, the more of the track is playing. */
  level(snapshot) {
    if (snapshot.state !== 'running') return 0;
    const depth = snapshot.distance;
    return depth < 100 ? 0 : depth < 300 ? 1 : depth < 600 ? 2 : 3;
  },

  cues: {
    title: {
      bpm: 96,
      parts: [
        { play: 'pad', gain: 1.25, wet: 0.5, notes: each(({ pad }) => hold(pad, 16)) },
        { play: 'sub', gain: 0.22, notes: each(({ root }) => hold(root, 16)) },
        { play: 'rain', gain: 1.7, echo: 0.55, wet: 0.3, pan: -0.25, notes: DRIFT },
        { play: 'heart', gain: 0.55, notes: 'x . o . . . . . x . o . . . . .' },
      ],
    },

    run: {
      bpm: 138,
      parts: [
        { play: 'kick', gain: 0.56, notes: FOUR },
        { play: 'bass', gain: 0.27, notes: each(rolling) },
        { play: 'hat', gain: 1.4, at: 1, pan: 0.2, notes: '. . x . . . x . . . x . . . X .' },
        { play: 'clap', gain: 2, at: 1, wet: 0.35, notes: '. . . . x . . . . . . . x . . .' },
        { play: 'rain', gain: 0.66, at: 1, echo: 0.4, pan: -0.3, notes: each(falling) },
        { play: 'tick', gain: 1.3, at: 2, pan: 0.35, notes: 'o o x o o o x o o o x o o x x o' },
        { play: 'pad', gain: 0.8, at: 2, wet: 0.45, notes: each(({ pad }) => hold(pad, 16)) },
        {
          play: 'bleep', gain: 1.4, at: 2, echo: 0.5, pan: 0.4,
          notes: '. . . . . . . b6 . . . . . . e7 . | . . . g6 . . . . . . . . . . . .',
        },
        { play: 'lead', gain: 0.45, at: 3, wet: 0.3, echo: 0.3, notes: LEAD },
      ],
    },

    /** System failure: a chord that is not in the key, and the power going. */
    over: {
      bpm: 138,
      once: true,
      then: 'title',
      parts: [
        { play: 'drop', gain: 0.8, wet: 0.4, notes: `${hold('e4', 16)} ${rest(16)}` },
        { play: 'pad', gain: 0.8, wet: 0.6, notes: `${hold('e3+g3+bb3', 16)} ${rest(16)}` },
        { play: 'bleep', gain: 0.4, echo: 0.6, notes: `e6 e6 e6 e6 e6 e6 . . . . . . . . . . ${rest(16)}` },
      ],
    },
  },
};
