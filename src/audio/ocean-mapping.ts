/**
 * Deterministic mapping for the backend ocean + temperature series.
 * Origin of these values: "numerical-data" as supplied by the backend
 * (dataset, location and the meaning of ocean_intensity not yet documented).
 *
 * Rules (also shown in the UI):
 *  - One day = one beat (fixed tempo, so the time axis stays honest).
 *  - temperature_celsius → piano pitch: +1 semitone per 0.1 °C above the series
 *    median, C4 at the median, clipped to ±12 semitones (clipping is reported).
 *  - ocean_intensity → surf (pink noise) loudness and swell rate, relative to the
 *    loaded series' own min–max because its unit/scale is not documented.
 */
import type { OceanTempRecord } from "@/contracts/ocean-temp";

export const OCEAN_MAPPING = {
  baseMidi: 60,
  semitonesPerDegree: 10,
  maxSemitones: 12,
  waveGainMin: 0.12,
  waveGainMax: 1,
  swellHzMin: 0.12,
  swellHzMax: 0.5,
  pianoVelocity: 0.7,
} as const;

export interface OceanScales {
  medianTempC: number;
  intensityMin: number;
  intensityMax: number;
}

export interface OceanStep {
  index: number;
  dateIso: string;
  temperatureC: number;
  oceanIntensity: number;
  semitoneOffset: number;
  clipped: boolean;
  midi: number;
  noteName: string;
  /** 0..1 position of ocean_intensity within the loaded series' range. */
  waveLevel: number;
  waveGain: number;
  /** Swells per second of the surf sound. */
  swellHz: number;
}

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function midiToName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function oceanScales(records: OceanTempRecord[]): OceanScales {
  if (records.length === 0) return { medianTempC: 0, intensityMin: 0, intensityMax: 0 };
  const temps = records.map((r) => r.temperatureC).sort((a, b) => a - b);
  const mid = Math.floor(temps.length / 2);
  const medianTempC = temps.length % 2 ? temps[mid] : (temps[mid - 1] + temps[mid]) / 2;
  const ints = records.map((r) => r.oceanIntensity);
  return { medianTempC, intensityMin: Math.min(...ints), intensityMax: Math.max(...ints) };
}

export function decideOceanStep(record: OceanTempRecord, index: number, scales: OceanScales): OceanStep {
  const m = OCEAN_MAPPING;
  const raw = Math.round((record.temperatureC - scales.medianTempC) * m.semitonesPerDegree);
  const semitoneOffset = Math.max(-m.maxSemitones, Math.min(m.maxSemitones, raw));
  const midi = m.baseMidi + semitoneOffset;
  const span = scales.intensityMax - scales.intensityMin;
  const waveLevel = span > 0 ? (record.oceanIntensity - scales.intensityMin) / span : 0.5;
  return {
    index,
    dateIso: record.dateIso,
    temperatureC: record.temperatureC,
    oceanIntensity: record.oceanIntensity,
    semitoneOffset,
    clipped: raw !== semitoneOffset,
    midi,
    noteName: midiToName(midi),
    waveLevel,
    waveGain: m.waveGainMin + (m.waveGainMax - m.waveGainMin) * waveLevel,
    swellHz: m.swellHzMin + (m.swellHzMax - m.swellHzMin) * waveLevel,
  };
}
