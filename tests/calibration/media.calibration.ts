/**
 * Calibration against the real prepared NASA renditions (not part of `npm test`).
 *   npx vitest run --config vitest.calibration.config.mts
 *
 * Decodes each derivative with ffmpeg at the profile's analysis resolution
 * (2 samples per second), runs the production extractFeatures(), and prints
 * percentiles used to set signalForFullPad / shareForFullVelocity. It also
 * writes tests/fixtures/svs5313-features.json: real image-derived features
 * from NASA SVS 5313, used as a source-derived fixture by unit tests.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

import { allGroups, extractFeatures } from "@/analysis/extract";
import { FRAME_SCHEMA_VERSION, type FeatureFrame } from "@/contracts/frame";
import { computeScanFrames } from "@/data/feature-providers";
import { getManifestAsset } from "@/registry/manifest";
import { SOURCES } from "@/registry/sources";
import { observationAt, phaseAt, toPhase } from "@/registry/timeline";

const ROOT = path.resolve(__dirname, "../..");

function decode(file: string, w: number, h: number, fps: number | null): Uint8ClampedArray[] {
  const args = ["-v", "error", "-i", file, "-vf", `${fps ? `fps=${fps},` : ""}scale=${w}:${h}:flags=bilinear`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"];
  const buf = execFileSync("ffmpeg", args, { maxBuffer: 1 << 30 });
  const frameBytes = w * h * 4;
  const out: Uint8ClampedArray[] = [];
  for (let o = 0; o + frameBytes <= buf.length; o += frameBytes) out.push(new Uint8ClampedArray(buf.buffer, buf.byteOffset + o, frameBytes));
  return out;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

describe("calibration against prepared NASA media", () => {
  for (const source of SOURCES) {
    it(source.id, () => {
      const asset = getManifestAsset(source.assetId!)!;
      const file = path.join(ROOT, "public", asset.derivative.path);
      if (!existsSync(file)) {
        console.log(`${source.id}: not prepared, skipped`);
        return;
      }
      const profile = source.analysis!;
      const w = profile.sampleWidth;
      const h = Math.round((w * asset.derivative.height) / asset.derivative.width);
      const stats: Record<string, number[]> = { signal_share: [], change: [] };
      const fixture: FeatureFrame[] = [];
      const record = (features: FeatureFrame["features"]) => {
        for (const f of features) if (f.status === "ok" && f.value !== null) (stats[f.id] ??= []).push(f.value);
      };
      if (source.presentation.kind === "still-scan") {
        const [img] = decode(file, w, h, null);
        const frames = computeScanFrames(img, w, h, source, source.presentation.scanDurationS, source.presentation.bandWidth, 4, (seq, t) => ({
          schemaVersion: FRAME_SCHEMA_VERSION, sourceId: source.id, assetId: asset.assetId, sessionId: "calibration", frameId: `c${seq}`, sequence: seq,
          presentationTimeS: t, observation: observationAt(source, t), phase: toPhase(phaseAt(source, t)), media: { assetId: asset.assetId, kind: asset.kind },
          provenance: { svsId: source.svsId, sourcePage: source.sourcePage, assetUrl: asset.original.url, extraction: { producer: "frontend-local", method: "calibration", version: "1" } },
        }));
        frames.forEach((f) => record(f.features));
        const rawFrames = computeScanFrames(img, w, h, { ...source, analysis: { ...profile, changeNormMax: 1000 } }, source.presentation.scanDurationS, source.presentation.bandWidth, 4, (seq, t) => ({ ...frames[seq], presentationTimeS: t }));
        for (const f of rawFrames) {
          const c = f.features.find((x) => x.id === "change");
          if (c?.value != null) (stats.changeRatePerS ??= []).push(c.value * 1000);
        }
      } else {
        const fps = 2;
        const frames = decode(file, w, h, fps);
        let prev: Float32Array | null = null;
        frames.forEach((px, i) => {
          const t = i / fps;
          const phase = phaseAt(source, t);
          const r = extractFeatures({ data: px, width: w, height: h, profile, phaseId: phase?.id ?? null, prevLuma: prev, sampleIntervalS: prev ? 1 / fps : null });
          const raw = extractFeatures({ data: px, width: w, height: h, profile: { ...profile, changeNormMax: 1000 }, phaseId: phase?.id ?? null, prevLuma: prev, sampleIntervalS: prev ? 1 / fps : null });
          const rate = raw.features.find((f) => f.id === "change");
          if (rate?.value != null) (stats.changeRatePerS ??= []).push(rate.value * 1000);
          prev = r.luma;
          record(r.features);
          if (source.svsId === 5313) {
            fixture.push({
              schemaVersion: FRAME_SCHEMA_VERSION, sourceId: source.id, assetId: asset.assetId, sessionId: "fixture-svs5313", frameId: `fixture-${i}`, sequence: i,
              presentationTimeS: t, observation: observationAt(source, t), phase: toPhase(phase), media: { assetId: asset.assetId, kind: "video" }, features: r.features,
              provenance: { svsId: 5313, sourcePage: source.sourcePage, assetUrl: asset.original.url, extraction: { producer: "backend", method: "hsl-colour-groups+luma-change (offline ffmpeg decode, 2 fps)", version: "1.0.0" } },
            });
          }
        });
      }
      const lines = [`${source.id} (${w}x${h})`];
      for (const key of ["signal_share", "change", "changeRatePerS", ...allGroups(profile).map((g) => `group:${g.id}:share`)]) {
        const xs = stats[key] ?? [];
        lines.push(`  ${key.padEnd(28)} n=${String(xs.length).padStart(4)} p50=${pct(xs, 0.5).toFixed(4)} p90=${pct(xs, 0.9).toFixed(4)} p99=${pct(xs, 0.99).toFixed(4)}`);
      }
      console.log(lines.join("\n"));
      if (fixture.length) {
        mkdirSync(path.join(ROOT, "tests/fixtures"), { recursive: true });
        writeFileSync(path.join(ROOT, "tests/fixtures/svs5313-features.json"), JSON.stringify(fixture) + "\n");
      }
    });
  }
});
