/**
 * The only module that knows backend URLs, HTTP and wire formats.
 * React components talk to it through providers/hooks and receive internal
 * types (FeatureFrame, EarthEvent) only.
 *
 * The browser always calls the same-origin proxy (/api/backend/...), so the
 * real backend URL and any server-side token never reach browser code.
 */
import { z, type ZodType } from "zod";

import {
  WireErrorSchema,
  WireFeatureWindowSchema,
  WireFrameSchema,
  WireHealthSchema,
  WireSessionSchema,
  mapCapabilities,
  mapWireFrame,
  type WireHealth,
} from "@/contracts/backend-v1";
import { parseEarthEvents, type EarthEvent } from "@/contracts/events";
import type { Capabilities, FeatureFrame } from "@/contracts/frame";

export class BackendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export interface BackendClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BackendSession {
  sessionId: string;
  durationS: number;
  capabilities: Capabilities;
}

export interface FeatureWindow {
  requestId: string;
  frames: FeatureFrame[];
  /** Frames dropped because they failed validation or belonged to another session/source. */
  rejected: number;
  endOfStream: boolean;
}

const WindowEnvelopeSchema = WireFeatureWindowSchema.omit({ frames: true }).extend({ frames: z.array(z.unknown()) });

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}

export class BackendClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BackendClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "/api/backend").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.backoffMs = opts.backoffMs ?? 300;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  /** GET/POST/DELETE with timeout, bounded retries for retryable failures, and response validation. */
  private async request<T>(path: string, init: RequestInit, schema: ZodType<T> | null, signal?: AbortSignal): Promise<T> {
    let lastError: BackendError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) throw signal.reason;
      if (attempt > 0) await sleep(this.backoffMs * 2 ** (attempt - 1), signal);
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: combined, headers: { accept: "application/json", ...(init.headers ?? {}) } });
      } catch (err) {
        if (signal?.aborted) throw signal.reason;
        lastError = isAbort(err)
          ? new BackendError("timeout", `Backend did not answer within ${this.timeoutMs} ms`, true)
          : new BackendError("network", "Backend unreachable (network error)", true);
        continue;
      }
      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* non-JSON error body */
        }
        const parsed = WireErrorSchema.safeParse(body);
        const retryable = parsed.success ? parsed.data.error.retryable : res.status >= 500 || res.status === 429;
        lastError = new BackendError(
          parsed.success ? parsed.data.error.code : `http_${res.status}`,
          parsed.success ? parsed.data.error.message : `Backend responded HTTP ${res.status}`,
          retryable,
          res.status,
        );
        if (!retryable) throw lastError;
        continue;
      }
      if (schema === null) return undefined as T;
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new BackendError("invalid_json", "Backend returned a body that is not JSON", false, res.status);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new BackendError("invalid_response", `Backend response failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, false, res.status);
      }
      return parsed.data;
    }
    throw lastError ?? new BackendError("unknown", "Backend request failed", true);
  }

  health(signal?: AbortSignal): Promise<WireHealth> {
    return this.request("/v1/health", { method: "GET" }, WireHealthSchema, signal);
  }

  async createSession(sourceId: string, assetId: string, signal?: AbortSignal): Promise<BackendSession> {
    const body = JSON.stringify({ source_id: sourceId, asset_id: assetId, client_request_id: crypto.randomUUID() });
    const s = await this.request("/v1/sessions", { method: "POST", body, headers: { "content-type": "application/json" } }, WireSessionSchema, signal);
    if (s.source_id !== sourceId || s.asset_id !== assetId) {
      throw new BackendError("session_mismatch", "Backend opened a session for a different source/asset", false);
    }
    return { sessionId: s.session_id, durationS: s.duration_s, capabilities: mapCapabilities(s.capabilities) };
  }

  async fetchWindow(
    expected: { sessionId: string; sourceId: string; assetId: string },
    fromS: number,
    toS: number,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<FeatureWindow> {
    const q = new URLSearchParams({ from_s: fromS.toFixed(3), to_s: toS.toFixed(3), request_id: requestId });
    // Validate the envelope strictly, but each frame individually so one bad frame cannot poison a window.
    const raw = await this.request(`/v1/sessions/${encodeURIComponent(expected.sessionId)}/features?${q}`, { method: "GET" }, WindowEnvelopeSchema, signal);
    if (raw.request_id !== requestId || raw.session_id !== expected.sessionId) {
      throw new BackendError("stale_response", "Response belongs to a different request or session", false);
    }
    const frames: FeatureFrame[] = [];
    let rejected = 0;
    for (const item of raw.frames) {
      const w = WireFrameSchema.safeParse(item);
      if (!w.success) {
        rejected++;
        continue;
      }
      if (w.data.session_id !== expected.sessionId || w.data.source_id !== expected.sourceId || w.data.asset_id !== expected.assetId) {
        rejected++;
        continue;
      }
      try {
        frames.push(mapWireFrame(w.data));
      } catch {
        rejected++;
      }
    }
    return { requestId, frames, rejected, endOfStream: raw.end_of_stream };
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", keepalive: true }, null);
    } catch {
      /* best effort */
    }
  }

  /** Teammate's event feed: GET /api/backend/events -> JSON array. */
  async events(signal?: AbortSignal): Promise<{ events: EarthEvent[]; rejected: number }> {
    // Envelope accepts any JSON; parseEarthEvents validates each record and counts rejects.
    const raw = await this.request("/events", { method: "GET" }, z.unknown(), signal);
    const parsed = parseEarthEvents(raw);
    if (parsed.error) throw new BackendError("invalid_response", parsed.error, false);
    return { events: parsed.events, rejected: parsed.rejected };
  }
}
