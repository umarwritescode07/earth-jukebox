/**
 * MediaPort: the controller-facing handle that a visualization renderer
 * exposes for the NASA media it displays. The controller never touches DOM
 * media APIs directly; a future 3D renderer can provide the same port.
 */
export type MediaPortEvent =
  | { type: "ready"; durationS: number }
  | { type: "waiting" }
  | { type: "playing" }
  | { type: "seeked"; timeS: number }
  | { type: "ended" }
  | { type: "external-pause" }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface FrameInfo {
  /** Media (presentation) time of the frame being presented, seconds. */
  mediaTimeS: number;
  /** performance.now()-based time at which the frame is expected to be displayed. */
  expectedDisplayTimeMs: number;
}

export interface MediaPort {
  readonly kind: "video" | "still";
  /** The element whose pixels are analysed (same-origin, so canvas access is allowed). */
  readonly element: HTMLVideoElement | HTMLImageElement;
  durationS(): number;
  mediaTime(): number;
  play(): Promise<void>;
  pause(): void;
  seek(timeS: number): void;
  setRate(rate: number): void;
  /** Per presented frame (video) — requestVideoFrameCallback with rAF fallback. */
  onFrame(cb: (info: FrameInfo) => void): () => void;
  subscribe(cb: (e: MediaPortEvent) => void): () => void;
}

/** Video element → MediaPort. */
export function videoPort(video: HTMLVideoElement): MediaPort {
  const listeners = new Set<(e: MediaPortEvent) => void>();
  const emit = (e: MediaPortEvent) => listeners.forEach((l) => l(e));
  let expectingPause = false;

  const handlers: [keyof HTMLMediaElementEventMap, () => void][] = [
    ["loadedmetadata", () => emit({ type: "ready", durationS: video.duration })],
    ["waiting", () => emit({ type: "waiting" })],
    ["stalled", () => !video.paused && video.readyState < 3 && emit({ type: "waiting" })],
    ["playing", () => emit({ type: "playing" })],
    ["seeked", () => emit({ type: "seeked", timeS: video.currentTime })],
    ["ended", () => emit({ type: "ended" })],
    [
      "pause",
      () => {
        if (expectingPause || video.ended) {
          expectingPause = false;
          return;
        }
        emit({ type: "external-pause" }); // e.g. browser paused a background tab
      },
    ],
    [
      "error",
      () => {
        const err = video.error;
        const code = err?.code === 4 ? "unsupported-format" : err?.code === 2 ? "network" : err?.code === 3 ? "decode" : "media-error";
        emit({ type: "error", code, message: err?.message || "The browser could not load or decode this media.", retryable: code === "network" });
      },
    ],
  ];
  for (const [ev, h] of handlers) video.addEventListener(ev, h);
  if (video.readyState >= 1) queueMicrotask(() => emit({ type: "ready", durationS: video.duration }));

  return {
    kind: "video",
    element: video,
    durationS: () => (Number.isFinite(video.duration) ? video.duration : 0),
    mediaTime: () => video.currentTime,
    play: () => video.play(),
    pause: () => {
      if (!video.paused) {
        expectingPause = true;
        video.pause();
      }
    },
    seek: (t) => {
      video.currentTime = t;
    },
    setRate: (r) => {
      video.playbackRate = r;
    },
    onFrame(cb) {
      let active = true;
      let handle = 0;
      const hasRvfc = typeof video.requestVideoFrameCallback === "function";
      const loopRvfc = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (!active) return;
        cb({ mediaTimeS: meta.mediaTime, expectedDisplayTimeMs: meta.expectedDisplayTime });
        handle = video.requestVideoFrameCallback(loopRvfc);
      };
      const loopRaf = (now: number) => {
        if (!active) return;
        cb({ mediaTimeS: video.currentTime, expectedDisplayTimeMs: now });
        handle = requestAnimationFrame(loopRaf);
      };
      handle = hasRvfc ? video.requestVideoFrameCallback(loopRvfc) : requestAnimationFrame(loopRaf);
      return () => {
        active = false;
        if (hasRvfc) video.cancelVideoFrameCallback(handle);
        else cancelAnimationFrame(handle);
      };
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) for (const [ev, h] of handlers) video.removeEventListener(ev, h);
      };
    },
  };
}

/** Still image → MediaPort. Time is virtual (the scan position), driven by the master clock. */
export function stillPort(img: HTMLImageElement, durationS: number, clockNow: () => number): MediaPort {
  const listeners = new Set<(e: MediaPortEvent) => void>();
  const emit = (e: MediaPortEvent) => listeners.forEach((l) => l(e));
  const onLoad = () => emit({ type: "ready", durationS });
  const onError = () => emit({ type: "error", code: "image-load", message: "The NASA image could not be loaded.", retryable: true });
  img.addEventListener("load", onLoad);
  img.addEventListener("error", onError);
  if (img.complete && img.naturalWidth > 0) queueMicrotask(onLoad);
  return {
    kind: "still",
    element: img,
    durationS: () => durationS,
    mediaTime: clockNow,
    play: () => Promise.resolve(),
    pause: () => {},
    seek: (t) => queueMicrotask(() => emit({ type: "seeked", timeS: t })),
    setRate: () => {},
    onFrame: () => () => {},
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) {
          img.removeEventListener("load", onLoad);
          img.removeEventListener("error", onError);
        }
      };
    },
  };
}
