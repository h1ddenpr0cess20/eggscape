import * as THREE from 'three';

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ﾊﾋﾌﾍﾎabcdefgh';
const SIZE = 512;
const COLUMNS = 32;
const TICK = 1 / 18;

/**
 * The backdrop, painted on a canvas and handed to the scene as its background.
 * It is the only thing in here that is not a line, and it is the reason the
 * black reads as somewhere rather than as nothing.
 */
export function createRain() {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const step = SIZE / COLUMNS;
  const heads = Array.from({ length: COLUMNS }, () => Math.random() * COLUMNS);
  const speeds = Array.from({ length: COLUMNS }, () => 0.35 + Math.random() * 0.9);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.font = `${Math.round(step * 0.92)}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  let carry = 0;

  return {
    texture,

    update(dt) {
      carry += dt;
      if (carry < TICK) return;
      /** Spend a tick, don't drop the remainder: zeroing it here cost the
       *  rain a fifth of its speed at 60fps, and more the faster the display. */
      carry = Math.min(carry - TICK, TICK);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.fillRect(0, 0, SIZE, SIZE);

      for (let i = 0; i < COLUMNS; i++) {
        heads[i] += speeds[i];
        if (heads[i] * step > SIZE + step * 8) heads[i] = -Math.random() * COLUMNS;
        const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        const y = Math.floor(heads[i]) * step;
        ctx.fillStyle = 'rgba(190, 255, 205, 0.85)';
        ctx.fillText(glyph, i * step, y);
        ctx.fillStyle = 'rgba(0, 255, 65, 0.35)';
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * step, y - step);
      }

      texture.needsUpdate = true;
    },
  };
}
