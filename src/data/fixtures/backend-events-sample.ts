import sample from "@/data/fixtures/backend-events-sample.json";

/**
 * Sample payload pasted by the backend teammate on 2026-11-14 from their NASA
 * API test run, copied verbatim. It is used ONLY when the real events endpoint
 * is not configured or not reachable, and the UI always labels it
 * "Sample backend payload — not live".
 *
 * Open questions for the backend team (see docs/BACKEND_CONTRACT.md):
 *  - which upstream NASA API produced these records, and is it one of the
 *    challenge resources?
 *  - the endpoint path (assumed GET {EJB_BACKEND_URL}{EJB_EVENTS_PATH}).
 */
export const SAMPLE_EVENTS_PAYLOAD: unknown = sample;
export const SAMPLE_EVENTS_PROVENANCE = {
  receivedOn: "2026-11-14",
  from: "Backend teammate (pasted sample from their NASA API test)",
  upstreamApi: "Not yet documented by the backend",
  live: false,
} as const;
