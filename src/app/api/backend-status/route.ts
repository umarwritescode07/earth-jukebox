import { connection } from "next/server";

/**
 * Tells the browser whether a backend is configured, without revealing its URL.
 * Lets the UI skip backend calls entirely when none is set (no noisy 503s).
 * connection() keeps this per-request: the env var must not be baked in at build time.
 */
export async function GET() {
  await connection();
  return Response.json({ configured: Boolean(process.env.EJB_BACKEND_URL?.trim()) }, { headers: { "cache-control": "no-store" } });
}
