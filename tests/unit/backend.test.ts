import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { BACKEND_CONTRACT_VERSION, toWireFrame } from "@/contracts/backend-v1";
import { parseEarthEvents } from "@/contracts/events";
import type { FeatureFrame } from "@/contracts/frame";
import { BackendClient, BackendError } from "@/data/backend-client";
import { SAMPLE_EVENTS_PAYLOAD } from "@/data/fixtures/backend-events-sample";

const fixture: FeatureFrame[] = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/svs5313-features.json"), "utf8"));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof BackendClient>[0]> = {}) {
  return new BackendClient({ baseUrl: "http://backend.test", timeoutMs: 200, maxRetries: 2, backoffMs: 1, fetchImpl, ...extra });
}

describe("BackendClient", () => {
  it("validates health responses", async () => {
    const ok = client(vi.fn(async () => json(200, { status: "ok", contract_version: BACKEND_CONTRACT_VERSION, service: "t", time: "2026-11-14T00:00:00Z" })));
    await expect(ok.health()).resolves.toMatchObject({ status: "ok" });
    const bad = client(vi.fn(async () => json(200, { status: "ok" })));
    await expect(bad.health()).rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });

  it("retries retryable failures a bounded number of times", async () => {
    const f = vi.fn(async () => json(503, { error: { code: "busy", message: "busy", retryable: true } }));
    await expect(client(f).health()).rejects.toMatchObject({ code: "busy" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const f = vi.fn(async () => json(400, { error: { code: "bad_request", message: "no", retryable: false } }));
    await expect(client(f).health()).rejects.toBeInstanceOf(BackendError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("times out hung requests and stops when cancelled", async () => {
    const hang = vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))));
    await expect(client(hang as unknown as typeof fetch, { maxRetries: 1 }).health()).rejects.toMatchObject({ code: "timeout" });
    expect(hang).toHaveBeenCalledTimes(2);
    const ctl = new AbortController();
    const p = client(hang as unknown as typeof fetch).health(ctl.signal);
    ctl.abort();
    await expect(p).rejects.toBeDefined();
  });

  it("maps a feature window, dropping invalid and foreign frames, and rejects stale responses", async () => {
    const expected = { sessionId: "s1", sourceId: "svs-5313", assetId: "svs5313-nightlights-eic" };
    const frames = fixture.slice(0, 6).map((f) => toWireFrame({ ...f, sessionId: "s1" }));
    const malformed = { ...frames[0], frame_id: "bad", presentation_time_s: -1 };
    const foreign = { ...frames[1], frame_id: "other", session_id: "s0" };
    const body = { session_id: "s1", request_id: "r1", from_s: 0, to_s: 3, frames: [...frames, malformed, foreign], end_of_stream: false };
    const w = await client(vi.fn(async () => json(200, body))).fetchWindow(expected, 0, 3, "r1");
    expect(w.frames).toHaveLength(6);
    expect(w.rejected).toBe(2);
    expect(w.frames[0].presentationTimeS).toBe(fixture[0].presentationTimeS);
    await expect(client(vi.fn(async () => json(200, { ...body, request_id: "older" }))).fetchWindow(expected, 0, 3, "r1")).rejects.toMatchObject({ code: "stale_response" });
  });

  it("parses the teammate's event payload", async () => {
    const r = await client(vi.fn(async () => json(200, SAMPLE_EVENTS_PAYLOAD))).events();
    expect(r.events).toHaveLength(5);
    expect(r.rejected).toBe(0);
  });
});

describe("event payload validation", () => {
  it("accepts the shared sample exactly and sorts newest first", () => {
    const r = parseEarthEvents(SAMPLE_EVENTS_PAYLOAD);
    expect(r.error).toBeNull();
    expect(r.events.map((e) => e.title)[0]).toBe("Tropical Storm Pena");
    expect(new Set(r.events.map((e) => e.category))).toEqual(new Set(["Wildfires", "Severe Storms"]));
  });

  it("drops invalid records without repairing them", () => {
    const items = SAMPLE_EVENTS_PAYLOAD as unknown[];
    const r = parseEarthEvents([...items, { title: "x", category: "Wildfires", date: "yesterday", latitude: 10, longitude: 10 }, { ...(items[0] as object), latitude: 123 }]);
    expect(r.events).toHaveLength(5);
    expect(r.rejected).toBe(2);
    expect(parseEarthEvents({ not: "an array" }).error).toMatch(/array/);
  });
});
