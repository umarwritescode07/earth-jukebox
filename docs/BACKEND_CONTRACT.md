# Backend integration contract

Status on 2026-11-14:

- The repository contained **no backend code or API documentation** when the frontend was built.
- **Events feed — CONFIRMED format** (sample shared by the backend teammate): a JSON array of
  `{ title, category, date, latitude, longitude }`. Endpoint path not yet known (assumed `/events`, configurable).
- **Ocean & temperature series — CONFIRMED format** (sample shared by the backend teammate): a JSON array of
  `{ date: "YYYYMMDD", temperature_celsius, ocean_intensity }`. Endpoint path not yet known (assumed `/ocean-temp`,
  configurable). The teammate's separate temperature-only list was explicitly marked "do not use" and is not stored.
- **Feature stream — PROPOSED** by the frontend as `ejb.backend/1` (below). Isolated in
  `src/contracts/backend-v1.ts` + `src/data/backend-client.ts`; nothing else depends on the wire format.

A runnable reference implementation of all three lives in `tools/reference-backend/server.mjs` (serves real image-derived
features of SVS 5313, the teammate's sample events and the sample ocean series). It is for development/tests, not production.

## How the browser reaches the backend

```
browser ──► /api/backend/<path>  (Next.js route, same origin)  ──► ${EJB_BACKEND_URL}/<path>
```

- No CORS configuration is needed on the backend: only the Next.js server calls it.
- `EJB_BACKEND_URL`, `EJB_EVENTS_PATH` and `EJB_BACKEND_TOKEN` are **server-only**. The token, if set, is sent as
  `Authorization: Bearer …` by the proxy. No secret is ever bundled into browser code.
- The ocean series has its own route, `GET /api/ocean-temp` (`src/app/api/ocean-temp/route.ts`), described below.
- Only these paths/methods are forwarded by `/api/backend/…` (anything else ⇒ 404/405):
  `GET events`, `GET v1/health`, `GET v1/sources`, `POST v1/sessions`, `DELETE v1/sessions/{id}`,
  `GET v1/sessions/{id}/features`.
- Timeouts: proxy 8 s; client 5 s per request, ≤ 2 retries (exponential backoff) for retryable failures only.
- `GET /api/backend-status` tells the browser `{ "configured": true|false }` without revealing the URL.

## 1. Events feed (confirmed format)

`GET {EJB_BACKEND_URL}{EJB_EVENTS_PATH}` → `200 application/json`

```json
[
  {
    "title": "Wildfire Red Hill, Perry, Mississippi",
    "category": "Wildfires",
    "date": "2026-11-12T00:22:00Z",
    "latitude": 31.130069,
    "longitude": -89.063853
  }
]
```

Validation (`src/contracts/events.ts`): `title`/`category` non-empty strings, `date` ISO-8601 date-time with offset
or `Z`, `latitude` ∈ [-90, 90], `longitude` ∈ [-180, 180] (WGS84 degrees assumed). Invalid records are **dropped and
counted**, never repaired. The frontend derives a stable id from the record (the payload has none).

Questions for the backend team:
1. Which NASA API produces these records? They are **not** among the challenge's visualization resources; the team
   should confirm it is acceptable under the challenge rules before relying on it.
2. Final endpoint path, and whether an `id` field can be added.
3. Should events be sonified? (Today they are visual + list only.)

## 1b. Ocean & temperature series (confirmed format)

Backend: `GET {EJB_BACKEND_URL}{EJB_OCEAN_TEMP_PATH}` (default path `/ocean-temp`) → `200 application/json`

```json
[
  { "date": "20230101", "temperature_celsius": 25.32, "ocean_intensity": 6.2 },
  { "date": "20230102", "temperature_celsius": 25.65, "ocean_intensity": 7.71 }
]
```

Frontend: `GET /api/ocean-temp` returns the **same array format**, plus headers that state where it came from:

| Header | Values |
| --- | --- |
| `x-ejb-data-source` | `backend` (validated backend data) or `sample` (teammate's sample payload) |
| `x-ejb-fallback-reason` | `backend-not-configured`, `backend-unreachable`, `backend-http-<status>`, `backend-invalid-json`, `backend-invalid-payload` |
| `x-ejb-rejected-records` | number of backend records dropped by validation or as duplicate dates |

Validation (`src/contracts/ocean-temp.ts`): `date` must be `YYYYMMDD` and a real calendar date; `temperature_celsius`
a number in [-90, 60] (garbage filter only); `ocean_intensity` a number ≥ 0. Invalid records are dropped and counted;
duplicate dates keep the first; records are sorted by date. Nothing is repaired or interpolated.

Questions for the backend team (shown in the UI as "not yet documented"):
1. Upstream dataset and API — is it one of the challenge resources?
2. Location (point / region) and which temperature this is (sea surface, air, …).
3. Meaning, unit and scale of `ocean_intensity` (today it is scaled relative to the loaded series).
4. Time zone / averaging period of each daily value, and the expected date range.

## 2. Feature stream `ejb.backend/1` (proposed)

Transport: REST JSON with short **windowed pulls**. The NASA media is prerecorded, so the client always knows the
presentation-time window it needs; seeking or switching sources is just a new window request. No WebSocket needed.

All times are **presentation seconds** on the selected NASA asset's own timeline (`presentation_time_s`), not wall
clock and not observation time.

### `GET /v1/health`

```json
{"status":"ok","contract_version":"ejb.backend/1","service":"earth-jukebox reference backend","time":"2026-11-14T09:21:43.239Z"}
```

### `GET /v1/sources`

```json
{"sources":[{"source_id":"svs-5313","asset_ids":["svs5313-nightlights-eic"],"status":"ready"}]}
```

`source_id` / `asset_id` values are the frontend registry ids (`src/registry/sources.ts`,
`src/registry/media-manifest.json`).

### `POST /v1/sessions`

Request:

```json
{"source_id":"svs-5313","asset_id":"svs5313-nightlights-eic","client_request_id":"c0ffee00-0000-4000-8000-000000000001"}
```

Response `201`:

```json
{"session_id":"sess-6iqtqvzc","source_id":"svs-5313","asset_id":"svs5313-nightlights-eic","duration_s":43.333333,
 "capabilities":{"seek":true,"rate_change":true,"loop":true,"feature_rate_hz":2,"separates_pollutants":false,"has_verified_georeference":false}}
```

`separates_pollutants` must be `true` only if the backend really delivers separate pollutant fields;
`has_verified_georeference` only if frames carry verified coordinates and projection. The UI keeps the related
controls disabled otherwise.

### `GET /v1/sessions/{session_id}/features?from_s=&to_s=&request_id=`

Real response from the reference backend (frame trimmed to 4 of its features):

```json
{
  "session_id": "sess-6iqtqvzc",
  "request_id": "req-1",
  "from_s": 12,
  "to_s": 12.6,
  "end_of_stream": false,
  "frames": [
    {
      "schema_version": "ejb.frame/1",
      "source_id": "svs-5313",
      "asset_id": "svs5313-nightlights-eic",
      "session_id": "sess-6iqtqvzc",
      "frame_id": "sess-6iqtqvzc:fixture-24",
      "sequence": 24,
      "presentation_time_s": 12,
      "observation": { "kind": "comparison", "start": "2012", "end": "2023", "label": "Change between 2012 and 2023", "basis": "on-screen-label-verified" },
      "phase": { "id": "change-global", "label": "Change 2012 → 2023 (global map)" },
      "media": { "asset_id": "svs5313-nightlights-eic", "kind": "video" },
      "features": [
        { "id": "signal_share", "label": "Lit / coloured pixel share", "value": 0.00166, "unit": "fraction", "status": "ok", "origin": "image-derived",
          "normalization": { "method": "fraction-of-analysed-pixels", "min": 0, "max": 1 } },
        { "id": "group:lights:share", "label": "Lit areas (annual average) — share", "value": null, "unit": "fraction", "status": "not-applicable", "origin": "image-derived",
          "normalization": { "method": "fraction-of-analysed-pixels", "min": 0, "max": 1 } },
        { "id": "group:more-light:share", "label": "Purple: more light in 2023 — share", "value": 0.00191, "unit": "fraction", "status": "ok", "origin": "image-derived",
          "normalization": { "method": "fraction-of-analysed-pixels", "min": 0, "max": 1 } },
        { "id": "change", "label": "Frame-to-frame change", "value": 0.444, "unit": "normalized", "status": "ok", "origin": "image-derived",
          "normalization": { "method": "fixed-range", "min": 0, "max": 0.002, "note": "Mean absolute luma difference to the previous sample per presentation second, divided by this max (calibrated p90) and clipped to 1." } }
      ],
      "provenance": { "svs_id": 5313, "source_page": "https://svs.gsfc.nasa.gov/5313/",
        "asset_url": "https://svs.gsfc.nasa.gov/vis/a000000/a005300/a005313/nightlights_flat_series_and_change_wZooms_13_EIC_2160p30_h265.mp4",
        "extraction": { "producer": "backend", "method": "hsl-colour-groups+luma-change (offline ffmpeg decode, 2 fps)", "version": "1.0.0" } }
    }
  ]
}
```

Rules:
- `value` is present **iff** `status` is `ok`; `missing` / `masked` / `not-applicable` carry `null`.
- `origin` is `image-derived` for pixel measurements and `numerical-data` only for values decoded from real
  numerical datasets. The UI shows the distinction.
- `observation` is `null` unless the backend can map presentation time to observation/model time reliably;
  `basis` says how (`nasa-frame-table`, `on-screen-label-verified`, `page-stated-coverage`).
- Include the frame at or just before `from_s`, so the client has a value at the start of the window.
- Feature ids the frontend sonifies: `signal_share`, `signal_lightness`, `group:<id>:share`,
  `group:<id>:lightness`, `change` (group ids per source in `src/registry/sources.ts`). Extra features are kept
  and validated but not sonified until mapped.

### `DELETE /v1/sessions/{session_id}` → `204`

### Errors

Any non-2xx: `{"error":{"code":"…","message":"…","retryable":true|false}}`. The client retries only
`retryable` errors (and 5xx/429/timeouts without a body), at most twice per request; the feature provider then
shows "reconnecting" and keeps retrying with backoff (≤ 6 times) before reporting an error.

## What the client guarantees

- Runtime validation of every response with Zod (envelope strictly, frames individually — one bad frame never
  poisons a window).
- Cancellation (AbortController) on seek, source switch, data-mode switch and unmount.
- Stale-response rejection: `request_id` and `session_id` must match; windows from an older timeline generation are
  dropped; frames from another session/source are rejected.
- Duplicate detection by `frame_id`; out-of-order frames are inserted in time order.
- Missing data = silence (never interpolated or invented), shown as "No feature data for this moment".
- Explicit states: not-configured / unreachable / no-feature-api / connected; provider starting / active /
  reconnecting / error. The header never says "Backend connected" while local analysis is used for features
  (the data-path badge says which path is active).

## What the backend teammate must provide

1. A reachable base URL for `EJB_BACKEND_URL` (server-to-server; CORS not required).
2. The events endpoint path (`EJB_EVENTS_PATH`) and confirmation of the upstream NASA API.
3. The ocean/temperature endpoint path (`EJB_OCEAN_TEMP_PATH`) and answers to the four questions in section 1b.
4. Either implement `ejb.backend/1` as above, or send the real contract — only `src/contracts/backend-v1.ts` and
   `src/data/backend-client.ts` need to change.
5. If authentication is needed, a token for `EJB_BACKEND_TOKEN` (kept server-side).
6. For pollutant-specific layers or a geographic globe: genuinely separated pollutant fields and verified
   coordinates/projection, flagged via `capabilities`.
