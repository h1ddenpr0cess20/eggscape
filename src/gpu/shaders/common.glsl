// Shared by every WebGL program: the two uniform blocks, and the last three
// things every fragment goes through on its way to the screen.
//
// The blocks mirror FRAME and DRAW in frame.js and the structs in
// common.wgsl. Nothing but vec4 and mat4, so std140 and WGSL agree on every
// offset without either of them being told.

precision highp float;
precision highp int;

layout(std140) uniform Frame {
  mat4 projectionMatrix;
  mat4 viewMatrix;
  vec4 fogColor;       // rgb already encoded for the screen; a = fog on
  vec4 fogParams;      // near, far, exposure, tone mapping (0 none, 1 ACES)
  vec4 hemiSky;        // rgb; a = there is a hemisphere light
  vec4 hemiGround;
  vec4 hemiDirection;  // view space
  vec4 lightDirection[4];
  vec4 lightColor[4];
  vec4 envParams;      // atlas texel width, texel height, top mip; w = present
  vec4 counts;         // directional lights, background intensity
};

layout(std140) uniform Draw {
  mat4 modelViewMatrix;
  mat4 normalMatrix;
  vec4 drawColor;      // linear rgb, opacity
  vec4 drawEmissive;   // linear rgb × intensity
  vec4 drawSurface;    // roughness, metalness, bump scale, clearcoat
  vec4 drawCoat;       // clearcoat roughness, sheen roughness
  vec4 drawSheen;      // sheen colour × sheen; a = sheen on
  vec4 drawFlags;      // fog, tone mapped, opaque, vertex colours
};

#define saturate(a) clamp(a, 0.0, 1.0)

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// ACES filmic, with the 1/0.6 brightening for a lit room rather than a
// cinema.
vec3 ACESFilmicToneMapping(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 ACESOutputMat = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602)
  );
  color *= fogParams.z / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return saturate(color);
}

vec4 sRGBTransferOETF(vec4 value) {
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92,
    vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
}

// Tone map, encode for the screen, then fog — in that order, because the fog
// colour arrives already encoded and is mixed in after the encode.
vec4 finish(vec3 color, float alpha, float fogDepth) {
  if (drawFlags.y > 0.5 && fogParams.w > 0.5) color = ACESFilmicToneMapping(color);
  vec4 result = sRGBTransferOETF(vec4(color, alpha));
  if (drawFlags.x > 0.5 && fogColor.a > 0.5) {
    result.rgb = mix(result.rgb, fogColor.rgb, smoothstep(fogParams.x, fogParams.y, fogDepth));
  }
  return result;
}
