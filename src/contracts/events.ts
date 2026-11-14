/**
 * Event feed format supplied by the backend teammate on 2026-11-14:
 * a clean JSON array of { title, category, date, latitude, longitude }.
 *
 * Status: format CONFIRMED by the backend teammate (sample payload); the
 * endpoint path and the upstream NASA API are NOT yet documented. Keep this
 * schema in sync with the backend; everything else depends only on EarthEvent.
 */
import { z } from "zod";

export const WireEarthEventSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  date: z.iso.datetime({ offset: true }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export const WireEarthEventsSchema = z.array(WireEarthEventSchema);
export type WireEarthEvent = z.infer<typeof WireEarthEventSchema>;

export interface EarthEvent {
  /** Stable id derived from the record (the payload has no id field). */
  id: string;
  title: string;
  category: string;
  dateIso: string;
  latitude: number;
  longitude: number;
}

function stableId(e: WireEarthEvent): string {
  const s = `${e.title}|${e.date}|${e.latitude}|${e.longitude}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `evt-${(h >>> 0).toString(36)}`;
}

/** Validates a raw payload. Invalid records are dropped and counted, never repaired or invented. */
export function parseEarthEvents(raw: unknown): { events: EarthEvent[]; rejected: number; error: string | null } {
  if (!Array.isArray(raw)) return { events: [], rejected: 0, error: "Expected a JSON array of events." };
  const events: EarthEvent[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const item of raw) {
    const r = WireEarthEventSchema.safeParse(item);
    if (!r.success) {
      rejected++;
      continue;
    }
    const id = stableId(r.data);
    if (seen.has(id)) continue;
    seen.add(id);
    events.push({ id, title: r.data.title, category: r.data.category, dateIso: r.data.date, latitude: r.data.latitude, longitude: r.data.longitude });
  }
  events.sort((a, b) => Date.parse(b.dateIso) - Date.parse(a.dateIso));
  return { events, rejected, error: null };
}
