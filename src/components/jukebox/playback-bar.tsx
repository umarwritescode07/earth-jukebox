"use client";

import { Pause, Play, Repeat, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { SonificationEngine } from "@/audio/engine";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatClock, spokenDuration } from "@/components/jukebox/format";
import { useMediaTime } from "@/hooks/use-jukebox";
import { cn } from "@/lib/utils";
import type { ControllerSnapshot, PlaybackController } from "@/playback/controller";

function A11ySlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueText: string;
  disabled?: boolean;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  className?: string;
  testId?: string;
}) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-6 w-full touch-none items-center select-none data-disabled:opacity-50", props.className)}
      value={[props.value]}
      min={props.min}
      max={props.max}
      step={props.step}
      disabled={props.disabled}
      onValueChange={(v) => props.onChange(v[0])}
      onValueCommit={(v) => props.onCommit?.(v[0])}
    >
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={props.label}
        aria-valuetext={props.valueText}
        data-testid={props.testId}
        className="block size-4 rounded-full border-2 border-primary bg-background shadow transition-[box-shadow] focus-visible:ring-4 focus-visible:ring-ring/60 focus-visible:outline-none"
      />
    </SliderPrimitive.Root>
  );
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function PlaybackBar({ controller, snap, showSpectrum, reducedMotion }: { controller: PlaybackController; snap: ControllerSnapshot; showSpectrum: boolean; reducedMotion: boolean }) {
  const t = useMediaTime(controller, 8);
  const [dragging, setDragging] = useState<number | null>(null);
  const playing = snap.status === "playing" || snap.status === "buffering";
  const canTransport = !["idle", "loading", "unavailable"].includes(snap.status);
  const duration = snap.durationS;
  const position = dragging ?? t;

  return (
    <section aria-label="Playback controls" className="rounded-xl border border-border bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="lg"
          className="min-w-28"
          onClick={() => void controller.togglePlay()}
          disabled={!canTransport}
          aria-label={playing ? "Pause sonification" : "Play sonification"}
          data-testid="play-toggle"
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing ? "Pause" : snap.status === "ended" ? "Play again" : "Play"}
        </Button>
        <Button variant="outline" size="lg" onClick={() => controller.restart()} disabled={!canTransport} aria-label="Restart from the beginning">
          <RotateCcw aria-hidden="true" />
          <span className="hidden sm:inline">Restart</span>
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-hidden="true">
          {formatClock(position)} / {formatClock(duration)}
        </span>
        <span className="sr-only" role="status" data-testid="playback-status">
          {snap.status}
        </span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs ring-1", playing ? "text-primary ring-primary/40" : "text-muted-foreground ring-border")}>
          {snap.status === "playing"
            ? "Sonifying"
            : snap.status === "buffering"
              ? "Buffering"
              : snap.status === "ended"
                ? "Ended"
                : snap.status === "paused"
                  ? "Paused"
                  : snap.status === "ready"
                    ? "Ready"
                    : snap.status === "loading"
                      ? "Loading"
                      : snap.status === "idle"
                        ? "No source"
                        : "Unavailable"}
        </span>
      </div>

      <div className="mt-3">
        <A11ySlider
          label="Seek position"
          value={Math.min(position, duration || 0)}
          min={0}
          max={Math.max(duration, 0.001)}
          step={0.1}
          valueText={`${spokenDuration(position)} of ${spokenDuration(duration)}`}
          disabled={!canTransport || duration <= 0}
          onChange={(v) => setDragging(v)}
          onCommit={(v) => {
            setDragging(null);
            controller.seek(v);
          }}
          testId="seek-slider"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => controller.setMuted(!snap.muted)}
          aria-pressed={snap.muted}
          aria-label={snap.muted ? "Unmute" : "Mute"}
          data-testid="mute-toggle"
        >
          {snap.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          {snap.muted ? "Muted" : "Sound on"}
        </Button>
        <A11ySlider
          className="w-40 min-w-32 flex-1 sm:flex-none"
          label="Volume"
          value={snap.volumeDb}
          min={-48}
          max={0}
          step={1}
          valueText={`${snap.volumeDb} decibels`}
          onChange={(v) => controller.setVolumeDb(v)}
          testId="volume-slider"
        />
        <div className="flex items-center gap-2">
          <Label htmlFor="rate-select" className="text-xs text-muted-foreground">
            Speed
          </Label>
          <Select value={String(snap.rate)} onValueChange={(v) => controller.setRate(Number(v))} disabled={!canTransport}>
            <SelectTrigger id="rate-select" size="sm" className="w-24" aria-label="Playback speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RATES.map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="loop-switch" checked={snap.loop} onCheckedChange={(v) => controller.setLoop(v)} />
          <Label htmlFor="loop-switch" className="text-xs">
            <Repeat aria-hidden="true" className="size-3.5" /> Loop
          </Label>
        </div>
      </div>
      {showSpectrum ? <OutputSpectrum active={snap.status === "playing" && !snap.muted} reducedMotion={reducedMotion} /> : null}
    </section>
  );
}

/** Draws the FFT of the actual audio output (after the limiter). Nothing is simulated. */
function OutputSpectrum({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [levelText, setLevelText] = useState("No sound");
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let lastDraw = 0;
    let lastText = 0;
    const minInterval = reducedMotion ? 1000 / 12 : 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < minInterval) return;
      lastDraw = now;
      const engine = SonificationEngine.current();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(148,163,184,0.15)";
      ctx.fillRect(0, h - 1, w, 1);
      if (!engine) return;
      const spec = engine.spectrum();
      const bins = Math.min(96, spec.length);
      const bw = w / bins;
      const accent = getComputedStyle(canvas).getPropertyValue("color") || "#2dd4bf";
      ctx.fillStyle = accent;
      for (let i = 0; i < bins; i++) {
        const db = Number.isFinite(spec[i]) ? spec[i] : -140;
        const mag = Math.max(0, Math.min(1, (db + 100) / 80));
        const bh = Math.max(1, mag * (h - 2));
        ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1.5), bh);
      }
      if (now - lastText > 1000) {
        lastText = now;
        const wave = engine.waveform();
        let sum = 0;
        for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
        const rms = Math.sqrt(sum / wave.length);
        setLevelText(rms > 1e-5 ? `Output level ${(20 * Math.log10(rms)).toFixed(0)} dBFS` : "No sound");
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);
  return (
    <div className="mt-3 flex min-w-0 items-center gap-3">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Spectrum of the generated sound, measured from the real audio output"
        className={cn("h-12 min-w-0 flex-1 rounded bg-stage/60 text-primary", !active && "opacity-60")}
        data-testid="output-spectrum"
      />
      <span className="w-24 shrink-0 text-right font-mono text-[11px] leading-tight text-muted-foreground" data-testid="output-level">
        {levelText}
      </span>
    </div>
  );
}
