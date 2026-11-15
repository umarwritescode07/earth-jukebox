import type { ObservationTime } from "@/contracts/frame";

/** Rectangle in normalised frame coordinates (0..1, origin top-left). */
export interface NormRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Why this region is excluded/included (shown in the UI). */
  reason: string;
}

export type VoiceId = "glass" | "bell" | "reed" | "pluck";

/**
 * A colour family identified from the NASA legend or page text. Matching is
 * done in HSL on the rendered pixels, so it is an image-derived estimate,
 * never a decoded data value.
 */
export interface ColorGroup {
  id: string;
  label: string;
  /** What NASA says this colour means (page text or legend), quoted or paraphrased. */
  meaning: string;
  /** Where the meaning comes from. */
  evidence: string;
  /** CSS colour of the reference swatch (sampled from the NASA legend where one exists). */
  swatch: string;
  /** Hue interval in degrees; may wrap (e.g. [340, 20]). */
  hue: [number, number];
  minSat: number;
  maxSat?: number;
  minLum: number;
  maxLum?: number;
  voice: VoiceId;
}

export interface AnalysisProfile {
  /** Width in px of the downscaled analysis canvas (height follows the media aspect). */
  sampleWidth: number;
  /** Regions never analysed (legends, captions, date stamps, colour bars). */
  exclude: NormRect[];
  /** A pixel is "signal" if lum ≥ minLum and (sat ≥ minSat or lum ≥ brightLum). */
  signal: { minLum: number; minSat: number; brightLum: number; description: string };
  /** Colour groups active per phase id; "default" is used when no phase applies. */
  colorGroupsByPhase: Record<string, ColorGroup[]>;
  /** Normalisation ceiling for the mean absolute luma change per presentation second (calibrated p90). */
  changeNormMax: number;
}

export interface SonificationProfile {
  /** MIDI note number of the tonal centre. */
  rootMidi: number;
  /** Semitone offsets of the scale used for pitch mapping. */
  scale: number[];
  octaves: number;
  /** Presentation seconds per musical step. */
  stepS: number;
  /** Exponential smoothing time constant (presentation seconds) applied to features. */
  smoothingS: number;
  /** Minimum smoothed share (0..1) before a colour group may sound. */
  noteThreshold: number;
  /** Share that maps to full note velocity (shares are tiny for sparse imagery). */
  shareForFullVelocity: number;
  /** signal_share that maps to full pad gain. */
  signalForFullPad: number;
  maxVoicesPerStep: number;
}

export interface TimedPhase {
  id: string;
  label: string;
  description: string;
  startS: number;
  endS: number;
}

export interface YearLabelSpan {
  year: number;
  startS: number;
  endS: number;
}

export type ObservationMapping =
  | {
      type: "linear-frame-table";
      /** NASA table: first/last timestamps and frame count (validated against the table in tests). */
      startIso: string;
      endIso: string;
      frameCount: number;
      fps: number;
      evidence: string;
    }
  | {
      type: "phase-and-year-labels";
      years: YearLabelSpan[];
      comparison: { phaseIds: string[]; observation: ObservationTime };
      evidence: string;
    }
  | { type: "fixed"; observation: ObservationTime; evidence: string }
  | { type: "none"; reason: string };

export interface CreditEntry {
  role: string;
  people: string[];
}

export interface CoverageStatement {
  summary: string;
  start?: string;
  end?: string;
  basis: string;
  /** Unresolved contradictions in NASA's own metadata, shown verbatim. */
  conflicts?: string[];
}

export interface MappingRow {
  feature: string;
  origin: "image-derived" | "numerical-data";
  sound: string;
  detail: string;
}

export interface SourceDefinition {
  id: string;
  svsId: number;
  title: string;
  shortTitle: string;
  category: string;
  sourcePage: string;
  status: "playable" | "reference-only";
  assetId: string | null;
  presentation: { kind: "video" } | { kind: "still-scan"; scanDurationS: number; bandWidth: number } | { kind: "none" };
  publication: { released: string; updated?: string };
  coverage: CoverageStatement;
  summary: string;
  pageDescription: string;
  interpretation: string[];
  cautions: string[];
  camera: { moves: boolean; disclosure: string };
  credits: CreditEntry[];
  datasets: string[];
  legend: { url: string; alt: string; description: string } | null;
  phases: TimedPhase[];
  observationMapping: ObservationMapping;
  analysis: AnalysisProfile | null;
  sonification: SonificationProfile | null;
  mapping: MappingRow[];
  disabledControls: { control: string; reason: string }[];
  /** Short text summary of the visual for screen-reader users. */
  visualDescription: string;
}
