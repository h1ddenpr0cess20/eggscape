// The backdrop: one triangle over the whole frame, at the far plane, with
// uvs running 0–1 across the visible part of it. Already sRGB, so never tone
// mapped, and never fogged — it is the far away.

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOut;
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  out.position = vec4f(corner * 2.0 - 1.0, 1.0, 1.0);
  return out;
}

@fragment
fn fs(input: VertexOut) -> @location(0) vec4f {
  var texColor = textureSample(colorMap, colorSampler, input.uv);
  texColor = vec4f(texColor.rgb * frame.counts.y, texColor.a);
  return sRGBTransferOETF(texColor);
}
