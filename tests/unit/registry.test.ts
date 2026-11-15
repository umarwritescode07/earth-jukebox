import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { mediaManifest, getManifestAsset, renditionsFor } from "@/registry/manifest";
import { METHOD_REFERENCES, SOURCES, getSource } from "@/registry/sources";
import { observationAt, phaseAt } from "@/registry/timeline";

/** SVS ids on the Space Apps 2026 "Earth Information Jukebox" Resources tab (as supplied by the team). */
const CHALLENGE_SVS_IDS = new Set([5313, 13786, 3912, 5669, 5533, 5425, 5196, 5011, 4960, 4950]);

describe("source registry", () => {
  it("only uses challenge resources, all hosted on NASA SVS", () => {
    for (const s of SOURCES) {
      expect(CHALLENGE_SVS_IDS.has(s.svsId)).toBe(true);
      expect(s.sourcePage).toBe(`https://svs.gsfc.nasa.gov/${s.svsId}/`);
    }
    for (const a of mediaManifest.assets) {
      expect(new URL(a.original.url).hostname).toBe("svs.gsfc.nasa.gov");
      if (a.passthrough) expect(new URL(a.passthrough.url).hostname).toBe("svs.gsfc.nasa.gov");
    }
    for (const t of mediaManifest.thumbnails) expect(new URL(t.url).hostname).toBe("svs.gsfc.nasa.gov");
  });

  it("never treats Caldwell 73 as Earth data", () => {
    expect(SOURCES.some((s) => s.svsId === 13786)).toBe(false);
    expect(METHOD_REFERENCES.map((m) => m.svsId)).toContain(13786);
  });

  it("links every playable source to a manifest asset whose derivative keeps the original aspect ratio (no crop)", () => {
    for (const s of SOURCES.filter((x) => x.status === "playable")) {
      const a = getManifestAsset(s.assetId!);
      expect(a, s.id).toBeDefined();
      const ro = a!.original.width / a!.original.height;
      const rd = a!.derivative.width / a!.derivative.height;
      expect(Math.abs(ro - rd) / ro).toBeLessThan(0.005);
      expect(a!.original.audio).toBe("none");
    }
  });

  it("offers a passthrough only for browser-compatible originals", () => {
    for (const a of mediaManifest.assets) {
      if (!a.passthrough) continue;
      expect(["video/mp4", "video/webm", "image/png"]).toContain(a.passthrough.mimeType);
      if (a.passthrough.mimeType === "video/mp4") expect(a.passthrough.videoCodec).toBe("h264");
    }
    const nightLights = getManifestAsset("svs5313-nightlights-eic")!;
    expect(nightLights.original.videoCodec).toBe("hevc");
    expect(nightLights.passthrough).toBeNull();
    expect(renditionsFor(nightLights, null)).toEqual([]);
  });

  it("records the GEDI date conflict instead of choosing one range", () => {
    const gedi = getSource("svs-4950")!;
    expect(gedi.coverage.conflicts?.join(" ")).toMatch(/April 2019 and April 2020/);
    expect(gedi.coverage.conflicts?.join(" ")).toMatch(/April 2018 and April 2019/);
    expect(gedi.observationMapping.type).toBe("none");
  });

  it("defines every colour group as a subset of the profile's signal pixels", () => {
    for (const s of SOURCES) {
      const a = s.analysis!;
      for (const groups of Object.values(a.colorGroupsByPhase)) {
        for (const g of groups) {
          expect(g.minLum, `${s.id}/${g.id}`).toBeGreaterThanOrEqual(a.signal.minLum);
          expect(g.minSat >= a.signal.minSat || g.minLum >= a.signal.brightLum, `${s.id}/${g.id}`).toBe(true);
        }
      }
    }
  });

  it("records the ISS lightning start-month conflict", () => {
    const lis = getSource("svs-5011")!;
    expect(lis.coverage.conflicts?.join(" ")).toMatch(/January 2017/);
    expect(lis.coverage.conflicts?.join(" ")).toMatch(/March 2017/);
  });

  it("keeps air-quality pollutant layers disabled with a reason", () => {
    const aq = getSource("svs-5533")!;
    expect(aq.disabledControls.find((d) => /pollutant/i.test(d.control))?.reason).toMatch(/does not separate/);
  });
});

describe("Night Lights (5313) frame-verified timeline", () => {
  const nl = getSource("svs-5313")!;

  it("has contiguous phases covering the whole 43.33 s asset", () => {
    expect(nl.phases[0].startS).toBe(0);
    for (let i = 1; i < nl.phases.length; i++) expect(nl.phases[i].startS).toBeCloseTo(nl.phases[i - 1].endS, 9);
    expect(nl.phases.at(-1)!.endS).toBeCloseTo(1300 / 30, 4);
  });

  it("maps verified frames to the labels read from the video", () => {
    // frames read visually: 16→2013, 148→2020, 200→2023, 450→change, 700→2012, 1000→2022, 1050→2023
    const at = (frame: number) => observationAt(nl, frame / 30);
    expect(at(16)?.label).toMatch(/2013/);
    expect(at(148)?.label).toMatch(/2020/);
    expect(at(200)?.label).toMatch(/2023/);
    expect(at(450)?.kind).toBe("comparison");
    expect(at(700)?.label).toMatch(/2012/);
    expect(at(1000)?.label).toMatch(/2022/);
    expect(at(1050)?.label).toMatch(/2023/);
    expect(phaseAt(nl, 295 / 30)?.id).toBe("transition");
    expect(observationAt(nl, 295 / 30)).toBeNull(); // cross-fade: no observation time claimed
  });
});

describe("ECCO2 (3912) model time from NASA's per-frame date table", () => {
  const table = readFileSync(path.resolve(__dirname, "../../src/registry/data/svs3912_flat_ecco2_dates.txt"), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[1]);
  const src = getSource("svs-3912")!;

  it("matches the frame count of the selected rendition", () => {
    expect(table).toHaveLength(2001);
    expect(getManifestAsset(src.assetId!)!.original.frameCount).toBe(2001);
  });

  it("agrees with every NASA timestamp within one minute", () => {
    let worst = 0;
    table.forEach((iso, i) => {
      const o = observationAt(src, (i + 0.5) / 30)!;
      const diff = Math.abs(Date.parse(o.start) - Date.parse(iso.replace("Z", ":00Z")));
      worst = Math.max(worst, diff);
    });
    expect(worst).toBeLessThanOrEqual(60_000);
  });
});
