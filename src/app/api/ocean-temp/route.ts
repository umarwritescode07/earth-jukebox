/**
 * GET /api/ocean-temp — ocean + temperature series for the jukebox.
 *
 * Body: always the format agreed with the backend teammate, a JSON array of
 *   { "date": "YYYYMMDD", "temperature_celsius": number, "ocean_intensity": number }
 *
 * Where the data comes from is stated in response headers, never hidden:
 *   x-ejb-data-source: backend | sample
 *   x-ejb-fallback-reason: why the sample was served (only when sample)
 *   x-ejb-rejected-records: records dropped by validation (backend only)
 *
 * - EJB_BACKEND_URL set: fetches `${EJB_BACKEND_URL}${EJB_OCEAN_TEMP_PATH ?? "/ocean-temp"}`
 *   server-side (optional EJB_BACKEND_TOKEN), validates every record, returns the valid ones.
 * - Not configured, unreachable, or invalid: returns the teammate's sample payload,
 *   labelled as such. The UI shows "Sample backend payload — not live".
 */
import { connection } from "next/server";

import { parseOceanTemp } from "@/contracts/ocean-temp";
import { SAMPLE_OCEAN_TEMP_PAYLOAD } from "@/data/fixtures/ocean-temp-sample";

const TIMEOUT_MS = 8000;

function toWire(records: ReturnType<typeof parseOceanTemp>["records"]) {
  return records.map((r) => ({ date: r.dateIso.replaceAll("-", ""), temperature_celsius: r.temperatureC, ocean_intensity: r.oceanIntensity }));
}

function sample(reason: string): Response {
  const parsed = parseOceanTemp(SAMPLE_OCEAN_TEMP_PAYLOAD);
  return Response.json(toWire(parsed.records), {
    headers: { "cache-control": "no-store", "x-ejb-data-source": "sample", "x-ejb-fallback-reason": reason },
  });
}

export async function GET() {
  await connection(); // per request: env and backend state must not be baked in at build time
  const base = process.env.EJB_BACKEND_URL?.trim();
  if (!base) return sample("backend-not-configured");

  const path = process.env.EJB_OCEAN_TEMP_PATH?.trim() || "/ocean-temp";
  const target = `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  const token = process.env.EJB_BACKEND_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return sample("backend-unreachable");
  }
  if (!upstream.ok) return sample(`backend-http-${upstream.status}`);
  let raw: unknown;
  try {
    raw = await upstream.json();
  } catch {
    return sample("backend-invalid-json");
  }
  const parsed = parseOceanTemp(raw);
  if (parsed.error || parsed.records.length === 0) return sample("backend-invalid-payload");
  return Response.json(toWire(parsed.records), {
    headers: {
      "cache-control": "no-store",
      "x-ejb-data-source": "backend",
      "x-ejb-rejected-records": String(parsed.rejected + parsed.duplicates),
    },
  });
}
