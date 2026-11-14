# Sonification: mapping, clock and calibration

Label used in the app: **"real-time sonification of NASA imagery"**. The imagery is prerecorded (with the
historical/model coverage stated per source); the sound is generated live in the browser while it plays.

## Pipeline

1. **Pixels** — the NASA frame being presented (`requestVideoFrameCallback`) is drawn into a small canvas
   (256–480 px wide) about 12 times per media second; for the still image, 192 vertical bands are computed once.
2. **Masks** — legends, colour bars, captions and burned-in date stamps are excluded per source
   (`analysis.exclude`). Black space and grey base maps are not "signal" (`analysis.signal`).
3. **Features** (`src/analysis/extract.ts`, all *image-derived*):
   - `signal_share` — fraction of analysed pixels that are coloured or bright;
   - `signal_lightness` — their mean HSL lightness;
   - `group:<id>:share` / `group:<id>:lightness` — per colour group taken from NASA's legend or page text, active only
     in the phases where that colour means something (Night Lights: annual "lights" vs change "purple/orange");
   - `change` — mean absolute luma difference to the previous sample **per presentation second** (rate-independent).
4. **Timeline** — frames are validated (`FeatureFrameSchema`) and stored by presentation time.
5. **Mapping** (`src/audio/mapping.ts`, pure and deterministic) every step of 0.25 presentation s:

| Feature | Sound | Rule |
| --- | --- | --- |
| `signal_share` | Pad loudness | `gain = clamp(share / signalForFullPad)`; ramped over one step |
| `signal_lightness` | Pad brightness | low-pass cutoff 180 Hz + 2200 Hz × lightness |
| `group:*:share` | Voice loudness and rhythm density | velocity `0.25 + 0.6 × clamp(share / shareForFullVelocity)`; 1–4 hits per 8 steps (Euclidean pattern, rotated per group) |
| `group:*:lightness` | Pitch | pentatonic scale over 2 octaves above the source's root, voice register offset (reed 0, glass/pluck +12, bell +24) |
| `change` | Soft percussion density | `k = round(5 × change)` hits per 8 steps (Euclidean) |
| frame missing | Silence | nothing is interpolated or invented; smoothed state decays |

   Each colour group has its own timbre (`voice`): glass (triangle synth), bell (FM), reed (AM), pluck (filtered
   square). Smoothing: exponential, time constant `smoothingS` (0.6 s; 0.35 s for the scan). Polyphony: at most
   2 group voices per step + pad + percussion. No random numbers are used anywhere in note choice or timing.
6. **Engine** (`src/audio/engine.ts`) — voices → gate → master (−10 dB default) → compressor (−24 dB, 3:1) →
   **limiter (−3 dBFS)** → output; FFT and waveform analysers tap the limiter output, so the spectrum and level meter
   show the real sound.

Per-source tables (feature → sound, with origin badges) are in `src/registry/sources.ts` → `mapping` and in the app's
**Mapping** tab.

### Disclosures built into the mapping
- Rotating/zooming cameras (5425, 5196, 5011, 4960, 4950) and sliding panels (5533): the UI says changes may come
  from the camera, not Earth. Night Lights insets and the duplicated EIC map are disclosed as image effects.
- Lightning: percussion follows displayed glow, never one note per strike.
- No numeric temperatures, ppm, AQI, concentrations or canopy heights are produced from colours.

## Calibration (normalisation metadata)

`signalForFullPad`, `shareForFullVelocity` and `changeNormMax` are ≈ the **90th percentile** of each feature measured
on the prepared NASA renditions with `tests/calibration/media.calibration.ts` (same extraction code, 2 samples/s).
Values above the ceiling clip, so loud moments stay bounded. Measured p90 (2026-11-14):

| Source | signal_share p90 | change rate p90 (/s) | Notable group shares (p90) |
| --- | --- | --- | --- |
| 5313 Night Lights | 0.024 | 0.0021 | lights 0.0165, more-light 0.0080, less-light 0.0016 |
| 3912 ECCO2 | 0.41 | 0.017 | cool 0.045, mid 0.086, warm 0.181 |
| 5425 Perpetual Ocean 2 | 0.30 | 0.136 | white 0.009, deep-blue 0.144 |
| 5533 Air Quality | 0.89 | 0.117 | green 0.222, violet 0.179, orange 0.498 |
| 5196 DYAMOND CO₂ | 0.037 | 0.027 | dense 0.015, pale 0.008 |
| 5011 Lightning | 0.0051 | 0.034 | lightning 0.0051 |
| 4960 Atmospheric river | 0.33 | 0.111 | vapour 0.113, white 0.007 |
| 4950 GEDI | 0.38 | 0.037 | short 0.153, tall 0.007 |
| 5669 Aerosols (scan) | 0.34 | 0.160 (per scan-second) | sulfate 0.060, dust 0.056, sea salt 0.010, black carbon 0.006 |

## Master clock and scheduling

- **One clock**: `PlaybackClock` (`src/playback/clock.ts`) maps the Web Audio clock to presentation seconds,
  `pres = anchorPres + (audioTime − anchorAudio) × rate`. Everything reads it: scheduling, UI time, phase/observation
  text, feature lookup. React renders and timers never advance it.
- **Discipline**: the NASA video is the visual truth. On every decoded frame, `requestVideoFrameCallback` gives the
  media time and expected display time; that display time is converted to audible AudioContext time with
  `getOutputTimestamp()` (output latency included). If |drift| > 60 ms the clock re-anchors to the frame.
- **Scheduling**: a worker-driven wake-up (Tone context ticker, every 25 ms) schedules steps whose audio time falls in
  the next **120 ms**, at exact AudioContext times. The wake-up is not the clock.
- **No backlog**: if wake-ups were delayed (background tab, busy main thread), missed steps are counted and skipped.
- **Seek / loop / speed / source switch**: the gate closes (also muting notes already inside the look-ahead window),
  mapping state resets, the clock re-anchors when the video reports `seeked`/`playing`; speed changes rescale the
  anchor without a jump. Source switches reset the timeline generation so late frames are rejected as stale.
- **Buffering**: video `waiting` pauses the clock and silences; `playing` re-anchors to the video time.
- **Suspended AudioContext / external pause**: playback pauses with an explanation; Play resumes.
- **Latency**: local analysis features are taken from frames already presented, so feature → sound latency is
  bounded by the look-ahead (120 ms) plus one sample interval (≈ 83 ms). Backend features are prefetched, so they
  are scheduled exactly at their presentation time.

Measured synchronisation (Chromium 153, headless, see [TESTING.md](TESTING.md)): video-frame vs audio-clock drift
mean 6–32 ms, max ≤ 41 ms across all nine sources, zero re-anchors; scheduling lead 74–119 ms, never in the past.
These are browser measurements of the clock relationship, not acoustic measurements at the speaker.

## Ocean & temperature series (backend numerical data)

Separate from the NASA imagery: daily values supplied by the backend (origin *numerical data*; dataset, location,
which temperature, and the meaning/unit of `ocean_intensity` are not yet documented and the UI says so).
Code: `src/audio/ocean-mapping.ts` (pure rules), `src/audio/ocean-player.ts` (scheduling),
`SonificationEngine.applyOcean` (voices).

| Value | Sound | Rule |
| --- | --- | --- |
| date | Beat | one day per beat, fixed tempo (0.5–3 s per day selectable); tempo never encodes data, so the time axis stays honest |
| `temperature_celsius` | Piano pitch (FM electric piano) | `C4 + round((T − median) × 10)` semitones — +1 semitone per 0.1 °C above the series median, clipped to ±12 (clipping shown in the table) |
| `ocean_intensity` | Surf: pink noise → low-pass 900 Hz → swell LFO | loudness `0.12 + 0.88 × level` and swell `0.12 + 0.38 × level` per second, where `level` = position within the loaded series' min–max (unit/scale undocumented) |

For the sample: median 25.665 °C (C4); 26.04 °C → E4, 25.32 °C → A3; intensity 4.98 → 12 %, 7.71 → 100 %.
Every day's value, note and wave level is listed in the view's data table.

Clock and scheduling follow the same rules as the NASA player: a `PlaybackClock` on the Web Audio time base (unit:
days, rate = 1 / seconds-per-day, so speed changes don't jump), 120 ms look-ahead from the worker wake-up, the first
day is fixed at start (not at the next wake-up), late days are skipped never replayed, heavy voice setup (noise buffer)
happens before the clock starts. The same engine, gate, master volume and limiter are used; starting this player
pauses the NASA controller, and leaving its view pauses it, so only one sonification plays at a time.
