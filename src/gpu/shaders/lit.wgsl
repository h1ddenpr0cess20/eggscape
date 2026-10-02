// Metal/rough PBR with a clearcoat and a sheen, lit by directional lights, a
// hemisphere light and a prefiltered environment — lit.frag.glsl, term for
// term. Change a constant in one and change it in the other.

const PI = 3.141592653589793;
const RECIPROCAL_PI = 0.3183098861837907;
const EPSILON = 1e-6;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) viewPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

@vertex
fn vs(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  // Canvases are uploaded top row first; the geometry's uvs put the top at 1.
  out.uv = vec2f(input.uv.x, 1.0 - input.uv.y);
  let n = draw.normalMatrix;
  out.normal = normalize(mat3x3f(n[0].xyz, n[1].xyz, n[2].xyz) * input.normal);
  let mvPosition = draw.modelView * vec4f(input.position, 1.0);
  out.position = frame.projection * mvPosition;
  out.viewPosition = -mvPosition.xyz;
  return out;
}

fn pow2(x: f32) -> f32 { return x * x; }
fn pow4(x: f32) -> f32 { let x2 = x * x; return x2 * x2; }
fn max3(v: vec3f) -> f32 { return max(max(v.x, v.y), v.z); }

fn F_Schlick(f0: vec3f, f90: f32, dotVH: f32) -> vec3f {
  let fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1.0 - fresnel) + (f90 * fresnel);
}

fn V_GGX_SmithCorrelated(alpha: f32, dotNL: f32, dotNV: f32) -> f32 {
  let a2 = pow2(alpha);
  let gv = dotNL * sqrt(a2 + (1.0 - a2) * pow2(dotNV));
  let gl = dotNV * sqrt(a2 + (1.0 - a2) * pow2(dotNL));
  return 0.5 / max(gv + gl, EPSILON);
}

fn D_GGX(alpha: f32, dotNH: f32) -> f32 {
  let a2 = pow2(alpha);
  let denom = pow2(dotNH) * (a2 - 1.0) + 1.0;
  return RECIPROCAL_PI * a2 / pow2(denom);
}

fn BRDF_GGX(lightDir: vec3f, viewDir: vec3f, normal: vec3f, f0: vec3f, f90: f32, roughness: f32) -> vec3f {
  let alpha = pow2(roughness);
  let halfDir = normalize(lightDir + viewDir);
  let dotNL = saturate(dot(normal, lightDir));
  let dotNV = saturate(dot(normal, viewDir));
  let dotNH = saturate(dot(normal, halfDir));
  let dotVH = saturate(dot(viewDir, halfDir));
  let F = F_Schlick(f0, f90, dotVH);
  let V = V_GGX_SmithCorrelated(alpha, dotNL, dotNV);
  let D = D_GGX(alpha, dotNH);
  return F * (V * D);
}

fn D_Charlie(roughness: f32, dotNH: f32) -> f32 {
  let alpha = pow2(roughness);
  let invAlpha = 1.0 / alpha;
  let cos2h = dotNH * dotNH;
  let sin2h = max(1.0 - cos2h, 0.0078125);
  return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * PI);
}

fn V_Neubelt(dotNV: f32, dotNL: f32) -> f32 {
  return saturate(1.0 / (4.0 * (dotNL + dotNV - dotNL * dotNV)));
}

fn BRDF_Sheen(lightDir: vec3f, viewDir: vec3f, normal: vec3f, sheenColor: vec3f, sheenRoughness: f32) -> vec3f {
  let halfDir = normalize(lightDir + viewDir);
  let dotNL = saturate(dot(normal, lightDir));
  let dotNV = saturate(dot(normal, viewDir));
  let dotNH = saturate(dot(normal, halfDir));
  return sheenColor * (D_Charlie(sheenRoughness, dotNH) * V_Neubelt(dotNV, dotNL));
}

fn IBLSheenBRDF(normal: vec3f, viewDir: vec3f, roughness: f32) -> f32 {
  let dotNV = saturate(dot(normal, viewDir));
  let r2 = roughness * roughness;
  let rInv = 1.0 / (roughness + 0.1);
  let a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
  let b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
  return saturate(exp(a * dotNV + b));
}

fn dfg(roughness: f32, dotNV: f32) -> vec2f {
  return textureSampleLevel(dfgLut, clampSampler, vec2f(roughness, dotNV), 0.0).rg;
}

fn EnvironmentBRDF(normal: vec3f, viewDir: vec3f, specularColor: vec3f, specularF90: f32, roughness: f32) -> vec3f {
  let fab = dfg(roughness, saturate(dot(normal, viewDir)));
  return specularColor * fab.x + specularF90 * fab.y;
}

struct Scattering {
  single: vec3f,
  multi: vec3f,
}

fn computeMultiscattering(normal: vec3f, viewDir: vec3f, specularColor: vec3f, specularF90: f32, roughness: f32) -> Scattering {
  let fab = dfg(roughness, saturate(dot(normal, viewDir)));
  let FssEss = specularColor * fab.x + specularF90 * fab.y;
  let Ess = fab.x + fab.y;
  let Ems = 1.0 - Ess;
  let Favg = specularColor + (1.0 - specularColor) * 0.047619;
  let Fms = FssEss * Favg / (1.0 - Ems * Favg);
  return Scattering(FssEss, Fms * Ems);
}

fn BRDF_GGX_Multiscatter(lightDir: vec3f, viewDir: vec3f, normal: vec3f, specularColor: vec3f, specularF90: f32, roughness: f32) -> vec3f {
  let singleScatter = BRDF_GGX(lightDir, viewDir, normal, specularColor, specularF90, roughness);
  let dotNL = saturate(dot(normal, lightDir));
  let dotNV = saturate(dot(normal, viewDir));
  let dfgV = dfg(roughness, dotNV);
  let dfgL = dfg(roughness, dotNL);
  let FssEss_V = specularColor * dfgV.x + specularF90 * dfgV.y;
  let FssEss_L = specularColor * dfgL.x + specularF90 * dfgL.y;
  let Ems_V = 1.0 - (dfgV.x + dfgV.y);
  let Ems_L = 1.0 - (dfgL.x + dfgL.y);
  let Favg = specularColor + (1.0 - specularColor) * 0.047619;
  let Fms = FssEss_V * FssEss_L * Favg / (1.0 - Ems_V * Ems_L * Favg + EPSILON);
  return singleScatter + Fms * (Ems_V * Ems_L);
}

const cubeUV_minMipLevel = 4.0;
const cubeUV_minTileSize = 16.0;

fn getFace(direction: vec3f) -> f32 {
  let absDirection = abs(direction);
  var face = -1.0;
  if (absDirection.x > absDirection.z) {
    if (absDirection.x > absDirection.y) {
      face = select(3.0, 0.0, direction.x > 0.0);
    } else {
      face = select(4.0, 1.0, direction.y > 0.0);
    }
  } else {
    if (absDirection.z > absDirection.y) {
      face = select(5.0, 2.0, direction.z > 0.0);
    } else {
      face = select(4.0, 1.0, direction.y > 0.0);
    }
  }
  return face;
}

fn getUV(direction: vec3f, face: f32) -> vec2f {
  var uv: vec2f;
  if (face == 0.0) {
    uv = vec2f(direction.z, direction.y) / abs(direction.x);
  } else if (face == 1.0) {
    uv = vec2f(-direction.x, -direction.z) / abs(direction.y);
  } else if (face == 2.0) {
    uv = vec2f(-direction.x, direction.y) / abs(direction.z);
  } else if (face == 3.0) {
    uv = vec2f(-direction.z, direction.y) / abs(direction.x);
  } else if (face == 4.0) {
    uv = vec2f(-direction.x, direction.z) / abs(direction.y);
  } else {
    uv = vec2f(direction.x, direction.y) / abs(direction.z);
  }
  return 0.5 * (uv + 1.0);
}

fn bilinearCubeUV(direction: vec3f, mipLevel: f32) -> vec3f {
  var face = getFace(direction);
  let filterInt = max(cubeUV_minMipLevel - mipLevel, 0.0);
  let mipInt = max(mipLevel, cubeUV_minMipLevel);
  let faceSize = exp2(mipInt);
  var uv = getUV(direction, face) * (faceSize - 2.0) + 1.0;
  if (face > 2.0) {
    uv.y += faceSize;
    face -= 3.0;
  }
  uv.x += face * faceSize;
  uv.x += filterInt * 3.0 * cubeUV_minTileSize;
  uv.y += 4.0 * (exp2(frame.envParams.z) - faceSize);
  uv.x *= frame.envParams.x;
  uv.y *= frame.envParams.y;
  return textureSampleLevel(envMap, clampSampler, uv, 0.0).rgb;
}

const cubeUV_r0 = 1.0;
const cubeUV_m0 = -2.0;
const cubeUV_r1 = 0.8;
const cubeUV_m1 = -1.0;
const cubeUV_r4 = 0.4;
const cubeUV_m4 = 2.0;
const cubeUV_r5 = 0.305;
const cubeUV_m5 = 3.0;
const cubeUV_r6 = 0.21;
const cubeUV_m6 = 4.0;

fn roughnessToMip(roughness: f32) -> f32 {
  var mip = 0.0;
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

fn textureCubeUV(sampleDir: vec3f, roughness: f32) -> vec3f {
  let mip = clamp(roughnessToMip(roughness), cubeUV_m0, frame.envParams.z);
  let mipF = fract(mip);
  let mipInt = floor(mip);
  let color0 = bilinearCubeUV(sampleDir, mipInt);
  if (mipF == 0.0) {
    return color0;
  }
  let color1 = bilinearCubeUV(sampleDir, mipInt + 1.0);
  return mix(color0, color1, mipF);
}

// The view matrix's rotation is orthonormal, so its transpose undoes it.
fn toWorld(dir: vec3f) -> vec3f {
  return normalize((vec4f(dir, 0.0) * frame.view).xyz);
}

fn getIBLIrradiance(normal: vec3f) -> vec3f {
  if (frame.envParams.w < 0.5) {
    return vec3f(0.0);
  }
  return PI * textureCubeUV(toWorld(normal), 1.0);
}

fn getIBLRadiance(viewDir: vec3f, normal: vec3f, roughness: f32) -> vec3f {
  if (frame.envParams.w < 0.5) {
    return vec3f(0.0);
  }
  var reflectVec = reflect(-viewDir, normal);
  reflectVec = normalize(mix(reflectVec, normal, pow4(roughness)));
  return textureCubeUV(toWorld(reflectVec), roughness);
}

fn dHdxy_fwd(uv: vec2f) -> vec2f {
  let dSTdx = dpdx(uv);
  let dSTdy = dpdy(uv);
  let bumpScale = draw.surface.z;
  let Hll = bumpScale * textureSample(bumpMap, bumpSampler, uv).x;
  let dBx = bumpScale * textureSample(bumpMap, bumpSampler, uv + dSTdx).x - Hll;
  let dBy = bumpScale * textureSample(bumpMap, bumpSampler, uv + dSTdy).x - Hll;
  return vec2f(dBx, dBy);
}

fn perturbNormalArb(surf_pos: vec3f, surf_norm: vec3f, dHdxy: vec2f, faceDirection: f32) -> vec3f {
  let vSigmaX = normalize(dpdx(surf_pos));
  let vSigmaY = normalize(dpdy(surf_pos));
  let vN = surf_norm;
  let R1 = cross(vSigmaY, vN);
  let R2 = cross(vN, vSigmaX);
  let fDet = dot(vSigmaX, R1) * faceDirection;
  let vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}

@fragment
fn fs(input: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let diffuseColor = draw.color * textureSample(colorMap, colorSampler, input.uv);
  let totalEmissiveRadiance = draw.emissive.rgb * textureSample(emissiveMap, emissiveSampler, input.uv).rgb;
  let metalness = draw.surface.y;

  let faceDirection = select(-1.0, 1.0, front);
  var normal = normalize(input.normal);
  let nonPerturbedNormal = normal;
  if (draw.surface.z != 0.0) {
    normal = perturbNormalArb(-input.viewPosition, normal, dHdxy_fwd(input.uv), faceDirection);
  }
  let clearcoatNormal = nonPerturbedNormal;

  let dxy = max(abs(dpdx(nonPerturbedNormal)), abs(dpdy(nonPerturbedNormal)));
  let geometryRoughness = max(max(dxy.x, dxy.y), dxy.z);

  let diffuse = diffuseColor.rgb;
  let diffuseContribution = diffuse * (1.0 - metalness);
  let roughness = min(max(draw.surface.x, 0.0525) + geometryRoughness, 1.0);
  let specularColor = vec3f(0.04);
  let specularColorBlended = mix(specularColor, diffuse, metalness);
  let specularF90 = 1.0;

  let clearcoat = saturate(draw.surface.w);
  let coated = draw.surface.w > 0.0;
  let clearcoatRoughness = min(max(draw.coat.x, 0.0525) + geometryRoughness, 1.0);
  let clearcoatF0 = vec3f(0.04);
  let clearcoatF90 = 1.0;

  let sheened = draw.sheen.a > 0.5;
  let sheenColor = draw.sheen.rgb;
  let sheenRoughness = clamp(draw.coat.y, 0.0001, 1.0);

  let geometryViewDir = normalize(input.viewPosition);

  var directDiffuse = vec3f(0.0);
  var directSpecular = vec3f(0.0);
  var indirectDiffuse = vec3f(0.0);
  var indirectSpecular = vec3f(0.0);
  var clearcoatSpecularDirect = vec3f(0.0);
  var clearcoatSpecularIndirect = vec3f(0.0);
  var sheenSpecularDirect = vec3f(0.0);
  var sheenSpecularIndirect = vec3f(0.0);

  let lights = i32(frame.counts.x);
  for (var i = 0; i < 4; i++) {
    if (i >= lights) {
      break;
    }
    let direction = frame.lightDirection[i].xyz;
    let color = frame.lightColor[i].rgb;

    let dotNL = saturate(dot(normal, direction));
    var irradiance = dotNL * color;

    if (coated) {
      let dotNLcc = saturate(dot(clearcoatNormal, direction));
      clearcoatSpecularDirect += dotNLcc * color
        * BRDF_GGX(direction, geometryViewDir, clearcoatNormal, clearcoatF0, clearcoatF90, clearcoatRoughness);
    }

    if (sheened) {
      sheenSpecularDirect += irradiance * BRDF_Sheen(direction, geometryViewDir, normal, sheenColor, sheenRoughness);
      let sheenAlbedoV = IBLSheenBRDF(normal, geometryViewDir, sheenRoughness);
      let sheenAlbedoL = IBLSheenBRDF(normal, direction, sheenRoughness);
      irradiance *= 1.0 - max3(sheenColor) * max(sheenAlbedoV, sheenAlbedoL);
    }

    directSpecular += irradiance
      * BRDF_GGX_Multiscatter(direction, geometryViewDir, normal, specularColorBlended, specularF90, roughness);
    directDiffuse += irradiance * RECIPROCAL_PI * diffuseContribution;
  }

  var irradiance = vec3f(0.0);
  if (frame.hemiSky.a > 0.5) {
    let hemiDiffuseWeight = 0.5 * dot(normal, frame.hemiDirection.xyz) + 0.5;
    irradiance += mix(frame.hemiGround.rgb, frame.hemiSky.rgb, hemiDiffuseWeight);
  }

  let iblIrradiance = getIBLIrradiance(normal);
  let radiance = getIBLRadiance(geometryViewDir, normal, roughness);

  var sheenAlbedo = 0.0;
  if (sheened) {
    sheenAlbedo = IBLSheenBRDF(normal, geometryViewDir, sheenRoughness);
  }
  let sheenEnergyComp = 1.0 - max3(sheenColor) * sheenAlbedo;

  var lambert = irradiance * RECIPROCAL_PI * diffuseContribution;
  if (sheened) {
    lambert *= sheenEnergyComp;
  }
  indirectDiffuse += lambert;

  if (coated) {
    let clearcoatRadiance = getIBLRadiance(geometryViewDir, clearcoatNormal, clearcoatRoughness);
    clearcoatSpecularIndirect += clearcoatRadiance
      * EnvironmentBRDF(clearcoatNormal, geometryViewDir, clearcoatF0, clearcoatF90, clearcoatRoughness);
  }

  if (sheened) {
    sheenSpecularIndirect += iblIrradiance * sheenColor * sheenAlbedo * RECIPROCAL_PI;
  }

  let dielectric = computeMultiscattering(normal, geometryViewDir, specularColor, specularF90, roughness);
  let metallic = computeMultiscattering(normal, geometryViewDir, diffuse, specularF90, roughness);

  let singleScattering = mix(dielectric.single, metallic.single, metalness);
  let multiScattering = mix(dielectric.multi, metallic.multi, metalness);
  let totalScatteringDielectric = dielectric.single + dielectric.multi;
  let diffuseIBL = diffuseContribution * (1.0 - totalScatteringDielectric);
  let cosineWeightedIrradiance = iblIrradiance * RECIPROCAL_PI;

  var specularIBL = radiance * singleScattering + multiScattering * cosineWeightedIrradiance;
  var diffuseFromIBL = diffuseIBL * cosineWeightedIrradiance;
  if (sheened) {
    specularIBL *= sheenEnergyComp;
    diffuseFromIBL *= sheenEnergyComp;
  }
  indirectSpecular += specularIBL;
  indirectDiffuse += diffuseFromIBL;

  var outgoingLight = directDiffuse + indirectDiffuse + directSpecular + indirectSpecular + totalEmissiveRadiance;

  if (sheened) {
    outgoingLight += sheenSpecularDirect + sheenSpecularIndirect;
  }

  if (coated) {
    let dotNVcc = saturate(dot(clearcoatNormal, geometryViewDir));
    let Fcc = F_Schlick(clearcoatF0, clearcoatF90, dotNVcc);
    outgoingLight = outgoingLight * (1.0 - clearcoat * Fcc)
      + (clearcoatSpecularDirect + clearcoatSpecularIndirect) * clearcoat;
  }

  let alpha = select(diffuseColor.a, 1.0, draw.flags.z > 0.5);
  return finish(outgoingLight, alpha, input.viewPosition.z);
}
