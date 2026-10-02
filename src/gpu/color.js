/**
 * Colour, in the two encodings that matter. Every hex in the theme is sRGB —
 * what a designer picked off a swatch — and every sum the shaders do is in
 * linear light, so a colour is decoded once on the way in and encoded once
 * on the way out, in the fragment shader, and nowhere in between.
 */

export function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

export function linearToSrgb(c) {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
}

/** A hex number or a `#rrggbb` string, as its three sRGB channels in 0–1. */
function channels(value) {
  const hex = typeof value === 'string' ? parseInt(value.replace('#', ''), 16) : value;
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** A theme colour, decoded to linear light — what a material or a light holds. */
export function linear(value, scale = 1) {
  return channels(value).map((c) => srgbToLinear(c) * scale);
}

/**
 * A theme colour as the screen wants it. Fog and the clear colour are mixed
 * after the shader has encoded its output, so they have to arrive encoded
 * too; the round trip through linear is kept so the numbers land exactly
 * where a decoded-then-encoded colour would.
 */
export function display(value) {
  return linear(value).map(linearToSrgb);
}
