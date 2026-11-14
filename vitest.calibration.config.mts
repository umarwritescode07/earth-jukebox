import path from "node:path";
import { defineConfig } from "vitest/config";

/** Runs the media calibration (needs prepared media + ffmpeg): npx vitest run --config vitest.calibration.config.ts */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["tests/calibration/**/*.calibration.ts"], environment: "node", testTimeout: 600000 },
});
