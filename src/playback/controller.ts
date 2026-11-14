/**
 * PlaybackController — one per page. Owns the master clock (PlaybackClock on
 * the Web Audio time base), the sound engine, the feature timeline and the
 * active feature provider. UI components only call its methods and read its
 * snapshot (useSyncExternalStore); renderers only hand it a MediaPort.
 *
 * Scheduling: a worker-driven wake-up (Tone context ticker, every 25 ms)
 * schedules musical steps whose audio time falls inside a 120 ms look-ahead
 * window, at exact AudioContext times computed from the clock. Steps whose
 * time has already passed (background tab, stall) are skipped, never replayed.
 */
import { activeGroups } from "@/analysis/extract";
import { SonificationEngine, preloadTone } from "@/audio/engine";
import { DEFAULT_LAYERS, createMappingState, decideStep, type GroupSummary, type LayerToggles, type MappingState } from "@/audio/mapping";
import type { ObservationTime, Phase } from "@/contracts/frame";
import { BackendClient } from "@/data/backend-client";
import {
  BackendFeatureProvider,
  LocalStillScanFeatureProvider,
  LocalVideoFeatureProvider,
  type DataMode,
  type FeatureProvider,
  type ProviderStatus,
} from "@/data/feature-providers";
import { FeatureTimeline } from "@/data/feature-timeline";
import { PlaybackClock } from "@/playback/clock";
import type { MediaPort, MediaPortEvent } from "@/playback/media-port";
import { getManifestAsset } from "@/registry/manifest";
import { getSource } from "@/registry/sources";
import { observationAt, phaseAt, toPhase } from "@/registry/timeline";
import type { SourceDefinition } from "@/registry/types";

export type PlaybackStatus = "idle" | "loading" | "ready" | "buffering" | "playing" | "paused" | "ended" | "error" | "unavailable";
export type AudioState = "not-started" | "starting" | "running" | "suspended" | "failed";

export interface HearingSummary {
  presentationTimeS: number;
  frameMissing: boolean;
  signal: number | null;
  activity: number | null;
  groups: GroupSummary[];
  padGain: number;
  pulse: boolean;
}

export interface SyncMetrics {
  driftSamples: number;
  lastDriftMs: number | null;
  maxAbsDriftMs: number;
  meanAbsDriftMs: number;
  corrections: number;
  stepsScheduled: number;
  skippedSteps: number;
  lookAheadMs: number;
}

export interface ControllerSnapshot {
  status: PlaybackStatus;
  statusDetail: string | null;
  sourceId: string | null;
  durationS: number;
  rate: number;
  loop: boolean;
  volumeDb: number;
  muted: boolean;
  layers: LayerToggles;
  dataMode: DataMode;
  provider: ProviderStatus | null;
  error: { code: string; message: string; retryable: boolean } | null;
  audio: AudioState;
  phase: Phase | null;
  observation: ObservationTime | null;
  hearing: HearingSummary | null;
  metrics: SyncMetrics;
}

const LOOKAHEAD_S = 0.12;
const WAKE_INTERVAL_S = 0.025;
const DRIFT_THRESHOLD_S = 0.06;
const SUMMARY_INTERVAL_S = 0.5;

const emptyMetrics = (): SyncMetrics => ({
  driftSamples: 0,
  lastDriftMs: null,
  maxAbsDriftMs: 0,
  meanAbsDriftMs: 0,
  corrections: 0,
  stepsScheduled: 0,
  skippedSteps: 0,
  lookAheadMs: LOOKAHEAD_S * 1000,
});

export class PlaybackController {
  readonly clock: PlaybackClock;
  readonly timeline = new FeatureTimeline();
  readonly backend = new BackendClient();
  private engine: SonificationEngine | null = null;
  private source: SourceDefinition | null = null;
  private port: MediaPort | null = null;
  private portUnsubs: (() => void)[] = [];
  private provider: FeatureProvider | null = null;
  private mapping: MappingState = createMappingState();
  private nextStep: number | null = null;
  private stopWake: (() => void) | null = null;
  private stopAudioState: (() => void) | null = null;
  private wantPlaying = false;
  private resumeAfterSeek = false;
  private lastSummaryAt = -Infinity;
  private driftWarmup = 0;
  private driftAbsSum = 0;
  private sessionCounter = 0;
  private listeners = new Set<() => void>();
  /** Mutable metrics; copied into each published snapshot (never mutated in place there). */
  private live: SyncMetrics = emptyMetrics();
  private snap: ControllerSnapshot;
  private disposed = false;

  constructor() {
    this.clock = new PlaybackClock(() => this.audioNow());
    this.snap = {
      status: "idle",
      statusDetail: null,
      sourceId: null,
      durationS: 0,
      rate: 1,
      loop: false,
      volumeDb: -10,
      muted: false,
      layers: DEFAULT_LAYERS,
      dataMode: "local-nasa-media",
      provider: null,
      error: null,
      audio: "not-started",
      phase: null,
      observation: null,
      hearing: null,
      metrics: emptyMetrics(),
    };
    if (typeof window !== "undefined") void preloadTone();
  }

  /* ---------------- store plumbing ---------------- */

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): ControllerSnapshot => this.snap;

  private update(patch: Partial<ControllerSnapshot>): void {
    this.snap = { ...this.snap, ...patch, metrics: { ...this.live } };
    this.listeners.forEach((l) => l());
  }

  private audioNow(): number {
    return this.engine ? this.engine.now() : performance.now() / 1000;
  }

  /** Current presentation time (seconds). Read this in rAF loops; it never triggers renders. */
  currentTime(): number {
    const d = this.snap.durationS;
    const t = this.clock.now();
    return d > 0 ? Math.min(Math.max(0, t), d) : Math.max(0, t);
  }

  getSource(): SourceDefinition | null {
    return this.source;
  }

  diagnostics() {
    return {
      metrics: { ...this.live },
      timeline: { ...this.timeline.stats, size: this.timeline.size, generation: this.timeline.generation },
      engine: this.engine ? { notes: this.engine.metrics.notes, pulses: this.engine.metrics.pulses, leadTimesS: [...this.engine.metrics.leadTimesS] } : null,
      provider: this.provider ? { mode: this.provider.mode, ...("stats" in this.provider ? (this.provider as BackendFeatureProvider).stats : {}) } : null,
    };
  }

  /* ---------------- source & media ---------------- */

  selectSource(id: string | null): void {
    if (this.disposed) return;
    const next = id ? getSource(id) ?? null : null;
    if (next?.id === this.source?.id) return;
    this.stopSound();
    this.wantPlaying = false;
    this.resumeAfterSeek = false;
    this.detachProvider();
    this.source = next && next.status === "playable" ? next : null;
    const assetId = this.source?.assetId ?? null;
    this.timeline.reset(this.source?.id ?? null, assetId);
    this.mapping = createMappingState();
    this.nextStep = null;
    this.clock.pause();
    this.clock.seek(0);
    this.clock.durationS = 0;
    this.live = emptyMetrics();
    this.driftAbsSum = 0;
    this.update({
      sourceId: this.source?.id ?? null,
      status: this.source ? "loading" : "idle",
      statusDetail: null,
      error: null,
      provider: null,
      durationS: 0,
      phase: this.source ? toPhase(phaseAt(this.source, 0)) : null,
      observation: this.source ? observationAt(this.source, 0) : null,
      hearing: null,
      layers: { ...DEFAULT_LAYERS, groups: {} },
    });
    if (this.source && this.engine) this.engine.setTonalCentre(this.source.sonification?.rootMidi ?? 50);
  }

  /** Renderers call this when their media element mounts (port) or unmounts (null). */
  attachPort(port: MediaPort | null): void {
    for (const u of this.portUnsubs) u();
    this.portUnsubs = [];
    this.detachProvider();
    this.port = port;
    if (!port) return;
    this.portUnsubs.push(port.subscribe((e) => this.onPortEvent(e)));
    if (port.kind === "video") {
      this.portUnsubs.push(
        port.onFrame((info) => {
          if (this.snap.status !== "playing" || !this.engine) return;
          this.disciplineClock(info.mediaTimeS, info.expectedDisplayTimeMs);
        }),
      );
    }
  }

  /** The media failed before a port existed (e.g. no rendition prepared). */
  reportMediaUnavailable(code: string, message: string, retryable: boolean): void {
    this.stopSound();
    this.update({ status: "unavailable", error: { code, message, retryable }, statusDetail: message });
  }

  private onPortEvent(e: MediaPortEvent): void {
    if (!this.source || !this.port) return;
    switch (e.type) {
      case "ready": {
        this.clock.durationS = e.durationS;
        this.update({ durationS: e.durationS, ...(this.snap.status === "loading" ? { status: "ready" as const, statusDetail: null } : {}) });
        if (!this.provider) this.attachProvider();
        break;
      }
      case "waiting":
        if (this.snap.status === "playing") {
          this.clock.pause();
          this.stopSound();
          this.update({ status: "buffering", statusDetail: "Buffering NASA media…" });
        }
        break;
      case "playing":
        if (this.wantPlaying && !this.resumeAfterSeek) this.startRunning(this.port.mediaTime());
        break;
      case "seeked":
        if (this.resumeAfterSeek) {
          this.resumeAfterSeek = false;
          if (this.wantPlaying) {
            if (this.port.kind === "video" && (this.port.element as HTMLVideoElement).paused) void this.port.play().catch((err) => this.fail("media-play-failed", String(err), true));
            else this.startRunning(this.port.kind === "video" ? this.port.mediaTime() : e.timeS);
          }
        }
        this.refreshPosition();
        break;
      case "ended":
        this.handleEnded();
        break;
      case "external-pause":
        if (this.wantPlaying) {
          this.wantPlaying = false;
          this.clock.pause();
          this.stopSound();
          this.update({ status: "paused", statusDetail: "Paused by the browser (for example, the tab went to the background)." });
        }
        break;
      case "error":
        this.stopSound();
        this.wantPlaying = false;
        this.update({ status: e.code === "unsupported-format" ? "unavailable" : "error", error: { code: e.code, message: e.message, retryable: e.retryable }, statusDetail: e.message });
        break;
    }
  }

  private attachProvider(): void {
    if (!this.source || !this.port || !this.source.assetId) return;
    const asset = getManifestAsset(this.source.assetId);
    if (!asset) return;
    const deps = {
      source: this.source,
      asset,
      port: this.port,
      timeline: this.timeline,
      sessionId: `local-${++this.sessionCounter}`,
      onStatus: (s: ProviderStatus) => this.update({ provider: s, ...(s.state === "error" && s.code === "pixel-access-blocked" ? { error: { code: s.code, message: s.message ?? "", retryable: false } } : {}) }),
    };
    if (this.snap.dataMode === "backend") this.provider = new BackendFeatureProvider(deps, this.backend, () => this.clock.now());
    else if (this.source.presentation.kind === "still-scan") this.provider = new LocalStillScanFeatureProvider(deps);
    else this.provider = new LocalVideoFeatureProvider(deps);
    this.provider.start();
  }

  private detachProvider(): void {
    this.provider?.dispose();
    this.provider = null;
  }

  setDataMode(mode: DataMode): void {
    if (mode === this.snap.dataMode) return;
    this.detachProvider();
    this.timeline.reset(this.source?.id ?? null, this.source?.assetId ?? null);
    this.mapping = createMappingState();
    this.update({ dataMode: mode, provider: null, error: null });
    if (this.port && this.snap.durationS > 0) {
      this.attachProvider();
      this.provider?.notifySeek(this.clock.now());
    }
  }

  /* ---------------- transport ---------------- */

  /** Must be invoked from a user gesture: it starts Web Audio. */
  async play(): Promise<void> {
    if (!this.source || !this.port || ["idle", "loading", "unavailable"].includes(this.snap.status)) return;
    if (!this.engine) {
      this.update({ audio: "starting" });
      try {
        this.engine = await SonificationEngine.create();
      } catch (err) {
        this.update({ audio: "failed", status: "error", error: { code: "audio-start-failed", message: `Audio could not start: ${String(err)}`, retryable: true } });
        return;
      }
      this.engine.setVolumeDb(this.snap.volumeDb);
      this.engine.setMuted(this.snap.muted);
      this.engine.setTonalCentre(this.source.sonification?.rootMidi ?? 50);
      this.stopAudioState = this.engine.onState((st) => this.onAudioState(st));
      this.stopWake = this.engine.setInterval(() => this.tick(), WAKE_INTERVAL_S);
      this.update({ audio: "running" });
    }
    if (this.engine.state !== "running") {
      try {
        await this.engine.resume();
      } catch {
        /* reported via state */
      }
      const after: AudioContextState = this.engine.rawContext().state;
      if (after !== "running") {
        this.update({ audio: "suspended", statusDetail: "The browser kept audio suspended. Press Play again." });
        return;
      }
      this.update({ audio: "running" });
    }
    if (this.snap.status === "ended") {
      this.clock.seek(0);
      this.port.seek(0);
    }
    this.wantPlaying = true;
    this.resumeAfterSeek = false;
    if (this.port.kind === "video") {
      this.update({ status: "buffering", statusDetail: "Starting…", error: null });
      try {
        await this.port.play();
      } catch (err) {
        this.wantPlaying = false;
        this.update({ status: "paused", statusDetail: `The browser refused to start playback: ${String(err)}` });
        return;
      }
      const v = this.port.element as HTMLVideoElement;
      if (!v.paused && v.readyState >= 3 && this.snap.status !== "playing") this.startRunning(v.currentTime);
    } else {
      this.startRunning(this.clock.now());
    }
  }

  private startRunning(fromS: number): void {
    if (!this.engine || !this.source) return;
    this.clock.setRate(this.snap.rate);
    this.clock.start(fromS);
    this.nextStep = null;
    this.driftWarmup = 3;
    this.engine.open(this.engine.now() + 0.01);
    this.update({ status: "playing", statusDetail: null, error: null });
  }

  pause(): void {
    this.wantPlaying = false;
    this.resumeAfterSeek = false;
    this.port?.pause();
    this.clock.pause();
    this.stopSound();
    if (["playing", "buffering"].includes(this.snap.status)) this.update({ status: "paused", statusDetail: null });
  }

  async togglePlay(): Promise<void> {
    if (this.snap.status === "playing" || this.snap.status === "buffering") this.pause();
    else await this.play();
  }

  restart(): void {
    this.seek(0);
  }

  seek(timeS: number): void {
    if (!this.source || !this.port) return;
    const d = this.snap.durationS;
    const t = Math.max(0, d > 0 ? Math.min(timeS, d - 0.001) : timeS);
    const wasRunning = this.snap.status === "playing" || this.snap.status === "buffering";
    this.clock.pause();
    this.clock.seek(t);
    this.stopSound();
    this.mapping = createMappingState();
    this.nextStep = null;
    this.provider?.notifySeek(t);
    if (wasRunning) {
      this.resumeAfterSeek = true;
      this.update({ status: "buffering", statusDetail: "Seeking…" });
    } else if (this.snap.status === "ended") {
      this.update({ status: "paused" });
    }
    this.port.seek(t);
    this.refreshPosition();
  }

  setRate(rate: number): void {
    const r = Math.min(2, Math.max(0.25, rate));
    this.clock.setRate(r);
    this.port?.setRate(r);
    this.nextStep = null;
    this.update({ rate: r });
  }

  setLoop(loop: boolean): void {
    this.update({ loop });
  }

  setVolumeDb(db: number): void {
    const v = Math.min(0, Math.max(-60, db));
    this.engine?.setVolumeDb(v);
    this.update({ volumeDb: v });
  }

  setMuted(muted: boolean): void {
    this.engine?.setMuted(muted);
    this.update({ muted });
  }

  setLayer(key: "pad" | "pulse" | { group: string }, enabled: boolean): void {
    const layers = this.snap.layers;
    const next: LayerToggles =
      typeof key === "string" ? { ...layers, [key]: enabled } : { ...layers, groups: { ...layers.groups, [key.group]: enabled } };
    this.update({ layers: next });
  }

  /** Prepare for the renderer to remount its media after an error (Retry button). */
  reload(): void {
    this.wantPlaying = false;
    this.resumeAfterSeek = false;
    this.stopSound();
    this.clock.pause();
    this.detachProvider();
    this.timeline.reset(this.source?.id ?? null, this.source?.assetId ?? null);
    this.mapping = createMappingState();
    this.update({ status: this.source ? "loading" : "idle", error: null, statusDetail: null, provider: null });
  }

  /** Retry after an error: re-attach provider / reload media handled by the renderer key. */
  retryProvider(): void {
    this.detachProvider();
    this.update({ provider: null, error: null, status: this.snap.durationS > 0 ? "paused" : "loading" });
    if (this.port && this.snap.durationS > 0) {
      this.attachProvider();
      this.provider?.notifySeek(this.clock.now());
    }
  }

  /* ---------------- scheduling ---------------- */

  private tick(): void {
    if (this.disposed || !this.engine || !this.source?.sonification || this.snap.status !== "playing") return;
    const profile = this.source.sonification;
    const analysis = this.source.analysis;
    const now = this.engine.now();
    const horizon = now + LOOKAHEAD_S;
    const stepS = profile.stepS;
    const duration = this.snap.durationS;
    const ptNow = this.clock.presentationAt(now);

    if (duration > 0 && this.port?.kind === "still" && ptNow >= duration) {
      this.handleEnded();
      return;
    }

    const currentStep = Math.ceil(ptNow / stepS - 1e-9);
    if (this.nextStep === null) this.nextStep = currentStep;
    if (this.nextStep < currentStep) {
      // Background tab / stall: drop the backlog instead of replaying it.
      this.live.skippedSteps += currentStep - this.nextStep;
      this.nextStep = currentStep;
    }

    let last: ReturnType<typeof decideStep> | null = null;
    while (true) {
      const pt = this.nextStep * stepS;
      if (duration > 0 && pt >= duration) break;
      const at = this.clock.audioTimeFor(pt);
      if (at > horizon) break;
      const frame = this.timeline.at(pt, 0.6);
      const phase = phaseAt(this.source, pt);
      const groups = analysis ? activeGroups(analysis, phase?.id ?? null) : [];
      const d = decideStep({ frame, profile, groups, stepIndex: this.nextStep, state: this.mapping, layers: this.snap.layers });
      this.engine.apply(d, Math.max(at, now + 0.005), stepS / this.clock.rate, this.clock.rate);
      last = d;
      this.live.stepsScheduled++;
      this.nextStep++;
    }

    // Publish what is being heard at most twice per second (not per frame).
    if (last && now - this.lastSummaryAt >= SUMMARY_INTERVAL_S) {
      this.lastSummaryAt = now;
      this.update({
        hearing: {
          presentationTimeS: last.presentationTimeS,
          frameMissing: last.frameMissing,
          signal: last.summary.signal,
          activity: last.summary.activity,
          groups: last.summary.groups,
          padGain: last.padGain,
          pulse: last.pulse !== null,
        },
        ...this.positionPatch(ptNow),
      });
    }
  }

  private positionPatch(t: number): Partial<ControllerSnapshot> {
    if (!this.source) return {};
    const phase = toPhase(phaseAt(this.source, t));
    const observation = observationAt(this.source, t);
    const patch: Partial<ControllerSnapshot> = {};
    if (phase?.id !== this.snap.phase?.id) patch.phase = phase;
    if (observation?.label !== this.snap.observation?.label) patch.observation = observation;
    return patch;
  }

  private refreshPosition(): void {
    const p = this.positionPatch(this.clock.now());
    if (Object.keys(p).length) this.update(p);
  }

  private disciplineClock(mediaTimeS: number, expectedDisplayTimeMs: number): void {
    if (!this.engine) return;
    const ctx = this.engine.rawContext();
    let audible: number;
    const ts = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      audible = ts.contextTime + (expectedDisplayTimeMs - ts.performanceTime) / 1000;
    } else {
      audible = ctx.currentTime + (expectedDisplayTimeMs - performance.now()) / 1000 - (ctx.outputLatency || ctx.baseLatency || 0);
    }
    const r = this.clock.discipline(mediaTimeS, audible, DRIFT_THRESHOLD_S);
    if (this.driftWarmup > 0) {
      this.driftWarmup--;
      return;
    }
    const m = this.live;
    const absMs = Math.abs(r.driftS) * 1000;
    this.driftAbsSum += absMs;
    m.driftSamples += 1;
    m.lastDriftMs = r.driftS * 1000;
    m.maxAbsDriftMs = Math.max(m.maxAbsDriftMs, absMs);
    m.meanAbsDriftMs = this.driftAbsSum / m.driftSamples;
    if (r.corrected) {
      m.corrections += 1;
      this.nextStep = null;
    }
  }

  private handleEnded(): void {
    if (this.snap.loop && this.wantPlaying) {
      this.seek(0);
      return;
    }
    this.wantPlaying = false;
    this.clock.pause();
    this.clock.seek(this.snap.durationS);
    this.stopSound();
    this.update({ status: "ended", statusDetail: null });
  }

  private onAudioState(state: AudioContextState): void {
    if (state === "running") {
      this.update({ audio: "running" });
      return;
    }
    this.update({ audio: state === "suspended" ? "suspended" : "failed" });
    if (this.wantPlaying) {
      this.wantPlaying = false;
      this.port?.pause();
      this.clock.pause();
      this.update({ status: "paused", statusDetail: "Audio was suspended by the browser or system. Press Play to resume." });
    }
  }

  private fail(code: string, message: string, retryable: boolean): void {
    this.stopSound();
    this.wantPlaying = false;
    this.update({ status: "error", error: { code, message, retryable }, statusDetail: message });
  }

  private stopSound(): void {
    this.engine?.silence();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.stopWake?.();
    this.stopAudioState?.();
    this.attachPort(null);
    this.detachProvider();
    this.engine?.dispose();
    this.engine = null;
    this.listeners.clear();
  }
}

let pageController: PlaybackController | null = null;

/** One controller (and therefore one audio engine) per page, safe under React StrictMode. */
export function getPageController(): PlaybackController {
  if (!pageController) {
    pageController = new PlaybackController();
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => {
        pageController?.dispose();
        pageController = null;
      });
      (window as unknown as { __ejbDiagnostics?: () => unknown }).__ejbDiagnostics = () => pageController?.diagnostics();
    }
  }
  return pageController;
}
