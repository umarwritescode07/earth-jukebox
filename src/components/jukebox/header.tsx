"use client";

import { Info, Settings2, Waves } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DataMode } from "@/data/feature-providers";
import type { BackendHealth, Preferences, PreparedState } from "@/hooks/use-jukebox";
import { getManifestAsset } from "@/registry/manifest";
import { EIC_COLLECTION_URL, METHOD_REFERENCES } from "@/registry/sources";
import type { SourceDefinition } from "@/registry/types";

function backendBadge(health: BackendHealth, mode: DataMode) {
  switch (health.state) {
    case "checking":
      return { text: "Backend: checking…", tone: "muted" as const };
    case "connected":
      return { text: `Backend connected${mode === "backend" ? " · features from backend" : ""}`, tone: "ok" as const };
    case "not-configured":
      return { text: "Backend not configured", tone: "muted" as const };
    case "no-feature-api":
      return { text: "Backend reachable · no feature API", tone: "warn" as const };
    case "unreachable":
      return { text: "Backend unreachable", tone: "warn" as const };
  }
}

export function AppHeader(props: {
  source: SourceDefinition | null;
  prepared: PreparedState;
  health: BackendHealth;
  dataMode: DataMode;
  onRecheck: () => void;
  prefs: Preferences;
  setPrefs: (p: Partial<Preferences>) => void;
}) {
  const { source, prepared, health, dataMode, onRecheck, prefs, setPrefs } = props;
  const badge = backendBadge(health, dataMode);
  return (
    <header className="border-b border-border bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/40">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <Waves className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">Earth Information Jukebox</h1>
            <p className="truncate text-xs text-muted-foreground">Listen to a changing planet · real-time sonification of NASA imagery</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={
              badge.tone === "ok"
                ? "border-primary/40 text-primary"
                : badge.tone === "warn"
                  ? "border-amber-400/40 text-amber-200"
                  : "text-muted-foreground"
            }
            data-testid="backend-status"
          >
            <span aria-hidden="true" className={`mr-1 inline-block size-1.5 rounded-full ${badge.tone === "ok" ? "bg-primary" : badge.tone === "warn" ? "bg-amber-300" : "bg-muted-foreground"}`} />
            {badge.text}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground" data-testid="data-mode">
            {dataMode === "backend" ? "Data: backend features" : "Data: local NASA media analysis"}
          </Badge>
          <SourceInfoDialog source={source} prepared={prepared} health={health} onRecheck={onRecheck} />
          <SettingsDialog prefs={prefs} setPrefs={setPrefs} />
        </div>
      </div>
    </header>
  );
}

function SourceInfoDialog({ source, prepared, health, onRecheck }: { source: SourceDefinition | null; prepared: PreparedState; health: BackendHealth; onRecheck: () => void }) {
  const asset = source?.assetId ? getManifestAsset(source.assetId) : undefined;
  const prep = asset && prepared.status === "ready" ? prepared.data.assets[asset.assetId] : undefined;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Info aria-hidden="true" />
          Source info
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Source and provenance</DialogTitle>
          <DialogDescription>Where the sound and pictures come from, and what was done to the media.</DialogDescription>
        </DialogHeader>
        {source && asset ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">NASA SVS ID</dt>
            <dd>{source.svsId}</dd>
            <dt className="text-muted-foreground">Title</dt>
            <dd>{source.title}</dd>
            <dt className="text-muted-foreground">Source page</dt>
            <dd>
              <a className="text-primary underline underline-offset-4" href={source.sourcePage} target="_blank" rel="noreferrer">
                {source.sourcePage}
              </a>
            </dd>
            <dt className="text-muted-foreground">Original asset</dt>
            <dd className="break-all">
              <a className="text-primary underline underline-offset-4" href={asset.original.url} target="_blank" rel="noreferrer">
                {asset.original.url.split("/").pop()}
              </a>{" "}
              <span className="text-muted-foreground">
                ({asset.original.videoCodec ?? asset.original.imageFormat}, {asset.original.width}×{asset.original.height}
                {asset.original.frameRate ? `, ${asset.original.frameRate} fps` : ""}
                {asset.original.durationS ? `, ${asset.original.durationS.toFixed(1)} s` : ""}, {(asset.original.bytes / 1048576).toFixed(1)} MiB)
              </span>
            </dd>
            <dt className="text-muted-foreground">Delivered as</dt>
            <dd>
              {prep ? (
                <>
                  Prepared {asset.derivative.transform}: {prep.probe.width}×{prep.probe.height} {prep.probe.videoCodec ?? "image"}
                  {prep.probe.frameCount ? `, ${prep.probe.frameCount} frames` : ""}. {asset.derivative.description}
                  <span className="mt-1 block font-mono text-xs break-all text-muted-foreground">sha256 {prep.sha256}</span>
                </>
              ) : asset.passthrough ? (
                <>Restricted same-origin passthrough of the unchanged NASA file. {asset.passthrough.description}</>
              ) : (
                <>Not prepared yet — run <code>npm run media:prepare</code>.</>
              )}
            </dd>
            <dt className="text-muted-foreground">Published</dt>
            <dd>
              {source.publication.released}
              {source.publication.updated && source.publication.updated !== source.publication.released ? ` (updated ${source.publication.updated})` : ""}
            </dd>
            <dt className="text-muted-foreground">Data coverage</dt>
            <dd>{source.coverage.summary}</dd>
            <dt className="text-muted-foreground">Collection</dt>
            <dd>
              Space Apps 2026 “Earth Information Jukebox” resource list ·{" "}
              <a className="text-primary underline underline-offset-4" href={EIC_COLLECTION_URL} target="_blank" rel="noreferrer">
                NASA Earth Information Center collection
              </a>
            </dd>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Select a visualization to see its provenance.</p>
        )}
        <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">Backend connection</p>
          <p className="text-muted-foreground">
            {health.state === "connected"
              ? `Connected to ${health.service}.`
              : health.state === "not-configured"
                ? "No backend URL is configured. The app uses local analysis of the NASA media in your browser; nothing is labelled as backend data."
                : health.state === "checking"
                  ? "Checking…"
                  : health.message}
          </p>
          <Button size="sm" variant="secondary" onClick={onRecheck}>
            Check again
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Method reference</p>
          {METHOD_REFERENCES.map((m) => (
            <p key={m.svsId}>
              <a className="text-primary underline underline-offset-4" href={m.sourcePage} target="_blank" rel="noreferrer">
                {m.title}
              </a>{" "}
              — {m.note}
            </p>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ prefs, setPrefs }: { prefs: Preferences; setPrefs: (p: Partial<Preferences>) => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 aria-hidden="true" />
          Accessibility
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Accessibility settings</DialogTitle>
          <DialogDescription>Saved in this browser only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pref-motion">Reduce motion</Label>
            <Select value={prefs.reduceMotion} onValueChange={(v) => setPrefs({ reduceMotion: v as Preferences["reduceMotion"] })}>
              <SelectTrigger id="pref-motion" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">Follow system setting</SelectItem>
                <SelectItem value="on">Always reduce</SelectItem>
                <SelectItem value="off">Allow motion</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pref-deco">Decorative animation</Label>
            <Switch id="pref-deco" checked={prefs.decorativeAnimation} onCheckedChange={(v) => setPrefs({ decorativeAnimation: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pref-spectrum">Show audio spectrum</Label>
            <Switch id="pref-spectrum" checked={prefs.showSpectrum} onCheckedChange={(v) => setPrefs({ showSpectrum: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pref-text">Larger text</Label>
            <Switch id="pref-text" checked={prefs.textSize === "large"} onCheckedChange={(v) => setPrefs({ textSize: v ? "large" : "normal" })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pref-announce">Announce phase and status changes</Label>
            <Switch id="pref-announce" checked={prefs.announceChanges} onCheckedChange={(v) => setPrefs({ announceChanges: v })} />
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-1 font-medium">Keyboard shortcuts (when focus is not in a text field)</p>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              <li>
                <kbd>K</kbd> play / pause
              </li>
              <li>
                <kbd>J</kbd> / <kbd>L</kbd> back / forward 5 seconds
              </li>
              <li>
                <kbd>M</kbd> mute / unmute
              </li>
              <li>All controls are also reachable with Tab and operable with Enter, Space and arrow keys.</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
