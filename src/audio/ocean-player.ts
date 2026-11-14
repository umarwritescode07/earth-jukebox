/**
 * Player for the backend ocean + temperature series (one per page).
 *
 * Clock: a PlaybackClock on the Web Audio time base whose presentation unit is
 * DAYS (rate = 1 / secondsPerDay), so changing the speed rescales the clock
 * without a jump. Day k sounds at clock.audioTimeFor(k), scheduled ≤ 120 ms ahead
 * from a worker-driven wake-up; missed days (background tab) are skipped, not
 * replayed. Uses the shared SonificationEngine (single AudioContext + limiter)
 * and pauses the NASA controller first, so only one sonification plays at a time.
 */
import { SonificationEngine } from "@/audio/engine";
import { OCEAN_MAPPING, decideOceanStep, oceanScales, type OceanScales, type OceanStep } from "@/audio/ocean-mapping";
import type { OceanTempRecord } from "@/contracts/ocean-temp";
import { PlaybackClock } from "@/playback/clock";
import { getPageController } from "@/playback/controller";

export type OceanStatus = "idle" | "ready" | "playing" | "paused" | "ended" | "error";

export interface OceanSnapshot {
  status: OceanStatus;
  error: string | null;
  dayCount: number;
  /** Index of the day being heard (−1 before start). */
  dayIndex: number;
  current: OceanStep | null;
  secondsPerDay: number;
  loop: boolean;
  layers: { piano: boolean; waves: boolean };
  scales: OceanScales;
  stepsScheduled: number;
  skippedSteps: number;
}

const LOOKAHEAD_S = 0.12;

export class OceanTempPlayer {
  private engine: SonificationEngine | null = null;
  private records: OceanTempRecord[] = [];
  private steps: OceanStep[] = [];
  private readonly clock = new PlaybackClock(() => (this.engine ? this.engine.now() : performance.now() / 1000));
  private nextStep: number | null = null;
  private stopWake: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private snap: OceanSnapshot = {
    status: "idle",
    error: null,
    dayCount: 0,
    dayIndex: -1,
    current: null,
    secondsPerDay: 1,
    loop: false,
    layers: { piano: true, waves: true },
    scales: { medianTempC: 0, intensityMin: 0, intensityMax: 0 },
    stepsScheduled: 0,
    skippedSteps: 0,
  };

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snap;
  private update(p: Partial<OceanSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }

  /** The deterministic decisions for every day (shown in the data table). */
  allSteps(): readonly OceanStep[] {
    return this.steps;
  }

  setRecords(records: OceanTempRecord[]): void {
    const same = records.length === this.records.length && records.every((r, i) => r.dateIso === this.records[i]?.dateIso && r.temperatureC === this.records[i].temperatureC && r.oceanIntensity === this.records[i].oceanIntensity);
    if (same) return;
    this.pause();
    this.records = records;
    const scales = oceanScales(records);
    this.steps = records.map((r, i) => decideOceanStep(r, i, scales));
    this.clock.pause();
    this.clock.seek(0);
    this.clock.durationS = records.length;
    this.update({ status: records.length ? "ready" : "idle", dayCount: records.length, dayIndex: -1, current: null, scales, error: null });
  }

  /** Must be called from a user gesture (starts Web Audio). */
  async play(): Promise<void> {
    if (!this.steps.length) return;
    try {
      if (!this.engine) {
        this.engine = await SonificationEngine.create();
        const c = getPageController().getSnapshot();
        this.engine.setVolumeDb(c.volumeDb);
        this.engine.setMuted(c.muted);
        this.stopWake = this.engine.setInterval(() => this.tick(), 0.025);
      }
      if (this.engine.state !== "running") await this.engine.resume();
    } catch (err) {
      this.update({ status: "error", error: `Audio could not start: ${String(err)}` });
      return;
    }
    getPageController().pause(); // never two sonifications at once
    this.engine.prepareOcean(); // heavy setup happens before the clock starts, not during scheduling
    if (this.snap.status === "ended") this.clock.seek(0);
    this.clock.setRate(1 / this.snap.secondsPerDay);
    const from = this.clock.now();
    this.clock.start(from);
    // Decide the first day now, not at the next wake-up (which could be ~25 ms later and past day 0).
    this.nextStep = Math.ceil(from - 1e-9);
    this.engine.open(this.engine.now() + 0.01);
    this.update({ status: "playing", error: null });
  }

  pause(): void {
    if (this.snap.status !== "playing") return;
    this.clock.pause();
    this.engine?.silence();
    this.update({ status: "paused" });
  }

  async toggle(): Promise<void> {
    if (this.snap.status === "playing") this.pause();
    else await this.play();
  }

  restart(): void {
    this.seekDay(0);
  }

  seekDay(day: number): void {
    const d = Math.max(0, Math.min(this.steps.length - 0.001, day));
    const wasPlaying = this.snap.status === "playing";
    this.engine?.silence();
    this.clock.seek(d);
    this.nextStep = Math.ceil(d - 1e-9);
    if (wasPlaying && this.engine) this.engine.open(this.engine.now() + 0.01);
    const idx = Math.floor(d);
    this.update({ dayIndex: idx, current: this.steps[idx] ?? null, ...(this.snap.status === "ended" ? { status: "paused" as const } : {}) });
  }

  setSecondsPerDay(s: number): void {
    const v = Math.min(4, Math.max(0.25, s));
    this.clock.setRate(1 / v);
    this.nextStep = Math.ceil(this.clock.now() - 1e-9);
    this.update({ secondsPerDay: v });
  }

  setLoop(loop: boolean): void {
    this.update({ loop });
  }

  setLayer(layer: "piano" | "waves", on: boolean): void {
    this.update({ layers: { ...this.snap.layers, [layer]: on } });
  }

  /** Current position in days (fractional). */
  position(): number {
    return Math.min(this.clock.now(), this.steps.length);
  }

  diagnostics() {
    const e = this.engine;
    let outputRms = 0;
    if (e) {
      const w = e.waveform();
      let sum = 0;
      for (let i = 0; i < w.length; i++) sum += w[i] * w[i];
      outputRms = Math.sqrt(sum / w.length);
    }
    return { ...this.snap, engine: e ? { notes: e.metrics.notes, leadTimesS: [...e.metrics.leadTimesS], outputRms } : null };
  }

  private tick(): void {
    if (this.snap.status !== "playing" || !this.engine) return;
    const now = this.engine.now();
    const n = this.steps.length;
    const pNow = this.clock.presentationAt(now);
    if (pNow >= n) {
      if (this.snap.loop) {
        this.clock.seek(0);
        this.nextStep = 0;
      } else {
        this.clock.pause();
        this.clock.seek(n);
        this.engine.silence();
        this.update({ status: "ended", dayIndex: n - 1 });
        return;
      }
    }
    // Start at the next day boundary (resuming mid-day waits for the next day).
    if (this.nextStep === null) this.nextStep = Math.max(0, Math.ceil(this.clock.presentationAt(now) - 1e-9));
    let skipped = 0;
    // Backlog (background tab / stall): days already more than 50 ms late are skipped, never replayed.
    while (this.nextStep < n && this.clock.audioTimeFor(this.nextStep) < now - 0.05) {
      skipped++;
      this.nextStep++;
    }
    let scheduled = 0;
    while (this.nextStep < n && this.clock.audioTimeFor(this.nextStep) <= now + LOOKAHEAD_S) {
      const at = this.clock.audioTimeFor(this.nextStep);
      this.engine.applyOcean(this.steps[this.nextStep], Math.max(at, now + 0.005), this.snap.secondsPerDay, this.snap.layers, OCEAN_MAPPING.pianoVelocity);
      scheduled++;
      this.nextStep++;
    }
    const idx = Math.min(n - 1, Math.max(0, Math.floor(this.clock.presentationAt(now))));
    if (scheduled || skipped || idx !== this.snap.dayIndex) {
      this.update({
        dayIndex: idx,
        current: this.steps[idx] ?? null,
        stepsScheduled: this.snap.stepsScheduled + scheduled,
        skippedSteps: this.snap.skippedSteps + skipped,
      });
    }
  }

  dispose(): void {
    this.pause();
    this.stopWake?.();
    this.stopWake = null;
    this.listeners.clear();
  }
}

let pagePlayer: OceanTempPlayer | null = null;
export function getOceanPlayer(): OceanTempPlayer {
  if (!pagePlayer) {
    pagePlayer = new OceanTempPlayer();
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => {
        pagePlayer?.dispose();
        pagePlayer = null;
      });
      (window as unknown as { __ejbOceanDiagnostics?: () => unknown }).__ejbOceanDiagnostics = () => pagePlayer?.diagnostics();
    }
  }
  return pagePlayer;
}
