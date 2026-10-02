// Mipmaps for WebGPU, which does not make its own: each level is the one
// above it drawn at half size through a linear filter, which for a
// power-of-two texture averages each 2×2 block. On an sRGB texture the
// sample is decoded and the write encoded, so the average is taken in linear
// light, the way WebGL's generateMipmap takes it.

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOut;
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(input: VertexOut) -> @location(0) vec4f {
  return textureSampleLevel(source, linearSampler, input.uv, 0.0);
}
