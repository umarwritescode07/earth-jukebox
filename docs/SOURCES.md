# Source & asset manifest

Authoritative registry: the Resources tab of the Space Apps 2026 challenge
[The Earth Information Jukebox](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/?tab=resources),
as supplied by the team. (The challenge site served an incomplete TLS certificate chain from this environment, so the
list could not be re-fetched; the 11 entries below are the team's copy.)

Every page was read through the NASA SVS API (`https://svs.gsfc.nasa.gov/api/<id>`) on **2026-11-14**. Technical
properties were verified with `ffprobe`/HTTP HEAD on the NASA files. Machine-readable data:
`src/registry/media-manifest.json` (assets) and `src/registry/sources.ts` (metadata, interpretation, profiles).

## Registry → selected assets

| SVS | Resource | Status in app | Selected NASA asset (exact file) | Original | Delivered rendition |
| --- | --- | --- | --- | --- | --- |
| — | [EIC Content Database](https://svs.gsfc.nasa.gov/gallery/earth-information-center/) | Provenance link | — | — | — |
| [13786](https://svs.gsfc.nasa.gov/13786/) | Data Sonification: Caldwell 73 | **Method reference only** (astronomy, not Earth data) | — | — | — |
| [5313](https://svs.gsfc.nasa.gov/5313/) | Change in Night Lights 2012–2023 — EIC | Playable | `nightlights_flat_series_and_change_wZooms_13_EIC_2160p30_h265.mp4` | HEVC Main 7680×2160, 30 fps, 1300 frames, 43.33 s, 34.3 MB, no audio | H.264 1920×540 (exact ¼ scale) |
| [3912](https://svs.gsfc.nasa.gov/3912/) | Global Sea Surface Currents and Temperature | Playable | `ecco2_sst_flow.mp4` (+ passthrough `ecco2_sst_flow.webmhd.webm`) | H.264 Main 2048×1024, 30 fps, 2001 frames, 66.7 s, 256 MB | H.264 1280×640; NASA VP8 1080×540 unchanged |
| [5669](https://svs.gsfc.nasa.gov/5669/) | GEOS Aerosols — page now titled **"GEOS Aerosols (2025)"**, a **still image** | Playable (scanned) | `Aerosols_2025-08-19T20_00_00_1920x1080.png` | PNG 1920×1080, 2.8 MB | byte-identical copy |
| [5533](https://svs.gsfc.nasa.gov/5533/) | Air Quality Model Runs | Playable | `AirQuality_MapWithLabels_5760x3240.mp4` | H.264 Main 5760×3240, 30 fps, 1800 frames, 60 s, 300 MB | H.264 1920×1080 (exact ⅓ scale) |
| [5425](https://svs.gsfc.nasa.gov/5425/) | Perpetual Ocean 2: Western Boundary Currents | Playable | `perpetual_ocean2_CLOSE_093_clean_noDate_1080p30.mp4` (beauty shot) | H.264 High 1920×1080, 30 fps, 9503 frames, 316.8 s, 1.28 GB | H.264 1280×720 |
| [5196](https://svs.gsfc.nasa.gov/5196/) | DYAMOND Global Carbon Dioxide | Playable | `dyamondPointCloud_12-1-2023b_dyamond_co2_anim_globe_orbit_1080p30_h265.mp4` (orbit) | HEVC Main 1920×1080, 30 fps, 1176 frames, 39.2 s, 7.2 MB | H.264 1920×1080 |
| [5011](https://svs.gsfc.nasa.gov/5011/) | Lightning Events Detected from the ISS 2017–2023 | Playable | `iss_lightning_sphere_07312023.mp4` | H.264 High 1920×1080, 30 fps, 6501 frames, 216.7 s, 133 MB | H.264 1280×720 (+ passthrough of the original) |
| [4960](https://svs.gsfc.nasa.gov/4960/) | A 3D View of an Atmospheric River | Playable | `atmos_river_HD.mp4` (**non-narrated** visualization) | H.264 High 1920×1080, 59.94 fps, 17486 frames, 291.7 s, 828 MB | H.264 1280×720 (+ passthrough NASA VP8 WebM) |
| [4950](https://svs.gsfc.nasa.gov/4950/) | GEDI Forest Height | Playable | `GEDI_global_w_colorbar_1080p60.mp4` (with on-screen colour bar) | H.264 High 1920×1080, 60 fps, 3089 frames, 51.5 s, 18.6 MB | lossless remux (+faststart) |

No selected file has an audio track, so no NASA narration or third-party music is ever played. Derivatives keep
the original aspect ratio, frame rate and frame count (checked by `prepare-media` and tests) and never crop,
recolour or retime. Exact recipes: `derivative.ffmpegOutputArgs` in the manifest. Each prepared file's SHA-256 and
ffprobe output are written to `public/media/prepared.json`.

Selection rationale: practical browser renditions over masters (8K ProRes/HEVC are 4 GB+), visualization-only
versions over narrated/produced ones, flat maps (no camera motion) where NASA offers them, and versions whose
legend is on screen or published separately.

## Interpretation per source (summary)

Full text, cautions and credits are in `src/registry/sources.ts` and shown in the app.

- **5313 Night Lights**: annual averages 2012–2023 → change 2012 vs 2023 (purple more light, orange less light) →
  repeat with insets of India, Ukraine, Western Europe, Eastern Mediterranean. Absolute brightness and change colours
  are mapped to **different** voices and only in their own phases. The EIC version shows the map twice (32:9). No
  inference about population, electricity or economy.
- **3912 ECCO2**: surface flow coloured by SST (model). Colours grouped into hue bands of NASA's 0–32 °C bar; **no
  temperatures decoded**; screen motion ≠ current speed. Model time per frame from NASA's table (exact).
- **5425 Perpetual Ocean 2 (beauty)**: white = surface–600 m flows (also the warm end of the deep table, and
  snow/ice) — ambiguous; blue–cyan = deeper than 600 m. Not an SST map. Camera rotation and zooms disclosed.
- **5533 Air Quality (GEOS-CF)**: modelled PM2.5, O₃, CO, NOₓ, July–August 2024. Not AQI, not an advisory. Panels
  slide horizontally and PM2.5/CO share hues → **per-pollutant controls disabled** with the reason shown.
- **5196 DYAMOND CO₂**: January–March 2020 model, orbiting camera. NASA's colour bar has **no numeric labels** → no
  ppm values.
- **5011 ISS LIS lightning**: through July 2023, 10-day roving window. **Start-month conflict** shown verbatim: the
  main caption says January 2017, the page's SOS caption says March 2017, and the selected video's burned-in date
  reads "Mar 01 2017 03:32" at 0.5 s. Percussion follows displayed glow, not strikes; not live. The first ~15 s show
  the globe before any glows appear, so the sonification is (correctly) nearly silent there.
- **4960 Atmospheric river**: rendered 3D scene in a video (not an interactive model); non-narrated version used.
  Blue shading = water-vapour transport (no colour bar); surface legends published separately.
- **4950 GEDI**: brown/dark green shorter, bright green/white taller; height exaggerated. **Date conflict** shown
  verbatim: the selected global-with-colour-bar asset says April 2019 – April 2020; the same view without the bar says
  April 2018 – April 2019. Not resolved.
- **5669 GEOS Aerosols (2025)**: single still for 2025-08-19 20:00 UTC. Legend labels Black Carbon / Dust /
  Sea Salt / Sulfate; page text says smoke (orange/red) / dust (pink/magenta) / sea salt (blue) / sulfates (green) —
  both names shown. Scanned left → right (scan position ≠ verified longitude; projection not stated).

## How time and phases were verified

- **Night Lights phases and years** — `scripts/analyze-nightlights-phases.mjs` decodes the NASA original and logs, per
  frame, purple share and a centre-label difference signal. Year labels change at frames
  0, 15, 33, 51, 69, 86, 104, 122, 139, 157, 175, 193 (2012…2023) and again at 645, 830, 848, …, 1008; the change
  colour bar is present from frame ≈ 305 to 615 and from ≈ 1120 to the end. The label text was then read visually
  from crops of frames 16, 42, 60, 78, 95, 113, 131, 148, 166, 200, 270, 450, 660, 700, 840, 1000, 1050, 1200.
  Cross-fades (283–305, 615–645, 1094–1120) are treated as transitions with **no** observation time and no colour
  interpretation.
- **ECCO2 model time** — NASA's `flat_ecco2_dates.txt` (2001 timestamps, copied to `src/registry/data/`) is evenly
  spaced; a unit test checks the app's mapping against every line (≤ 1 min).
- **All other videos** show burned-in dates (or none) without a published frame table, so the app shows the
  page-stated coverage and says "not mapped per frame".

## Legend colours used for colour groups

Sampled from NASA images (see `tests/unit/extract.test.ts`):

| Source | Swatch | RGB | HSL hue |
| --- | --- | --- | --- |
| 5669 legend | Black Carbon | 210, 94, 69 | ≈ 11° |
| 5669 legend | Dust | 193, 154, 220 | ≈ 276° |
| 5669 legend | Sea Salt | 133, 170, 169 | ≈ 178° (low saturation) |
| 5669 legend | Sulfate | 83, 220, 52 | ≈ 109° |
| 5313 change bar | less light (orange end) | 230, 157, 90 | ≈ 29° |
| 5313 change bar | more light (purple end) | 147, 104, 196 | ≈ 268° |

## Network/CORS finding

`svs.gsfc.nasa.gov` answers `Access-Control-Allow-Origin` for a single unrelated origin, so a browser can *play*
hotlinked NASA media but cannot read its pixels. All analysed media is therefore same-origin (prepared derivative or
the restricted passthrough route). See [MEDIA.md](MEDIA.md).
