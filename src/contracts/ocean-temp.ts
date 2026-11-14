/**
 * Ocean + temperature series supplied by the backend teammate on 2026-11-14:
 * a JSON array of { date: "YYYYMMDD", temperature_celsius: number, ocean_intensity: number }.
 *
 * Status: format CONFIRMED by the teammate (sample payload). NOT yet documented:
 * the upstream dataset, the location it describes, which temperature it is
 * (e.g. sea surface or air), and the meaning/units/scale of `ocean_intensity`.
 * The UI states these gaps instead of guessing.
 */
import { z } from "zod";

/** "YYYYMMDD" that is a real calendar date (rejects 20230230). */
const yyyymmdd = z
  .string()
  .regex(/^\d{8}$/, "date must be YYYYMMDD")
  .refine((s) => {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "date is not a real calendar date");

export const WireOceanTempRecordSchema = z.object({
  date: yyyymmdd,
  // Generous physical bounds only to reject garbage; no assumption about the dataset.
  temperature_celsius: z.number().min(-90).max(60),
  ocean_intensity: z.number().min(0),
});
export type WireOceanTempRecord = z.infer<typeof WireOceanTempRecordSchema>;

export interface OceanTempRecord {
  /** ISO calendar date, e.g. "2023-01-01". */
  dateIso: string;
  temperatureC: number;
  /** As supplied; unit and scale not yet documented by the backend. */
  oceanIntensity: number;
}

export interface ParsedOceanTemp {
  records: OceanTempRecord[];
  rejected: number;
  duplicates: number;
  error: string | null;
}

/** Validates a raw payload. Invalid records are dropped and counted; nothing is repaired, interpolated or invented. */
export function parseOceanTemp(raw: unknown): ParsedOceanTemp {
  if (!Array.isArray(raw)) return { records: [], rejected: 0, duplicates: 0, error: "Expected a JSON array of { date, temperature_celsius, ocean_intensity }." };
  const byDate = new Map<string, OceanTempRecord>();
  let rejected = 0;
  let duplicates = 0;
  for (const item of raw) {
    const r = WireOceanTempRecordSchema.safeParse(item);
    if (!r.success) {
      rejected++;
      continue;
    }
    const d = r.data.date;
    const dateIso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    if (byDate.has(dateIso)) {
      duplicates++; // first occurrence wins
      continue;
    }
    byDate.set(dateIso, { dateIso, temperatureC: r.data.temperature_celsius, oceanIntensity: r.data.ocean_intensity });
  }
  const records = [...byDate.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return { records, rejected, duplicates, error: null };
}
