import type { ObservationTime, Phase } from "@/contracts/frame";
import type { SourceDefinition, TimedPhase } from "@/registry/types";

export function phaseAt(source: SourceDefinition, presentationTimeS: number): TimedPhase | null {
  for (const p of source.phases) {
    if (presentationTimeS >= p.startS && presentationTimeS < p.endS) return p;
  }
  const last = source.phases.at(-1);
  if (last && presentationTimeS >= last.endS - 1e-6 && presentationTimeS <= last.endS + 0.05) return last;
  return null;
}

export function toPhase(p: TimedPhase | null): Phase | null {
  return p ? { id: p.id, label: p.label } : null;
}

function isoMinute(ms: number): string {
  return new Date(Math.round(ms / 60000) * 60000).toISOString().replace(":00.000Z", "Z");
}

/** Model/observation time for a presentation time, or null when not reliably mapped. */
export function observationAt(source: SourceDefinition, presentationTimeS: number): ObservationTime | null {
  const m = source.observationMapping;
  switch (m.type) {
    case "linear-frame-table": {
      const frame = Math.min(m.frameCount - 1, Math.max(0, Math.floor(presentationTimeS * m.fps + 1e-6)));
      const t0 = Date.parse(m.startIso);
      const t1 = Date.parse(m.endIso);
      const ms = t0 + ((t1 - t0) * frame) / (m.frameCount - 1);
      const iso = isoMinute(ms);
      return { kind: "instant", start: iso, label: `Model time ${iso.replace("T", " ").replace("Z", " UTC")}`, basis: "nasa-frame-table" };
    }
    case "phase-and-year-labels": {
      const phase = phaseAt(source, presentationTimeS);
      if (phase && m.comparison.phaseIds.includes(phase.id)) return m.comparison.observation;
      const span = m.years.find((y) => presentationTimeS >= y.startS && presentationTimeS < y.endS);
      if (!span) return null;
      return { kind: "interval", start: String(span.year), end: String(span.year), label: `Annual average ${span.year} (on-screen label)`, basis: "on-screen-label-verified" };
    }
    case "fixed":
      return m.observation;
    case "none":
      return null;
  }
}
