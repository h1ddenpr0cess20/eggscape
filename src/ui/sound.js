const VOICES = {
  jump: { from: 420, to: 820, time: 0.12, type: 'square', gain: 0.05 },
  land: { from: 220, to: 120, time: 0.08, type: 'triangle', gain: 0.04 },
  bit: { from: 880, to: 1560, time: 0.09, type: 'square', gain: 0.05 },
  smash: { from: 640, to: 90, time: 0.22, type: 'square', gain: 0.07 },
  hit: { from: 300, to: 70, time: 0.3, type: 'sawtooth', gain: 0.09 },
  over: { from: 260, to: 40, time: 0.9, type: 'sawtooth', gain: 0.1 },
  start: { from: 180, to: 760, time: 0.3, type: 'square', gain: 0.05 },
};

/** A handful of oscillators' worth of arcade, built on the first gesture
 *  because no browser will start an AudioContext before one. */
export function createSound() {
  let ctx = null;
  let muted = false;

  function context() {
    if (ctx) return ctx;
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  }

  return {
    get muted() { return muted; },
    set muted(value) { muted = Boolean(value); },

    play(name) {
      const voice = VOICES[name];
      if (!voice || muted) return;
      const audio = context();
      if (!audio) return;
      if (audio.state === 'suspended') audio.resume();

      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.from, now);
      osc.frequency.exponentialRampToValueAtTime(voice.to, now + voice.time);
      gain.gain.setValueAtTime(voice.gain, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.time);
      osc.connect(gain).connect(audio.destination);
      osc.start(now);
      osc.stop(now + voice.time + 0.02);
    },
  };
}
