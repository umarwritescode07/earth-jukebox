#!/usr/bin/env node
/**
 * Earth Information Jukebox — media preparation.
 *
 * Builds same-origin, browser-compatible renditions of the approved NASA SVS
 * assets listed in src/registry/media-manifest.json, and writes
 * public/media/prepared.json describing exactly what was produced
 * (ffprobe results + SHA-256), so the app and reviewers can verify provenance.
 *
 * Rules enforced here:
 *  - Only URLs that appear in the manifest are fetched (no arbitrary URLs).
 *  - Upstream size/ETag are checked against the manifest before use.
 *  - Derivatives never crop, recolour, retime or add audio (see manifest recipes).
 *  - Masters are streamed through ffmpeg; nothing is kept except the derivative.
 *
 * Usage:
 *   npm run media:prepare                    # everything
 *   npm run media:prepare -- --only 5313,4950
 *   npm run media:prepare -- --force         # rebuild even if up to date
 *   npm run media:prepare -- --accept-upstream-change   # proceed if NASA changed a file
 *
 * Requires ffmpeg + ffprobe on PATH. Behind an HTTPS proxy (HTTPS_PROXY set),
 * the script re-launches itself with NODE_USE_ENV_PROXY=1 so fetch() uses it.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy && process.env.NODE_USE_ENV_PROXY !== "1") {
  const child = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  process.exit(child.status ?? 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(ROOT, "src/registry/media-manifest.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const PREPARED_PATH = path.join(PUBLIC_DIR, "media/prepared.json");
const THUMB_WIDTH = 480;

const args = process.argv.slice(2);
const force = args.includes("--force");
const acceptUpstreamChange = args.includes("--accept-upstream-change");
const onlyIdx = args.indexOf("--only");
const only =
  onlyIdx >= 0 && args[onlyIdx + 1]
    ? new Set(args[onlyIdx + 1].split(",").map((s) => Number(s.trim())))
    : null;

function log(...parts) {
  console.log("[media]", ...parts);
}

function requireTool(name) {
  const r = spawnSync(name, ["-version"], { stdio: "ignore" });
  if (r.error || r.status !== 0) {
    console.error(`[media] '${name}' was not found on PATH. Install FFmpeg (https://ffmpeg.org/download.html) and retry.`);
    process.exit(1);
  }
}

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}

/** ffmpeg needs the proxy passed explicitly for http(s) inputs. */
function ffmpegInputArgs(url) {
  return proxy ? ["-http_proxy", proxy, "-i", url] : ["-i", url];
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file).on("data", (d) => hash.update(d)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries",
    "stream=codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,pix_fmt,nb_frames:format=duration,bit_rate,format_name",
    "-of", "json", file,
  ]);
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  return {
    format: j.format?.format_name ?? null,
    durationS: j.format?.duration ? Number(j.format.duration) : null,
    bitRate: j.format?.bit_rate ? Number(j.format.bit_rate) : null,
    videoCodec: v?.codec_name ?? null,
    profile: v?.profile ?? null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    frameRate: v?.r_frame_rate ?? null,
    frameCount: v?.nb_frames ? Number(v.nb_frames) : null,
    pixelFormat: v?.pix_fmt ?? null,
    hasAudio: (j.streams || []).some((s) => s.codec_type === "audio"),
  };
}

async function headCheck(url, expected) {
  const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HEAD ${url} -> HTTP ${res.status}`);
  const bytes = Number(res.headers.get("content-length"));
  const etag = res.headers.get("etag");
  const problems = [];
  if (expected.bytes && bytes !== expected.bytes) problems.push(`size ${bytes} != manifest ${expected.bytes}`);
  if (expected.etag && etag && etag !== expected.etag) problems.push(`etag ${etag} != manifest ${expected.etag}`);
  if (problems.length) {
    const msg = `Upstream NASA file differs from the verified manifest (${problems.join("; ")}): ${url}`;
    if (!acceptUpstreamChange) throw new Error(`${msg}. Re-verify provenance, then rerun with --accept-upstream-change.`);
    log("WARNING:", msg);
  }
  return { bytes, etag, lastModified: res.headers.get("last-modified") };
}

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

function recipeHash(asset) {
  return createHash("sha256")
    .update(JSON.stringify({ url: asset.original.url, d: asset.derivative }))
    .digest("hex")
    .slice(0, 16);
}

async function loadPrepared() {
  try {
    return JSON.parse(await readFile(PREPARED_PATH, "utf8"));
  } catch {
    return { schemaVersion: "ejb.prepared-media/1", assets: {}, thumbnails: {} };
  }
}

async function prepareAsset(asset, prepared) {
  const outFile = path.join(PUBLIC_DIR, asset.derivative.path);
  const hash = recipeHash(asset);
  const prev = prepared.assets[asset.assetId];
  if (!force && prev && prev.recipeHash === hash && existsSync(outFile)) {
    log(`skip ${asset.assetId} (up to date)`);
    return;
  }
  log(`prepare ${asset.assetId} <- ${asset.original.url}`);
  const upstream = await headCheck(asset.original.url, asset.original);
  await mkdir(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.partial${path.extname(outFile)}`;
  await rm(tmp, { force: true });
  const started = Date.now();
  if (asset.derivative.transform === "copy") {
    await download(asset.original.url, tmp);
  } else {
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      ...ffmpegInputArgs(asset.original.url),
      ...asset.derivative.ffmpegOutputArgs,
      tmp,
    ]);
  }
  await rename(tmp, outFile);
  const info = await stat(outFile);
  const result = {
    assetId: asset.assetId,
    svsId: asset.svsId,
    path: asset.derivative.path,
    mimeType: asset.derivative.mimeType,
    transform: asset.derivative.transform,
    recipeHash: hash,
    bytes: info.size,
    sha256: await sha256File(outFile),
    probe: await probe(outFile),
    upstream: { url: asset.original.url, ...upstream },
    preparedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  if (result.probe.hasAudio) throw new Error(`${asset.assetId}: derivative unexpectedly contains audio`);
  if (asset.kind === "video" && asset.original.frameCount && result.probe.frameCount && result.probe.frameCount !== asset.original.frameCount) {
    log(`WARNING ${asset.assetId}: frame count ${result.probe.frameCount} != original ${asset.original.frameCount}`);
  }
  prepared.assets[asset.assetId] = result;
  log(`done ${asset.assetId}: ${(info.size / 1048576).toFixed(1)} MiB, ${result.probe.width}x${result.probe.height} ${result.probe.videoCodec ?? result.probe.format} in ${result.seconds}s`);
}

async function prepareThumb(thumb, prepared) {
  const rel = `/media/thumbs/svs${thumb.svsId}.jpg`;
  const out = path.join(PUBLIC_DIR, rel);
  if (!force && prepared.thumbnails[thumb.svsId]?.sourceUrl === thumb.url && existsSync(out)) return;
  await mkdir(path.dirname(out), { recursive: true });
  // Only ever downscale: never upscale a NASA preview image.
  const width = Math.min(THUMB_WIDTH, thumb.width);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...ffmpegInputArgs(thumb.url), "-vf", `scale=${width}:-2:flags=lanczos`, "-q:v", "4", out]);
  prepared.thumbnails[thumb.svsId] = { path: rel, sourceUrl: thumb.url, width };
  log(`thumbnail svs${thumb.svsId} -> ${rel}`);
}

async function main() {
  requireTool("ffmpeg");
  requireTool("ffprobe");
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const prepared = await loadPrepared();
  const save = () => writeFile(PREPARED_PATH, JSON.stringify(prepared, null, 2) + "\n");
  await mkdir(path.dirname(PREPARED_PATH), { recursive: true });

  const failures = [];
  for (const thumb of manifest.thumbnails) {
    if (only && !only.has(thumb.svsId)) continue;
    try {
      await prepareThumb(thumb, prepared);
      await save();
    } catch (err) {
      failures.push(`thumb ${thumb.svsId}: ${err.message}`);
    }
  }
  // Smallest first so something playable appears quickly.
  const assets = [...manifest.assets].sort((a, b) => a.original.bytes - b.original.bytes);
  for (const asset of assets) {
    if (only && !only.has(asset.svsId)) continue;
    try {
      await prepareAsset(asset, prepared);
      prepared.generatedAt = new Date().toISOString();
      await save();
    } catch (err) {
      failures.push(`${asset.assetId}: ${err.message}`);
      log(`FAILED ${asset.assetId}: ${err.message.split("\n")[0]}`);
    }
  }
  if (failures.length) {
    console.error("[media] Some items failed:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  log(`wrote ${path.relative(ROOT, PREPARED_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
