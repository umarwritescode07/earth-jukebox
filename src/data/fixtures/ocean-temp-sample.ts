import sample from "@/data/fixtures/ocean-temp-sample.json";

/**
 * "Clean Ocean Data ready for Audio" pasted by the backend teammate on
 * 2026-11-14, copied verbatim. Served by /api/ocean-temp ONLY when the real
 * backend endpoint is not configured or not usable, and always labelled
 * "Sample backend payload — not live" in the UI.
 *
 * The teammate's separate temperature-only list was explicitly excluded
 * ("DO NOT USE THIS") and is intentionally not stored anywhere.
 */
export const SAMPLE_OCEAN_TEMP_PAYLOAD: unknown = sample;
export const SAMPLE_OCEAN_TEMP_PROVENANCE = {
  receivedOn: "2026-11-14",
  from: "Backend teammate (pasted sample from their API test)",
  undocumented: ["upstream dataset", "location", "which temperature (sea surface, air, …)", "meaning, unit and scale of ocean_intensity"],
  live: false,
} as const;
