import { display } from './color.js';
import { createFrameBuilder } from './frame.js';

/**
 * The renderer: WebGPU or WebGL 2, whichever draws this game better on the
 * machine it is running on, and the same picture out of either.
 *
 * "Better" comes down to antialiasing. WebGPU multisamples at 4× and no
 * more; Chrome on a desktop GPU gives a WebGL canvas 8×, which is what these
 * games were tuned under. So where WebGL can sample more than 4×, WebGL draws
 * — on a phone, where it usually cannot, WebGPU does — and either one falls
 * back to the other if it will not start.
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

  /**
   * A GPU can be taken away — a driver reset, or a phone reclaiming memory
   * from a tab in the background. Everything drawn is rebuilt from the scene
   * on the next frame anyway, so coming back is a matter of making a new
   * backend on the same canvas and letting it upload everything again.
   */
  settings.lost = () => {
    backend = null;
    import('./webgpu.js')
      .then(({ createWebGPU }) => createWebGPU(canvas, settings))
      .then((fresh) => { backend = fresh; })
      .catch((error) => console.error('WebGPU did not come back.', error));
  };
  canvas.addEventListener?.('webglcontextlost', (event) => {
    event.preventDefault();
    backend = null;
  });
  canvas.addEventListener?.('webglcontextrestored', () => {
    import('./webgl.js')
      .then(({ createWebGL }) => { backend = createWebGL(canvas, settings); })
      .catch((error) => console.error('WebGL did not come back.', error));
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

/**
 * How many samples a WebGL canvas could multisample with here, asked of a
 * throwaway context that is given straight back.
 */
function webglSamples() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 0;
    const samples = gl.getParameter(gl.MAX_SAMPLES);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return samples;
  } catch {
    return 0;
  }
}

async function choose(canvas, settings) {
  const wanted = preference() ?? (webglSamples() > 4 ? 'webgl' : 'webgpu');
  const order = wanted === 'webgl' ? ['webgl', 'webgpu'] : ['webgpu', 'webgl'];

  for (const name of order) {
    try {
      if (name === 'webgpu') {
        if (!globalThis.navigator?.gpu) continue;
        const { createWebGPU } = await import('./webgpu.js');
        return await createWebGPU(canvas, settings);
      }
      const { createWebGL } = await import('./webgl.js');
      return createWebGL(canvas, settings);
    } catch (error) {
      console.warn(`${name === 'webgpu' ? 'WebGPU' : 'WebGL 2'} would not start.`, error);
    }
  }

  console.error('Neither WebGPU nor WebGL 2 would start, so there is nothing to draw with.');
  return null;
}
