# Media preparation

## Why derivatives are needed

| Problem (verified 2026-11-14) | Consequence |
| --- | --- |
| `svs.gsfc.nasa.gov` sends `Access-Control-Allow-Origin` for one unrelated origin only | A browser can play hotlinked NASA video but `getImageData` on it throws a SecurityError. Analysed media must be same-origin. |
| 5313 and 5196 are HEVC (H.265) only | The tested Chromium 153 reports `canPlayType('video/mp4; codecs="hvc1…"') === ""`. A browser-compatible derivative is required. |
| Several originals are 22–40 Mbit/s or 5760×3240 | Too heavy to stream for interactive playback; large frames exceed common decoder limits. |

## `npm run media:prepare`

`scripts/prepare-media.mjs`:

1. Reads `src/registry/media-manifest.json` — the only URLs it will ever fetch.
2. HEAD-checks each NASA file; stops if size/ETag differ from the verified manifest (override only after
   re-verifying provenance: `--accept-upstream-change`).
3. Streams the master through FFmpeg into the documented recipe (masters are not stored):
   - transcode to H.264 High, yuv420p, `+faststart`, 1-second keyframe interval for accurate seeking,
     bounded bitrate (`-maxrate`), **no audio**; exact downscales that keep the aspect ratio (no crop);
     native frame rate and frame count preserved;
   - GEDI: lossless remux (`-c copy`) only; Aerosols: byte-for-byte copy.
4. Writes `public/media/prepared.json`: ffprobe results, SHA-256, upstream size/ETag/Last-Modified, recipe hash.
5. Writes 480-px thumbnails (downscaled, never upscaled) of NASA preview images.

Options: `--only 5313,4950`, `--force`. Requires FFmpeg/ffprobe on PATH. Behind an HTTPS proxy the script relaunches
itself with `NODE_USE_ENV_PROXY=1`. Output (≈ 490 MB) is git-ignored; do not commit it.

Result on 2026-11-14 (all frame counts identical to the originals, no audio streams):

| SVS | Rendition | Size |
| --- | --- | --- |
| 5313 | 1920×540 H.264, 30 fps, 1300 frames | 6.2 MiB |
| 3912 | 1280×640 H.264, 30 fps, 2001 frames | 48.3 MiB |
| 5425 | 1280×720 H.264, 30 fps, 9503 frames | 151.4 MiB |
| 5533 | 1920×1080 H.264, 30 fps, 1800 frames | 57.9 MiB |
| 5196 | 1920×1080 H.264, 30 fps, 1176 frames | 13.6 MiB |
| 5011 | 1280×720 H.264, 30 fps, 6501 frames | 46.5 MiB |
| 4960 | 1280×720 H.264, 59.94 fps, 17486 frames | 146.4 MiB |
| 4950 | 1920×1080 H.264, 60 fps, 3089 frames (remux) | 17.7 MiB |
| 5669 | 1920×1080 PNG (copy) | 2.6 MiB |

## Restricted passthrough route

`GET|HEAD /api/media/<assetId>` serves **only** manifest assets that have a `passthrough` entry — NASA originals that
are already browser-compatible (3912 VP8 WebM, 5011 H.264, 4960 VP8 WebM, 4950 H.264, 5669 PNG). It:
- takes an asset id, never a URL (no open proxy);
- forwards a single byte range (`bytes=a-b`), rejects multi-range;
- refuses with `502 upstream_changed` if NASA's total size differs from the manifest;
- sets the content type from the manifest, not from upstream.

The renderer tries renditions in order: prepared derivative → passthrough. If none is available or decodable it
shows "Media not prepared" / "This browser cannot decode the media format" with a Retry button. Thumbnails and legend
images are hotlinked from NASA for display only (no pixel access needed).

## Bounded buffering

The app uses progressive `<video>` loading with `preload="auto"` on a single element; browsers buffer a bounded window
around the playhead. No source loads all frames into memory: local analysis samples one small canvas at a time, and
the feature timeline is capped (6000 frames, evicting the farthest).

## Night Lights phase analysis

`node scripts/analyze-nightlights-phases.mjs [input]` prints per-frame purple share, warm share and the centre-label
difference used to establish the phases and year labels documented in [SOURCES.md](SOURCES.md). It accepts the
prepared derivative or the NASA URL.
