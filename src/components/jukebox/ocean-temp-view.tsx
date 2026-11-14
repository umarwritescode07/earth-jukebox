"use client";

import { Pause, Play, RotateCcw, Waves } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { OCEAN_MAPPING, type OceanStep } from "@/audio/ocean-mapping";
import { getOceanPlayer, type OceanTempPlayer } from "@/audio/ocean-player";
import { A11ySlider } from "@/components/jukebox/playback-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SAMPLE_OCEAN_TEMP_PROVENANCE } from "@/data/fixtures/ocean-temp-sample";
import type { OceanTempState } from "@/hooks/use-jukebox";
import { cn } from "@/lib/utils";
import type { ControllerSnapshot, PlaybackController } from "@/playback/controller";

/* Series colours: reference palette dark slots 1–2, validated against this app's card surface (dataviz validator: all checks pass). */
const TEMP_COLOR = "#3987e5";
const INTENSITY_COLOR = "#d95926";

const noopSubscribe = () => () => {};
const serverSnap = () => null;

function usePlayer(): OceanTempPlayer | null {
  return useSyncExternalStore(noopSubscribe, getOceanPlayer, serverSnap);
}

function shortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function sentence(s: OceanStep): string {
  const dir = s.semitoneOffset === 0 ? "at" : s.semitoneOffset > 0 ? `${s.semitoneOffset} semitone${s.semitoneOffset === 1 ? "" : "s"} above` : `${-s.semitoneOffset} semitone${s.semitoneOffset === -1 ? "" : "s"} below`;
  return `${s.dateIso}: ${s.temperatureC.toFixed(2)} °C → piano note ${s.noteName} (${dir} the series median${s.clipped ? ", clipped" : ""}). Ocean intensity ${s.oceanIntensity} → waves at ${Math.round(s.waveGain * 100)}%, ${s.swellHz.toFixed(2)} swells per second.`;
}

export function OceanTempView({ series, controller, snap }: { series: OceanTempState & { reload: () => void }; controller: PlaybackController | null; snap: ControllerSnapshot }) {
  const player = usePlayer();
  const o = useSyncExternalStore(player?.subscribe ?? noopSubscribe, player?.getSnapshot ?? serverSnap, serverSnap);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (player && series.records.length) player.setRecords(series.records);
  }, [player, series.records]);
  // Leaving this view stops its sound.
  useEffect(() => () => player?.pause(), [player]);
  useEffect(() => {
    if (!player) return;
    let last = player.getSnapshot().status;
    return player.subscribe(() => {
      const s = player.getSnapshot().status;
      if (s !== last && ["playing", "paused", "ended", "error"].includes(s)) setStatus(s === "playing" ? "Ocean and temperature sonification playing." : s === "paused" ? "Paused." : s === "ended" ? "Reached the last day." : "Audio problem.");
      last = s;
    });
  }, [player]);

  const steps = useMemo(() => (player && o ? player.allSteps() : []), [player, o]);
  const playing = o?.status === "playing";

  return (
    <section aria-labelledby="ocean-heading" className="rounded-xl border border-border bg-card/70">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Waves aria-hidden="true" className="size-4 text-primary" />
        <h2 id="ocean-heading" className="text-sm font-semibold">
          Ocean &amp; temperature series (backend data)
        </h2>
        {series.status === "sample" ? (
          <Badge variant="outline" className="border-amber-400/50 text-amber-200" data-testid="ocean-source">
            Sample backend payload — not live
          </Badge>
        ) : series.status === "backend" ? (
          <Badge variant="outline" className="border-primary/40 text-primary" data-testid="ocean-source">
            From backend
          </Badge>
        ) : (
          <Badge variant="outline" data-testid="ocean-source">
            {series.status === "error" ? "Could not load" : "Loading…"}
          </Badge>
        )}
        <Badge variant="outline" className="border-emerald-300/40 text-emerald-200">
          Numerical data (as supplied)
        </Badge>
      </div>

      <div className="space-y-1 px-3 pt-2 text-xs text-muted-foreground">
        {series.status === "sample" ? (
          <p role="note">
            {series.reason} Showing the sample your backend teammate shared on {SAMPLE_OCEAN_TEMP_PROVENANCE.receivedOn}, validated with the same rules as the real endpoint.
          </p>
        ) : null}
        {series.status === "error" ? (
          <p role="alert">
            {series.error}{" "}
            <Button size="xs" variant="secondary" onClick={series.reload}>
              Retry
            </Button>
          </p>
        ) : null}
        {series.rejected > 0 ? <p>{series.rejected} record(s) failed validation or were duplicates and were dropped (never repaired).</p> : null}
        <p>
          Not yet documented by the backend: {SAMPLE_OCEAN_TEMP_PROVENANCE.undocumented.join(", ")}. This series is not one of the NASA challenge visualizations.
        </p>
      </div>

      {player && o && o.dayCount > 0 ? (
        <div className="space-y-4 p-3">
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="space-y-4">
            <div className="space-y-2" aria-label="Ocean and temperature playback controls" role="group">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="lg" className="min-w-28" onClick={() => void player.toggle()} aria-label={playing ? "Pause ocean and temperature sonification" : "Play ocean and temperature sonification"} data-testid="ocean-play">
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  {playing ? "Pause" : o.status === "ended" ? "Play again" : "Play"}
                </Button>
                <Button variant="outline" size="lg" onClick={() => player.restart()} aria-label="Restart from the first day">
                  <RotateCcw aria-hidden="true" />
                </Button>
                <span className="sr-only" data-testid="ocean-status">
                  {o.status}
                </span>
              </div>
              <A11ySlider
                label="Day position"
                value={Math.max(0, o.dayIndex)}
                min={0}
                max={o.dayCount - 1}
                step={1}
                valueText={`Day ${Math.max(0, o.dayIndex) + 1} of ${o.dayCount}${steps[Math.max(0, o.dayIndex)] ? `, ${steps[Math.max(0, o.dayIndex)].dateIso}` : ""}`}
                onChange={(v) => player.seekDay(v)}
                testId="ocean-day-slider"
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="ocean-spd" className="text-xs text-muted-foreground">
                    Seconds per day
                  </Label>
                  <Select value={String(o.secondsPerDay)} onValueChange={(v) => player.setSecondsPerDay(Number(v))}>
                    <SelectTrigger id="ocean-spd" size="sm" className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0.5, 1, 1.5, 2, 3].map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s} s
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="ocean-loop" checked={o.loop} onCheckedChange={(v) => player.setLoop(v)} />
                  <Label htmlFor="ocean-loop" className="text-xs">
                    Loop
                  </Label>
                </div>
              </div>
              {controller ? (
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" aria-pressed={snap.muted} onClick={() => controller.setMuted(!snap.muted)}>
                    {snap.muted ? "Muted" : "Sound on"}
                  </Button>
                  <A11ySlider className="w-40" label="Volume" value={snap.volumeDb} min={-48} max={0} step={1} valueText={`${snap.volumeDb} decibels`} onChange={(v) => controller.setVolumeDb(v)} />
                </div>
              ) : null}
            </div>

            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Sound layers</legend>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ocean-layer-piano" className="flex items-center gap-2 font-normal">
                  <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: TEMP_COLOR }} />
                  Piano — temperature
                </Label>
                <Switch id="ocean-layer-piano" checked={o.layers.piano} onCheckedChange={(v) => player.setLayer("piano", v)} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ocean-layer-waves" className="flex items-center gap-2 font-normal">
                  <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: INTENSITY_COLOR }} />
                  Waves — ocean intensity
                </Label>
                <Switch id="ocean-layer-waves" checked={o.layers.waves} onCheckedChange={(v) => player.setLayer("waves", v)} />
              </div>
            </fieldset>

            </div>
            <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold">What you are hearing</h3>
              <p className="mt-1 leading-snug" data-testid="ocean-hearing">
                {o.status === "playing" && o.current ? sentence(o.current) : o.status === "ended" ? "Reached the last day. Press Play again to repeat." : "Press Play: one day per beat, generated live from the series."}
              </p>
            </div>

            <div className="text-xs text-muted-foreground">
              <h3 className="font-semibold text-foreground">Mapping rules (deterministic)</h3>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>One day per beat at a fixed tempo, so the time axis stays honest.</li>
                <li>
                  Temperature → piano pitch: +1 semitone per 0.1 °C above the series median ({o.scales.medianTempC.toFixed(3)} °C = C4), clipped at ±
                  {OCEAN_MAPPING.maxSemitones} semitones.
                </li>
                <li>
                  Ocean intensity → wave (pink-noise surf) loudness and swell rate, scaled to this series&apos; range ({o.scales.intensityMin}–{o.scales.intensityMax}), because the
                  unit and scale are not documented.
                </li>
                <li>All sound passes through the shared limiter. The surf is noise as a timbre; note choice is never random.</li>
              </ul>
            </div>
            </div>
          </div>
          <SeriesChart steps={steps} activeIndex={o.status === "playing" || o.status === "paused" || o.status === "ended" ? o.dayIndex : -1} />
          <SeriesTable steps={steps} activeIndex={o.dayIndex} />
        </div>
      ) : (
        <p className="p-3 text-sm text-muted-foreground" role="status">
          {series.status === "loading" ? "Loading series…" : "No valid records to play."}
        </p>
      )}
      <div aria-live="polite" className="sr-only">
        {status}
      </div>
    </section>
  );
}

/* ---------------- chart: two small multiples sharing the date axis (never a dual axis) ---------------- */

function niceExtent(values: number[], minSpan: number): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const mid = (lo + hi) / 2;
  const span = Math.max(minSpan, (hi - lo) * 1.2);
  return [mid - span / 2, mid + span / 2];
}

function SeriesChart({ steps, activeIndex }: { steps: readonly OceanStep[]; activeIndex: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const PAD_L = 44;
  const PAD_R = 12;
  const tempTop = 22;
  const tempH = 110;
  const intTop = tempTop + tempH + 34;
  const intH = 90;
  const H = intTop + intH + 26;
  const n = steps.length;
  const band = (W - PAD_L - PAD_R) / n;
  const x = (i: number) => PAD_L + band * (i + 0.5);
  const [t0, t1] = niceExtent(steps.map((s) => s.temperatureC), 0.5);
  const yT = (v: number) => tempTop + tempH - ((v - t0) / (t1 - t0)) * tempH;
  const iMax = Math.max(...steps.map((s) => s.oceanIntensity)) * 1.15 || 1;
  const yI = (v: number) => intTop + intH - (v / iMax) * intH;
  const tTicks = [t0 + (t1 - t0) * 0.15, (t0 + t1) / 2, t1 - (t1 - t0) * 0.15];
  const iTicks = [0, iMax / 2, iMax * 0.95];
  const shown = hover ?? null;
  const barW = Math.min(18, band * 0.45);

  const linePath = steps.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yT(s.temperatureC).toFixed(1)}`).join(" ");
  const barPath = (i: number, v: number) => {
    const x0 = x(i) - barW / 2;
    const y0 = yI(v);
    const yb = intTop + intH;
    const r = Math.min(4, barW / 2, Math.max(0, yb - y0));
    return `M${x0},${yb} L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} L${x0 + barW - r},${y0} Q${x0 + barW},${y0} ${x0 + barW},${y0 + r} L${x0 + barW},${yb} Z`;
  };

  return (
    <div
      className="relative rounded-lg bg-stage/60 p-2 focus-visible:outline-2 focus-visible:outline-ring"
      tabIndex={0}
      role="group"
      aria-label="Chart of daily temperature and ocean intensity. Use left and right arrow keys to read each day; the table below lists every value."
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
        else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
        else if (e.key === "Escape") setHover(null);
        else return;
        e.preventDefault();
      }}
      onBlur={() => setHover(null)}
      data-testid="ocean-chart"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true">
        {/* playing-day band */}
        {activeIndex >= 0 ? <rect x={PAD_L + band * activeIndex} y={tempTop - 6} width={band} height={intTop + intH - tempTop + 6} className="fill-primary/10" rx={4} /> : null}
        <g className="text-muted-foreground" fill="currentColor" fontSize={11}>
          <text x={PAD_L} y={12} className="fill-foreground" fontWeight={600}>
            Temperature (°C, as supplied)
          </text>
          <text x={PAD_L} y={intTop - 10} className="fill-foreground" fontWeight={600}>
            Ocean intensity (unit not documented)
          </text>
          {tTicks.map((v) => (
            <g key={`t${v}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yT(v)} y2={yT(v)} stroke="currentColor" strokeOpacity={0.15} />
              <text x={PAD_L - 6} y={yT(v) + 4} textAnchor="end">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {iTicks.map((v) => (
            <g key={`i${v}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yI(v)} y2={yI(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.4 : 0.15} />
              <text x={PAD_L - 6} y={yI(v) + 4} textAnchor="end">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {steps.map((s, i) => (
            <text key={s.dateIso} x={x(i)} y={H - 8} textAnchor="middle">
              {shortDate(s.dateIso)}
            </text>
          ))}
        </g>
        <path d={linePath} fill="none" stroke={TEMP_COLOR} strokeWidth={2} strokeLinejoin="round" />
        {steps.map((s, i) => (
          <circle key={s.dateIso} cx={x(i)} cy={yT(s.temperatureC)} r={4} fill={TEMP_COLOR} stroke="var(--color-card)" strokeWidth={2} />
        ))}
        {steps.map((s, i) => (
          <path key={s.dateIso} d={barPath(i, s.oceanIntensity)} fill={INTENSITY_COLOR} />
        ))}
        {/* hit targets larger than the marks */}
        {steps.map((s, i) => (
          <rect
            key={`hit-${s.dateIso}`}
            x={PAD_L + band * i}
            y={tempTop - 6}
            width={band}
            height={intTop + intH - tempTop + 6}
            fill="transparent"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            style={{ pointerEvents: "all" }}
          />
        ))}
        {shown !== null ? <line x1={x(shown)} x2={x(shown)} y1={tempTop - 6} y2={intTop + intH} className="stroke-foreground" strokeOpacity={0.35} strokeWidth={1} /> : null}
      </svg>
      {shown !== null && steps[shown] ? (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow"
          style={{ left: `clamp(0.5rem, calc(${((x(shown) / W) * 100).toFixed(2)}% - 5rem), calc(100% - 11rem))` }}
        >
          <p className="font-medium">{steps[shown].dateIso}</p>
          <p className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded" style={{ background: TEMP_COLOR }} />
            <strong>{steps[shown].temperatureC.toFixed(2)} °C</strong> <span className="text-muted-foreground">temperature → {steps[shown].noteName}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded" style={{ background: INTENSITY_COLOR }} />
            <strong>{steps[shown].oceanIntensity}</strong> <span className="text-muted-foreground">ocean intensity → waves {Math.round(steps[shown].waveGain * 100)}%</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SeriesTable({ steps, activeIndex }: { steps: readonly OceanStep[]; activeIndex: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" data-testid="ocean-table">
        <caption className="mb-1 text-left text-muted-foreground">Every value in the series and the sound it produces</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">
              Date
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Temperature (°C)
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Ocean intensity
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Piano note
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Wave level
            </th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {steps.map((s) => (
            <tr key={s.dateIso} aria-current={s.index === activeIndex ? "true" : undefined} className={cn("border-t border-border", s.index === activeIndex && "bg-primary/10")}>
              <th scope="row" className="py-1 pr-3 font-normal whitespace-nowrap">
                {s.dateIso}
              </th>
              <td className="py-1 pr-3 text-right">{s.temperatureC.toFixed(2)}</td>
              <td className="py-1 pr-3 text-right">{s.oceanIntensity}</td>
              <td className="py-1 pr-3">
                {s.noteName}
                {s.clipped ? " (clipped)" : ""}
              </td>
              <td className="py-1 text-right">{Math.round(s.waveGain * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
