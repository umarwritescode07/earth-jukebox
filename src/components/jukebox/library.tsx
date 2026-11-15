"use client";

import { CheckCircle2, CircleDashed, Library } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PreparedState } from "@/hooks/use-jukebox";
import { getManifestAsset, mediaManifest, renditionsFor } from "@/registry/manifest";
import { METHOD_REFERENCES, SOURCES } from "@/registry/sources";
import type { SourceDefinition } from "@/registry/types";

export type Readiness = { ready: true; via: string } | { ready: false; reason: string };

export function readinessOf(source: SourceDefinition, prepared: PreparedState): Readiness {
  if (source.status !== "playable" || !source.assetId) return { ready: false, reason: "Reference only" };
  const asset = getManifestAsset(source.assetId);
  if (!asset) return { ready: false, reason: "Asset missing from manifest" };
  if (prepared.status === "loading") return { ready: false, reason: "Checking media…" };
  const r = renditionsFor(asset, prepared.status === "ready" ? prepared.data : null);
  if (r.length === 0) return { ready: false, reason: "Media not prepared" };
  return { ready: true, via: r[0].kind === "prepared-derivative" ? "Prepared NASA rendition" : "NASA original (same-origin)" };
}

function coverageShort(s: SourceDefinition): string {
  const d = (x?: string) => x?.slice(0, 10);
  const a = d(s.coverage.start);
  const b = d(s.coverage.end);
  if (s.coverage.conflicts?.length) return "disputed in NASA metadata";
  if (a && b) return `${a} → ${b}`;
  return a ?? "not stated";
}

function thumbFor(source: SourceDefinition, prepared: PreparedState): string | undefined {
  const local = prepared.status === "ready" ? prepared.data.thumbnails[String(source.svsId)] : undefined;
  if (local) return local.path;
  return mediaManifest.thumbnails.find((t) => t.svsId === source.svsId)?.url;
}

export function SourceLibrary({ selectedId, prepared, onSelect }: { selectedId: string | null; prepared: PreparedState; onSelect: (id: string) => void }) {
  return (
    <section aria-labelledby="library-heading" className="flex h-full flex-col rounded-xl border border-border bg-card/70">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Library aria-hidden="true" className="size-4 text-primary" />
        <h2 id="library-heading" className="text-sm font-semibold">
          Visualization library
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">{SOURCES.length} NASA sources</span>
      </div>
      <ul className="flex-1 space-y-1.5 overflow-y-auto p-2 lg:max-h-[calc(100dvh-11rem)]" role="list">
        {SOURCES.map((s) => {
          const r = readinessOf(s, prepared);
          const selected = s.id === selectedId;
          const thumb = thumbFor(s, prepared);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => r.ready && onSelect(s.id)}
                disabled={!r.ready}
                aria-current={selected ? "true" : undefined}
                aria-describedby={`src-${s.id}-meta`}
                data-testid={`source-${s.id}`}
                className={cn(
                  "group flex w-full gap-3 rounded-lg border p-2 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected ? "border-primary/60 bg-primary/10" : "border-transparent hover:border-border hover:bg-muted/50",
                  !r.ready && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-stage ring-1 ring-border">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- NASA preview image (display only)
                    <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug font-medium">{s.shortTitle}</span>
                  <span id={`src-${s.id}-meta`} className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    <span className="block">{s.category}</span>
                    <span className="block">Coverage: {coverageShort(s)}</span>
                    <span className={cn("mt-0.5 inline-flex items-center gap-1", r.ready ? "text-primary" : "text-amber-200")}>
                      {r.ready ? <CheckCircle2 aria-hidden="true" className="size-3" /> : <CircleDashed aria-hidden="true" className="size-3" />}
                      {r.ready ? `Ready · ${r.via}` : r.reason}
                    </span>
                    <span className="sr-only">{selected ? " (selected)" : ""} NASA SVS {s.svsId}.</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {METHOD_REFERENCES.map((m) => (
          <li key={m.svsId} className="rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground">
            <span className="block font-medium text-foreground">{m.title}</span>
            <span className="block">Method reference only — not playable, not Earth data.</span>
            <a className="text-primary underline underline-offset-4" href={m.sourcePage} target="_blank" rel="noreferrer">
              NASA SVS {m.svsId}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
