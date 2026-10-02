// The backdrop: one triangle over the whole frame, at the far plane, with
// uvs running 0–1 across the visible part of it.

out vec2 vUv;

void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(corner.x, 1.0 - corner.y);
  gl_Position = vec4(corner * 2.0 - 1.0, 1.0, 1.0);
}
