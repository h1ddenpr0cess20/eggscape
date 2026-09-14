import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHud } from '../src/ui/hud.js';
import { readBest, writeBest } from '../src/ui/best.js';
import { loadPage } from './helpers/dom.js';

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
}

function snapshot(over = {}) {
  return { state: 'running', score: 412, distance: 287.6, bits: 5, lives: 2, ...over };
}

describe('page', () => {
  it('carries every element the HUD writes to', async () => {
    const page = await loadPage();
    for (const id of ['stage', 'score', 'depth', 'bits', 'shells', 'overlay', 'overlay-kicker',
      'overlay-lead', 'overlay-stats', 'play', 'mute']) {
      assert.ok(page.document.getElementById(id), `#${id} is missing from index.html`);
    }
    page.close();
  });

  it('loads nothing but the module that boots the game', async () => {
    const page = await loadPage();
    const scripts = [...page.document.querySelectorAll('script')];
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].type, 'module');
    assert.equal(scripts[0].getAttribute('src'), '/src/main.js');
    page.close();
  });
});

describe('hud', () => {
  it('writes the run onto the readouts', async () => {
    const page = await loadPage();
    const hud = createHud(page.document, 3);

    hud.update(snapshot());
    assert.equal(page.$('#score').textContent, '412');
    assert.equal(page.$('#depth').textContent, '287m');
    assert.equal(page.$('#bits').textContent, '5');

    const shells = page.$('#shells');
    assert.equal(shells.textContent.length, 3, 'three pips, one of them spent');
    assert.equal(shells.querySelector('.spent').textContent.length, 1);
    page.close();
  });

  it('opens on the title, and hides the best score until there is one', async () => {
    const page = await loadPage();
    const hud = createHud(page.document, 3);

    hud.ready(0);
    assert.equal(page.$('#overlay').hidden, false);
    assert.equal(page.$('#overlay').dataset.state, 'ready');
    assert.equal(page.$('#overlay-stats').hidden, true);
    assert.equal(page.$('#play').textContent, 'enter');

    hud.ready(900);
    assert.equal(page.$('#overlay-stats').hidden, false);
    assert.match(page.$('#overlay-stats').textContent, /900/);
    page.close();
  });

  it('gets out of the way while a run is going', async () => {
    const page = await loadPage();
    const hud = createHud(page.document, 3);
    hud.running();
    assert.equal(page.$('#overlay').hidden, true);
    page.close();
  });

  it('reports the run back when it ends', async () => {
    const page = await loadPage();
    const hud = createHud(page.document, 3);

    hud.over(snapshot({ state: 'over', lives: 0 }), 900);
    const overlay = page.$('#overlay');
    assert.equal(overlay.hidden, false);
    assert.equal(overlay.dataset.state, 'over');
    assert.match(page.$('#overlay-kicker').textContent, /system failure/i);
    assert.equal(page.$('#play').textContent, 'again');

    const stats = page.$('#overlay-stats').textContent;
    for (const value of ['412', '287m', '5', '900']) assert.match(stats, new RegExp(value));
    page.close();
  });

  it('starts a run from the button', async () => {
    const page = await loadPage();
    const hud = createHud(page.document, 3);
    let started = 0;
    hud.onPlay(() => { started += 1; });
    page.$('#play').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
    assert.equal(started, 1);
    page.close();
  });
});

describe('best', () => {
  it('remembers the best run and nothing else', () => {
    const storage = fakeStorage();
    assert.equal(readBest(storage), 0);
    assert.equal(writeBest(420, storage), 420);
    assert.equal(readBest(storage), 420);
    assert.equal(writeBest(100, storage), 420, 'a worse run overwrote a better one');
    assert.equal(writeBest(900.7, storage), 900);
  });

  it('shrugs off a browser that will not store anything', () => {
    const broken = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    assert.equal(readBest(broken), 0);
    assert.equal(writeBest(300, broken), 300);
    assert.equal(readBest(undefined), 0);
  });

  it('ignores junk left in storage', () => {
    assert.equal(readBest(fakeStorage({ 'eggscape:best': 'wake up' })), 0);
    assert.equal(readBest(fakeStorage({ 'eggscape:best': '-5' })), 0);
  });
});
