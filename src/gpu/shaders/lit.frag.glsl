// Metal/rough PBR with a clearcoat and a sheen, lit by directional lights, a
// hemisphere light and a prefiltered environment.
//
// This is the lighting model the game's look was tuned under, kept term for
// term: GGX specular with multiscatter energy compensation off a DFG table,
// Charlie sheen with its energy compensation, a clearcoat layered on top, and
// the cube-UV environment lookup with its roughness-to-mip mapping. Change a
// constant here and the egg changes colour.

uniform sampler2D colorMap;
uniform sampler2D emissiveMap;
uniform sampler2D bumpMap;
uniform sampler2D envMap;
uniform sampler2D dfgLut;

in vec3 vViewPosition;
in vec3 vNormal;
in vec2 vUv;

out vec4 fragColor;

#define PI 3.141592653589793
#define RECIPROCAL_PI 0.3183098861837907
#define EPSILON 1e-6

float pow2(float x) { return x * x; }
float pow4(float x) { float x2 = x * x; return x2 * x2; }
float max3(vec3 v) { return max(max(v.x, v.y), v.z); }

vec3 F_Schlick(vec3 f0, float f90, float dotVH) {
  float fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1.0 - fresnel) + (f90 * fresnel);
}

float V_GGX_SmithCorrelated(float alpha, float dotNL, float dotNV) {
  float a2 = pow2(alpha);
  float gv = dotNL * sqrt(a2 + (1.0 - a2) * pow2(dotNV));
  float gl = dotNV * sqrt(a2 + (1.0 - a2) * pow2(dotNL));
  return 0.5 / max(gv + gl, EPSILON);
}

float D_GGX(float alpha, float dotNH) {
  float a2 = pow2(alpha);
  float denom = pow2(dotNH) * (a2 - 1.0) + 1.0;
  return RECIPROCAL_PI * a2 / pow2(denom);
}

// GGX distribution, Schlick Fresnel, height-correlated Smith visibility —
// the base layer and the clearcoat both, with their own F0 and roughness.
vec3 BRDF_GGX(vec3 lightDir, vec3 viewDir, vec3 normal, vec3 f0, float f90, float roughness) {
  float alpha = pow2(roughness);
  vec3 halfDir = normalize(lightDir + viewDir);
  float dotNL = saturate(dot(normal, lightDir));
  float dotNV = saturate(dot(normal, viewDir));
  float dotNH = saturate(dot(normal, halfDir));
  float dotVH = saturate(dot(viewDir, halfDir));
  vec3 F = F_Schlick(f0, f90, dotVH);
  float V = V_GGX_SmithCorrelated(alpha, dotNL, dotNV);
  float D = D_GGX(alpha, dotNH);
  return F * (V * D);
}

float D_Charlie(float roughness, float dotNH) {
  float alpha = pow2(roughness);
  float invAlpha = 1.0 / alpha;
  float cos2h = dotNH * dotNH;
  float sin2h = max(1.0 - cos2h, 0.0078125);
  return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * PI);
}

float V_Neubelt(float dotNV, float dotNL) {
  return saturate(1.0 / (4.0 * (dotNL + dotNV - dotNL * dotNV)));
}

vec3 BRDF_Sheen(vec3 lightDir, vec3 viewDir, vec3 normal, vec3 sheenColor, float sheenRoughness) {
  vec3 halfDir = normalize(lightDir + viewDir);
  float dotNL = saturate(dot(normal, lightDir));
  float dotNV = saturate(dot(normal, viewDir));
  float dotNH = saturate(dot(normal, halfDir));
  return sheenColor * (D_Charlie(sheenRoughness, dotNH) * V_Neubelt(dotNV, dotNL));
}

// A curve fit to the Charlie sheen BRDF integrated over the hemisphere.
float IBLSheenBRDF(vec3 normal, vec3 viewDir, float roughness) {
  float dotNV = saturate(dot(normal, viewDir));
  float r2 = roughness * roughness;
  float rInv = 1.0 / (roughness + 0.1);
  float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
  float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
  return saturate(exp(a * dotNV + b));
}

vec2 dfg(float roughness, float dotNV) {
  return textureLod(dfgLut, vec2(roughness, dotNV), 0.0).rg;
}

vec3 EnvironmentBRDF(vec3 normal, vec3 viewDir, vec3 specularColor, float specularF90, float roughness) {
  vec2 fab = dfg(roughness, saturate(dot(normal, viewDir)));
  return specularColor * fab.x + specularF90 * fab.y;
}

// Fdez-Agüera's multiple-scattering approximation for image-based light.
void computeMultiscattering(vec3 normal, vec3 viewDir, vec3 specularColor, float specularF90,
    float roughness, inout vec3 singleScatter, inout vec3 multiScatter) {
  vec2 fab = dfg(roughness, saturate(dot(normal, viewDir)));
  vec3 FssEss = specularColor * fab.x + specularF90 * fab.y;
  float Ess = fab.x + fab.y;
  float Ems = 1.0 - Ess;
  vec3 Favg = specularColor + (1.0 - specularColor) * 0.047619;
  vec3 Fms = FssEss * Favg / (1.0 - Ems * Favg);
  singleScatter += FssEss;
  multiScatter += Fms * Ems;
}

// GGX for direct light, with Turquin's multiple-scattering compensation.
vec3 BRDF_GGX_Multiscatter(vec3 lightDir, vec3 viewDir, vec3 normal, vec3 specularColor,
    float specularF90, float roughness) {
  vec3 singleScatter = BRDF_GGX(lightDir, viewDir, normal, specularColor, specularF90, roughness);
  float dotNL = saturate(dot(normal, lightDir));
  float dotNV = saturate(dot(normal, viewDir));
  vec2 dfgV = dfg(roughness, dotNV);
  vec2 dfgL = dfg(roughness, dotNL);
  vec3 FssEss_V = specularColor * dfgV.x + specularF90 * dfgV.y;
  vec3 FssEss_L = specularColor * dfgL.x + specularF90 * dfgL.y;
  float Ems_V = 1.0 - (dfgV.x + dfgV.y);
  float Ems_L = 1.0 - (dfgL.x + dfgL.y);
  vec3 Favg = specularColor + (1.0 - specularColor) * 0.047619;
  vec3 Fms = FssEss_V * FssEss_L * Favg / (1.0 - Ems_V * Ems_L * Favg + EPSILON);
  return singleScatter + Fms * (Ems_V * Ems_L);
}

// The cube-UV atlas: six faces three across and two down, one block per rung
// of blur, a texel of padding round every face.

#define cubeUV_minMipLevel 4.0
#define cubeUV_minTileSize 16.0

float getFace(vec3 direction) {
  vec3 absDirection = abs(direction);
  float face = -1.0;
  if (absDirection.x > absDirection.z) {
    if (absDirection.x > absDirection.y) face = direction.x > 0.0 ? 0.0 : 3.0;
    else face = direction.y > 0.0 ? 1.0 : 4.0;
  } else {
    if (absDirection.z > absDirection.y) face = direction.z > 0.0 ? 2.0 : 5.0;
    else face = direction.y > 0.0 ? 1.0 : 4.0;
  }
  return face;
}

vec2 getUV(vec3 direction, float face) {
  vec2 uv;
  if (face == 0.0) uv = vec2(direction.z, direction.y) / abs(direction.x);
  else if (face == 1.0) uv = vec2(-direction.x, -direction.z) / abs(direction.y);
  else if (face == 2.0) uv = vec2(-direction.x, direction.y) / abs(direction.z);
  else if (face == 3.0) uv = vec2(-direction.z, direction.y) / abs(direction.x);
  else if (face == 4.0) uv = vec2(-direction.x, direction.z) / abs(direction.y);
  else uv = vec2(direction.x, direction.y) / abs(direction.z);
  return 0.5 * (uv + 1.0);
}

vec3 bilinearCubeUV(vec3 direction, float mipInt) {
  float face = getFace(direction);
  float filterInt = max(cubeUV_minMipLevel - mipInt, 0.0);
  mipInt = max(mipInt, cubeUV_minMipLevel);
  float faceSize = exp2(mipInt);
  highp vec2 uv = getUV(direction, face) * (faceSize - 2.0) + 1.0;
  if (face > 2.0) {
    uv.y += faceSize;
    face -= 3.0;
  }
  uv.x += face * faceSize;
  uv.x += filterInt * 3.0 * cubeUV_minTileSize;
  uv.y += 4.0 * (exp2(envParams.z) - faceSize);
  uv.x *= envParams.x;
  uv.y *= envParams.y;
  return textureLod(envMap, uv, 0.0).rgb;
}

#define cubeUV_r0 1.0
#define cubeUV_m0 -2.0
#define cubeUV_r1 0.8
#define cubeUV_m1 -1.0
#define cubeUV_r4 0.4
#define cubeUV_m4 2.0
#define cubeUV_r5 0.305
#define cubeUV_m5 3.0
#define cubeUV_r6 0.21
#define cubeUV_m6 4.0

float roughnessToMip(float roughness) {
  float mip = 0.0;
  if (roughness >= cubeUV_r1) {
    mip = (cubeUV_r0 - roughness) * (cubeUV_m1 - cubeUV_m0) / (cubeUV_r0 - cubeUV_r1) + cubeUV_m0;
  } else if (roughness >= cubeUV_r4) {
    mip = (cubeUV_r1 - roughness) * (cubeUV_m4 - cubeUV_m1) / (cubeUV_r1 - cubeUV_r4) + cubeUV_m1;
  } else if (roughness >= cubeUV_r5) {
    mip = (cubeUV_r4 - roughness) * (cubeUV_m5 - cubeUV_m4) / (cubeUV_r4 - cubeUV_r5) + cubeUV_m4;
  } else if (roughness >= cubeUV_r6) {
    mip = (cubeUV_r5 - roughness) * (cubeUV_m6 - cubeUV_m5) / (cubeUV_r5 - cubeUV_r6) + cubeUV_m5;
  } else {
    mip = -2.0 * log2(1.16 * roughness);
  }
  return mip;
}

vec3 textureCubeUV(vec3 sampleDir, float roughness) {
  float mip = clamp(roughnessToMip(roughness), cubeUV_m0, envParams.z);
  float mipF = fract(mip);
  float mipInt = floor(mip);
  vec3 color0 = bilinearCubeUV(sampleDir, mipInt);
  if (mipF == 0.0) return color0;
  vec3 color1 = bilinearCubeUV(sampleDir, mipInt + 1.0);
  return mix(color0, color1, mipF);
}

// The view matrix's rotation is orthonormal, so its transpose undoes it.
vec3 toWorld(vec3 dir) {
  return normalize((vec4(dir, 0.0) * viewMatrix).xyz);
}

vec3 getIBLIrradiance(vec3 normal) {
  if (envParams.w < 0.5) return vec3(0.0);
  return PI * textureCubeUV(toWorld(normal), 1.0);
}

vec3 getIBLRadiance(vec3 viewDir, vec3 normal, float roughness) {
  if (envParams.w < 0.5) return vec3(0.0);
  vec3 reflectVec = reflect(-viewDir, normal);
  // Leaning the reflection towards the normal keeps a rough surface from
  // gathering light from behind its own tangent plane.
  reflectVec = normalize(mix(reflectVec, normal, pow4(roughness)));
  return textureCubeUV(toWorld(reflectVec), roughness);
}

// Bump mapping from a height map, without tangents (Mikkelsen 2010): the
// height's screen-space slope, pushed through the surface's own slope.
vec2 dHdxy_fwd() {
  vec2 dSTdx = dFdx(vUv);
  vec2 dSTdy = dFdy(vUv);
  float bumpScale = drawSurface.z;
  float Hll = bumpScale * texture(bumpMap, vUv).x;
  float dBx = bumpScale * texture(bumpMap, vUv + dSTdx).x - Hll;
  float dBy = bumpScale * texture(bumpMap, vUv + dSTdy).x - Hll;
  return vec2(dBx, dBy);
}

vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}

void main() {
  vec4 diffuseColor = drawColor * texture(colorMap, vUv);
  vec3 totalEmissiveRadiance = drawEmissive.rgb * texture(emissiveMap, vUv).rgb;
  float metalness = drawSurface.y;

  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
  vec3 normal = normalize(vNormal);
  vec3 nonPerturbedNormal = normal;
  if (drawSurface.z != 0.0) normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);
  vec3 clearcoatNormal = nonPerturbedNormal;

  // How much the normal turns across a pixel is roughness the eye cannot
  // resolve, so it is added on — it is what stops a curved edge sparkling.
  vec3 dxy = max(abs(dFdx(nonPerturbedNormal)), abs(dFdy(nonPerturbedNormal)));
  float geometryRoughness = max(max(dxy.x, dxy.y), dxy.z);

  vec3 diffuse = diffuseColor.rgb;
  vec3 diffuseContribution = diffuse * (1.0 - metalness);
  float roughness = min(max(drawSurface.x, 0.0525) + geometryRoughness, 1.0);
  vec3 specularColor = vec3(0.04);
  vec3 specularColorBlended = mix(specularColor, diffuse, metalness);
  float specularF90 = 1.0;

  float clearcoat = saturate(drawSurface.w);
  bool coated = drawSurface.w > 0.0;
  float clearcoatRoughness = min(max(drawCoat.x, 0.0525) + geometryRoughness, 1.0);
  vec3 clearcoatF0 = vec3(0.04);
  float clearcoatF90 = 1.0;

  bool sheened = drawSheen.a > 0.5;
  vec3 sheenColor = drawSheen.rgb;
  float sheenRoughness = clamp(drawCoat.y, 0.0001, 1.0);

  vec3 geometryViewDir = normalize(vViewPosition);

  vec3 directDiffuse = vec3(0.0);
  vec3 directSpecular = vec3(0.0);
  vec3 indirectDiffuse = vec3(0.0);
  vec3 indirectSpecular = vec3(0.0);
  vec3 clearcoatSpecularDirect = vec3(0.0);
  vec3 clearcoatSpecularIndirect = vec3(0.0);
  vec3 sheenSpecularDirect = vec3(0.0);
  vec3 sheenSpecularIndirect = vec3(0.0);

  int lights = int(counts.x);
  for (int i = 0; i < 4; i++) {
    if (i >= lights) break;
    vec3 direction = lightDirection[i].xyz;
    vec3 color = lightColor[i].rgb;

    float dotNL = saturate(dot(normal, direction));
    vec3 irradiance = dotNL * color;

    if (coated) {
      float dotNLcc = saturate(dot(clearcoatNormal, direction));
      clearcoatSpecularDirect += dotNLcc * color
        * BRDF_GGX(direction, geometryViewDir, clearcoatNormal, clearcoatF0, clearcoatF90, clearcoatRoughness);
    }

    if (sheened) {
      sheenSpecularDirect += irradiance * BRDF_Sheen(direction, geometryViewDir, normal, sheenColor, sheenRoughness);
      float sheenAlbedoV = IBLSheenBRDF(normal, geometryViewDir, sheenRoughness);
      float sheenAlbedoL = IBLSheenBRDF(normal, direction, sheenRoughness);
      irradiance *= 1.0 - max3(sheenColor) * max(sheenAlbedoV, sheenAlbedoL);
    }

    directSpecular += irradiance
      * BRDF_GGX_Multiscatter(direction, geometryViewDir, normal, specularColorBlended, specularF90, roughness);
    directDiffuse += irradiance * RECIPROCAL_PI * diffuseContribution;
  }

  vec3 irradiance = vec3(0.0);
  if (hemiSky.a > 0.5) {
    float hemiDiffuseWeight = 0.5 * dot(normal, hemiDirection.xyz) + 0.5;
    irradiance += mix(hemiGround.rgb, hemiSky.rgb, hemiDiffuseWeight);
  }

  vec3 iblIrradiance = getIBLIrradiance(normal);
  vec3 radiance = getIBLRadiance(geometryViewDir, normal, roughness);

  float sheenAlbedo = sheened ? IBLSheenBRDF(normal, geometryViewDir, sheenRoughness) : 0.0;
  float sheenEnergyComp = 1.0 - max3(sheenColor) * sheenAlbedo;

  vec3 lambert = irradiance * RECIPROCAL_PI * diffuseContribution;
  if (sheened) lambert *= sheenEnergyComp;
  indirectDiffuse += lambert;

  if (coated) {
    vec3 clearcoatRadiance = getIBLRadiance(geometryViewDir, clearcoatNormal, clearcoatRoughness);
    clearcoatSpecularIndirect += clearcoatRadiance
      * EnvironmentBRDF(clearcoatNormal, geometryViewDir, clearcoatF0, clearcoatF90, clearcoatRoughness);
  }

  if (sheened) {
    sheenSpecularIndirect += iblIrradiance * sheenColor * sheenAlbedo * RECIPROCAL_PI;
  }

  vec3 singleScatteringDielectric = vec3(0.0);
  vec3 multiScatteringDielectric = vec3(0.0);
  vec3 singleScatteringMetallic = vec3(0.0);
  vec3 multiScatteringMetallic = vec3(0.0);
  computeMultiscattering(normal, geometryViewDir, specularColor, specularF90, roughness,
    singleScatteringDielectric, multiScatteringDielectric);
  computeMultiscattering(normal, geometryViewDir, diffuse, specularF90, roughness,
    singleScatteringMetallic, multiScatteringMetallic);

  vec3 singleScattering = mix(singleScatteringDielectric, singleScatteringMetallic, metalness);
  vec3 multiScattering = mix(multiScatteringDielectric, multiScatteringMetallic, metalness);
  vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
  vec3 diffuseIBL = diffuseContribution * (1.0 - totalScatteringDielectric);
  vec3 cosineWeightedIrradiance = iblIrradiance * RECIPROCAL_PI;

  vec3 specularIBL = radiance * singleScattering + multiScattering * cosineWeightedIrradiance;
  vec3 diffuseFromIBL = diffuseIBL * cosineWeightedIrradiance;
  if (sheened) {
    specularIBL *= sheenEnergyComp;
    diffuseFromIBL *= sheenEnergyComp;
  }
  indirectSpecular += specularIBL;
  indirectDiffuse += diffuseFromIBL;

  vec3 outgoingLight = directDiffuse + indirectDiffuse + directSpecular + indirectSpecular + totalEmissiveRadiance;

  if (sheened) outgoingLight += sheenSpecularDirect + sheenSpecularIndirect;

  if (coated) {
    float dotNVcc = saturate(dot(clearcoatNormal, geometryViewDir));
    vec3 Fcc = F_Schlick(clearcoatF0, clearcoatF90, dotNVcc);
    outgoingLight = outgoingLight * (1.0 - clearcoat * Fcc)
      + (clearcoatSpecularDirect + clearcoatSpecularIndirect) * clearcoat;
  }

  float alpha = drawFlags.z > 0.5 ? 1.0 : diffuseColor.a;
  fragColor = finish(outgoingLight, alpha, vViewPosition.z);
}
