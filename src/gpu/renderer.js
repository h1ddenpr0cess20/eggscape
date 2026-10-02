import { display } from './color.js';
import { createFrameBuilder } from './frame.js';

/**
 * The renderer: WebGPU where the browser has it, WebGL 2 where it does not,
 * and the same picture out of either.
 *
 * Choosing takes a moment — WebGPU hands over its device asynchronously — so
 * the renderer exists at once and starts drawing when a backend is ready.
 * Until then `render` does nothing and the page shows its own background —
 * and the same goes for an environment still being filtered in the
 * background, so the first frame drawn is drawn under the right light.
 * `?renderer=webgl` or `?renderer=webgpu` in the address forces one, which is
 * how a device that gets WebGPU wrong is told to stop trying.
 */
export function createRenderer(canvas, { clearColor = 0x000000, antialias = true } = {}) {
  const builder = createFrameBuilder();
  const settings = {
    clear: display(clearColor),
    antialias,
    toneMapping: 'none',
    exposure: 1,
  };
  let pixelRatio = 1;
  let backend = null;

  const ready = choose(canvas, settings).then((chosen) => {
    backend = chosen;
    return chosen?.name ?? null;
  });

  return {
    canvas,
    /** Resolves to 'webgpu', 'webgl', or null when neither would start. */
    ready,
    get backend() { return backend?.name ?? null; },

    /** 'none' or 'aces'. */
    set toneMapping(value) { settings.toneMapping = value; },
    get toneMapping() { return settings.toneMapping; },
    set toneMappingExposure(value) { settings.exposure = value; },
    get toneMappingExposure() { return settings.exposure; },

    setPixelRatio(value) { pixelRatio = value; },

    /** The drawing buffer, in CSS pixels; the canvas's own size is left to
     *  the stylesheet unless `updateStyle` says otherwise. */
    setSize(width, height, updateStyle = true) {
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      if (updateStyle) {
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
    },

    render(scene, camera) {
      if (!backend || scene.environment?.ready === false) return;
      const { list } = builder.build(scene, camera, {
        zeroToOne: backend.zeroToOne,
        toneMapping: settings.toneMapping,
        exposure: settings.exposure,
      });
      backend.render(builder.frame, builder.draws, list, scene);
    },
  };
}

function preference() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('renderer');
  } catch {
    return null;
  }
}

async function choose(canvas, settings) {
  const wanted = preference();

  if (wanted !== 'webgl' && globalThis.navigator?.gpu) {
    try {
      const { createWebGPU } = await import('./webgpu.js');
      return await createWebGPU(canvas, settings);
    } catch (error) {
      console.warn('WebGPU would not start; drawing with WebGL instead.', error);
    }
  }

  try {
    const { createWebGL } = await import('./webgl.js');
    return createWebGL(canvas, settings);
  } catch (error) {
    console.error('Neither WebGPU nor WebGL 2 would start, so there is nothing to draw with.', error);
    return null;
  }
}
