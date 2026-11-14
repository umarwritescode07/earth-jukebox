# Future 3D renderer

## Where it plugs in

`src/renderers/types.ts` defines the replaceable renderer:

```ts
interface RendererProps {
  source: SourceDefinition;      // registry entry: profile, phases, coverage, cautions
  asset: ManifestAsset;          // approved NASA asset + renditions metadata
  renditions: Rendition[];       // same-origin URLs (prepared derivative / passthrough)
  controller: PlaybackController; // read the master clock: controller.currentTime(); expose a MediaPort
  preferences: RendererPreferences; // reducedMotion, decorativeAnimation
}
interface VisualizationRenderer { id; label; supports(source, asset): boolean; Component }
```

A Three.js / React Three Fiber renderer implements the same props. It must:
- read time only from `controller.currentTime()` (never its own clock) and frames from the shared timeline if needed;
- if it shows the NASA media (e.g. as a texture of a *flat* plane), still hand the `<video>` element to
  `controller.attachPort(videoPort(video))` so sound stays synchronized and features keep flowing;
- respect `preferences.reducedMotion` / `decorativeAnimation` (no auto-rotation when either is set);
- leave the backend adapter (`src/data/*`) and audio engine (`src/audio/*`) untouched — they don't know which
  renderer is active.

`supports()` must return `false` unless the projection is known. Only enable geographically meaningful globe
interaction when frames carry **verified** coordinates/projection (`capabilities.hasVerifiedGeoreference`).

## Rules for 3D content

- The challenge resources are **rendered videos/stills**; none supplies downloadable 3D meshes. Do not wrap an
  arbitrary rendered video (e.g. a camera fly-through or a globe render) around a sphere — it is already a
  projection of a 3D scene. The 4960 atmospheric river is a video of a 3D scene, not a model.
- An equirectangular map can be wrapped only if its projection and extent are documented. NASA's Science-on-a-Sphere
  renditions (e.g. 5011 `iss_lightning_sos_yearly_07312023_2048p60.mp4`, 4096×2048) are designed for spheres and
  are the natural candidates — verify their metadata first.
- Blender models (GLB/GLTF) made by the team are presentation assets: credit them, and never present them as data.
- The listening experience must keep working without WebGL (today: list fallback in the events view; NASA media
  renderer needs no WebGL).

## Loading and disposing GLB/GLTF (React Three Fiber)

```tsx
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useEffect } from "react";
import * as THREE from "three";

function Model({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url); // cached + suspends; wrap in <Suspense fallback=…>
  useEffect(
    () => () => {
      // dispose GPU resources when the model leaves the scene
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
            mat.dispose();
          }
        }
      });
      useLoader.clear(GLTFLoader, url); // drop the loader cache entry
    },
    [gltf, url],
  );
  return <primitive object={gltf.scene} />;
}
```

Guidelines: serve `.glb` from `public/models/` (same origin), compress with Draco/Meshopt (add the decoder
explicitly), keep textures ≤ 2048 px, lazy-load the renderer with `next/dynamic({ ssr: false })` like
`src/renderers/event-globe.tsx`, and add `<Suspense>` + an error boundary with a text fallback.

## Existing 3D code

`src/renderers/event-globe.tsx` is a working R3F example: procedural sphere + graticule (no texture), markers at
backend lat/lon, keyboard and pointer rotation, decorative auto-rotation disabled under reduced motion, geometry
disposal on unmount, lazy-loaded so Three.js is not in the main bundle.
