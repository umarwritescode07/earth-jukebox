/**
 * PROPOSED backend wire contract "ejb.backend/1".
 *
 * Status: PROPOSED by the frontend. The repository contained no backend code or
 * API documentation when this was written (2026-11-14). The backend team may
 * change it; only src/data/backend-client.ts and this file need to follow.
 * React components never import this module.
 *
 * Transport: plain REST/JSON, polled in short windows. The NASA media is
 * prerecorded, so the client always knows which presentation-time window it
 * needs next; windowed pulls make seeking, speed changes and source switches
 * simple (a new window request), and need no long-lived socket.
 *
 * Endpoints (relative to the backend base URL; the browser reaches them
 * through the same-origin proxy /api/backend/...):
 *   GET    /v1/health
 *   GET    /v1/sources
 *   POST   /v1/sessions                                  body: CreateSessionRequest
 *   GET    /v1/sessions/{session_id}/features?from_s=&to_s=&request_id=
 *   DELETE /v1/sessions/{session_id}
 * Errors: non-2xx with body { "error": { code, message, retryable } }.
 */
import { z } from "zod";

import {
  FRAME_SCHEMA_VERSION,
  FeatureFrameSchema,
  type Capabilities,
  type FeatureFrame,
} from "@/contracts/frame";

export const BACKEND_CONTRACT_VERSION = "ejb.backend/1" as const;

export const WireErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
});

export const WireHealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  contract_version: z.literal(BACKEND_CONTRACT_VERSION),
  service: z.string(),
  time: z.string(),
});
export type WireHealth = z.infer<typeof WireHealthSchema>;

export const WireSourcesSchema = z.object({
  sources: z.array(
    z.object({
      source_id: z.string(),
      asset_ids: z.array(z.string()),
      status: z.enum(["ready", "processing", "unavailable"]),
    }),
  ),
});

export const WireCapabilitiesSchema = z.object({
  seek: z.boolean(),
  rate_change: z.boolean(),
  loop: z.boolean(),
  feature_rate_hz: z.number().positive().max(120),
  separates_pollutants: z.boolean(),
  has_verified_georeference: z.boolean(),
});

export const WireCreateSessionRequestSchema = z.object({
  source_id: z.string(),
  asset_id: z.string(),
  client_request_id: z.string(),
});
export type WireCreateSessionRequest = z.infer<typeof WireCreateSessionRequestSchema>;

export const WireSessionSchema = z.object({
  session_id: z.string().min(1),
  source_id: z.string(),
  asset_id: z.string(),
  duration_s: z.number().positive(),
  capabilities: WireCapabilitiesSchema,
});
export type WireSession = z.infer<typeof WireSessionSchema>;

const WireFeatureSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  status: z.enum(["ok", "missing", "masked", "not-applicable"]),
  origin: z.enum(["image-derived", "numerical-data"]),
  normalization: z.object({
    method: z.enum(["fraction-of-analysed-pixels", "fixed-range", "none"]),
    min: z.number(),
    max: z.number(),
    note: z.string().optional(),
  }),
});

export const WireFrameSchema = z.object({
  schema_version: z.literal(FRAME_SCHEMA_VERSION),
  source_id: z.string(),
  asset_id: z.string(),
  session_id: z.string(),
  frame_id: z.string(),
  sequence: z.number().int().nonnegative(),
  presentation_time_s: z.number().nonnegative(),
  presentation_span_s: z.number().positive().optional(),
  observation: z
    .object({
      kind: z.enum(["instant", "interval", "comparison"]),
      start: z.string(),
      end: z.string().optional(),
      label: z.string(),
      basis: z.enum(["nasa-frame-table", "on-screen-label-verified", "page-stated-coverage"]),
    })
    .nullable(),
  phase: z.object({ id: z.string(), label: z.string() }).nullable(),
  media: z.object({ asset_id: z.string(), kind: z.enum(["video", "image"]) }),
  features: z.array(WireFeatureSchema),
  provenance: z.object({
    svs_id: z.number().int(),
    source_page: z.string(),
    asset_url: z.string(),
    extraction: z.object({ producer: z.literal("backend"), method: z.string(), version: z.string() }),
  }),
});
export type WireFrame = z.infer<typeof WireFrameSchema>;

export const WireFeatureWindowSchema = z.object({
  session_id: z.string(),
  request_id: z.string(),
  from_s: z.number().nonnegative(),
  to_s: z.number().nonnegative(),
  frames: z.array(WireFrameSchema),
  end_of_stream: z.boolean(),
});
export type WireFeatureWindow = z.infer<typeof WireFeatureWindowSchema>;

export function mapCapabilities(w: z.infer<typeof WireCapabilitiesSchema>): Capabilities {
  return {
    seek: w.seek,
    rateChange: w.rate_change,
    loop: w.loop,
    featureRateHz: w.feature_rate_hz,
    separatesPollutants: w.separates_pollutants,
    hasVerifiedGeoreference: w.has_verified_georeference,
  };
}

/** Maps a validated wire frame to the internal representation, re-validating the result. */
export function mapWireFrame(w: WireFrame): FeatureFrame {
  return FeatureFrameSchema.parse({
    schemaVersion: w.schema_version,
    sourceId: w.source_id,
    assetId: w.asset_id,
    sessionId: w.session_id,
    frameId: w.frame_id,
    sequence: w.sequence,
    presentationTimeS: w.presentation_time_s,
    presentationSpanS: w.presentation_span_s,
    observation: w.observation,
    phase: w.phase,
    media: { assetId: w.media.asset_id, kind: w.media.kind },
    features: w.features,
    provenance: {
      svsId: w.provenance.svs_id,
      sourcePage: w.provenance.source_page,
      assetUrl: w.provenance.asset_url,
      extraction: w.provenance.extraction,
    },
  });
}

/** Inverse mapping, used by the development reference backend and tests. */
export function toWireFrame(f: FeatureFrame): WireFrame {
  return {
    schema_version: f.schemaVersion,
    source_id: f.sourceId,
    asset_id: f.assetId,
    session_id: f.sessionId,
    frame_id: f.frameId,
    sequence: f.sequence,
    presentation_time_s: f.presentationTimeS,
    ...(f.presentationSpanS !== undefined ? { presentation_span_s: f.presentationSpanS } : {}),
    observation: f.observation,
    phase: f.phase,
    media: { asset_id: f.media.assetId, kind: f.media.kind },
    features: f.features,
    provenance: {
      svs_id: f.provenance.svsId,
      source_page: f.provenance.sourcePage,
      asset_url: f.provenance.assetUrl,
      extraction: { producer: "backend", method: f.provenance.extraction.method, version: f.provenance.extraction.version },
    },
  };
}
