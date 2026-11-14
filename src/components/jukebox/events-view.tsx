"use client";

import dynamic from "next/dynamic";
import { Globe2, RefreshCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatLatLon, formatUtc } from "@/components/jukebox/format";
import { SAMPLE_EVENTS_PROVENANCE } from "@/data/fixtures/backend-events-sample";
import type { EventFeedState } from "@/hooks/use-jukebox";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, OTHER_STYLE, styleFor } from "@/renderers/event-style";

const EventGlobe = dynamic(() => import("@/renderers/event-globe"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-muted-foreground">Loading 3D globe…</div>,
});

let webglCache: boolean | null = null;
function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const c = document.createElement("canvas");
    webglCache = Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglCache = false;
  }
  return webglCache;
}
const noopSubscribe = () => () => {};

function Shape({ category }: { category: string }) {
  const s = styleFor(category);
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3.5 shrink-0">
      {s.shape === "octahedron" ? (
        <path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z" fill={s.color} />
      ) : s.shape === "torus" ? (
        <circle cx="6" cy="6" r="4" fill="none" stroke={s.color} strokeWidth="2.4" />
      ) : (
        <circle cx="6" cy="6" r="4" fill={s.color} />
      )}
    </svg>
  );
}

export function EventsView({ feed, autoRotate }: { feed: EventFeedState & { refresh: () => void }; autoRotate: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const webgl = useSyncExternalStore<boolean | null>(noopSubscribe, hasWebGL, () => null);
  const selected = feed.events.find((e) => e.id === selectedId) ?? null;
  const categories = [...new Set(feed.events.map((e) => e.category))];

  return (
    <section aria-labelledby="events-heading" className="rounded-xl border border-border bg-card/70">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Globe2 aria-hidden="true" className="size-4 text-primary" />
        <h2 id="events-heading" className="text-sm font-semibold">
          Backend event feed
        </h2>
        {feed.status === "sample" ? (
          <Badge variant="outline" className="border-amber-400/50 text-amber-200" data-testid="events-source">
            Sample backend payload — not live
          </Badge>
        ) : feed.status === "backend" ? (
          <Badge variant="outline" className="border-primary/40 text-primary" data-testid="events-source">
            From backend · fetched {feed.fetchedAt ? new Date(feed.fetchedAt).toISOString().slice(11, 16) : ""} UTC
          </Badge>
        ) : (
          <Badge variant="outline" data-testid="events-source">
            Loading…
          </Badge>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={feed.refresh}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="space-y-1 px-3 pt-2 text-xs text-muted-foreground">
        {feed.status === "sample" ? (
          <p role="note">
            {feed.reason} Showing the sample payload your backend teammate shared on {SAMPLE_EVENTS_PROVENANCE.receivedOn}, validated with the same schema as the real
            endpoint. Upstream NASA API: {SAMPLE_EVENTS_PROVENANCE.upstreamApi.toLowerCase()}. These events are not among the challenge visualization resources and are not
            sonified.
          </p>
        ) : null}
        {feed.rejected > 0 ? <p>{feed.rejected} record(s) failed validation and were dropped (never repaired).</p> : null}
        <p id="globe-help">
          Markers use the latitude/longitude sent by the backend. The globe has no basemap imagery (only a 30° grid; the brighter lines are the equator and prime
          meridian). Drag or use arrow keys to rotate.
        </p>
      </div>

      <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <div className="relative aspect-square max-h-[62dvh] w-full rounded-lg bg-stage">
          {webgl === false ? (
            <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
              WebGL is not available in this browser, so the 3D globe is hidden. The event list contains the same information.
            </div>
          ) : webgl ? (
            <EventGlobe events={feed.events} selectedId={selectedId} onSelect={setSelectedId} autoRotate={autoRotate} describedBy="globe-help" />
          ) : null}
        </div>

        <div className="space-y-3">
          <ul aria-label="Legend" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {[...Object.entries(CATEGORY_STYLE), ...(categories.some((c) => !CATEGORY_STYLE[c]) ? [["Other", OTHER_STYLE] as const] : [])].map(([name, s]) => (
              <li key={name} className="flex items-center gap-1.5">
                <Shape category={name} />
                {s.label}
              </li>
            ))}
          </ul>
          <ol className="max-h-[50dvh] space-y-1.5 overflow-y-auto" aria-label="Events">
            {feed.events.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  aria-pressed={e.id === selectedId}
                  onClick={() => setSelectedId(e.id === selectedId ? null : e.id)}
                  className={cn(
                    "flex w-full gap-2 rounded-lg border p-2 text-left text-xs transition-colors",
                    e.id === selectedId ? "border-primary/60 bg-primary/10" : "border-border hover:bg-muted/50",
                  )}
                >
                  <Shape category={e.category} />
                  <span className="min-w-0">
                    <span className="block text-sm leading-snug font-medium">{e.title}</span>
                    <span className="block text-muted-foreground">
                      {e.category} · {formatUtc(e.dateIso)}
                    </span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{formatLatLon(e.latitude, e.longitude)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {selected ? (
            <p className="text-xs" aria-live="polite">
              Selected: <span className="font-medium">{selected.title}</span> ({selected.category}, {formatLatLon(selected.latitude, selected.longitude)})
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
