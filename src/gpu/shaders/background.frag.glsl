uniform sampler2D colorMap;

in vec2 vUv;

out vec4 fragColor;

// Already sRGB, so never tone mapped, and never fogged — it is the far away.
void main() {
  vec4 texColor = texture(colorMap, vUv);
  texColor.rgb *= counts.y;
  fragColor = sRGBTransferOETF(texColor);
}
