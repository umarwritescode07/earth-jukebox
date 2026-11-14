/**
 * Pure, deterministic image-feature extraction from RGBA pixels.
 * Runs identically in the browser (canvas ImageData) and in Node tests.
 * All outputs are labelled "image-derived": they describe rendered pixels,
 * never the underlying physical quantity.
 */
import type { Feature } from "@/contracts/frame";
import type { AnalysisProfile, ColorGroup } from "@/registry/types";

export const EXTRACTION_METHOD = "hsl-colour-groups+luma-change";
export const EXTRACTION_VERSION = "1.0.0";

/** HSL with h in degrees [0,360), s and l in [0,1]. Same convention as Python colorsys.rgb_to_hls. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** Rec.709 luma of gamma-encoded sRGB, 0..1. */
export function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function hueInRange(h: number, [a, b]: [number, number]): boolean {
  if (a === 0 && b === 360) return true;
  return a <= b ? h >= a && h <= b : h >= a || h <= b;
}

export function matchesGroup(h: number, s: number, l: number, g: ColorGroup): boolean {
  if (s < g.minSat) return false;
  if (g.maxSat !== undefined && s > g.maxSat) return false;
  if (l < g.minLum) return false;
  if (g.maxLum !== undefined && l > g.maxLum) return false;
  return hueInRange(h, g.hue);
}

/** All colour groups the profile can ever emit, in a stable order (deduplicated by id). */
export function allGroups(profile: AnalysisProfile): ColorGroup[] {
  const seen = new Map<string, ColorGroup>();
  for (const key of Object.keys(profile.colorGroupsByPhase).sort()) {
    for (const g of profile.colorGroupsByPhase[key]) if (!seen.has(g.id)) seen.set(g.id, g);
  }
  return [...seen.values()];
}

export function activeGroups(profile: AnalysisProfile, phaseId: string | null): ColorGroup[] {
  if (phaseId && profile.colorGroupsByPhase[phaseId]) return profile.colorGroupsByPhase[phaseId];
  return profile.colorGroupsByPhase.default ?? [];
}

export interface Band {
  /** Normalised horizontal band [x0, x1) to analyse (used by still-image scans). */
  x0: number;
  x1: number;
}

export interface ExtractInput {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  profile: AnalysisProfile;
  phaseId: string | null;
  /** Luma of the previous sample at the same resolution (and band), for the change feature. */
  prevLuma: Float32Array | null;
  band?: Band;
}

export interface ExtractResult {
  features: Feature[];
  luma: Float32Array;
  analysedPixels: number;
}

const FRACTION = { method: "fraction-of-analysed-pixels" as const, min: 0, max: 1 };
const LIGHTNESS = { method: "fixed-range" as const, min: 0, max: 1, note: "HSL lightness of rendered pixels (0 = black, 1 = white)." };

function ok(id: string, label: string, value: number, unit: string, normalization: Feature["normalization"]): Feature {
  return { id, label, value, unit, status: "ok", origin: "image-derived", normalization };
}
function absent(id: string, label: string, unit: string, status: Exclude<Feature["status"], "ok">, normalization: Feature["normalization"]): Feature {
  return { id, label, value: null, unit, status, origin: "image-derived", normalization };
}

/** Builds (and caches) the analysed-pixel mask for a size + band + exclusion set. */
const maskCache = new Map<string, Uint8Array>();
export function analysisMask(width: number, height: number, profile: AnalysisProfile, band?: Band): Uint8Array {
  const key = `${width}x${height}|${band ? `${band.x0.toFixed(5)}-${band.x1.toFixed(5)}` : "full"}|${profile.exclude.map((r) => `${r.x0},${r.y0},${r.x1},${r.y1}`).join(";")}`;
  const cached = maskCache.get(key);
  if (cached) return cached;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width;
      if (band && (nx < band.x0 || nx >= band.x1)) continue;
      let excluded = false;
      for (const r of profile.exclude) {
        if (nx >= r.x0 && nx < r.x1 && ny >= r.y0 && ny < r.y1) {
          excluded = true;
          break;
        }
      }
      if (!excluded) mask[y * width + x] = 1;
    }
  }
  if (maskCache.size > 256) maskCache.clear();
  maskCache.set(key, mask);
  return mask;
}

export function extractFeatures(input: ExtractInput): ExtractResult {
  const { data, width, height, profile, phaseId, prevLuma, band } = input;
  const n = width * height;
  if (data.length < n * 4) throw new Error(`pixel buffer too small: ${data.length} < ${n * 4}`);
  const mask = analysisMask(width, height, profile, band);
  const groups = activeGroups(profile, phaseId);
  const groupCount = new Float64Array(groups.length);
  const groupLight = new Float64Array(groups.length);
  const lumaOut = new Float32Array(n);
  let analysed = 0;
  let signal = 0;
  let signalLight = 0;
  let changeSum = 0;
  const comparable = prevLuma !== null && prevLuma.length === n;
  const { minLum, minSat, brightLum } = profile.signal;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const y = luma(r, g, b);
    lumaOut[i] = y;
    if (!mask[i]) continue;
    analysed++;
    if (comparable) changeSum += Math.abs(y - prevLuma[i]);
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l >= minLum && (s >= minSat || l >= brightLum)) {
      signal++;
      signalLight += l;
    }
    for (let k = 0; k < groups.length; k++) {
      if (matchesGroup(h, s, l, groups[k])) {
        groupCount[k]++;
        groupLight[k] += l;
        break; // first matching group wins: groups are disjoint by construction
      }
    }
  }

  const features: Feature[] = [];
  if (analysed === 0) {
    features.push(absent("signal_share", "Lit / coloured pixel share", "fraction", "masked", FRACTION));
    features.push(absent("signal_lightness", "Lightness of lit / coloured pixels", "lightness", "masked", LIGHTNESS));
  } else {
    features.push(ok("signal_share", "Lit / coloured pixel share", signal / analysed, "fraction", FRACTION));
    features.push(
      signal > 0
        ? ok("signal_lightness", "Lightness of lit / coloured pixels", signalLight / signal, "lightness", LIGHTNESS)
        : absent("signal_lightness", "Lightness of lit / coloured pixels", "lightness", "missing", LIGHTNESS),
    );
  }

  const activeIds = new Set(groups.map((g) => g.id));
  for (const g of allGroups(profile)) {
    const shareId = `group:${g.id}:share`;
    const lightId = `group:${g.id}:lightness`;
    if (!activeIds.has(g.id)) {
      features.push(absent(shareId, `${g.label} — share`, "fraction", "not-applicable", FRACTION));
      features.push(absent(lightId, `${g.label} — lightness`, "lightness", "not-applicable", LIGHTNESS));
      continue;
    }
    const k = groups.findIndex((x) => x.id === g.id);
    if (analysed === 0) {
      features.push(absent(shareId, `${g.label} — share`, "fraction", "masked", FRACTION));
      features.push(absent(lightId, `${g.label} — lightness`, "lightness", "masked", LIGHTNESS));
      continue;
    }
    features.push(ok(shareId, `${g.label} — share`, groupCount[k] / analysed, "fraction", FRACTION));
    features.push(
      groupCount[k] > 0
        ? ok(lightId, `${g.label} — lightness`, groupLight[k] / groupCount[k], "lightness", LIGHTNESS)
        : absent(lightId, `${g.label} — lightness`, "lightness", "missing", LIGHTNESS),
    );
  }

  const changeNorm = { method: "fixed-range" as const, min: 0, max: profile.changeNormMax, note: "Mean absolute luma difference to the previous sample, divided by this max and clipped to 1." };
  if (comparable && analysed > 0) {
    features.push(ok("change", "Frame-to-frame change", Math.min(1, changeSum / analysed / profile.changeNormMax), "normalized", changeNorm));
  } else {
    features.push(absent("change", "Frame-to-frame change", "normalized", "missing", changeNorm));
  }

  return { features, luma: lumaOut, analysedPixels: analysed };
}
