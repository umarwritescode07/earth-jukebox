/**
 * Internal, transport-independent representation of a timestamped feature
 * frame. Every data path (local NASA-media extraction, the backend adapter,
 * tests) produces exactly this shape, validated at runtime with Zod.
 *
 * Units are explicit in names: `presentationTimeS` is seconds on the NASA
 * media's own presentation timeline (0 = first frame of the selected asset),
 * NOT wall-clock time and NOT the time the data was observed.
 */
import { z } from "zod";

export const FRAME_SCHEMA_VERSION = "ejb.frame/1" as const;

export const FeatureOriginSchema = z.enum(["image-derived", "numerical-data"]);
export type FeatureOrigin = z.infer<typeof FeatureOriginSchema>;

/** ok = measured; missing = no value for this frame; masked = region excluded; not-applicable = feature not meaningful in this phase. */
export const FeatureStatusSchema = z.enum(["ok", "missing", "masked", "not-applicable"]);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

export const NormalizationSchema = z.object({
  method: z.enum(["fraction-of-analysed-pixels", "fixed-range", "none"]),
  min: z.number(),
  max: z.number(),
  note: z.string().optional(),
});
export type Normalization = z.infer<typeof NormalizationSchema>;

export const FeatureSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.number().nullable(),
    unit: z.string().min(1),
    status: FeatureStatusSchema,
    origin: FeatureOriginSchema,
    normalization: NormalizationSchema,
  })
  .refine((f) => (f.status === "ok" ? f.value !== null : f.value === null), {
    message: "value must be present exactly when status is 'ok'",
  });
export type Feature = z.infer<typeof FeatureSchema>;

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO-8601 date or date-time");

/**
 * When the depicted data was observed or modelled. Only present when the
 * mapping from presentation time is reliable; `basis` records why.
 */
export const ObservationTimeSchema = z.object({
  kind: z.enum(["instant", "interval", "comparison"]),
  start: isoDate,
  end: isoDate.optional(),
  label: z.string().min(1),
  basis: z.enum(["nasa-frame-table", "on-screen-label-verified", "page-stated-coverage"]),
});
export type ObservationTime = z.infer<typeof ObservationTimeSchema>;

export const PhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const ProvenanceSchema = z.object({
  svsId: z.number().int().positive(),
  sourcePage: z.url(),
  assetUrl: z.url(),
  extraction: z.object({
    producer: z.enum(["frontend-local", "backend"]),
    method: z.string().min(1),
    version: z.string().min(1),
  }),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const FeatureFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  sourceId: z.string().min(1),
  assetId: z.string().min(1),
  sessionId: z.string().min(1),
  frameId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  presentationTimeS: z.number().nonnegative(),
  /** Optional span of presentation time this frame summarises (e.g. a scan band). */
  presentationSpanS: z.number().positive().optional(),
  observation: ObservationTimeSchema.nullable(),
  phase: PhaseSchema.nullable(),
  media: z.object({ assetId: z.string().min(1), kind: z.enum(["video", "image"]) }),
  features: z.array(FeatureSchema),
  provenance: ProvenanceSchema,
});
export type FeatureFrame = z.infer<typeof FeatureFrameSchema>;

export const CapabilitiesSchema = z.object({
  seek: z.boolean(),
  rateChange: z.boolean(),
  loop: z.boolean(),
  featureRateHz: z.number().positive().max(120),
  /** True only if the asset/backend genuinely separates pollutant channels. */
  separatesPollutants: z.boolean(),
  /** True only if verified coordinates + projection exist for the frames. */
  hasVerifiedGeoreference: z.boolean(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const StreamErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
});
export type StreamError = z.infer<typeof StreamErrorSchema>;

/** Convenience accessor; returns null unless the feature exists with status ok. */
export function featureValue(frame: FeatureFrame | null | undefined, id: string): number | null {
  if (!frame) return null;
  const f = frame.features.find((x) => x.id === id);
  return f && f.status === "ok" ? f.value : null;
}
