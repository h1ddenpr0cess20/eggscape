const KEYS = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ArrowDown: 'dive',
  KeyS: 'dive',
};

const SWIPE = 26;

function blank() {
  return { left: false, right: false, jump: false, dive: false };
}

/**
 * Intents are edges, not held keys: leaning on → moves one lane, and holding
 * jump does not hover. `take()` hands the frame's edges to the first physics
 * tick and clears them, so a press is spent exactly once.
 */
export function createInput(target, { onConfirm = () => {} } = {}) {
  let pending = blank();
  let start = null;

  function press(action) {
    if (action) pending[action] = true;
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const action = KEYS[event.code];
    if (action) {
      event.preventDefault();
      press(action);
    }
    if (event.code === 'Space' || event.code === 'Enter') onConfirm();
  }

  function onPointerDown(event) {
    start = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  }

  function onPointerUp(event) {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE) press(dx < 0 ? 'left' : 'right');
    else if (dy < -SWIPE) press('jump');
    else if (dy > SWIPE) press('dive');
    else press('jump');

    onConfirm();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', () => { start = null; });

  return {
    take() {
      const frame = pending;
      pending = blank();
      return frame;
    },

    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerup', onPointerUp);
    },
  };
}
