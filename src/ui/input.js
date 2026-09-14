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

/** The page's own controls. A press that lands on one is theirs, not the run's. */
const CHROME = 'button, a, input, select, textarea, [data-chrome]';

function blank() {
  return { left: 0, right: 0, jump: false, dive: false };
}

/** Lane presses count; jump and slam are flags. Pressing jump twice inside a
 *  frame is still one jump, and pressing left twice is two lanes. */
function record(frame, action) {
  if (action === 'left' || action === 'right') frame[action] += 1;
  else frame[action] = true;
}

/**
 * Whether a pointer event belongs to the page rather than the course. Tapping
 * `audio on` used to toggle the sound *and* jump the egg: `click` can be
 * stopped from bubbling, but the pointer events under it are separate, and
 * they reach the window either way.
 */
function onChrome(event) {
  return Boolean(event.target?.closest?.(CHROME));
}

/**
 * Intents are edges, not held keys: leaning on → moves one lane, and holding
 * jump does not hover. `take()` hands the frame's edges over and clears them;
 * the game holds them until a fixed tick spends them, so a press is spent
 * exactly once and never simply dropped.
 */
export function createInput(target, { onConfirm = () => {} } = {}) {
  let pending = blank();
  let start = null;

  function press(action) {
    if (action) record(pending, action);
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
    if (onChrome(event)) return;
    start = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  }

  function onPointerUp(event) {
    if (!start) return;
    /** A swipe that ended on a button is over, and is not also a jump. */
    if (onChrome(event)) {
      start = null;
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE) press(dx < 0 ? 'left' : 'right');
    else if (dy < -SWIPE) press('jump');
    else if (dy > SWIPE) press('dive');
    else press('jump');

    onConfirm();
  }

  function onPointerCancel() {
    start = null;
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerCancel);

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
      target.removeEventListener('pointercancel', onPointerCancel);
    },
  };
}
