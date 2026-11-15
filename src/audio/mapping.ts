/**
 * Deterministic feature → sound mapping. Pure: no randomness, no Tone.js,
 * no clock access. The same sequence of frames always yields the same notes.
 */
import { featureValue, type FeatureFrame } from "@/contracts/frame";
import type { ColorGroup, SonificationProfile, VoiceId } from "@/registry/types";

export interface LayerToggles {
  pad: boolean;
  pulse: boolean;
  /** Per colour-group voice; missing key = enabled. */
  groups: Record<string, boolean>;
}

export const DEFAULT_LAYERS: LayerToggles = { pad: true, pulse: true, groups: {} };

export interface VoiceNote {
  voice: VoiceId;
  groupId: string;
  midi: number;
  /** 0..1 */
  velocity: number;
  /** Presentation seconds. */
  durationS: number;
}

export interface GroupSummary {
  id: string;
  label: string;
  share: number | null;
  lightness: number | null;
  sounding: boolean;
}

export interface StepDecision {
  stepIndex: number;
  presentationTimeS: number;
  /** Target pad level 0..1 (ramped, never stepped). */
  padGain: number;
  /** Target pad brightness 0..1 → low-pass cutoff. */
  padBrightness: number;
  notes: VoiceNote[];
  pulse: { velocity: number } | null;
  frameMissing: boolean;
  summary: { signal: number | null; activity: number | null; groups: GroupSummary[] };
}

export interface MappingState {
  smoothed: Map<string, number>;
}

export function createMappingState(): MappingState {
  return { smoothed: new Map() };
}

const REGISTER: Record<VoiceId, number> = { reed: 0, glass: 12, pluck: 12, bell: 24 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** k hits spread evenly over n steps (Euclidean rhythm), rotated by `rotate`. */
export function euclidHit(k: number, n: number, step: number, rotate = 0): boolean {
  if (k <= 0) return false;
  if (k >= n) return true;
  const i = (((step + rotate) % n) + n) % n;
  return (i * k) % n < k;
}

/** Map a 0..1 value onto the profile's scale, returning a MIDI note. */
export function scaleNote(profile: SonificationProfile, value01: number, registerOffset = 0): number {
  const degrees = profile.scale.length * profile.octaves;
  const idx = Math.round(clamp01(value01) * (degrees - 1));
  const octave = Math.floor(idx / profile.scale.length);
  return profile.rootMidi + registerOffset + octave * 12 + profile.scale[idx % profile.scale.length];
}

function smooth(state: MappingState, key: string, value: number, alpha: number): number {
  const prev = state.smoothed.get(key);
  const next = prev === undefined ? value : prev + alpha * (value - prev);
  state.smoothed.set(key, next);
  return next;
}

export interface DecideArgs {
  frame: FeatureFrame | null;
  profile: SonificationProfile;
  /** Colour groups active for this frame's phase. */
  groups: ColorGroup[];
  stepIndex: number;
  state: MappingState;
  layers: LayerToggles;
}

export function decideStep({ frame, profile, groups, stepIndex, state, layers }: DecideArgs): StepDecision {
  const presentationTimeS = stepIndex * profile.stepS;
  const alpha = 1 - Math.exp(-profile.stepS / profile.smoothingS);

  if (!frame) {
    // Missing data is silence, not invention: decay the smoothed state toward zero.
    for (const [k, v] of state.smoothed) state.smoothed.set(k, v * (1 - alpha));
    return {
      stepIndex,
      presentationTimeS,
      padGain: 0,
      padBrightness: 0,
      notes: [],
      pulse: null,
      frameMissing: true,
      summary: { signal: null, activity: null, groups: groups.map((g) => ({ id: g.id, label: g.label, share: null, lightness: null, sounding: false })) },
    };
  }

  const signalRaw = featureValue(frame, "signal_share");
  const lightRaw = featureValue(frame, "signal_lightness");
  const changeRaw = featureValue(frame, "change");
  const signal = signalRaw === null ? null : smooth(state, "signal_share", signalRaw, alpha);
  const light = lightRaw === null ? null : smooth(state, "signal_lightness", lightRaw, alpha);
  const activity = changeRaw === null ? null : smooth(state, "change", changeRaw, alpha);

  const padGain = layers.pad && signal !== null ? clamp01(signal / profile.signalForFullPad) : 0;
  const padBrightness = light ?? 0;

  const summaries: GroupSummary[] = [];
  const candidates: { g: ColorGroup; share: number; light: number; order: number }[] = [];
  groups.forEach((g, order) => {
    const shareRaw = featureValue(frame, `group:${g.id}:share`);
    const lRaw = featureValue(frame, `group:${g.id}:lightness`);
    const share = shareRaw === null ? null : smooth(state, `share:${g.id}`, shareRaw, alpha);
    const l = lRaw === null ? null : smooth(state, `light:${g.id}`, lRaw, alpha);
    summaries.push({ id: g.id, label: g.label, share, lightness: l, sounding: false });
    const enabled = layers.groups[g.id] !== false;
    if (enabled && share !== null && l !== null && share >= profile.noteThreshold) candidates.push({ g, share, light: l, order });
  });

  candidates.sort((a, b) => b.share - a.share || a.order - b.order);
  const notes: VoiceNote[] = [];
  for (const c of candidates.slice(0, profile.maxVoicesPerStep)) {
    const strength = clamp01(c.share / profile.shareForFullVelocity);
    // 1..4 notes per 8 steps; stronger presence → denser rhythm.
    const hits = 1 + Math.round(strength * 3);
    if (!euclidHit(hits, 8, stepIndex, c.order * 3)) continue;
    notes.push({
      voice: c.g.voice,
      groupId: c.g.id,
      midi: scaleNote(profile, c.light, REGISTER[c.g.voice]),
      velocity: 0.25 + 0.6 * strength,
      durationS: profile.stepS * 1.8,
    });
    const s = summaries.find((x) => x.id === c.g.id);
    if (s) s.sounding = true;
  }

  let pulse: StepDecision["pulse"] = null;
  if (layers.pulse && activity !== null) {
    const k = Math.round(clamp01(activity) * 5);
    if (euclidHit(k, 8, stepIndex)) pulse = { velocity: 0.25 + 0.45 * clamp01(activity) };
  }

  return {
    stepIndex,
    presentationTimeS,
    padGain,
    padBrightness,
    notes,
    pulse,
    frameMissing: false,
    summary: { signal, activity, groups: summaries },
  };
}
