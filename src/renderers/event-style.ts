/** Marker styles shared by the 3D globe and the accessible list (no Three.js import). */
export type MarkerShape = "octahedron" | "torus" | "sphere";

export const CATEGORY_STYLE: Record<string, { color: string; shape: MarkerShape; label: string }> = {
  Wildfires: { color: "#f59e0b", shape: "octahedron", label: "Wildfires — amber diamond" },
  "Severe Storms": { color: "#38bdf8", shape: "torus", label: "Severe storms — cyan ring" },
};
export const OTHER_STYLE = { color: "#e2e8f0", shape: "sphere" as MarkerShape, label: "Other categories — white dot" };
export const styleFor = (category: string) => CATEGORY_STYLE[category] ?? OTHER_STYLE;
