# Test results and remaining gaps

Run on 2026-11-14 in a Linux cloud container (4 vCPU). **Browser actually tested: Chromium 153.0.8010.12 (Playwright
1.63 build, headless) only.** Not tested: Firefox, Safari/WebKit, Edge, real mobile devices, real speakers.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Type check (strict) | `npm run typecheck` | pass |
| Lint (Next + React Compiler rules) | `npm run lint` | pass, 0 problems |
| Unit tests | `npm test` | **45 passed** (5 files) |
| Production build | `npm run build` | pass (Next 16.4.6, Turbopack) |
| Browser E2E | `npm run test:e2e` against `next start` + reference backend | **12 passed** |
| Calibration on real media | `npx vitest run --config vitest.calibration.config.mts --reporter=verbose` | 9 sources measured |
| Media preparation | `npm run media:prepare` | 9 assets; frame counts identical to originals; no audio streams |

## What the tests verify

Unit (`tests/unit`), using source-derived fixtures (real Night Lights features, NASA legend colours, NASA's ECCO2
date table, the teammate's event payload); synthetic data only for structural error cases:
- registry: only challenge resources / NASA SVS hosts; Caldwell 73 never treated as Earth data; derivatives keep
  aspect ratio; passthrough only for browser-compatible originals; GEDI and ISS-LIS date conflicts recorded;
  pollutant controls disabled; every colour group is a subset of the signal pixels;
- Night Lights: phases contiguous over 43.33 s; frames 16/148/200/450/700/1000/1050 map to the labels read visually;
  cross-fades carry no observation time;
- ECCO2: model time agrees with all 2001 NASA timestamps within 1 minute;
- extraction: NASA legend swatches classify into the right groups; phase-specific colour meaning; masks; change is
  rate-independent; determinism;
- timeline: out-of-order insertion, duplicate / stale-generation / wrong-source rejection, missing-value lookup,
  bounded capacity;
- mapping: identical output for identical input; velocity/pitch/polyphony bounds; change-phase voices only in
  change phases; silence for missing data and disabled layers; exact Euclidean rhythms;
- clock: anchor math for start/pause/seek/rate; re-anchoring only beyond the drift threshold;
- backend client: validation, bounded retries, no retry on non-retryable errors, timeout, cancellation, per-frame
  rejection of invalid/foreign frames, stale-response rejection, event payload parsing;
- routes: backend not configured (no URL leak), path/method allowlist, server-side token, events path mapping;
  media passthrough refuses unapproved ids/URLs, refuses size mismatch, forwards a single byte range.

Browser E2E (`tests/e2e/jukebox.spec.ts`, real NASA derivatives, real Web Audio):
1. Night Lights decodes (1920×540), canvas `getImageData` works on same-origin media, notes are produced, output
   RMS > 0, drift < 80 ms, never scheduled in the past, observation label matches the verified table, exactly one
   AudioContext, no console errors.
2. Pause stops the video clock and the sound (RMS < 1e-4); keyboard seek moves video to 5.0 ± 0.4 s; restart → 0.
3. Rapid double source switch during playback: audio released (< 1e-3 RMS), timeline contains only the final
   source's frames, one AudioContext.
4. A 1.5 s main-thread stall skips ≥ 4 steps instead of replaying them.
5. Suspending the AudioContext pauses video and sound; Play resumes.
6. GEOS Aerosols still: 192 scan frames, fixed model time label.
7. Keyboard only: select source, play, volume (aria-valuetext "-11 decibels"), mute, K to pause, announcement.
8. Mobile 390×844: no horizontal overflow, play button not covered.
9. Backend path via reference backend: connected badge, feature windows arrive; simulated outage → "reconnecting";
   recovery with out-of-order + duplicate frames → "active", frames deduplicated, playback continues.
10. Events globe from backend: 5 events, selection, keyboard rotation.
11. axe-core WCAG 2.1 A/AA scan: **0 violations** in the NASA view (Listen and Mapping tabs) and the events view.
12. Leaving the NASA view and returning keeps the playback position.

## Measured synchronisation (Chromium 153, headless)

Drift = master clock (Web Audio) vs. decoded NASA video frame times (`requestVideoFrameCallback` +
`getOutputTimestamp`). These are clock measurements inside the browser, not acoustic measurements.

| Run | Mean |drift| | Max |drift| | Frames | Re-anchors | Scheduling lead |
| --- | --- | --- | --- | --- | --- |
| E2E test 1 (production build, final run) | 5.2 ms | 11.5 ms | 179 | 0 | 95–119 ms |
| Earlier E2E runs (dev / production) | 6.0–11.1 ms | 11.9–16.1 ms | 174–178 | 0 | 81–119 ms |

All-sources sweep on the production build (select while previous source plays → play 3 s → +10 s seek → 2.5 s):

| Source | Status after seek | Mean / max drift | Re-anchors | Skipped steps |
| --- | --- | --- | --- | --- |
| 5313 Night Lights | playing | 29.8 / 57.4 ms | 0 | 0 |
| 3912 ECCO2 | playing | 9.4 / 22.6 ms | 0 | 0 |
| 5425 Perpetual Ocean 2 | playing | 12.2 / 18.2 ms | 0 | 0 |
| 5533 Air Quality | playing | 11.3 / 28.1 ms | 0 | 0 |
| 5196 DYAMOND CO₂ | playing | 13.3 / 26.6 ms | 0 | 0 |
| 5011 ISS lightning | playing | 19.2 / 51.9 ms | 0 | 0 |
| 4960 Atmospheric river | playing | 12.7 / 23.7 ms | 0 | 0 |
| 4950 GEDI | playing | 11.9 / 20.8 ms | 0 | 0 |
| 5669 Aerosols (still, no video clock) | playing | n/a | n/a | 0 |

Feature → sound latency in local-analysis mode is bounded by design (≤ 120 ms look-ahead + ≈ 83 ms sample interval);
it was not measured acoustically.

## Console / network

Production, no backend configured: no HTTP errors and no console errors. Warnings observed only from libraries and the
headless GPU: `THREE.Clock: This module has been deprecated` (emitted inside @react-three/fiber 9.8 with three 0.187)
and SwiftShader "GPU stall due to ReadPixels" driver messages. In development, React StrictMode double effects cause
aborted duplicate fetches (expected). Next 16 dev blocks dev resources when the app is opened as `127.0.0.1` instead
of `localhost` (use `localhost`, or add `allowedDevOrigins`).

## Not verified / remaining dependencies

- **Real backend**: not available; only the reference backend implementing the *proposed* contract was tested. The
  events endpoint path and upstream API are unconfirmed. Integration must be re-tested against the teammate's server.
- **Browsers**: Firefox, Safari (macOS/iOS), Edge and real mobile devices untested (H.264 decode, `requestVideoFrameCallback`
  and `getOutputTimestamp` support differ; the code has fallbacks but they were not exercised).
- **Audio perception**: levels, timbre balance and limiter behaviour were checked numerically (RMS, spectrum), not by
  listening tests with users or screen-reader users. A manual screen-reader pass (NVDA/VoiceOver) was not done.
- **Long sessions**: full-length playback of the 5-minute sources and memory over many loops not measured.
- **Challenge Resources tab**: could not be re-fetched from this environment (TLS chain issue); the team's copy was used.
- **Colour groups** are HSL estimates of rendered pixels; blended/overlapping colours are approximate by design and
  labelled image-derived.
