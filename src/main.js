import './styles.css';

import { createGame } from './core/game.js';
import { LIVES } from './core/tuning.js';
import { createScene } from './render/scene.js';
import { createView } from './render/view.js';
import { readBest, writeBest } from './ui/best.js';
import { createHud } from './ui/hud.js';
import { createInput } from './ui/input.js';
import { createMusic } from './ui/music.js';
import { createSound } from './ui/sound.js';
import { SOUNDTRACK } from './ui/soundtrack.js';

const seed = () => Math.floor(Math.random() * 1e6);

const stage = createScene(document.getElementById('stage'));
const view = createView(stage);
const hud = createHud(document, LIVES);
const sound = createSound();
const music = createMusic(SOUNDTRACK, sound);
const game = createGame({ seed: seed() });

let best = readBest();

game.on('start', () => {
  view.reset();
  hud.running();
  sound.play('start');
  music.play('run');
});
game.on('jump', () => sound.play('jump'));
game.on('land', () => {
  view.kick(1.7);
  sound.play('land');
});
game.on('bit', () => {
  view.kick(0.7);
  sound.play('bit');
});
game.on('smash', () => {
  view.kick(2.2);
  view.jolt(0.35);
  sound.play('smash');
});
game.on('hit', () => {
  view.kick(2.6);
  view.jolt(0.9);
  sound.play('hit');
  music.duck();
});
/** The egg is put down metres further on, so the camera cuts rather than
 *  chases — it used to spend the landing somewhere behind, pointed at void. */
game.on('respawn', () => view.snap());
game.on('over', (snapshot) => {
  best = writeBest(snapshot.score);
  hud.over(snapshot, best);
  sound.play('over');
  music.play('over');
});

function play() {
  if (game.state === 'running') return;
  game.start(seed());
  /** The press that started the run is not also the run's first jump. */
  input.take();
}

const input = createInput(window, { onConfirm: play });
hud.onPlay(play);
hud.ready(best);
music.play('title');

/** The title has music too, and no browser will play a note of it before
 *  somebody has touched the page — so the first touch of anything wakes the
 *  audio, rather than the first run. */
for (const type of ['pointerup', 'keydown']) addEventListener(type, () => sound.wake(), { once: true });

const mute = document.getElementById('mute');
function setMuted(value) {
  sound.muted = value;
  music.muted = value;
  mute.textContent = value ? 'audio off' : 'audio on';
  mute.setAttribute('aria-pressed', String(value));
}
mute.addEventListener('click', (event) => {
  event.stopPropagation();
  setMuted(!sound.muted);
});
addEventListener('keydown', (event) => {
  /** A held key repeats, and a mute that flips thirty times a second is a
   *  mute nobody can aim. */
  if (event.code === 'KeyM' && !event.repeat) setMuted(!sound.muted);
});

/**
 * Real seconds go in; the game turns them into fixed ticks of its own. The
 * clamp is for the tab that was in the background for a minute — it comes
 * back to one long frame, and the egg should not teleport through the floor.
 */
let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  const snapshot = game.advance(dt, input.take());
  music.update(snapshot);
  view.sync(snapshot, dt, now / 1000);
  stage.tick(dt);
  hud.update(snapshot);
  stage.render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
