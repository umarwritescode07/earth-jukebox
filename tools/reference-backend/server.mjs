#!/usr/bin/env node
/**
 * Reference backend for the PROPOSED contract "ejb.backend/1" (development & tests).
 *
 * This is NOT the team's backend. It exists so the frontend's backend path can
 * be exercised end to end, and as an executable example of the contract.
 *
 * Data it serves (nothing invented):
 *  - Feature frames: real image-derived features of NASA SVS 5313, computed
 *    offline from the approved asset by tests/calibration/media.calibration.ts
 *    (tests/fixtures/svs5313-features.json).
 *  - Events: the sample payload shared by the backend teammate
 *    (src/data/fixtures/backend-events-sample.json).
 *  - Ocean/temperature series: the teammate's "Clean Ocean Data" sample
 *    (src/data/fixtures/ocean-temp-sample.json), in the agreed format.
 *
 * Usage: node tools/reference-backend/server.mjs [--port 3299]
 * Test controls: POST /__control {"mode":"up"|"down"|"slow"|"shuffle"}
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 3299;
const frames = JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/svs5313-features.json"), "utf8"));
const events = JSON.parse(readFileSync(path.join(ROOT, "src/data/fixtures/backend-events-sample.json"), "utf8"));
const oceanTemp = JSON.parse(readFileSync(path.join(ROOT, "src/data/fixtures/ocean-temp-sample.json"), "utf8"));
const SOURCE = { source_id: "svs-5313", asset_id: "svs5313-nightlights-eic", duration_s: 43.333333 };

let mode = "up"; // up | down | slow | shuffle
const sessions = new Map();

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const err = (res, status, code, message, retryable) => send(res, status, { error: { code, message, retryable } });

function toWire(f, sessionId) {
  return {
    schema_version: f.schemaVersion,
    source_id: f.sourceId,
    asset_id: f.assetId,
    session_id: sessionId,
    frame_id: `${sessionId}:${f.frameId}`,
    sequence: f.sequence,
    presentation_time_s: f.presentationTimeS,
    observation: f.observation,
    phase: f.phase,
    media: { asset_id: f.media.assetId, kind: f.media.kind },
    features: f.features,
    provenance: { svs_id: f.provenance.svsId, source_page: f.provenance.sourcePage, asset_url: f.provenance.assetUrl, extraction: { producer: "backend", method: f.provenance.extraction.method, version: f.provenance.extraction.version } },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let body = "";
  for await (const chunk of req) body += chunk;

  if (url.pathname === "/__control" && req.method === "POST") {
    mode = JSON.parse(body || "{}").mode ?? "up";
    return send(res, 200, { mode });
  }
  if (mode === "down") return err(res, 503, "unavailable", "Reference backend is in 'down' mode", true);
  if (mode === "slow") await new Promise((r) => setTimeout(r, 1500));

  if (req.method === "GET" && url.pathname === "/v1/health") {
    return send(res, 200, { status: "ok", contract_version: "ejb.backend/1", service: "earth-jukebox reference backend", time: new Date().toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/events") return send(res, 200, events);
  if (req.method === "GET" && url.pathname === "/ocean-temp") return send(res, 200, oceanTemp);
  if (req.method === "GET" && url.pathname === "/v1/sources") {
    return send(res, 200, { sources: [{ source_id: SOURCE.source_id, asset_ids: [SOURCE.asset_id], status: "ready" }] });
  }
  if (req.method === "POST" && url.pathname === "/v1/sessions") {
    let reqBody;
    try {
      reqBody = JSON.parse(body);
    } catch {
      return err(res, 400, "invalid_json", "Body must be JSON", false);
    }
    if (reqBody.source_id !== SOURCE.source_id || reqBody.asset_id !== SOURCE.asset_id) {
      return err(res, 404, "source_not_available", "This reference backend only serves svs-5313", false);
    }
    const id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    sessions.set(id, Date.now());
    return send(res, 201, {
      session_id: id,
      ...SOURCE,
      capabilities: { seek: true, rate_change: true, loop: true, feature_rate_hz: 2, separates_pollutants: false, has_verified_georeference: false },
    });
  }
  const m = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9._-]+)(\/features)?$/);
  if (m) {
    const [, id, features] = m;
    if (!sessions.has(id)) return err(res, 404, "unknown_session", "Session not found", false);
    if (req.method === "DELETE" && !features) {
      sessions.delete(id);
      res.writeHead(204).end();
      return;
    }
    if (req.method === "GET" && features) {
      const from = Number(url.searchParams.get("from_s"));
      const to = Number(url.searchParams.get("to_s"));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return err(res, 400, "bad_window", "from_s/to_s invalid", false);
      // include the frame at or before `from` so the client has a value at the window start
      let out = frames.filter((f, i) => (f.presentationTimeS >= from || frames[i + 1]?.presentationTimeS > from) && f.presentationTimeS <= to).map((f) => toWire(f, id));
      if (mode === "shuffle") out = out.reverse().concat(out.slice(0, 2)); // out of order + duplicates
      return send(res, 200, { session_id: id, request_id: url.searchParams.get("request_id") ?? "", from_s: from, to_s: to, frames: out, end_of_stream: to >= SOURCE.duration_s });
    }
  }
  err(res, 404, "not_found", `No route for ${req.method} ${url.pathname}`, false);
});

server.listen(port, "127.0.0.1", () => console.log(`[reference-backend] listening on http://127.0.0.1:${port} (contract ejb.backend/1)`));
