/**
 * Tells the browser whether a backend is configured, without revealing its URL.
 * Lets the UI skip backend calls entirely when none is set (no noisy 503s).
 */
export function GET() {
  return Response.json(
    { configured: Boolean(process.env.EJB_BACKEND_URL?.trim()) },
    { headers: { "cache-control": "no-store" } },
  );
}
