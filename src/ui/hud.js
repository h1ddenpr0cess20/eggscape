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

  return {
    update(snapshot) {
      score.textContent = String(snapshot.score);
      depth.textContent = metres(snapshot.distance);
      bits.textContent = String(snapshot.bits);
      shells.innerHTML = pips(snapshot.lives);
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
