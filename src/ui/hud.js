const PIP = '◆';

const LEAD = {
  ready: 'The carton was a simulation. Roll east, take the bits, do not meet an agent.',
  over: 'Connection terminated. The shell was never the problem.',
};

function stat(label, value) {
  return `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function metres(value) {
  return `${Math.max(0, Math.floor(value))}m`;
}

/**
 * The readouts, and the panel that covers them between runs. Markup lives in
 * index.html; this only ever writes text and flips `hidden`.
 */
export function createHud(doc = document, lives = 3) {
  const $ = (id) => doc.getElementById(id);

  const score = $('score');
  const depth = $('depth');
  const bits = $('bits');
  const shells = $('shells');
  const overlay = $('overlay');
  const kicker = $('overlay-kicker');
  const lead = $('overlay-lead');
  const stats = $('overlay-stats');
  const play = $('play');

  function pips(left) {
    return PIP.repeat(Math.max(0, left)) + `<span class="spent">${PIP.repeat(Math.max(0, lives - left))}</span>`;
  }

  /** The readouts are written sixty times a second and change a handful of
   *  times a run, so each one only touches the DOM when its text moves. */
  const shown = {};
  function put(node, key, value, html = false) {
    if (shown[key] === value) return;
    shown[key] = value;
    if (html) node.innerHTML = value;
    else node.textContent = value;
  }

  return {
    update(snapshot) {
      put(score, 'score', String(snapshot.score));
      put(depth, 'depth', metres(snapshot.distance));
      put(bits, 'bits', String(snapshot.bits));
      put(shells, 'shells', pips(snapshot.lives), true);
    },

    ready(best) {
      overlay.hidden = false;
      overlay.dataset.state = 'ready';
      kicker.textContent = 'wake up, marc…';
      lead.textContent = LEAD.ready;
      stats.hidden = best <= 0;
      stats.innerHTML = best > 0 ? stat('best', best) : '';
      play.textContent = 'enter';
    },

    over(snapshot, best) {
      overlay.hidden = false;
      overlay.dataset.state = 'over';
      kicker.textContent = 'system failure';
      lead.textContent = LEAD.over;
      stats.hidden = false;
      stats.innerHTML = [
        ['score', snapshot.score],
        ['depth', metres(snapshot.distance)],
        ['bits', snapshot.bits],
        /** Agents only earn a column on a run that broke one. */
        ...(snapshot.agents > 0 ? [['agents', snapshot.agents]] : []),
        ['best', best],
      ].map(([label, value]) => stat(label, value)).join('');
      play.textContent = 'again';
    },

    running() {
      overlay.hidden = true;
      overlay.dataset.state = 'running';
    },

    onPlay(fn) {
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        fn();
      });
    },
  };
}
