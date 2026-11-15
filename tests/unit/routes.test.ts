import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as backendGET, POST as backendPOST } from "@/app/api/backend/[...path]/route";
import { GET as statusGET } from "@/app/api/backend-status/route";
import { GET as mediaGET } from "@/app/api/media/[assetId]/route";

// connection() needs a Next.js request context; outside Next it is a no-op for these handlers.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const ctx = <T,>(params: T) => ({ params: Promise.resolve(params) }) as never;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("backend proxy route", () => {
  it("reports not-configured without leaking anything", async () => {
    vi.stubEnv("EJB_BACKEND_URL", "");
    const res = await backendGET(new Request("http://app/api/backend/v1/health"), ctx({ path: ["v1", "health"] }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("backend_not_configured");
    expect(await (await statusGET()).json()).toEqual({ configured: false });
  });

  it("forwards only contract paths and methods, with the server-side token", async () => {
    vi.stubEnv("EJB_BACKEND_URL", "http://backend.internal/base/");
    vi.stubEnv("EJB_BACKEND_TOKEN", "server-only-secret");
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await backendGET(new Request("http://app/api/backend/admin/users"), ctx({ path: ["admin", "users"] }))).status).toBe(404);
    expect((await backendPOST(new Request("http://app/api/backend/v1/health", { method: "POST" }), ctx({ path: ["v1", "health"] }))).status).toBe(405);
    const ok = await backendGET(new Request("http://app/api/backend/v1/sessions/abc/features?from_s=0&to_s=3"), ctx({ path: ["v1", "sessions", "abc", "features"] }));
    expect(ok.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://backend.internal/base/v1/sessions/abc/features?from_s=0&to_s=3");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer server-only-secret");
  });

  it("maps the events path from EJB_EVENTS_PATH", async () => {
    vi.stubEnv("EJB_BACKEND_URL", "http://backend.internal");
    vi.stubEnv("EJB_EVENTS_PATH", "/api/natural-events");
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await backendGET(new Request("http://app/api/backend/events"), ctx({ path: ["events"] }));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("http://backend.internal/api/natural-events");
  });
});

describe("restricted media passthrough route", () => {
  it("refuses asset ids that are not approved for passthrough", async () => {
    for (const id of ["svs5313-nightlights-eic", "https://evil.example/x.mp4", "../../etc/passwd"]) {
      const res = await mediaGET(new Request(`http://app/api/media/${encodeURIComponent(id)}`), ctx({ assetId: id }));
      expect(res.status).toBe(404);
    }
  });

  it("refuses to serve when NASA's file no longer matches the verified size", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": "1" } })));
    const res = await mediaGET(new Request("http://app/api/media/svs4950-gedi-global-colorbar"), ctx({ assetId: "svs4950-gedi-global-colorbar" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("upstream_changed");
  });

  it("forwards a single byte range from the manifest URL only", async () => {
    const fetchMock = vi.fn(async () => new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/18574070", "content-length": "3" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await mediaGET(new Request("http://app/api/media/svs4950-gedi-global-colorbar", { headers: { range: "bytes=0-2" } }), ctx({ assetId: "svs4950-gedi-global-colorbar" }));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://svs.gsfc.nasa.gov/vis/a000000/a004900/a004950/GEDI_global_w_colorbar_1080p60.mp4");
    const multi = await mediaGET(new Request("http://app/api/media/svs4950-gedi-global-colorbar", { headers: { range: "bytes=0-1,5-6" } }), ctx({ assetId: "svs4950-gedi-global-colorbar" }));
    expect(multi.status).toBe(416);
  });
});
