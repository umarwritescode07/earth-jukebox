/**
 * Restricted same-origin passthrough for approved NASA SVS media.
 *
 * NASA SVS does not send CORS headers for this site, so the browser may play
 * hotlinked media but cannot read its pixels. This route serves ONLY assets in
 * src/registry/media-manifest.json that have a `passthrough` entry (already
 * browser-compatible files), by asset id — never an arbitrary URL.
 * It forwards single byte-range requests and refuses to serve if NASA's file
 * size no longer matches the verified manifest.
 */
import { getManifestAsset } from "@/registry/manifest";

const RANGE_RE = /^bytes=\d*-\d*$/;
const HEADER_TIMEOUT_MS = 15000;

function jsonError(status: number, code: string, message: string, retryable: boolean) {
  return Response.json({ error: { code, message, retryable } }, { status });
}

async function proxy(req: Request, assetId: string, method: "GET" | "HEAD"): Promise<Response> {
  const asset = getManifestAsset(assetId);
  const pt = asset?.passthrough;
  if (!asset || !pt) return jsonError(404, "asset_not_approved", "No approved passthrough rendition for this asset id.", false);

  const range = req.headers.get("range");
  if (range && !RANGE_RE.test(range)) return jsonError(416, "range_not_supported", "Only a single byte range is supported.", false);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), HEADER_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(pt.url, {
      method,
      headers: range ? { range } : {},
      signal: AbortSignal.any([req.signal, timeout.signal]),
      cache: "no-store",
    });
  } catch {
    return jsonError(502, "upstream_unreachable", "NASA SVS could not be reached.", true);
  } finally {
    clearTimeout(timer);
  }
  if (!(upstream.status === 200 || upstream.status === 206)) {
    return jsonError(upstream.status === 416 ? 416 : 502, "upstream_status", `NASA SVS answered HTTP ${upstream.status}.`, upstream.status >= 500);
  }

  const contentRange = upstream.headers.get("content-range");
  const total = contentRange ? Number(contentRange.split("/")[1]) : Number(upstream.headers.get("content-length"));
  if (total !== pt.bytes) {
    await upstream.body?.cancel();
    return jsonError(502, "upstream_changed", `NASA file size ${total} differs from the verified manifest (${pt.bytes}). Re-verify provenance before serving.`, false);
  }

  const headers = new Headers({
    "content-type": pt.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
    "x-ejb-asset-id": asset.assetId,
    "x-ejb-original-url": pt.url,
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  if (contentRange) headers.set("content-range", contentRange);
  return new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}

export async function GET(req: Request, ctx: RouteContext<"/api/media/[assetId]">) {
  const { assetId } = await ctx.params;
  return proxy(req, assetId, "GET");
}

export async function HEAD(req: Request, ctx: RouteContext<"/api/media/[assetId]">) {
  const { assetId } = await ctx.params;
  return proxy(req, assetId, "HEAD");
}
