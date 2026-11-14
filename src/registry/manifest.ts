import { z } from "zod";

import rawManifest from "@/registry/media-manifest.json";

const OriginalSchema = z.object({
  url: z.url(),
  bytes: z.number().int().positive(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  videoCodec: z.string().optional(),
  imageFormat: z.string().optional(),
  profile: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.string().optional(),
  durationS: z.number().positive().optional(),
  frameCount: z.number().int().positive().optional(),
  audio: z.literal("none"),
  browserCompatible: z.boolean(),
  compatibilityNote: z.string(),
});

const DerivativeSchema = z.object({
  path: z.string().startsWith("/media/"),
  mimeType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  transform: z.enum(["transcode", "remux", "copy"]),
  ffmpegOutputArgs: z.array(z.string()),
  description: z.string(),
});

const PassthroughSchema = z.object({
  url: z.url(),
  bytes: z.number().int().positive(),
  etag: z.string().optional(),
  mimeType: z.string(),
  videoCodec: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.string().optional(),
  durationS: z.number().positive().optional(),
  description: z.string(),
});

export const ManifestAssetSchema = z.object({
  assetId: z.string(),
  svsId: z.number().int(),
  kind: z.enum(["video", "image"]),
  sourcePage: z.url(),
  mediaGroupId: z.number().int(),
  original: OriginalSchema,
  derivative: DerivativeSchema,
  passthrough: PassthroughSchema.nullable(),
  auxiliary: z
    .array(
      z.object({
        role: z.string(),
        url: z.url(),
        bytes: z.number().int(),
        etag: z.string().optional(),
        repoCopy: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
});
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;

const ManifestSchema = z.object({
  schemaVersion: z.literal("ejb.media-manifest/1"),
  notes: z.array(z.string()),
  assets: z.array(ManifestAssetSchema),
  thumbnails: z.array(z.object({ svsId: z.number().int(), url: z.url(), width: z.number(), height: z.number() })),
});

/** Parsed once at module load; a malformed manifest fails the build/tests loudly. */
export const mediaManifest = ManifestSchema.parse(rawManifest);

export function getManifestAsset(assetId: string): ManifestAsset | undefined {
  return mediaManifest.assets.find((a) => a.assetId === assetId);
}

/** Shape of public/media/prepared.json written by scripts/prepare-media.mjs. */
export const PreparedMediaSchema = z.object({
  schemaVersion: z.literal("ejb.prepared-media/1"),
  generatedAt: z.string().optional(),
  assets: z.record(
    z.string(),
    z.object({
      assetId: z.string(),
      svsId: z.number(),
      path: z.string().startsWith("/media/"),
      mimeType: z.string(),
      transform: z.string(),
      bytes: z.number(),
      sha256: z.string().length(64),
      probe: z.object({
        width: z.number().nullable(),
        height: z.number().nullable(),
        videoCodec: z.string().nullable(),
        frameRate: z.string().nullable(),
        frameCount: z.number().nullable(),
        durationS: z.number().nullable(),
        hasAudio: z.boolean(),
      }),
      preparedAt: z.string(),
    }),
  ),
  thumbnails: z.record(z.string(), z.object({ path: z.string().startsWith("/media/"), sourceUrl: z.string(), width: z.number() })),
});
export type PreparedMedia = z.infer<typeof PreparedMediaSchema>;

/** One playable rendition, always same-origin so canvas sampling is permitted. */
export interface Rendition {
  kind: "prepared-derivative" | "restricted-passthrough";
  src: string;
  mimeType: string;
  width: number;
  height: number;
  description: string;
}

export function renditionsFor(asset: ManifestAsset, prepared: PreparedMedia | null): Rendition[] {
  const out: Rendition[] = [];
  const p = prepared?.assets[asset.assetId];
  if (p && p.path === asset.derivative.path) {
    out.push({
      kind: "prepared-derivative",
      src: asset.derivative.path,
      mimeType: asset.derivative.mimeType,
      width: asset.derivative.width,
      height: asset.derivative.height,
      description: asset.derivative.description,
    });
  }
  if (asset.passthrough) {
    out.push({
      kind: "restricted-passthrough",
      src: `/api/media/${encodeURIComponent(asset.assetId)}`,
      mimeType: asset.passthrough.mimeType,
      width: asset.passthrough.width,
      height: asset.passthrough.height,
      description: asset.passthrough.description,
    });
  }
  return out;
}
