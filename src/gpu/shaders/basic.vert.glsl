// Unlit surfaces and lines: a colour, a texture, vertex colours, fog.

layout(location = 0) in vec3 position;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec3 color;

out vec2 vUv;
out vec3 vColor;
out float vFogDepth;

void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vFogDepth = -mvPosition.z;
}
