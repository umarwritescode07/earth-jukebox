import { EXTRACTION_METHOD, EXTRACTION_VERSION, extractFeatures } from "@/analysis/extract";
import { FRAME_SCHEMA_VERSION, type FeatureFrame } from "@/contracts/frame";
import { BackendClient, BackendError, type BackendSession } from "@/data/backend-client";
import type { FeatureTimeline } from "@/data/feature-timeline";
import type { MediaPort } from "@/playback/media-port";
import type { ManifestAsset } from "@/registry/manifest";
import { observationAt, phaseAt, toPhase } from "@/registry/timeline";
import type { AnalysisProfile, SourceDefinition } from "@/registry/types";

export type DataMode = "local-nasa-media" | "backend";

export interface ProviderStatus {
  state: "starting" | "active" | "reconnecting" | "error";
  code?: string;
  message?: string;
}

export interface FeatureProvider {
  readonly mode: DataMode;
  readonly featureRateHz: number;
  start(): void;
  /** Called after the controller has reset the timeline for a seek. */
  notifySeek(timeS: number): void;
  dispose(): void;
}

interface ProviderDeps {
  source: SourceDefinition;
  asset: ManifestAsset;
  port: MediaPort;
  timeline: FeatureTimeline;
  sessionId: string;
  onStatus: (s: ProviderStatus) => void;
}

function baseFrame(deps: ProviderDeps, sequence: number, t: number, producer: "frontend-local"): Omit<FeatureFrame, "features"> {
  const { source, asset } = deps;
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    sourceId: source.id,
    assetId: asset.assetId,
    sessionId: deps.sessionId,
    frameId: `${asset.assetId}:${deps.sessionId}:${sequence}`,
    sequence,
    presentationTimeS: t,
    observation: observationAt(source, t),
    phase: toPhase(phaseAt(source, t)),
    media: { assetId: asset.assetId, kind: asset.kind },
    provenance: {
      svsId: source.svsId,
      sourcePage: source.sourcePage,
      assetUrl: asset.original.url,
      extraction: { producer, method: EXTRACTION_METHOD, version: EXTRACTION_VERSION },
    },
  };
}

/** Samples the NASA video frame actually being presented, ~12 times per media second. */
export class LocalVideoFeatureProvider implements FeatureProvider {
  readonly mode = "local-nasa-media" as const;
  readonly featureRateHz = 12;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stopFrames: (() => void) | null = null;
  private lastSampleT = -Infinity;
  private prevLuma: Float32Array | null = null;
  private seq = 0;
  private failed = false;

  constructor(private readonly deps: ProviderDeps) {}

  start(): void {
    const video = this.deps.port.element as HTMLVideoElement;
    const profile = this.deps.source.analysis as AnalysisProfile;
    const w = profile.sampleWidth;
    const h = Math.max(1, Math.round((w * this.deps.asset.derivative.height) / this.deps.asset.derivative.width));
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.deps.onStatus({ state: "active" });
    this.stopFrames = this.deps.port.onFrame(({ mediaTimeS }) => {
      const dt = mediaTimeS - this.lastSampleT;
      if (dt < 0 || dt > 0.6) this.prevLuma = null; // discontinuity (seek/loop): no change value
      if (dt < 0 || dt >= 1 / this.featureRateHz - 1e-3) this.sample(video, mediaTimeS);
    });
    if (video.readyState >= 2) this.sample(video, video.currentTime);
  }

  notifySeek(timeS: number): void {
    this.prevLuma = null;
    this.lastSampleT = -Infinity;
    const video = this.deps.port.element as HTMLVideoElement;
    const once = () => {
      video.removeEventListener("seeked", once);
      this.sample(video, video.currentTime);
    };
    if (Math.abs(video.currentTime - timeS) < 1e-3 && !video.seeking && video.readyState >= 2) this.sample(video, timeS);
    else video.addEventListener("seeked", once);
  }

  private sample(video: HTMLVideoElement, t: number): void {
    if (this.failed || !this.ctx || !this.canvas || video.readyState < 2) return;
    const { width: w, height: h } = this.canvas;
    let data: Uint8ClampedArray;
    try {
      this.ctx.drawImage(video, 0, 0, w, h);
      data = this.ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      this.failed = true;
      const blocked = err instanceof DOMException && err.name === "SecurityError";
      this.deps.onStatus({
        state: "error",
        code: blocked ? "pixel-access-blocked" : "sampling-failed",
        message: blocked ? "The browser blocked pixel access to this media (cross-origin). Use a prepared same-origin rendition." : `Frame sampling failed: ${String(err)}`,
      });
      return;
    }
    const phase = phaseAt(this.deps.source, t);
    const r = extractFeatures({ data, width: w, height: h, profile: this.deps.source.analysis as AnalysisProfile, phaseId: phase?.id ?? null, prevLuma: this.prevLuma });
    this.prevLuma = r.luma;
    this.lastSampleT = t;
    const frame: FeatureFrame = { ...baseFrame(this.deps, this.seq++, t, "frontend-local"), features: r.features };
    this.deps.timeline.insert(frame, this.deps.timeline.generation);
  }

  dispose(): void {
    this.stopFrames?.();
    this.stopFrames = null;
    this.ctx = null;
    this.canvas = null;
  }
}

/** Scans a still NASA image left → right (radar-style sweep). All frames are computed once on load. */
export class LocalStillScanFeatureProvider implements FeatureProvider {
  readonly mode = "local-nasa-media" as const;
  readonly featureRateHz = 4;
  private frames: FeatureFrame[] = [];

  constructor(private readonly deps: ProviderDeps) {}

  start(): void {
    const img = this.deps.port.element as HTMLImageElement;
    const pres = this.deps.source.presentation;
    if (pres.kind !== "still-scan") throw new Error("still-scan presentation required");
    const profile = this.deps.source.analysis as AnalysisProfile;
    const w = profile.sampleWidth;
    const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let full: Uint8ClampedArray;
    try {
      ctx.drawImage(img, 0, 0, w, h);
      full = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      const blocked = err instanceof DOMException && err.name === "SecurityError";
      this.deps.onStatus({ state: "error", code: blocked ? "pixel-access-blocked" : "sampling-failed", message: String(err) });
      return;
    }
    this.frames = computeScanFrames(full, w, h, this.deps.source, pres.scanDurationS, pres.bandWidth, this.featureRateHz, (seq, t) => baseFrame(this.deps, seq, t, "frontend-local"));
    this.insertAll();
    this.deps.onStatus({ state: "active" });
  }

  private insertAll(): void {
    const gen = this.deps.timeline.generation;
    for (const f of this.frames) this.deps.timeline.insert(f, gen);
  }

  notifySeek(): void {
    this.insertAll(); // timeline was reset; frames are deterministic so we simply re-insert them
  }

  dispose(): void {
    this.frames = [];
  }
}

/** Pure scan computation (exported for tests). */
export function computeScanFrames(
  full: Uint8ClampedArray,
  w: number,
  h: number,
  source: SourceDefinition,
  scanDurationS: number,
  bandWidth: number,
  rateHz: number,
  base: (seq: number, t: number) => Omit<FeatureFrame, "features">,
): FeatureFrame[] {
  const profile = source.analysis as AnalysisProfile;
  const n = Math.round(scanDurationS * rateHz);
  const bandPx = Math.max(1, Math.round(bandWidth * w));
  const out: FeatureFrame[] = [];
  let prev: Float32Array | null = null;
  for (let k = 0; k < n; k++) {
    const centre = ((k + 0.5) / n) * w;
    const x0 = Math.min(w - bandPx, Math.max(0, Math.round(centre - bandPx / 2)));
    const band = new Uint8ClampedArray(bandPx * h * 4);
    for (let y = 0; y < h; y++) band.set(full.subarray((y * w + x0) * 4, (y * w + x0 + bandPx) * 4), y * bandPx * 4);
    const nx0 = x0 / w;
    const nx1 = (x0 + bandPx) / w;
    const local: AnalysisProfile = {
      ...profile,
      exclude: profile.exclude
        .map((r) => ({ ...r, x0: (r.x0 - nx0) / (nx1 - nx0), x1: (r.x1 - nx0) / (nx1 - nx0) }))
        .filter((r) => r.x1 > 0 && r.x0 < 1),
    };
    const t = k / rateHz;
    const phase = phaseAt(source, t);
    const r = extractFeatures({ data: band, width: bandPx, height: h, profile: local, phaseId: phase?.id ?? null, prevLuma: prev });
    prev = r.luma;
    out.push({ ...base(k, t), presentationSpanS: 1 / rateHz, features: r.features });
  }
  return out;
}

/** Pulls feature windows ahead of the playhead from the backend (proposed contract v1). */
export class BackendFeatureProvider implements FeatureProvider {
  readonly mode = "backend" as const;
  featureRateHz = 10;
  private session: BackendSession | null = null;
  private abort = new AbortController();
  private inflight: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fetchedTo = 0;
  private failures = 0;
  private disposed = false;
  private ended = false;
  readonly stats = { windows: 0, rejectedFrames: 0, staleWindows: 0 };

  constructor(
    private readonly deps: ProviderDeps,
    private readonly client: BackendClient,
    private readonly clockNow: () => number,
    private readonly horizonS = 3,
  ) {}

  start(): void {
    this.deps.onStatus({ state: "starting" });
    this.client
      .createSession(this.deps.source.id, this.deps.asset.assetId, this.abort.signal)
      .then((s) => {
        if (this.disposed) return void this.client.closeSession(s.sessionId);
        this.session = s;
        this.featureRateHz = s.capabilities.featureRateHz;
        this.deps.onStatus({ state: "active" });
        this.pump();
      })
      .catch((err) => this.fail(err));
  }

  notifySeek(timeS: number): void {
    this.inflight?.abort();
    this.inflight = null;
    this.fetchedTo = timeS;
    this.ended = false;
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pump(), ms);
  }

  private pump(): void {
    if (this.disposed || !this.session) return;
    const t = this.clockNow();
    const to = t + this.horizonS;
    const duration = this.session.durationS;
    if (this.inflight || this.ended || this.fetchedTo >= Math.min(to, duration)) return this.schedule(200);
    const from = Math.max(t, this.fetchedTo);
    const requestTo = Math.min(duration, from + this.horizonS + 1);
    const generation = this.deps.timeline.generation;
    const ctl = new AbortController();
    this.inflight = ctl;
    const requestId = crypto.randomUUID();
    const expected = { sessionId: this.session.sessionId, sourceId: this.deps.source.id, assetId: this.deps.asset.assetId };
    this.client
      .fetchWindow(expected, from, requestTo, requestId, AbortSignal.any([ctl.signal, this.abort.signal]))
      .then((win) => {
        if (this.inflight !== ctl) return; // superseded by a seek
        this.inflight = null;
        if (generation !== this.deps.timeline.generation) {
          this.stats.staleWindows++;
          return this.schedule(0);
        }
        this.stats.windows++;
        this.stats.rejectedFrames += win.rejected;
        for (const f of win.frames) this.deps.timeline.insert(f, generation);
        this.fetchedTo = requestTo;
        this.ended = win.endOfStream;
        if (this.failures > 0) this.deps.onStatus({ state: "active" });
        this.failures = 0;
        this.schedule(100);
      })
      .catch((err) => {
        if (this.inflight !== ctl) return;
        this.inflight = null;
        if (this.disposed || ctl.signal.aborted) return;
        this.fail(err);
      });
  }

  private fail(err: unknown): void {
    if (this.disposed) return;
    const e = err instanceof BackendError ? err : new BackendError("unknown", String(err), true);
    this.failures++;
    if (e.retryable && this.failures <= 6) {
      this.deps.onStatus({ state: "reconnecting", code: e.code, message: `${e.message} — retrying (${this.failures}/6)` });
      const delay = Math.min(4000, 400 * 2 ** (this.failures - 1));
      if (this.session) this.schedule(delay);
      else
        setTimeout(() => {
          if (!this.disposed && !this.session) this.start();
        }, delay);
      return;
    }
    this.deps.onStatus({ state: "error", code: e.code, message: e.message });
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.inflight?.abort();
    if (this.timer) clearTimeout(this.timer);
    if (this.session) void this.client.closeSession(this.session.sessionId);
  }
}
