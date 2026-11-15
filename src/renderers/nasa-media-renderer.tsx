"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Rendition } from "@/registry/manifest";

import { stillPort, videoPort } from "@/playback/media-port";
import type { RendererProps, VisualizationRenderer } from "@/renderers/types";

const playableCache = new WeakMap<Rendition[], Rendition[]>();
let probe: HTMLVideoElement | null = null;
/** Renditions this browser reports it can decode (images always pass). Cached per list for useSyncExternalStore. */
function playable(list: Rendition[]): Rendition[] {
  const hit = playableCache.get(list);
  if (hit) return hit;
  probe ??= document.createElement("video");
  const out = list.filter((r) => r.mimeType.startsWith("image/") || probe!.canPlayType(r.mimeType) !== "");
  playableCache.set(list, out);
  return out;
}
const noopSubscribe = () => () => {};

/** Plays the approved NASA video (or shows the still) at its native aspect ratio, uncropped. */
function NasaMediaView({ source, asset, renditions: all, controller }: RendererProps) {
  const renditions = useSyncExternalStore(noopSubscribe, () => playable(all), () => all);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const rendition = renditions[idx];

  // Report "no rendition": not prepared (and no passthrough), or no format this browser can decode.
  useEffect(() => {
    if (all.length === 0) {
      controller.reportMediaUnavailable(
        "media-not-prepared",
        "No same-origin rendition is available for this asset. Run \"npm run media:prepare\" to build it from the approved NASA file.",
        true,
      );
    } else if (renditions.length === 0) {
      controller.reportMediaUnavailable("unsupported-format", `This browser cannot decode ${all.map((r) => r.mimeType).join(" or ")}.`, false);
    }
  }, [all, renditions.length, controller]);

  // Video: attach a MediaPort; fall back to the next rendition on load/decode failure.
  useEffect(() => {
    const video = videoRef.current;
    if (asset.kind !== "video" || !video || !rendition) return;
    const port = videoPort(video);
    const unsub = port.subscribe((e) => {
      if (e.type === "error" && idx + 1 < renditions.length) setIdx(idx + 1);
    });
    controller.attachPort(port);
    return () => {
      unsub();
      controller.attachPort(null);
    };
  }, [asset.kind, rendition, idx, renditions.length, controller]);

  // Still: attach a port whose time is the master clock; draw the scan line from the clock.
  useEffect(() => {
    const img = imgRef.current;
    if (asset.kind !== "image" || !img || !rendition || source.presentation.kind !== "still-scan") return;
    const duration = source.presentation.scanDurationS;
    const port = stillPort(img, duration, () => controller.currentTime());
    controller.attachPort(port);
    let raf = 0;
    const draw = () => {
      if (scanRef.current) scanRef.current.style.left = `${(Math.min(1, controller.currentTime() / duration) * 100).toFixed(3)}%`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      controller.attachPort(null);
    };
  }, [asset.kind, rendition, source, controller]);

  if (!rendition) return null;

  if (asset.kind === "image") {
    return (
      <div className="relative h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- same-origin NASA still; next/image would re-encode it */}
        <img
          ref={imgRef}
          src={rendition.src}
          alt={source.visualDescription}
          className="h-full w-full object-contain"
          draggable={false}
          data-testid="nasa-still"
        />
        <div
          ref={scanRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-primary shadow-[0_0_12px_2px_var(--color-primary)]"
          style={{ left: "0%" }}
        />
      </div>
    );
  }

  return (
    <video
      key={rendition.src}
      ref={videoRef}
      src={rendition.src}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      className="h-full w-full object-contain"
      aria-label={`NASA visualization: ${source.title}. ${source.visualDescription}`}
      data-testid="nasa-video"
      data-rendition={rendition.kind}
    />
  );
}

export const nasaMediaRenderer: VisualizationRenderer = {
  id: "nasa-media",
  label: "NASA media (video / still)",
  supports: () => true,
  Component: NasaMediaView,
};
