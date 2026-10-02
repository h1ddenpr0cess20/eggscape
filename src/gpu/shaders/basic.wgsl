// Unlit surfaces and lines: a colour, a texture, vertex colours, fog —
// basic.vert.glsl and basic.frag.glsl in one.

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) fogDepth: f32,
}

@vertex
fn vs(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.uv = vec2f(input.uv.x, 1.0 - input.uv.y);
  out.color = input.color;
  let mvPosition = draw.modelView * vec4f(input.position, 1.0);
  out.position = frame.projection * mvPosition;
  out.fogDepth = -mvPosition.z;
  return out;
}

@fragment
fn fs(input: VertexOut) -> @location(0) vec4f {
  var diffuseColor = draw.color * textureSample(colorMap, colorSampler, input.uv);
  if (draw.flags.w > 0.5) {
    diffuseColor = vec4f(diffuseColor.rgb * input.color, diffuseColor.a);
  }
  let alpha = select(diffuseColor.a, 1.0, draw.flags.z > 0.5);
  return finish(diffuseColor.rgb, alpha, input.fogDepth);
}
