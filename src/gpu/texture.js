/**
 * A picture for the GPU: a canvas, and how to sample it. Everything this game
 * textures with is painted onto a canvas at boot, so a texture is never
 * fetched, never decoded, and is ready the moment it exists.
 *
 * Mipmaps are built on upload and anisotropic filtering is asked for up to
 * what the device allows. Set `needsUpdate` after painting on the canvas
 * again and the next frame uploads it again.
 */
export class Texture {
  constructor(image, {
    srgb = true,
    wrapS = 'clamp',
    wrapT = 'clamp',
    anisotropy = 1,
  } = {}) {
    this.image = image;
    /** Colour pictures are sRGB and are decoded to linear when sampled;
     *  data — a height map — is read back exactly as painted. */
    this.srgb = srgb;
    /** 'repeat' or 'clamp', across and down. */
    this.wrapS = wrapS;
    this.wrapT = wrapT;
    this.anisotropy = anisotropy;
    this.version = 0;
  }

  set needsUpdate(value) {
    if (value) this.version += 1;
  }
}
