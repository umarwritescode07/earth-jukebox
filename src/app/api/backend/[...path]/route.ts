/**
 * Same-origin proxy to the teammate's backend.
 *
 * - The backend URL (EJB_BACKEND_URL) and optional token (EJB_BACKEND_TOKEN)
 *   are read on the server only; they never reach browser code.
 * - Only the paths of the documented/proposed contract are forwarded.
 * - No CORS configuration is needed on the backend.
 */
const ROUTES: { re: RegExp; methods: string[] }[] = [
  { re: /^events$/, methods: ["GET"] },
  { re: /^v1\/health$/, methods: ["GET"] },
  { re: /^v1\/sources$/, methods: ["GET"] },
  { re: /^v1\/sessions$/, methods: ["POST"] },
  { re: /^v1\/sessions\/[A-Za-z0-9._-]{1,128}$/, methods: ["DELETE"] },
  { re: /^v1\/sessions\/[A-Za-z0-9._-]{1,128}\/features$/, methods: ["GET"] },
];
const TIMEOUT_MS = 8000;
const MAX_BODY = 16 * 1024;

function err(status: number, code: string, message: string, retryable: boolean) {
  return Response.json({ error: { code, message, retryable } }, { status });
}

async function handle(req: Request, segments: string[], method: string): Promise<Response> {
  const base = process.env.EJB_BACKEND_URL?.trim();
  if (!base) return err(503, "backend_not_configured", "EJB_BACKEND_URL is not set on the frontend server.", false);
  const path = segments.join("/");
  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) return err(404, "unknown_backend_path", `Path '${path}' is not part of the backend contract.`, false);
  if (!route.methods.includes(method)) return err(405, "method_not_allowed", `${method} is not allowed for '${path}'.`, false);

  const upstreamPath = path === "events" ? process.env.EJB_EVENTS_PATH?.trim() || "/events" : `/${path}`;
  const target = `${base.replace(/\/+$/, "")}${upstreamPath.startsWith("/") ? "" : "/"}${upstreamPath}${new URL(req.url).search}`;

  const headers: Record<string, string> = { accept: "application/json" };
  const token = process.env.EJB_BACKEND_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (method === "POST") {
    body = await req.text();
    if (body.length > MAX_BODY) return err(413, "body_too_large", "Request body too large.", false);
    headers["content-type"] = "application/json";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body, signal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]), cache: "no-store" });
  } catch {
    return err(502, "backend_unreachable", "The backend did not respond.", true);
  }
  const out = new Headers({ "cache-control": "no-store" });
  const ct = upstream.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

type Ctx = RouteContext<"/api/backend/[...path]">;
export async function GET(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path, "GET");
}
export async function POST(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path, "POST");
}
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path, "DELETE");
}
