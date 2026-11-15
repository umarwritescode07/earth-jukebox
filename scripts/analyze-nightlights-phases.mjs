#!/usr/bin/env node
/**
 * Reproducible frame analysis used to establish the presentation phases of
 * NASA SVS 5313 "Change in Night Lights between 2012 and 2023 - EIC Version".
 *
 * It decodes the approved NASA asset (or its prepared derivative) with ffmpeg
 * at reduced resolution and prints, for every frame:
 *   - purple share  (purple = "more light" in the NASA change view)
 *   - centre-label signature change (the year label / change colour bar sit
 *     at the centre of the 32:9 frame)
 *   - inset share   (bright panel outlines of the zoomed regional views)
 * The resulting change points were then checked by eye against extracted
 * frames before being written into src/registry/sources.ts.
 *
 * Usage: node scripts/analyze-nightlights-phases.mjs [input] > analysis.tsv
 * Default input: public/media/svs/5313/nightlights_eic_1920x540_h264.mp4
 */
import { spawn } from "node:child_process";

const input = process.argv[2] || "public/media/svs/5313/nightlights_eic_1920x540_h264.mp4";
const W = 480;
const H = 135;
const FPS = 30;
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const inArgs = /^https?:/.test(input) && proxy ? ["-http_proxy", proxy, "-i", input] : ["-i", input];

const ff = spawn("ffmpeg", ["-v", "error", ...inArgs, "-vf", `scale=${W}:${H}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
  stdio: ["ignore", "pipe", "inherit"],
});

const frameBytes = W * H * 3;
let buf = Buffer.alloc(0);
let frame = 0;
let prevLabel = null;

function hsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  const d = (max - min) / 255;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
    else if (max === g) h = 60 * ((b - r) / (max - min) + 2);
    else h = 60 * ((r - g) / (max - min) + 4);
  }
  if (h < 0) h += 360;
  return [h, s, l];
}

console.log(["frame", "t", "purple", "warm", "labelDelta", "labelLum", "insetShare"].join("\t"));

function analyse(px) {
  let purple = 0;
  let warm = 0;
  let inset = 0;
  const label = [];
  let labelLum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const [h, s, l] = hsl(r, g, b);
      if (l > 0.12 && s > 0.25 && h >= 255 && h <= 300) purple++;
      if (l > 0.12 && s > 0.25 && h >= 15 && h <= 50) warm++;
      // inset outlines are light-grey, low-saturation, bright pixels
      if (l > 0.6 && s < 0.12) inset++;
    }
  }
  // centre label block: x 45%-55%, y 40%-62%
  const x0 = Math.floor(W * 0.45), x1 = Math.floor(W * 0.55);
  const y0 = Math.floor(H * 0.4), y1 = Math.floor(H * 0.62);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 3;
      const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
      label.push(v);
      labelLum += v;
    }
  }
  labelLum /= label.length;
  let delta = 0;
  if (prevLabel) for (let k = 0; k < label.length; k++) delta += Math.abs(label[k] - prevLabel[k]);
  delta /= label.length;
  prevLabel = label;
  const n = W * H;
  console.log([frame, (frame / FPS).toFixed(3), (purple / n).toFixed(5), (warm / n).toFixed(5), delta.toFixed(2), labelLum.toFixed(2), (inset / n).toFixed(5)].join("\t"));
}

ff.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= frameBytes) {
    analyse(buf.subarray(0, frameBytes));
    buf = buf.subarray(frameBytes);
    frame++;
  }
});
ff.on("close", (code) => process.exit(code ?? 0));
