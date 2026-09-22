/**
 * Just enough of an AudioContext to schedule music against and look at what
 * was scheduled. Time only moves when a test moves it, and a source only
 * ends when time passes its stop — which is when the real thing would let go
 * of it too.
 */

class Param {
  constructor(value) {
    this.value = value;
    this.events = [];
  }

  #at(kind, value, time, extra) {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new TypeError(`${kind}(${value}, ${time}) is not a number`);
    }
    this.events.push({ kind, value, time, extra });
    return this;
  }

  setValueAtTime(value, time) { return this.#at('set', value, time); }
  linearRampToValueAtTime(value, time) { return this.#at('linear', value, time); }

  exponentialRampToValueAtTime(value, time) {
    /** The real one throws on this, and on nothing else that is a number. */
    if (value <= 0) throw new RangeError(`an exponential ramp cannot reach ${value}`);
    return this.#at('exponential', value, time);
  }

  setTargetAtTime(value, time, constant) {
    if (!(constant > 0)) throw new RangeError(`a time constant of ${constant} never arrives`);
    return this.#at('target', value, time, constant);
  }

  cancelScheduledValues(time) {
    this.events = this.events.filter((event) => event.time < time);
    return this;
  }
}

class Node {
  constructor(ctx, kind) {
    this.context = ctx;
    this.kind = kind;
    this.outputs = new Set();
    ctx.nodes.push(this);
  }

  connect(to) {
    this.outputs.add(to);
    return to;
  }

  disconnect() {
    this.outputs.clear();
  }
}

class Source extends Node {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.startedAt = null;
    this.stoppedAt = null;
    this.onended = null;
  }

  start(when = 0) {
    if (this.startedAt !== null) throw new Error('a source can only be started once');
    this.startedAt = when;
    this.context.started.push(this);
  }

  stop(when = 0) {
    if (this.startedAt === null) throw new Error('stopped before it was started');
    this.stoppedAt = when;
  }
}

class Buffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel) {
    return this.data[channel];
  }
}

export function fakeAudio({ sampleRate = 8000 } = {}) {
  const ctx = {
    sampleRate,
    currentTime: 0,
    state: 'running',
    nodes: [],
    started: [],
    resume: () => Promise.resolve(),

    createGain() {
      const node = new Node(ctx, 'gain');
      node.gain = new Param(1);
      return node;
    },
    createBiquadFilter() {
      const node = new Node(ctx, 'filter');
      node.type = 'lowpass';
      node.frequency = new Param(350);
      node.Q = new Param(1);
      node.gain = new Param(0);
      return node;
    },
    createOscillator() {
      const node = new Source(ctx, 'oscillator');
      node.type = 'sine';
      node.frequency = new Param(440);
      node.detune = new Param(0);
      return node;
    },
    createBufferSource() {
      const node = new Source(ctx, 'buffer');
      node.buffer = null;
      node.loop = false;
      node.playbackRate = new Param(1);
      return node;
    },
    createBuffer: (channels, length, rate) => new Buffer(channels, length, rate),
    createConvolver() {
      const node = new Node(ctx, 'convolver');
      node.buffer = null;
      return node;
    },
    createDelay() {
      const node = new Node(ctx, 'delay');
      node.delayTime = new Param(0);
      return node;
    },
    createDynamicsCompressor() {
      const node = new Node(ctx, 'compressor');
      for (const param of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[param] = new Param(0);
      return node;
    },
    createStereoPanner() {
      const node = new Node(ctx, 'panner');
      node.pan = new Param(0);
      return node;
    },

    /** Move the clock on, and end whatever has stopped by then. */
    advance(seconds) {
      ctx.currentTime += seconds;
      for (const source of ctx.started) {
        if (source.ended || source.stoppedAt === null || source.stoppedAt > ctx.currentTime) continue;
        source.ended = true;
        source.onended?.();
      }
    },
  };
  ctx.destination = new Node(ctx, 'destination');
  return ctx;
}
