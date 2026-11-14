"use client";

import { AlertTriangle, Loader2, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { formatClock } from "@/components/jukebox/format";
import { useMediaTime } from "@/hooks/use-jukebox";
import type { ControllerSnapshot, PlaybackController } from "@/playback/controller";
import type { ManifestAsset, Rendition } from "@/registry/manifest";
import { nasaMediaRenderer } from "@/renderers/nasa-media-renderer";
import type { RendererPreferences } from "@/renderers/types";
import type { SourceDefinition } from "@/registry/types";

function subscribeFullscreen(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}

export function Stage(props: {
  source: SourceDefinition;
  asset: ManifestAsset;
  renditions: Rendition[];
  controller: PlaybackController;
  snap: ControllerSnapshot;
  preferences: RendererPreferences;
}) {
  const { source, asset, renditions, controller, snap, preferences } = props;
  const frameRef = useRef<HTMLElement>(null);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null && document.fullscreenElement === frameRef.current, () => false);
  const canFullscreen = useSyncExternalStore(subscribeFullscreen, () => Boolean(document.fullscreenEnabled), () => false);
  const [attempt, setAttempt] = useState(0);
  const t = useMediaTime(controller, 4);
  const Renderer = nasaMediaRenderer.Component;
  const w = asset.derivative.width;
  const h = asset.derivative.height;

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await frameRef.current?.requestFullscreen();
  };

  const retry = () => {
    controller.reload();
    setAttempt((a) => a + 1);
  };

  const providerError = snap.provider?.state === "error" ? snap.provider : null;
  const blocking = snap.status === "error" || snap.status === "unavailable" ? snap.error : null;
  const busy = snap.status === "loading" || snap.status === "buffering";
  const obsMapping = source.observationMapping;

  return (
    <figure
      ref={frameRef}
      aria-labelledby="stage-title"
      className="overflow-hidden rounded-xl border border-border bg-card/70 data-[fs=true]:flex data-[fs=true]:flex-col data-[fs=true]:bg-stage"
      data-fs={fullscreen}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 id="stage-title" className="truncate text-sm font-semibold">
            {source.title}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            NASA SVS {source.svsId} · {asset.kind === "image" ? "still image, scanned left → right" : "prerecorded visualization"} · real-time sonification of NASA imagery
          </p>
        </div>
        {canFullscreen ? (
          <Button variant="ghost" size="sm" onClick={toggleFullscreen} aria-pressed={fullscreen}>
            {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            {fullscreen ? "Exit full screen" : "Full screen"}
          </Button>
        ) : null}
      </div>

      <div className="relative bg-stage">
        <div
          className="relative mx-auto"
          style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(${fullscreen ? "86dvh" : "62dvh"} * ${w} / ${h}))` }}
        >
          <Renderer key={`${source.id}-${attempt}`} source={source} asset={asset} renditions={renditions} controller={controller} preferences={preferences} />
        </div>

        {busy ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status">
            <span className="inline-flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs ring-1 ring-border">
              <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
              {snap.status === "loading" ? "Loading NASA media…" : snap.statusDetail ?? "Buffering…"}
            </span>
          </div>
        ) : null}

        {blocking || providerError ? (
          <div className="absolute inset-0 grid place-items-center bg-background/85 p-4" role="alert">
            <div className="max-w-md space-y-3 text-center text-sm">
              <AlertTriangle aria-hidden="true" className="mx-auto size-6 text-amber-300" />
              <p className="font-medium">
                {blocking?.code === "unsupported-format"
                  ? "This browser cannot decode the media format"
                  : blocking?.code === "media-not-prepared"
                    ? "NASA media is not prepared on this server"
                    : providerError
                      ? "Feature extraction stopped"
                      : "The visualization could not be loaded"}
              </p>
              <p className="text-muted-foreground">{blocking?.message ?? providerError?.message}</p>
              {blocking?.code === "media-not-prepared" ? (
                <pre className="rounded bg-muted px-2 py-1 text-left text-xs">npm run media:prepare</pre>
              ) : null}
              <Button size="sm" variant="secondary" onClick={retry}>
                <RotateCcw aria-hidden="true" />
                Retry
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <figcaption className="space-y-1 border-t border-border px-3 py-2 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1" data-testid="stage-readout">
          <span>
            <span className="text-muted-foreground">Playback position </span>
            <span className="font-mono tabular-nums">
              {formatClock(t)} / {formatClock(snap.durationS)}
            </span>
          </span>
          {source.phases.length ? (
            <span>
              <span className="text-muted-foreground">Phase </span>
              <span data-testid="phase-label">{snap.phase?.label ?? "—"}</span>
            </span>
          ) : null}
          <span>
            <span className="text-muted-foreground">{source.presentation.kind === "still-scan" ? "Model time " : "Observation / model time "}</span>
            {snap.observation ? (
              <span data-testid="observation-label">{snap.observation.label}</span>
            ) : (
              <span className="text-muted-foreground" data-testid="observation-label">
                not mapped per frame{obsMapping.type === "none" ? ` (${obsMapping.reason})` : ""} · coverage: {source.coverage.summary}
              </span>
            )}
          </span>
        </div>
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Describe the visual (text alternative)</summary>
          <p className="mt-1 max-w-prose leading-relaxed">{source.visualDescription}</p>
        </details>
      </figcaption>
    </figure>
  );
}
