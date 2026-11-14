"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { EventsView } from "@/components/jukebox/events-view";
import { AppHeader } from "@/components/jukebox/header";
import { SourceLibrary, readinessOf } from "@/components/jukebox/library";
import { ListeningPanel } from "@/components/jukebox/listening-panel";
import { PlaybackBar } from "@/components/jukebox/playback-bar";
import { Stage } from "@/components/jukebox/stage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackendHealth, useController, useEventFeed, usePreferences, usePreparedMedia } from "@/hooks/use-jukebox";
import { getManifestAsset, renditionsFor } from "@/registry/manifest";
import { SOURCES, getSource } from "@/registry/sources";

type View = "nasa" | "events";

export function Jukebox() {
  const { controller, snap } = useController();
  const prepared = usePreparedMedia();
  const { health, recheck } = useBackendHealth();
  const feed = useEventFeed();
  const [prefs, setPrefs, reducedMotion] = usePreferences();
  const [view, setView] = useState<View>("nasa");
  const [announcement, setAnnouncement] = useState("");
  const source = snap.sourceId ? getSource(snap.sourceId) ?? null : null;
  const asset = source?.assetId ? getManifestAsset(source.assetId) ?? null : null;
  const renditions = useMemo(() => (asset ? renditionsFor(asset, prepared.status === "ready" ? prepared.data : null) : []), [asset, prepared]);

  // Select the first ready source once media availability is known.
  useEffect(() => {
    if (!controller || snap.sourceId || prepared.status === "loading") return;
    const first = SOURCES.find((s) => readinessOf(s, prepared).ready) ?? SOURCES[0];
    controller.selectSource(first.id);
  }, [controller, prepared, snap.sourceId]);

  // Leaving the page or unmounting the app stops sound immediately.
  useEffect(() => () => controller?.pause(), [controller]);

  // Polite announcements for meaningful changes only (never per frame), driven by the controller store.
  useEffect(() => {
    if (!controller || !prefs.announceChanges) return;
    const last = { status: "", phase: "", source: "" };
    const onChange = () => {
      const s = controller.getSnapshot();
      const src = s.sourceId ? getSource(s.sourceId) : null;
      const parts: string[] = [];
      if (src && src.id !== last.source) parts.push(`Selected ${src.shortTitle}. Press Play to listen.`);
      last.source = src?.id ?? "";
      if (s.status !== last.status && ["playing", "paused", "ended", "error", "unavailable"].includes(s.status)) {
        parts.push(
          s.status === "playing"
            ? "Sonification playing."
            : s.status === "paused"
              ? `Paused.${s.statusDetail ? ` ${s.statusDetail}` : ""}`
              : s.status === "ended"
                ? "Playback ended."
                : `Problem: ${s.error?.message ?? "media unavailable"}`,
        );
      }
      last.status = s.status;
      const ph = s.phase?.label ?? "";
      if (ph && ph !== last.phase && s.status === "playing") parts.push(`Now: ${ph}.`);
      last.phase = ph;
      if (parts.length) setAnnouncement(parts.join(" "));
    };
    return controller.subscribe(onChange);
  }, [controller, prefs.announceChanges]);

  // Keyboard shortcuts: K play/pause, J/L ±5 s, M mute. Ignored while typing or on sliders.
  useEffect(() => {
    if (!controller) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [role=slider], [role=listbox], [role=application], [contenteditable=true]") || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "k") void controller.togglePlay();
      else if (k === "j") controller.seek(controller.currentTime() - 5);
      else if (k === "l") controller.seek(controller.currentTime() + 5);
      else if (k === "m") controller.setMuted(!controller.getSnapshot().muted);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);

  const selectSource = (id: string) => {
    controller?.selectSource(id);
    setView("nasa");
  };

  const animate = prefs.decorativeAnimation && !reducedMotion;

  return (
    <MotionConfig reducedMotion={animate ? "never" : "always"}>
      <a href="#main" className="sr-only-focusable fixed top-2 left-2 z-50 rounded bg-primary px-3 py-2 text-primary-foreground">
        Skip to player
      </a>
      <AppHeader source={source} prepared={prepared} health={health} dataMode={snap.dataMode} onRecheck={recheck} prefs={prefs} setPrefs={setPrefs} />

      <div className="mx-auto grid max-w-[1800px] gap-4 p-4 lg:grid-cols-[19rem_minmax(0,1fr)_23rem]">
        <nav aria-label="Visualizations" className="order-2 lg:order-1">
          <SourceLibrary selectedId={view === "nasa" ? snap.sourceId : null} prepared={prepared} onSelect={selectSource} />
        </nav>

        <main id="main" tabIndex={-1} className="order-1 min-w-0 space-y-3 focus:outline-none lg:order-2">
          <Tabs
            value={view}
            onValueChange={(v) => {
              if (v === "events") controller?.pause();
              setView(v as View);
            }}
            className="gap-3"
          >
            <TabsList aria-label="Workspace view">
              <TabsTrigger value="nasa">NASA visualizations (sonified)</TabsTrigger>
              <TabsTrigger value="events" data-testid="events-tab">
                Backend events globe
              </TabsTrigger>
            </TabsList>

            {prepared.status === "missing" ? (
              <p role="status" className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-3 text-sm text-amber-100">
                {prepared.message} Sources whose NASA original is already browser-compatible still play through the restricted same-origin route.
              </p>
            ) : null}

            <TabsContent value="nasa" className="space-y-3">
              {source && asset && controller ? (
                <>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={source.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                      <Stage source={source} asset={asset} renditions={renditions} controller={controller} snap={snap} preferences={{ reducedMotion, decorativeAnimation: prefs.decorativeAnimation }} />
                    </motion.div>
                  </AnimatePresence>
                  <PlaybackBar controller={controller} snap={snap} showSpectrum={prefs.showSpectrum} reducedMotion={reducedMotion} />
                </>
              ) : (
                <div className="grid min-h-64 place-items-center rounded-xl border border-border bg-card/70 text-sm text-muted-foreground" role="status">
                  Loading the visualization library…
                </div>
              )}
            </TabsContent>
            <TabsContent value="events">
              <EventsView feed={feed} autoRotate={animate} />
            </TabsContent>
          </Tabs>
        </main>

        <aside aria-label="Listening panel" className="order-3">
          <ListeningPanel source={view === "nasa" ? source : null} snap={snap} controller={controller} health={health} eventsView={view === "events"} />
        </aside>
      </div>

      <footer className="mx-auto max-w-[1800px] px-4 pb-6 text-xs text-muted-foreground">
        Imagery: NASA Scientific Visualization Studio (see each source’s credits). Sound: generated live in your browser with Tone.js from image-derived features; no
        prerecorded music. Built for NASA Space Apps 2026 — Earth Information Jukebox.
      </footer>

      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
        {announcement}
      </div>
    </MotionConfig>
  );
}
