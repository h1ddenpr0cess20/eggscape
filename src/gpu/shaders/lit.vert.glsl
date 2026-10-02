// Lit surfaces: everything is worked out in view space, from a model-view
// matrix the CPU multiplied in double precision.

layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;

out vec3 vViewPosition;
out vec3 vNormal;
out vec2 vUv;

void main() {
  // Canvases are uploaded top row first; the geometry's uvs put the top at 1.
  vUv = vec2(uv.x, 1.0 - uv.y);
  vNormal = normalize(mat3(normalMatrix) * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vViewPosition = -mvPosition.xyz;
}
