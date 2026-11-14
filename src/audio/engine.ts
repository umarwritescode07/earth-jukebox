/**
 * Tone.js sonification engine (browser only).
 *
 * Signal chain:
 *   pad (2 detuned oscillators → low-pass) ┐
 *   glass / bell / reed / pluck voices      ├→ gate → master volume → compressor → limiter(-3 dBFS) → destination
 *   pulse (membrane)                         ┘                                              └→ FFT + waveform analysers
 *
 * - One engine per page (create() returns the live instance).
 * - The gate closes on pause / seek / source change, which also mutes any
 *   note already scheduled inside the short look-ahead window.
 * - Nothing here is random: timbres are deterministic oscillators/FM.
 */
import type * as ToneNS from "tone";

import type { StepDecision } from "@/audio/mapping";
import type { VoiceId } from "@/registry/types";

export type ToneModule = typeof ToneNS;

let toneModule: ToneModule | null = null;
let tonePromise: Promise<ToneModule> | null = null;

/** Preload Tone.js so that a later click can start audio synchronously within the gesture. */
export function preloadTone(): Promise<ToneModule> {
  if (!tonePromise) tonePromise = import("tone").then((m) => (toneModule = m));
  return tonePromise;
}

let live: SonificationEngine | null = null;

export interface EngineMetrics {
  notes: number;
  pulses: number;
  /** Seconds between "now" and the scheduled time of each event (last 64). */
  leadTimesS: number[];
}

type AnyVoice = ToneNS.Synth | ToneNS.FMSynth | ToneNS.AMSynth | ToneNS.MonoSynth;

export class SonificationEngine {
  readonly metrics: EngineMetrics = { notes: 0, pulses: 0, leadTimesS: [] };
  private disposed = false;
  private readonly nodes: { dispose(): unknown }[] = [];
  private readonly voices: Record<VoiceId, AnyVoice>;
  private readonly pulseSynth: ToneNS.MembraneSynth;
  private readonly padGain: ToneNS.Gain;
  private readonly padFilter: ToneNS.Filter;
  private readonly padOscs: ToneNS.FatOscillator[];
  private readonly gate: ToneNS.Gain;
  private readonly master: ToneNS.Volume;
  private readonly fft: ToneNS.Analyser;
  private readonly wave: ToneNS.Analyser;
  private stateListeners = new Set<(state: AudioContextState) => void>();
  private readonly onStateChange = () => this.stateListeners.forEach((l) => l(this.state));

  private constructor(private readonly T: ToneModule) {
    const track = <N extends { dispose(): unknown }>(n: N): N => {
      this.nodes.push(n);
      return n;
    };
    this.master = track(new T.Volume(-10));
    const comp = track(new T.Compressor({ threshold: -24, ratio: 3, attack: 0.02, release: 0.25 }));
    const limiter = track(new T.Limiter(-3));
    this.fft = track(new T.Analyser("fft", 256));
    this.wave = track(new T.Analyser("waveform", 1024));
    this.master.chain(comp, limiter);
    limiter.connect(this.fft);
    limiter.connect(this.wave);
    limiter.toDestination();

    this.gate = track(new T.Gain(0));
    this.gate.connect(this.master);

    this.padGain = track(new T.Gain(0));
    this.padFilter = track(new T.Filter({ frequency: 400, type: "lowpass", rolloff: -24, Q: 0.7 }));
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.gate);
    this.padOscs = [0, 7].map((interval) => {
      const o = track(new T.FatOscillator({ type: "sawtooth", count: 3, spread: 16, volume: -15 }));
      o.frequency.value = T.Frequency(38 + interval, "midi").toFrequency();
      o.connect(this.padFilter);
      return o;
    });

    const glass = track(new T.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.35, sustain: 0.15, release: 0.9 }, volume: -12 }));
    const bell = track(
      new T.FMSynth({
        harmonicity: 3.01,
        modulationIndex: 6,
        envelope: { attack: 0.004, decay: 0.7, sustain: 0, release: 1.1 },
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.6 },
        volume: -18,
      }),
    );
    const reed = track(new T.AMSynth({ harmonicity: 1.5, envelope: { attack: 0.06, decay: 0.25, sustain: 0.45, release: 0.7 }, volume: -14 }));
    const pluck = track(
      new T.MonoSynth({
        oscillator: { type: "square" },
        filter: { Q: 2, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.25 },
        filterEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, baseFrequency: 300, octaves: 3 },
        volume: -16,
      }),
    );
    this.voices = { glass, bell, reed, pluck };
    for (const v of Object.values(this.voices)) v.connect(this.gate);

    this.pulseSynth = track(new T.MembraneSynth({ pitchDecay: 0.03, octaves: 4, envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.1 }, volume: -20 }));
    this.pulseSynth.connect(this.gate);

    T.getContext().rawContext.addEventListener("statechange", this.onStateChange);
  }

  /**
   * Must be called from a user gesture (click/keypress). Returns the single live engine.
   * Tone must already be preloaded (preloadTone) so start() runs inside the gesture.
   */
  static async create(): Promise<SonificationEngine> {
    const T = toneModule ?? (await preloadTone());
    const started = T.start();
    await started;
    if (T.getContext().state !== "running") throw new Error(`Audio could not start (context is ${T.getContext().state}).`);
    if (live && !live.disposed) return live;
    T.getContext().lookAhead = 0; // we do our own look-ahead scheduling against raw context time
    live = new SonificationEngine(T);
    for (const o of live.padOscs) o.start();
    return live;
  }

  static current(): SonificationEngine | null {
    return live && !live.disposed ? live : null;
  }

  get state(): AudioContextState {
    return this.T.getContext().rawContext.state as AudioContextState;
  }

  /** Raw AudioContext time (seconds), the master clock's time base. */
  now(): number {
    return this.T.getContext().rawContext.currentTime;
  }

  rawContext(): AudioContext {
    return this.T.getContext().rawContext as AudioContext;
  }

  onState(cb: (state: AudioContextState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  async resume(): Promise<void> {
    await this.T.getContext().resume();
  }

  /** Worker-driven wake-up (Tone context ticker). Timing comes from now(), never from this interval. */
  setInterval(fn: () => void, intervalS: number): () => void {
    const id = this.T.getContext().setInterval(fn, intervalS);
    return () => this.T.getContext().clearInterval(id);
  }

  /** Pad drone = tonal centre an octave below the profile root, plus a fifth. */
  setTonalCentre(rootMidi: number): void {
    const now = this.now();
    this.padOscs.forEach((o, i) => {
      o.frequency.setValueAtTime(this.T.Frequency(rootMidi - 12 + (i === 0 ? 0 : 7), "midi").toFrequency(), now);
    });
  }

  setVolumeDb(db: number): void {
    this.master.volume.rampTo(Math.max(-60, Math.min(0, db)), 0.05);
  }

  setMuted(muted: boolean): void {
    this.master.mute = muted;
  }

  /** Open the gate at an audio time (resume sound). */
  open(at: number): void {
    const g = this.gate.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(1, at + 0.04);
  }

  /** Close the gate quickly and drop the pad: stops current and already-scheduled sound. */
  silence(): void {
    const now = this.now();
    for (const p of [this.gate.gain, this.padGain.gain]) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.getValueAtTime(now), now);
      p.linearRampToValueAtTime(0, now + 0.03);
    }
    for (const v of Object.values(this.voices)) v.triggerRelease(now + 0.03);
  }

  /** Schedule one step. `stepAudioS` is the step length in audio seconds (stepS / rate). */
  apply(d: StepDecision, at: number, stepAudioS: number, rate: number): void {
    if (this.disposed) return;
    const T = this.T;
    const lead = at - this.now();
    this.metrics.leadTimesS.push(lead);
    if (this.metrics.leadTimesS.length > 64) this.metrics.leadTimesS.shift();

    this.padGain.gain.linearRampToValueAtTime(0.9 * d.padGain, at + stepAudioS);
    this.padFilter.frequency.linearRampToValueAtTime(180 + 2200 * d.padBrightness, at + stepAudioS);

    for (const n of d.notes) {
      const v = this.voices[n.voice];
      v.triggerAttackRelease(T.Frequency(n.midi, "midi").toFrequency(), Math.max(0.05, n.durationS / rate), at, n.velocity);
      this.metrics.notes++;
    }
    if (d.pulse) {
      this.pulseSynth.triggerAttackRelease(T.Frequency(38, "midi").toFrequency(), 0.08, at, d.pulse.velocity);
      this.metrics.pulses++;
    }
  }

  /** Spectrum in dBFS (FFT bins) from the real output. */
  spectrum(): Float32Array {
    return this.fft.getValue() as Float32Array;
  }

  waveform(): Float32Array {
    return this.wave.getValue() as Float32Array;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.T.getContext().rawContext.removeEventListener("statechange", this.onStateChange);
    this.stateListeners.clear();
    for (const o of this.padOscs) o.stop();
    for (const n of this.nodes.reverse()) n.dispose();
    if (live === this) live = null;
  }
}
