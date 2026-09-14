import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

import { createInput } from '../src/ui/input.js';

function harness() {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const { window } = dom;
  const confirms = [];
  const input = createInput(window, { onConfirm: () => confirms.push(true) });

  const key = (code, extra = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', { code, ...extra }));
  const swipe = (from, to) => {
    window.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: from[0], clientY: from[1] }));
    window.dispatchEvent(new window.MouseEvent('pointerup', { clientX: to[0], clientY: to[1] }));
  };

  return { window, input, key, swipe, confirms, close: () => { input.dispose(); window.close(); } };
}

describe('input', () => {
  it('maps both the arrows and the left hand', () => {
    const h = harness();
    for (const [code, action] of [
      ['ArrowLeft', 'left'], ['KeyA', 'left'],
      ['ArrowRight', 'right'], ['KeyD', 'right'],
      ['ArrowUp', 'jump'], ['KeyW', 'jump'], ['Space', 'jump'],
      ['ArrowDown', 'dive'], ['KeyS', 'dive'],
    ]) {
      h.key(code);
      assert.equal(h.input.take()[action], true, `${code} should mean ${action}`);
    }
    h.close();
  });

  it('hands a press to one frame and no more', () => {
    const h = harness();
    h.key('KeyW');
    assert.equal(h.input.take().jump, true);
    assert.equal(h.input.take().jump, false, 'the same press jumped twice');
    h.close();
  });

  it('ignores the key repeat a held key sends', () => {
    const h = harness();
    h.key('KeyD', { repeat: true });
    assert.equal(h.input.take().right, false);
    h.close();
  });

  it('takes a swipe for a lane, a flick up for a jump, down for a slam', () => {
    const h = harness();

    h.swipe([200, 300], [100, 305]);
    assert.equal(h.input.take().left, true);

    h.swipe([100, 300], [220, 296]);
    assert.equal(h.input.take().right, true);

    h.swipe([150, 300], [152, 240]);
    assert.equal(h.input.take().jump, true);

    h.swipe([150, 240], [148, 320]);
    assert.equal(h.input.take().dive, true);

    h.close();
  });

  it('reads a tap as a jump', () => {
    const h = harness();
    h.swipe([150, 300], [152, 302]);
    assert.equal(h.input.take().jump, true);
    h.close();
  });

  it('confirms on space, enter and a tap — the three ways to start a run', () => {
    const h = harness();
    h.key('Space');
    h.key('Enter');
    h.swipe([10, 10], [11, 11]);
    assert.equal(h.confirms.length, 3);
    h.close();
  });

  it('stops listening once disposed', () => {
    const h = harness();
    h.input.dispose();
    h.key('KeyW');
    assert.equal(h.input.take().jump, false);
    h.window.close();
  });
});
