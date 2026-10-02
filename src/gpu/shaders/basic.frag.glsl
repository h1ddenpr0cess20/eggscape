uniform sampler2D colorMap;

in vec2 vUv;
in vec3 vColor;
in float vFogDepth;

out vec4 fragColor;

void main() {
  vec4 diffuseColor = drawColor * texture(colorMap, vUv);
  if (drawFlags.w > 0.5) diffuseColor.rgb *= vColor;
  float alpha = drawFlags.z > 0.5 ? 1.0 : diffuseColor.a;
  fragColor = finish(diffuseColor.rgb, alpha, vFogDepth);
}
