# Earth Information Jukebox — Listen to a Changing Planet

NASA Space Apps 2026 · frontend (Next.js) for real-time sonification of NASA Earth Information Center visualizations.

The app plays an approved NASA Scientific Visualization Studio (SVS) video or image, measures features of the
pixels actually on screen (colour groups taken from NASA's own legends, lightness, frame-to-frame change), and turns
them into sound **live in the browser** with Tone.js. Nothing is prerecorded and nothing is random. Every source
explains what you are hearing, what the colours mean, and what the sound must **not** be read as.

| What | Where |
| --- | --- |
| Source & asset manifest, provenance, verification | [docs/SOURCES.md](docs/SOURCES.md) |
| Backend integration contract (proposed v1 + confirmed events format) | [docs/BACKEND_CONTRACT.md](docs/BACKEND_CONTRACT.md) |
| Sonification mapping, master clock, calibration | [docs/SONIFICATION.md](docs/SONIFICATION.md) |
| Media preparation (derivatives, CORS, passthrough) | [docs/MEDIA.md](docs/MEDIA.md) |
| Future 3D renderer (React Three Fiber, GLB/GLTF) | [docs/FUTURE_3D.md](docs/FUTURE_3D.md) |
| Test results, browsers tested, remaining gaps | [docs/TESTING.md](docs/TESTING.md) |

## Quick start

Requirements: Node 22+, npm, and **FFmpeg** (for `media:prepare`).

```bash
npm install
```

```bash
npm run media:prepare
```

```bash
npm run dev
```

Open http://localhost:3000, pick a visualization, press **Play** (audio starts only after a click, as browsers require).

`media:prepare` downloads the approved NASA files listed in `src/registry/media-manifest.json`, checks their size/ETag,
and writes browser-compatible renditions to `public/media/` (≈ 490 MB, git-ignored). Without it, only sources whose
NASA original is already browser-compatible play (through the restricted `/api/media/<assetId>` route); the others
show "Media not prepared".

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (Next core-web-vitals + React Compiler rules) |
| `npm test` | Vitest unit tests (`tests/unit`) |
| `npm run test:e2e` | Playwright browser tests (starts the reference backend + dev server; needs prepared media) |
| `npm run media:prepare` | Build same-origin NASA renditions (`--only 5313,4950`, `--force`) |
| `npx vitest run --config vitest.calibration.config.mts --reporter=verbose` | Re-measure feature distributions on the real media; regenerates `tests/fixtures/svs5313-features.json` |
| `node tools/reference-backend/server.mjs --port 3299` | Reference implementation of the proposed backend contract (dev/tests only) |

### Environment

Copy `.env.example` to `.env.local`. All variables are **server-side only**; nothing secret reaches the browser.

| Variable | Meaning |
| --- | --- |
| `EJB_BACKEND_URL` | Base URL of the team backend. Unset ⇒ "Backend not configured", local NASA analysis only. |
| `EJB_EVENTS_PATH` | Path of the events array endpoint on the backend (default `/events`). |
| `EJB_OCEAN_TEMP_PATH` | Path of the ocean + temperature series endpoint on the backend (default `/ocean-temp`). |
| `EJB_BACKEND_TOKEN` | Optional bearer token added by the server proxy. Never exposed to the browser. |

Behind an HTTPS proxy, start Next with `NODE_USE_ENV_PROXY=1` so server-side `fetch` (media passthrough, backend proxy) uses it.

## What the app does

- **Library** of 9 verified NASA SVS sources from the challenge resource list, with NASA thumbnails, category,
  coverage and readiness. Caldwell 73 is listed as a *method reference* only (astronomy, never Earth data).
- **Stage**: the NASA media at its native aspect ratio (32:9, 2:1, 16:9), never cropped; playback position;
  phase and observation/model time **only where reliably mapped** (Night Lights years and phases verified frame by
  frame; ECCO2 model time from NASA's per-frame date table); loading/buffering/unsupported/unavailable/retry states;
  full screen; a text description of the visual.
- **Listening panel**: "What you are hearing" (updated twice per second), the mapping table with
  *image-derived* vs *numerical-data* labels, per-layer switches, NASA legends, interpretation cautions, credits,
  data-path selection (local analysis vs backend) and measured sync diagnostics.
- **Playback bar**: play/pause, restart, seek, mute, volume (dB), speed 0.5–2×, loop, and a spectrum + level meter
  measured from the real audio output.
- **Ocean & temperature series** (`/api/ocean-temp`, file `src/app/api/ocean-temp/route.ts`): the backend's daily
  `{ date, temperature_celsius, ocean_intensity }` array, sonified one day per beat — temperature → piano pitch
  (+1 semitone per 0.1 °C above the series median), ocean intensity → surf (noise) loudness and swell rate — with two
  small-multiple charts, a full data table and the exact note/wave level per day. Until the endpoint is live the route
  serves the teammate's sample, labelled **"Sample backend payload — not live"** (header `x-ejb-data-source`).
- **Backend events globe**: the teammate's event payload on a procedural 3D globe (no basemap imagery) plus an
  accessible list. Until the API is live it shows the shared sample, labelled **"Sample backend payload — not live"**.
- **Accessibility**: landmarks, skip link, full keyboard operation (shortcuts K / J / L / M), visible focus, named
  sliders with spoken values, text alternatives, reduced-motion and decorative-animation settings, larger text, polite
  announcements on meaningful changes only.

## Architecture (short)

```
NASA SVS asset ──(media:prepare / restricted passthrough)──► same-origin <video>/<img>  ◄── renderer (MediaPort)
                                                                      │ canvas pixels
backend (proposed v1, via /api/backend proxy) ──► BackendFeatureProvider ┐
local analysis (extractFeatures)              ──► Local*FeatureProvider  ┴─► FeatureTimeline (validated FeatureFrame)
                                                                                     │
PlaybackClock (Web Audio time, disciplined to decoded video frames) ──► look-ahead scheduler ──► mapping ──► Tone.js engine
```

React components never see URLs, HTTP or wire formats; they use the controller snapshot and the registry.
See [docs/SONIFICATION.md](docs/SONIFICATION.md) and [docs/BACKEND_CONTRACT.md](docs/BACKEND_CONTRACT.md).

## Team Git workflow — Roman Urdu guide

Repository ke folder mein jao. Frontend ka kaam `feature/ui-globe` branch par karo. Main branch par direct push mat
karo. Build aur tests check karne ke baad sirf apni relevant files commit karo.

1. Repository ke folder mein jao:

   ```bash
   cd earth-jukebox
   ```

2. Latest changes lo aur frontend branch par switch karo:

   ```bash
   git fetch origin
   ```

   ```bash
   git switch feature/ui-globe
   ```

3. Kaam shuru karne se pehle check karo ke kya badla hua hai:

   ```bash
   git status
   ```

4. Kaam ke baad build aur tests chalao (sab pass hone chahiye):

   ```bash
   npm run typecheck
   ```

   ```bash
   npm run lint
   ```

   ```bash
   npm test
   ```

   ```bash
   npm run build
   ```

5. Sirf apni relevant files add karo (poora folder `git add .` mat karo). `node_modules`, `.next`, `public/media`
   aur `.env.local` kabhi commit nahi karne — ye `.gitignore` mein hain:

   ```bash
   git add src/components/jukebox/stage.tsx docs/TESTING.md
   ```

6. Saaf message ke saath commit karo:

   ```bash
   git commit -m "feat: stage par fullscreen button behtar kiya"
   ```

7. Apni branch push karo (main par nahi):

   ```bash
   git push -u origin feature/ui-globe
   ```

8. GitHub par `feature/ui-globe` se `main` ke liye Pull Request banao, teammate se review karwao, phir merge karo.

Agar push par "authentication" error aaye to pehle GitHub login check karo (`gh auth login` ya GitHub Desktop).
Secrets (API keys, tokens) kabhi code ya commit mein na daalo — sirf `.env.local` mein rakho.

## Standalone climate audio prototype

The separate Vite/Tone.js prototype is in [audio-prototype/](./audio-prototype/). It explores 15 selected temperature-anomaly sample points; it is not the complete annual NASA record. See [audio-prototype/README.md](./audio-prototype/README.md) for setup and run instructions.

## Credits

All imagery: NASA Scientific Visualization Studio; individual visualizer, scientist and dataset credits are shown in
the app for each source and listed in [docs/SOURCES.md](docs/SOURCES.md). Sonification method inspired by NASA's
*Data Sonification: Caldwell 73* (SYSTEM Sounds — M. Russo, A. Santaguida). Sound is generated by this project; no
third-party or NASA audio is played.
