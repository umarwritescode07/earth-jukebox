"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { EarthEvent } from "@/contracts/events";
import { parseEarthEvents } from "@/contracts/events";
import { parseOceanTemp, type OceanTempRecord } from "@/contracts/ocean-temp";
import { BackendClient, BackendError } from "@/data/backend-client";
import { SAMPLE_EVENTS_PAYLOAD } from "@/data/fixtures/backend-events-sample";
import { getPageController, type ControllerSnapshot, type PlaybackController } from "@/playback/controller";
import { PreparedMediaSchema, type PreparedMedia } from "@/registry/manifest";

/* ---------------- controller ---------------- */

const noopSubscribe = () => () => {};
let initialSnapshot: ControllerSnapshot | null = null;
function serverSnapshot(): ControllerSnapshot {
  if (!initialSnapshot) {
    initialSnapshot = {
      status: "idle",
      statusDetail: null,
      sourceId: null,
      durationS: 0,
      rate: 1,
      loop: false,
      volumeDb: -10,
      muted: false,
      layers: { pad: true, pulse: true, groups: {} },
      dataMode: "local-nasa-media",
      provider: null,
      error: null,
      audio: "not-started",
      phase: null,
      observation: null,
      hearing: null,
      metrics: { driftSamples: 0, lastDriftMs: null, maxAbsDriftMs: 0, meanAbsDriftMs: 0, corrections: 0, stepsScheduled: 0, skippedSteps: 0, lookAheadMs: 120 },
    };
  }
  return initialSnapshot;
}

export function useController(): { controller: PlaybackController | null; snap: ControllerSnapshot } {
  const controller = useMemo(() => (typeof window === "undefined" ? null : getPageController()), []);
  const snap = useSyncExternalStore(controller ? controller.subscribe : noopSubscribe, controller ? controller.getSnapshot : serverSnapshot, serverSnapshot);
  return { controller, snap };
}

/** Presentation time sampled from the master clock at a limited rate (never drives the clock). */
export function useMediaTime(controller: PlaybackController | null, fps = 8): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!controller) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= 1000 / fps) {
        last = now;
        const v = controller.currentTime();
        setT((prev) => (Math.abs(prev - v) > 1e-3 ? v : prev));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controller, fps]);
  return t;
}

/* ---------------- prepared media ---------------- */

export type PreparedState = { status: "loading" } | { status: "ready"; data: PreparedMedia } | { status: "missing"; message: string };

export function usePreparedMedia(): PreparedState {
  const [state, setState] = useState<PreparedState>({ status: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/media/prepared.json", { signal: ctl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const parsed = PreparedMediaSchema.safeParse(await r.json());
        if (!parsed.success) throw new Error("prepared.json failed validation");
        setState({ status: "ready", data: parsed.data });
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        setState({ status: "missing", message: `No prepared media found (${String(err.message ?? err)}). Run "npm run media:prepare".` });
      });
    return () => ctl.abort();
  }, []);
  return state;
}

/* ---------------- backend health ---------------- */

let configuredPromise: Promise<boolean> | null = null;
/** Whether the server has EJB_BACKEND_URL set (cached per page load). */
export function backendConfigured(): Promise<boolean> {
  configuredPromise ??= fetch("/api/backend-status", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((j: { configured?: unknown }) => j.configured === true)
    .catch(() => false);
  return configuredPromise;
}

export type BackendHealth =
  | { state: "checking" }
  | { state: "connected"; service: string; checkedAt: number }
  | { state: "not-configured" }
  | { state: "unreachable"; message: string; checkedAt: number }
  | { state: "no-feature-api"; message: string; checkedAt: number };

export function useBackendHealth(intervalMs = 20000): { health: BackendHealth; recheck: () => void } {
  const [health, setHealth] = useState<BackendHealth>({ state: "checking" });
  const [nonce, setNonce] = useState(0);
  const client = useMemo(() => new BackendClient({ timeoutMs: 4000, maxRetries: 0 }), []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const ctl = new AbortController();
    const check = async () => {
      if (!(await backendConfigured())) {
        if (!cancelled) setHealth({ state: "not-configured" });
        return;
      }
      try {
        const h = await client.health(ctl.signal);
        if (!cancelled) setHealth({ state: "connected", service: h.service, checkedAt: Date.now() });
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof BackendError ? err : null;
        if (e?.code === "backend_not_configured") setHealth({ state: "not-configured" });
        else if (e && (e.status === 404 || e.code === "invalid_response" || e.code === "invalid_json"))
          setHealth({ state: "no-feature-api", message: e.message, checkedAt: Date.now() });
        else setHealth({ state: "unreachable", message: e?.message ?? String(err), checkedAt: Date.now() });
      }
      if (!cancelled) timer = setTimeout(check, intervalMs);
    };
    void check();
    return () => {
      cancelled = true;
      ctl.abort();
      clearTimeout(timer);
    };
  }, [client, intervalMs, nonce]);
  return { health, recheck: () => setNonce((n) => n + 1) };
}

/* ---------------- event feed ---------------- */

export interface EventFeedState {
  status: "loading" | "backend" | "sample";
  events: EarthEvent[];
  rejected: number;
  /** Why the sample payload is shown (only when status === "sample"). */
  reason: string | null;
  fetchedAt: number | null;
}

export function useEventFeed(refreshMs = 60000): EventFeedState & { refresh: () => void } {
  const [state, setState] = useState<EventFeedState>({ status: "loading", events: [], rejected: 0, reason: null, fetchedAt: null });
  const [nonce, setNonce] = useState(0);
  const client = useMemo(() => new BackendClient({ timeoutMs: 6000, maxRetries: 1 }), []);
  const sample = useRef(parseEarthEvents(SAMPLE_EVENTS_PAYLOAD));
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const ctl = new AbortController();
    const load = async () => {
      if (!(await backendConfigured())) {
        if (!cancelled)
          setState({ status: "sample", events: sample.current.events, rejected: sample.current.rejected, reason: "The backend URL is not configured yet.", fetchedAt: null });
        return;
      }
      try {
        const r = await client.events(ctl.signal);
        if (!cancelled) setState({ status: "backend", events: r.events, rejected: r.rejected, reason: null, fetchedAt: Date.now() });
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof BackendError ? err : null;
        const reason =
          e?.code === "backend_not_configured"
            ? "The backend URL is not configured yet."
            : e?.status === 404
              ? "The backend has no events endpoint at the configured path."
              : `The backend events request failed (${e?.message ?? String(err)}).`;
        setState({ status: "sample", events: sample.current.events, rejected: sample.current.rejected, reason, fetchedAt: null });
      }
      if (!cancelled) timer = setTimeout(load, refreshMs);
    };
    void load();
    return () => {
      cancelled = true;
      ctl.abort();
      clearTimeout(timer);
    };
  }, [client, refreshMs, nonce]);
  return { ...state, refresh: () => setNonce((n) => n + 1) };
}

/* ---------------- accessibility preferences ---------------- */

export interface Preferences {
  reduceMotion: "system" | "on" | "off";
  decorativeAnimation: boolean;
  textSize: "normal" | "large";
  announceChanges: boolean;
  showSpectrum: boolean;
}

const DEFAULT_PREFS: Preferences = { reduceMotion: "system", decorativeAnimation: true, textSize: "normal", announceChanges: true, showSpectrum: true };
const PREFS_KEY = "ejb.preferences.v1";

/** Preferences live in a tiny external store backed by localStorage (per-viewer convenience only). */
const prefListeners = new Set<() => void>();
let prefCache: Preferences | null = null;
function readPrefs(): Preferences {
  if (prefCache) return prefCache;
  let stored: Partial<Preferences> = {};
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Preferences>;
  } catch {
    /* storage unavailable: defaults */
  }
  prefCache = { ...DEFAULT_PREFS, ...stored };
  return prefCache;
}
function writePrefs(p: Partial<Preferences>) {
  prefCache = { ...readPrefs(), ...p };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefCache));
  } catch {
    /* ignore */
  }
  prefListeners.forEach((l) => l());
}
function subscribePrefs(l: () => void) {
  prefListeners.add(l);
  return () => prefListeners.delete(l);
}
function subscribeReducedMotion(l: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", l);
  return () => mq.removeEventListener("change", l);
}

export function usePreferences(): [Preferences, (p: Partial<Preferences>) => void, boolean] {
  const prefs = useSyncExternalStore(subscribePrefs, readPrefs, () => DEFAULT_PREFS);
  const systemReduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.textSize = prefs.textSize;
    if (prefs.reduceMotion === "system") delete html.dataset.reduceMotion;
    else html.dataset.reduceMotion = prefs.reduceMotion === "on" ? "true" : "false";
  }, [prefs]);
  const reducedMotion = prefs.reduceMotion === "on" || (prefs.reduceMotion === "system" && systemReduced);
  return [prefs, writePrefs, reducedMotion];
}

/* ---------------- ocean + temperature series ---------------- */

export interface OceanTempState {
  status: "loading" | "backend" | "sample" | "error";
  records: OceanTempRecord[];
  rejected: number;
  /** Why the sample payload is shown (only when status === "sample"). */
  reason: string | null;
  error: string | null;
}

const FALLBACK_REASONS: Record<string, string> = {
  "backend-not-configured": "The backend URL is not configured yet.",
  "backend-unreachable": "The backend did not respond.",
  "backend-invalid-json": "The backend returned a body that is not JSON.",
  "backend-invalid-payload": "The backend response failed validation.",
};

/** Loads /api/ocean-temp and reports honestly whether the data came from the backend or the sample. */
export function useOceanTempSeries(): OceanTempState & { reload: () => void } {
  const [state, setState] = useState<OceanTempState>({ status: "loading", records: [], rejected: 0, reason: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/ocean-temp", { signal: ctl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const source = r.headers.get("x-ejb-data-source");
        const parsed = parseOceanTemp(await r.json());
        if (parsed.error) throw new Error(parsed.error);
        const reasonCode = r.headers.get("x-ejb-fallback-reason") ?? "";
        setState({
          status: source === "backend" ? "backend" : "sample",
          records: parsed.records,
          rejected: parsed.rejected + parsed.duplicates + Number(r.headers.get("x-ejb-rejected-records") ?? 0),
          reason: source === "backend" ? null : (FALLBACK_REASONS[reasonCode] ?? (reasonCode.startsWith("backend-http-") ? `The backend answered HTTP ${reasonCode.slice(13)} for the ocean/temperature endpoint.` : "Using the sample payload.")),
          error: null,
        });
      })
      .catch((err) => {
        if (!ctl.signal.aborted) setState({ status: "error", records: [], rejected: 0, reason: null, error: String(err?.message ?? err) });
      });
    return () => ctl.abort();
  }, [nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
