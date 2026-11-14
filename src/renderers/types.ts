/**
 * Replaceable visualization renderers.
 *
 * A renderer receives the shared source definition, the approved asset and
 * its same-origin renditions, the playback controller (for reading the
 * master clock and exposing a MediaPort) and the user's accessibility
 * preferences. It must not talk to the backend adapter or the audio engine.
 *
 * Today: NasaMediaRenderer (video / still). Later: a React Three Fiber
 * renderer can implement the same props without touching data or audio code
 * (see docs/FUTURE_3D.md).
 */
import type { ComponentType } from "react";

import type { PlaybackController } from "@/playback/controller";
import type { ManifestAsset, Rendition } from "@/registry/manifest";
import type { SourceDefinition } from "@/registry/types";

export interface RendererPreferences {
  reducedMotion: boolean;
  decorativeAnimation: boolean;
}

export interface RendererProps {
  source: SourceDefinition;
  asset: ManifestAsset;
  renditions: Rendition[];
  controller: PlaybackController;
  preferences: RendererPreferences;
}

export interface VisualizationRenderer {
  id: string;
  label: string;
  /** Whether this renderer can faithfully present the source (e.g. a globe needs verified georeferencing). */
  supports(source: SourceDefinition, asset: ManifestAsset): boolean;
  Component: ComponentType<RendererProps>;
}
