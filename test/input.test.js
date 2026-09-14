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
      assert.ok(h.input.take()[action], `${code} should mean ${action}`);
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
    assert.ok(!h.input.take().right);
    h.close();
  });

  it('counts lane presses, so a double tap inside one frame is two lanes', () => {
    const h = harness();
    h.key('KeyA');
    h.key('KeyA');
    h.key('KeyW');
    h.key('KeyW');
    const frame = h.input.take();
    assert.equal(frame.left, 2, 'the second tap was swallowed');
    assert.equal(frame.right, 0);
    assert.equal(frame.jump, true, 'two jumps in a frame are still one jump');
    assert.equal(h.input.take().left, 0);
    h.close();
  });

  it('leaves the page its own buttons', () => {
    const h = harness();
    const button = h.window.document.createElement('button');
    h.window.document.body.append(button);

    button.dispatchEvent(new h.window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    button.dispatchEvent(new h.window.MouseEvent('pointerup', { bubbles: true, clientX: 11, clientY: 11 }));
    assert.ok(!h.input.take().jump, 'tapping a button jumped the egg');
    assert.equal(h.confirms.length, 0, 'and started a run behind the button');

    /** A swipe that strays onto a button is abandoned, not read as a tap. */
    h.window.dispatchEvent(new h.window.MouseEvent('pointerdown', { clientX: 200, clientY: 300 }));
    button.dispatchEvent(new h.window.MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 300 }));
    assert.equal(h.input.take().left, 0);
    h.close();
  });

  it('takes a swipe for a lane, a flick up for a jump, down for a slam', () => {
    const h = harness();

    h.swipe([200, 300], [100, 305]);
    assert.equal(h.input.take().left, 1);

    h.swipe([100, 300], [220, 296]);
    assert.equal(h.input.take().right, 1);

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
    h.swipe([200, 300], [100, 305]);
    const frame = h.input.take();
    assert.equal(frame.jump, false);
    assert.equal(frame.left, 0);
    h.window.close();
  });
});
