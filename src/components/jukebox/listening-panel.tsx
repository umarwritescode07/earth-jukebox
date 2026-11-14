"use client";

import { Ear } from "lucide-react";

import { allGroups } from "@/analysis/extract";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { percent } from "@/components/jukebox/format";
import type { BackendHealth } from "@/hooks/use-jukebox";
import type { ControllerSnapshot, PlaybackController } from "@/playback/controller";
import type { SourceDefinition } from "@/registry/types";

function OriginBadge({ origin }: { origin: "image-derived" | "numerical-data" }) {
  return (
    <Badge variant="outline" className={origin === "image-derived" ? "border-sky-300/40 text-sky-200" : "border-emerald-300/40 text-emerald-200"}>
      {origin === "image-derived" ? "Image-derived" : "Numerical data"}
    </Badge>
  );
}

function hearingSentences(source: SourceDefinition, snap: ControllerSnapshot): string[] {
  if (snap.status !== "playing" && snap.status !== "buffering") {
    return [
      snap.status === "ended" ? "Playback ended." : "Sound is off. Press Play to start.",
      "Sound is generated live in your browser from features measured on the NASA imagery. No recorded music is used.",
    ];
  }
  const h = snap.hearing;
  if (!h) return ["Starting…"];
  if (h.frameMissing) return ["No feature data for this moment, so the sound is silent. Nothing is invented to fill the gap."];
  const out: string[] = [];
  out.push(`Pad at ${Math.round(h.padGain * 100)}% — ${percent(h.signal)} of the analysed pixels are lit or coloured.`);
  const voiceName = (id: string) => source.analysis?.colorGroupsByPhase && allGroups(source.analysis).find((g) => g.id === id)?.voice;
  for (const g of h.groups) {
    out.push(
      `${g.label}: ${g.sounding ? "sounding" : "quiet"} (${voiceName(g.id) ?? "voice"}; share ${percent(g.share, 2)}${g.lightness !== null ? `, lightness ${g.lightness.toFixed(2)}` : ""}).`,
    );
  }
  if (h.groups.length === 0) out.push("No colour groups are interpreted in this phase (transition between views).");
  out.push(h.activity === null ? "Percussion: no change value yet." : `Percussion density follows frame-to-frame change (${(h.activity * 100).toFixed(0)}%).`);
  if (source.camera.moves) out.push("Note: the camera moves, so some changes you hear come from the camera, not from Earth.");
  return out;
}

export function ListeningPanel({ source, snap, controller, health }: { source: SourceDefinition | null; snap: ControllerSnapshot; controller: PlaybackController | null; health: BackendHealth }) {
  if (!source || !controller) {
    return (
      <section aria-labelledby="listening-heading" className="rounded-xl border border-border bg-card/70 p-4">
        <h2 id="listening-heading" className="text-sm font-semibold">
          What you are hearing
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Choose a visualization from the library.</p>
      </section>
    );
  }
  const groups = source.analysis ? allGroups(source.analysis) : [];
  const activeIds = new Set(snap.hearing?.groups.map((g) => g.id) ?? []);
  const backendUsable = health.state === "connected";

  return (
    <section aria-labelledby="listening-heading" className="flex flex-col rounded-xl border border-border bg-card/70">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Ear aria-hidden="true" className="size-4 text-primary" />
        <h2 id="listening-heading" className="text-sm font-semibold">
          What you are hearing
        </h2>
      </div>
      <Tabs defaultValue="listen" className="p-3">
        <TabsList className="w-full">
          <TabsTrigger value="listen">Listen</TabsTrigger>
          <TabsTrigger value="mapping">Mapping</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>

        <TabsContent value="listen" className="mt-3 space-y-4 text-sm">
          <ul className="space-y-1.5" data-testid="hearing-summary">
            {hearingSentences(source, snap).map((s, i) => (
              <li key={i} className="leading-snug">
                {s}
              </li>
            ))}
          </ul>

          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Sound layers</legend>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="layer-pad">Pad (overall lit/coloured share)</Label>
              <Switch id="layer-pad" checked={snap.layers.pad} onCheckedChange={(v) => controller.setLayer("pad", v)} />
            </div>
            {groups.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2">
                <Label htmlFor={`layer-${g.id}`} className="flex items-center gap-2 font-normal">
                  <span aria-hidden="true" className="inline-block size-3 rounded-sm ring-1 ring-white/20" style={{ background: g.swatch }} />
                  <span>
                    {g.label} <span className="text-muted-foreground">· {g.voice} voice</span>
                    {snap.hearing && !activeIds.has(g.id) ? <span className="block text-xs text-muted-foreground">Not interpreted in the current phase</span> : null}
                  </span>
                </Label>
                <Switch
                  id={`layer-${g.id}`}
                  checked={snap.layers.groups[g.id] !== false}
                  onCheckedChange={(v) => controller.setLayer({ group: g.id }, v)}
                />
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="layer-pulse">Percussion (frame-to-frame change)</Label>
              <Switch id="layer-pulse" checked={snap.layers.pulse} onCheckedChange={(v) => controller.setLayer("pulse", v)} />
            </div>
            {source.disabledControls.map((d) => (
              <div key={d.control} className="flex items-start justify-between gap-2 text-muted-foreground">
                <span>
                  {d.control}
                  <span className="block text-xs">{d.reason}</span>
                </span>
                <Switch checked={false} disabled aria-label={`${d.control} (unavailable)`} />
              </div>
            ))}
          </fieldset>

          <fieldset className="space-y-2 rounded-lg border border-border p-3" data-testid="data-path">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Feature data path</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="data-mode" className="mt-1 accent-[var(--primary)]" checked={snap.dataMode === "local-nasa-media"} onChange={() => controller.setDataMode("local-nasa-media")} />
              <span>
                Local analysis of the NASA media in this browser
                <span className="block text-xs text-muted-foreground">Same feature contract as the backend. Not labelled as backend data.</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 ${backendUsable ? "" : "opacity-60"}`}>
              <input
                type="radio"
                name="data-mode"
                className="mt-1 accent-[var(--primary)]"
                disabled={!backendUsable}
                checked={snap.dataMode === "backend"}
                onChange={() => controller.setDataMode("backend")}
              />
              <span>
                Backend feature stream
                <span className="block text-xs text-muted-foreground">
                  {backendUsable ? "Backend reports a compatible contract." : "Unavailable: the backend does not expose the feature contract yet."}
                </span>
              </span>
            </label>
            {snap.provider ? (
              <p className="text-xs text-muted-foreground" role={snap.provider.state === "error" ? "alert" : undefined}>
                Provider: {snap.provider.state}
                {snap.provider.message ? ` — ${snap.provider.message}` : ""}
              </p>
            ) : null}
          </fieldset>
        </TabsContent>

        <TabsContent value="mapping" className="mt-3 space-y-4 text-sm">
          <table className="w-full border-separate border-spacing-y-1 text-left text-xs">
            <caption className="mb-1 text-left text-muted-foreground">Deterministic feature → sound rules for this source</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="font-medium">
                  Feature
                </th>
                <th scope="col" className="font-medium">
                  Sound
                </th>
              </tr>
            </thead>
            <tbody>
              {source.mapping.map((m) => (
                <tr key={m.feature} className="align-top">
                  <th scope="row" className="pr-2 font-normal">
                    <span className="block">{m.feature}</span>
                    <OriginBadge origin={m.origin} />
                  </th>
                  <td>
                    <span className="block font-medium">{m.sound}</span>
                    <span className="text-muted-foreground">{m.detail}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            Image-derived features describe the rendered pixels (colour, lightness, change), not the physical quantity. Pitch uses a pentatonic scale; loudness is
            capped and passes through a limiter. All rules are fixed, with no randomness.
          </p>
          {source.analysis?.exclude.length ? (
            <div className="text-xs">
              <p className="font-medium">Masked regions (never analysed)</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {source.analysis.exclude.map((r) => (
                  <li key={r.reason}>{r.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="text-xs">
            <p className="font-medium">Colour groups</p>
            <ul className="space-y-1 text-muted-foreground">
              {groups.map((g) => (
                <li key={g.id} className="flex gap-2">
                  <span aria-hidden="true" className="mt-0.5 inline-block size-3 shrink-0 rounded-sm ring-1 ring-white/20" style={{ background: g.swatch }} />
                  <span>
                    <span className="text-foreground">{g.label}</span> — {g.meaning} <span className="italic">({g.evidence})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {source.legend ? (
            <figure className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- NASA legend, display only */}
              <img src={source.legend.url} alt={source.legend.alt} className="w-full rounded bg-white/5 object-contain" loading="lazy" />
              <figcaption className="text-xs text-muted-foreground">NASA legend: {source.legend.description}</figcaption>
            </figure>
          ) : null}
        </TabsContent>

        <TabsContent value="about" className="mt-3 space-y-4 text-sm">
          <p className="leading-relaxed">{source.summary}</p>
          <blockquote className="border-l-2 border-primary/50 pl-3 text-xs leading-relaxed text-muted-foreground">
            “{source.pageDescription}” — NASA SVS {source.svsId}
          </blockquote>
          <div>
            <h3 className="text-xs font-semibold">How to read it</h3>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {source.interpretation.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold">Cautions</h3>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
              {source.cautions.map((x) => (
                <li key={x}>{x}</li>
              ))}
              <li>{source.camera.disclosure}</li>
            </ul>
          </div>
          {source.coverage.conflicts ? (
            <div className="rounded-lg border border-amber-300/30 p-2 text-xs" role="note">
              <p className="font-semibold text-amber-200">NASA metadata conflict (unresolved)</p>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {source.coverage.conflicts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="text-xs">
            <h3 className="font-semibold">Credits (NASA SVS)</h3>
            <dl className="mt-1 space-y-1 text-muted-foreground">
              {source.credits.map((c) => (
                <div key={c.role}>
                  <dt className="inline text-foreground">{c.role}: </dt>
                  <dd className="inline">{c.people.join("; ")}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-muted-foreground">Data: {source.datasets.join(" · ")}</p>
            <p className="mt-1">
              <a className="text-primary underline underline-offset-4" href={source.sourcePage} target="_blank" rel="noreferrer">
                NASA SVS page {source.svsId}
              </a>{" "}
              · published {source.publication.released}
            </p>
          </div>
          <details className="text-xs" data-testid="sync-diagnostics">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Sync diagnostics (measured)</summary>
            <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 font-mono text-[11px]">
              <dt>Look-ahead</dt>
              <dd>{snap.metrics.lookAheadMs} ms</dd>
              <dt>Video-frame drift samples</dt>
              <dd>{snap.metrics.driftSamples}</dd>
              <dt>Mean |drift|</dt>
              <dd>{snap.metrics.meanAbsDriftMs.toFixed(1)} ms</dd>
              <dt>Max |drift|</dt>
              <dd>{snap.metrics.maxAbsDriftMs.toFixed(1)} ms</dd>
              <dt>Clock re-anchors</dt>
              <dd>{snap.metrics.corrections}</dd>
              <dt>Steps scheduled / skipped</dt>
              <dd>
                {snap.metrics.stepsScheduled} / {snap.metrics.skippedSteps}
              </dd>
            </dl>
          </details>
        </TabsContent>
      </Tabs>
    </section>
  );
}
