import { createRng, intBelow, range } from './rng.js';
import { AIRTIME, APEX, laneBounds, LANES, laneX, speedAt } from './tuning.js';

/** The runway starts behind the egg, so there is floor under it at t=0. */
const START_Z = -16;
const RUNWAY = 36;

/** Metres to full difficulty. */
const DIFFICULTY_RUN = 950;

/** A gap is a share of the reach a flat jump has at that speed — never more. */
const GAP_SHARE = { easy: 0.3, hard: 0.55 };
const GAP_MIN = 2.2;

/** A step up has to be comfortably under the apex, and over the landing snap. */
const STEP = { min: 0.7, max: APEX * 0.62 };

/** How far past a slab's edge the egg can still stand. */
export const EDGE_MARGIN = 0.25;

/** Slabs never overlap in z, so there is never a wall to run into: miss a
 *  jump and you meet the void, which is a fair thing to lose to. */
export function createCourse({ seed = 1, difficultyRun = DIFFICULTY_RUN } = {}) {
  const rng = createRng(seed);

  const segments = [];
  const hazards = [];
  const bits = [];

  let cursor = START_Z;
  let level = 0;
  let laid = 0;
  /** Ids never come round again — pruning shortens the array, and a renderer
   *  keyed on a reused id would put an old slab under a new one. */
  let nextId = 0;

  function difficulty() {
    return Math.min(1, Math.max(0, cursor / difficultyRun));
  }

  function reach() {
    return speedAt(Math.max(0, cursor)) * AIRTIME;
  }

  function gapLength(scale = 1) {
    const share = GAP_SHARE.easy + (GAP_SHARE.hard - GAP_SHARE.easy) * difficulty();
    return Math.max(GAP_MIN, reach() * share * range(rng, 0.85, 1.15) * scale);
  }

  function slab(length, { lane = 0, span = LANES, y = level } = {}) {
    const seg = {
      id: nextId++,
      z0: cursor,
      z1: cursor + length,
      y,
      lane,
      span,
      ...laneBounds(lane, span),
    };
    segments.push(seg);
    cursor = seg.z1;
    level = y;
    return seg;
  }

  function gap(length = gapLength()) {
    cursor += length;
    return length;
  }

  function hazard(seg, z, lane) {
    hazards.push({ z, lane, x: laneX(lane), y: seg.y, hit: false });
  }

  function bit(z, lane, y) {
    bits.push({ z, lane, x: laneX(lane), y, taken: false });
  }

  function trail(seg, count, lane = seg.lane + intBelow(rng, seg.span), step = 2.4) {
    const room = seg.z1 - seg.z0 - 3;
    const gapZ = Math.min(step, room / Math.max(1, count));
    for (let i = 0; i < count; i++) bit(seg.z0 + 2 + i * gapZ, lane, seg.y + 0.75);
    return lane;
  }

  /** A breather: flat, wide, and paved with bits. */
  function runway() {
    trail(slab(range(rng, 22, 32)), 5);
  }

  /** Agents parked one lane at a time — weave, or jump them. */
  function slalom(d) {
    const rows = 2 + Math.round(d * 3);
    const seg = slab((rows + 1) * 6 + range(rng, 0, 6));
    let lane = intBelow(rng, LANES);
    for (let i = 1; i <= rows; i++) {
      const z = seg.z0 + (seg.z1 - seg.z0) * (i / (rows + 1));
      hazard(seg, z, lane);
      bit(z + 1.8, (lane + 1 + intBelow(rng, LANES - 1)) % LANES, seg.y + 0.75);
      lane = (lane + 1 + intBelow(rng, LANES - 1)) % LANES;
    }
  }

  /** A hole in the floor, with an arc of bits over it to say how far. */
  function chasm() {
    const before = slab(range(rng, 10, 16));
    const length = gap();
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      bit(before.z1 + length * t, 1, before.y + 0.9 + Math.sin(t * Math.PI) * 1.1);
    }
    trail(slab(range(rng, 12, 20)), 3);
  }

  /** One or two lanes wide, with void either side. The run-up is the tell. */
  function catwalk(d) {
    slab(range(rng, 8, 12));
    const span = rng() < 0.35 + d * 0.4 ? 1 : 2;
    const lane = intBelow(rng, LANES - span + 1);
    gap(gapLength(0.7));
    const seg = slab(range(rng, 12, 20), { lane, span });
    const line = trail(seg, 5, lane + intBelow(rng, span), 2.6);
    if (span === 2 && d > 0.4) {
      hazard(seg, seg.z0 + (seg.z1 - seg.z0) * 0.6, lane + (line === lane ? 1 : 0));
    }
    slab(range(rng, 6, 10), { y: seg.y });
  }

  /** Up a storey, or back down to the floor. Either way, over a gap. */
  function stack(d) {
    const down = level > 0.4;
    gap(gapLength(down ? 0.8 : 0.55));
    const span = rng() < 0.5 ? LANES : 2;
    const lane = span === LANES ? 0 : intBelow(rng, LANES - 1);
    const seg = slab(range(rng, 14, 22), { y: down ? 0 : range(rng, STEP.min, STEP.max), lane, span });
    const line = trail(seg, 4, lane + intBelow(rng, span));
    if (d > 0.3 && span > 1) {
      const other = lane + ((line - lane + 1) % span);
      hazard(seg, seg.z0 + (seg.z1 - seg.z0) * 0.72, other);
    }
  }

  /** Rows with exactly one way through — and a bit sitting in it. */
  function gauntlet(d) {
    const rows = 2 + Math.round(d * 2);
    const seg = slab((rows + 1) * 6.5 + range(rng, 0, 4));
    let safe = intBelow(rng, LANES);
    for (let i = 1; i <= rows; i++) {
      const z = seg.z0 + (seg.z1 - seg.z0) * (i / (rows + 1));
      for (let lane = 0; lane < LANES; lane++) if (lane !== safe) hazard(seg, z, lane);
      bit(z, safe, seg.y + 0.75);
      /** The way through never jumps more than a lane between rows. */
      safe = Math.max(0, Math.min(LANES - 1, safe + (rng() < 0.5 ? -1 : 1)));
    }
  }

  function next() {
    if (laid++ === 0) {
      trail(slab(RUNWAY), 6, 1);
      return;
    }
    const d = difficulty();
    const roll = rng();
    if (roll < 0.18) runway();
    else if (roll < 0.42) slalom(d);
    else if (roll < 0.62) chasm(d);
    else if (roll < 0.78) catwalk(d);
    else if (roll < 0.9) stack(d);
    else gauntlet(d);
  }

  return {
    segments,
    hazards,
    bits,

    get end() { return cursor; },

    /** Lay course until it reaches z. */
    ensure(z) {
      while (cursor < z) next();
      return this;
    },

    /** The slab under a point, or null over the void. */
    groundAt(x, z) {
      let lo = 0;
      let hi = segments.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const seg = segments[mid];
        if (z < seg.z0) hi = mid - 1;
        else if (z >= seg.z1) lo = mid + 1;
        else return x >= seg.xMin - EDGE_MARGIN && x <= seg.xMax + EDGE_MARGIN ? seg : null;
      }
      return null;
    },

    /** Where a fallen egg is put back: the first slab still ahead of it. */
    landingAfter(z) {
      for (const seg of segments) if (seg.z0 > z) return seg;
      return null;
    },

    /** Everything behind the egg is scenery nobody will look at again. */
    prune(z) {
      while (segments.length > 1 && segments[0].z1 < z) segments.shift();
      while (hazards.length && hazards[0].z < z) hazards.shift();
      while (bits.length && bits[0].z < z) bits.shift();
    },
  };
}
