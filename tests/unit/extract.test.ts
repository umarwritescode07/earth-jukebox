import { describe, expect, it } from "vitest";

import { activeGroups, analysisMask, extractFeatures, matchesGroup, rgbToHsl } from "@/analysis/extract";
import { getSource } from "@/registry/sources";
import type { AnalysisProfile } from "@/registry/types";

/** Colours sampled from NASA legends (see docs/SOURCES.md). */
const AEROSOL_SWATCHES: Record<string, [number, number, number]> = {
  "black-carbon": [210, 94, 69],
  dust: [193, 154, 220],
  "sea-salt": [133, 170, 169],
  sulfate: [83, 220, 52],
};
const NIGHT_LIGHTS_BAR = { less: [230, 157, 90] as const, more: [147, 104, 196] as const, white: [255, 255, 255] as const };

function solid(w: number, h: number, rgb: readonly [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return d;
}

describe("colour conversion", () => {
  it("matches Python colorsys for the NASA legend swatches", () => {
    const [h, s, l] = rgbToHsl(210, 94, 69);
    expect(h).toBeCloseTo(10.6, 1);
    expect(s).toBeCloseTo(0.61, 2);
    expect(l).toBeCloseTo(0.547, 2);
  });
});

describe("colour groups derived from NASA legends", () => {
  it("classifies each GEOS aerosol legend swatch into its own group", () => {
    const profile = getSource("svs-5669")!.analysis!;
    const groups = activeGroups(profile, null);
    for (const [id, rgb] of Object.entries(AEROSOL_SWATCHES)) {
      const [h, s, l] = rgbToHsl(...rgb);
      const matched = groups.filter((g) => matchesGroup(h, s, l, g)).map((g) => g.id);
      expect(matched, id).toEqual([id]);
    }
  });

  it("interprets Night Lights colours only in the right phase", () => {
    const profile = getSource("svs-5313")!.analysis!;
    const change = activeGroups(profile, "change-global");
    const hsl = (c: readonly [number, number, number]) => rgbToHsl(c[0], c[1], c[2]);
    expect(change.filter((g) => matchesGroup(...hsl(NIGHT_LIGHTS_BAR.more), g)).map((g) => g.id)).toEqual(["more-light"]);
    expect(change.filter((g) => matchesGroup(...hsl(NIGHT_LIGHTS_BAR.less), g)).map((g) => g.id)).toEqual(["less-light"]);
    expect(change.some((g) => matchesGroup(...hsl(NIGHT_LIGHTS_BAR.white), g))).toBe(false);
    expect(activeGroups(profile, "transition")).toEqual([]);
  });
});

describe("extractFeatures", () => {
  const profile = getSource("svs-5313")!.analysis!;
  const w = 64;
  const h = 18;

  it("reports purple share in the change phase and marks inactive groups not-applicable", () => {
    const r = extractFeatures({ data: solid(w, h, NIGHT_LIGHTS_BAR.more), width: w, height: h, profile, phaseId: "change-global", prevLuma: null, sampleIntervalS: null });
    const f = Object.fromEntries(r.features.map((x) => [x.id, x]));
    expect(f["group:more-light:share"].value).toBeCloseTo(1, 5);
    expect(f["group:lights:share"].status).toBe("not-applicable");
    expect(f["change"].status).toBe("missing");
    expect(r.features.every((x) => x.origin === "image-derived")).toBe(true);
  });

  it("excludes the legend region from analysis", () => {
    const mask = analysisMask(w, h, profile);
    const excluded = mask.length - mask.reduce((a, b) => a + b, 0);
    expect(excluded).toBeGreaterThan(0);
    const r = extractFeatures({ data: solid(w, h, [0, 0, 0]), width: w, height: h, profile, phaseId: "annual-global", prevLuma: null, sampleIntervalS: null });
    expect(r.analysedPixels).toBe(mask.reduce((a, b) => a + b, 0));
  });

  it("marks everything masked when the band contains only excluded pixels", () => {
    const masked: AnalysisProfile = { ...profile, exclude: [{ x0: 0, y0: 0, x1: 1, y1: 1, reason: "test" }] };
    const r = extractFeatures({ data: solid(w, h, [255, 255, 255]), width: w, height: h, profile: masked, phaseId: "annual-global", prevLuma: null, sampleIntervalS: null });
    expect(r.features.find((x) => x.id === "signal_share")?.status).toBe("masked");
  });

  it("reports change per second so the value does not depend on the sampling rate", () => {
    const a = extractFeatures({ data: solid(w, h, [0, 0, 0]), width: w, height: h, profile, phaseId: "annual-global", prevLuma: null, sampleIntervalS: null });
    const tiny: AnalysisProfile = { ...profile, changeNormMax: 1000 };
    const b1 = extractFeatures({ data: solid(w, h, [10, 10, 10]), width: w, height: h, profile: tiny, phaseId: "annual-global", prevLuma: a.luma, sampleIntervalS: 0.5 });
    const b2 = extractFeatures({ data: solid(w, h, [10, 10, 10]), width: w, height: h, profile: tiny, phaseId: "annual-global", prevLuma: a.luma, sampleIntervalS: 0.25 });
    const v1 = b1.features.find((x) => x.id === "change")!.value!;
    const v2 = b2.features.find((x) => x.id === "change")!.value!;
    expect(v2).toBeCloseTo(v1 * 2, 9);
  });

  it("is deterministic", () => {
    const data = solid(w, h, NIGHT_LIGHTS_BAR.less);
    const x = extractFeatures({ data, width: w, height: h, profile, phaseId: "change-global", prevLuma: null, sampleIntervalS: null });
    const y = extractFeatures({ data, width: w, height: h, profile, phaseId: "change-global", prevLuma: null, sampleIntervalS: null });
    expect(y.features).toEqual(x.features);
  });
});
