// Shared by every WebGPU pipeline: the two uniform structs, the bindings
// every pipeline layout carries, and the last three things every fragment
// goes through on its way to the screen.
//
// The structs mirror FRAME and DRAW in frame.js and the std140 blocks in
// common.glsl. Nothing but vec4 and mat4, so both languages agree on every
// offset without either of them being told.

struct Frame {
  projection: mat4x4f,
  view: mat4x4f,
  fogColor: vec4f,       // rgb already encoded for the screen; a = fog on
  fogParams: vec4f,      // near, far, exposure, tone mapping (0 none, 1 ACES)
  hemiSky: vec4f,        // rgb; a = there is a hemisphere light
  hemiGround: vec4f,
  hemiDirection: vec4f,  // view space
  lightDirection: array<vec4f, 4>,
  lightColor: array<vec4f, 4>,
  envParams: vec4f,      // atlas texel width, texel height, top mip; w = present
  counts: vec4f,         // directional lights, background intensity
}

struct Draw {
  modelView: mat4x4f,
  normalMatrix: mat4x4f,
  color: vec4f,          // linear rgb, opacity
  emissive: vec4f,       // linear rgb × intensity
  surface: vec4f,        // roughness, metalness, bump scale, clearcoat
  coat: vec4f,           // clearcoat roughness, sheen roughness
  sheen: vec4f,          // sheen colour × sheen; a = sheen on
  flags: vec4f,          // fog, tone mapped, opaque, vertex colours
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var envMap: texture_2d<f32>;
@group(0) @binding(2) var clampSampler: sampler;
@group(0) @binding(3) var dfgLut: texture_2d<f32>;

@group(1) @binding(0) var<uniform> draw: Draw;

@group(2) @binding(0) var colorMap: texture_2d<f32>;
@group(2) @binding(1) var colorSampler: sampler;
@group(2) @binding(2) var emissiveMap: texture_2d<f32>;
@group(2) @binding(3) var emissiveSampler: sampler;
@group(2) @binding(4) var bumpMap: texture_2d<f32>;
@group(2) @binding(5) var bumpSampler: sampler;

struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec3f,
}

fn RRTAndODTFit(v: vec3f) -> vec3f {
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// ACES filmic, with the 1/0.6 brightening for a lit room rather than a
// cinema.
fn ACESFilmicToneMapping(input: vec3f) -> vec3f {
  let ACESInputMat = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777)
  );
  let ACESOutputMat = mat3x3f(
    vec3f( 1.60475, -0.10208, -0.00327),
    vec3f(-0.53108,  1.10813, -0.07276),
    vec3f(-0.07367, -0.00605,  1.07602)
  );
  var color = input * (frame.fogParams.z / 0.6);
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return saturate(color);
}

fn sRGBTransferOETF(value: vec4f) -> vec4f {
  let encoded = pow(value.rgb, vec3f(0.41666)) * 1.055 - vec3f(0.055);
  let low = value.rgb * 12.92;
  return vec4f(select(encoded, low, value.rgb <= vec3f(0.0031308)), value.a);
}

// Tone map, encode for the screen, then fog — in that order, because the fog
// colour arrives already encoded and is mixed in after the encode.
fn finish(input: vec3f, alpha: f32, fogDepth: f32) -> vec4f {
  var color = input;
  if (draw.flags.y > 0.5 && frame.fogParams.w > 0.5) {
    color = ACESFilmicToneMapping(color);
  }
  var result = sRGBTransferOETF(vec4f(color, alpha));
  if (draw.flags.x > 0.5 && frame.fogColor.a > 0.5) {
    let amount = smoothstep(frame.fogParams.x, frame.fogParams.y, fogDepth);
    result = vec4f(mix(result.rgb, frame.fogColor.rgb, amount), result.a);
  }
  return result;
}
