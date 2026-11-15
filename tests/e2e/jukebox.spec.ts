import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const AXE = readFileSync(path.resolve(__dirname, "../../node_modules/axe-core/axe.min.js"), "utf8");
async function axeViolations(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
  });
}

const BACKEND = `http://127.0.0.1:${process.env.E2E_BACKEND_PORT ?? 3299}`;

type Diag = {
  metrics: { driftSamples: number; meanAbsDriftMs: number; maxAbsDriftMs: number; corrections: number; stepsScheduled: number; skippedSteps: number };
  timeline: { inserted: number; stale: number; duplicates: number; wrongSource: number; outOfOrder: number; size: number };
  engine: { notes: number; pulses: number; outputRms: number; audioState: string; leadTimesS: number[] } | null;
  provider: { mode: string; windows?: number; rejectedFrames?: number } | null;
  sourceId: string | null;
  timelineSources: string[];
};

const diag = (page: Page) => page.evaluate(() => (window as unknown as { __ejbDiagnostics: () => unknown }).__ejbDiagnostics() as Diag);
const status = (page: Page) => page.getByTestId("playback-status");

async function countAudioContexts(page: Page) {
  await page.addInitScript(() => {
    const W = window as unknown as { __audioContexts: number; AudioContext: typeof AudioContext };
    W.__audioContexts = 0;
    const Orig = W.AudioContext;
    W.AudioContext = class extends Orig {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        W.__audioContexts++;
        (window as unknown as { __lastAudioContext: AudioContext }).__lastAudioContext = this;
      }
    } as typeof AudioContext;
  });
}

async function open(page: Page, sourceId = "svs-5313") {
  await page.goto("/");
  await page.getByTestId(`source-${sourceId}`).click();
  await expect(status(page)).toHaveText(/ready|paused/);
}

test.beforeEach(async ({ request }) => {
  await request.post(`${BACKEND}/__control`, { data: { mode: "up" } });
});

test("Night Lights: NASA media decodes, pixels are sampled, sound is generated and synchronized", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await countAudioContexts(page);
  await open(page);
  const video = page.getByTestId("nasa-video");
  await expect(video).toHaveAttribute("data-rendition", "prepared-derivative");
  expect(await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight])).toEqual([1920, 540]);

  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(6000);
  const d = await diag(page);
  expect(d.timeline.inserted).toBeGreaterThan(30); // canvas getImageData succeeded on same-origin media
  expect(d.metrics.stepsScheduled).toBeGreaterThan(15);
  expect(d.engine!.notes).toBeGreaterThan(0);
  expect(d.engine!.outputRms).toBeGreaterThan(0);
  expect(d.metrics.driftSamples).toBeGreaterThan(50);
  expect(d.metrics.maxAbsDriftMs).toBeLessThan(80);
  expect(Math.min(...d.engine!.leadTimesS)).toBeGreaterThanOrEqual(0); // never scheduled in the past
  await expect(page.getByTestId("observation-label")).toHaveText(/Annual average 20(1\d|2[0-3])|Change between 2012 and 2023/);
  info.annotations.push({
    type: "sync",
    description: `drift mean ${d.metrics.meanAbsDriftMs.toFixed(1)} ms, max ${d.metrics.maxAbsDriftMs.toFixed(1)} ms over ${d.metrics.driftSamples} frames; re-anchors ${d.metrics.corrections}; lead ${Math.min(...d.engine!.leadTimesS).toFixed(3)}–${Math.max(...d.engine!.leadTimesS).toFixed(3)} s`,
  });
  console.log("[sync]", info.annotations.at(-1)!.description);
  expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(1);
  expect(errors).toEqual([]);
});

test("pause stops sound and the clock; restart and seek move both video and clock", async ({ page }) => {
  await open(page);
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(2500);
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("paused");
  await page.waitForTimeout(400);
  const t1 = await page.getByTestId("nasa-video").evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(800);
  const t2 = await page.getByTestId("nasa-video").evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(t2).toBeCloseTo(t1, 3);
  expect((await diag(page)).engine!.outputRms).toBeLessThan(1e-4);

  // keyboard seek on the slider: End then 10 × PageDown? use Home + ArrowRight
  const seek = page.getByTestId("seek-slider");
  await seek.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 50; i++) await page.keyboard.press("ArrowRight"); // 50 × 0.1 s
  await page.waitForTimeout(500);
  const vt = await page.getByTestId("nasa-video").evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(vt).toBeGreaterThan(4.6);
  expect(vt).toBeLessThan(5.4);
  await expect(seek).toHaveAttribute("aria-valuetext", /seconds of/);

  await page.getByRole("button", { name: "Restart from the beginning" }).click();
  await page.waitForTimeout(400);
  expect(await page.getByTestId("nasa-video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(0.2);
});

test("switching sources while loading/playing releases audio and never mixes frames", async ({ page }) => {
  await countAudioContexts(page);
  await open(page, "svs-3912");
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(1500);
  // switch twice quickly: the first switch's media/frames are still pending when the second happens
  await page.getByTestId("source-svs-5425").click();
  await page.getByTestId("source-svs-4950").click();
  await page.waitForTimeout(300);
  let d = await diag(page);
  expect(d.sourceId).toBe("svs-4950");
  expect(d.engine!.outputRms).toBeLessThan(1e-3);
  await expect(status(page)).toHaveText(/ready|paused/);
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(2000);
  d = await diag(page);
  expect(d.timelineSources).toEqual(["svs-4950"]);
  expect(d.timeline.wrongSource).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(1);
});

test("a stalled main thread (like a background tab) skips the backlog instead of replaying it", async ({ page }) => {
  await open(page, "svs-3912");
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(1500);
  const before = await diag(page);
  await page.evaluate(() => {
    const end = performance.now() + 1500;
    while (performance.now() < end) {
      /* block the main thread: scheduler wake-ups cannot run */
    }
  });
  await page.waitForTimeout(300);
  const after = await diag(page);
  // ~6 steps of 0.25 s were missed; they are skipped, not scheduled late in a burst
  expect(after.metrics.skippedSteps - before.metrics.skippedSteps).toBeGreaterThanOrEqual(4);
  expect(after.metrics.stepsScheduled - before.metrics.stepsScheduled).toBeLessThanOrEqual(4);
  expect(Math.min(...after.engine!.leadTimesS)).toBeGreaterThanOrEqual(0);
});

test("a suspended AudioContext pauses playback cleanly and Play resumes it", async ({ page }) => {
  await countAudioContexts(page);
  await open(page, "svs-5313");
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(1000);
  await page.evaluate(() => (window as unknown as { __lastAudioContext: AudioContext }).__lastAudioContext.suspend());
  await expect(status(page)).toHaveText("paused");
  expect(await page.getByTestId("nasa-video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(1);
});

test("still image (GEOS Aerosols) is scanned with a fixed model time", async ({ page }) => {
  await open(page, "svs-5669");
  await expect(page.getByTestId("nasa-still")).toBeVisible();
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(2000);
  const d = await diag(page);
  expect(d.timeline.inserted).toBe(192);
  expect(d.metrics.stepsScheduled).toBeGreaterThan(5);
  await expect(page.getByTestId("observation-label")).toHaveText(/19 Aug 2025 20:00 UTC/);
});

test("keyboard-only: choose a source, play, mute, change volume, pause", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("source-svs-5313")).toBeEnabled();
  await page.getByTestId("source-svs-3912").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("source-svs-3912")).toHaveAttribute("aria-current", "true");
  await expect(status(page)).toHaveText(/ready|paused/);
  await page.getByTestId("play-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("playing");
  await page.getByTestId("volume-slider").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("volume-slider")).toHaveAttribute("aria-valuetext", "-11 decibels");
  await page.getByTestId("mute-toggle").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("mute-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator("body").focus();
  await page.keyboard.press("k");
  await expect(status(page)).toHaveText("paused");
  await expect(page.getByTestId("announcer")).not.toBeEmpty();
});

test("mobile layout has no horizontal overflow and an unobstructed play button", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(status(page)).toHaveText(/ready|paused/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const btn = page.getByTestId("play-toggle");
  await btn.scrollIntoViewIfNeeded();
  const box = (await btn.boundingBox())!;
  const topEl = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid"), [box.x + box.width / 2, box.y + box.height / 2]);
  expect(topEl).toBe("play-toggle");
  await page.screenshot({ path: "test-results/mobile.png", fullPage: false });
  await page.getByTestId("ocean-tab").click();
  await expect(page.getByTestId("ocean-table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // the wrapped view tabs must not overlap the panel below them
  const tabs = (await page.getByTestId("view-tabs").boundingBox())!;
  const heading = (await page.locator("#ocean-heading").boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
  await page.screenshot({ path: "test-results/mobile-ocean.png", fullPage: true });
  await ctx.close();
});

test("backend path: connects, streams real features, survives an outage and recovers", async ({ page, request }) => {
  await open(page, "svs-5313");
  await expect(page.getByTestId("backend-status")).toHaveText(/Backend connected/);
  await page.getByLabel(/Backend feature stream/).check();
  await expect(page.getByTestId("data-mode")).toHaveText(/backend features/);
  await page.getByTestId("play-toggle").click();
  await expect(status(page)).toHaveText("playing");
  await page.waitForTimeout(2500);
  let d = await diag(page);
  expect(d.provider!.mode).toBe("backend");
  expect(d.provider!.windows).toBeGreaterThan(0);
  expect(d.timeline.inserted).toBeGreaterThan(3);

  await request.post(`${BACKEND}/__control`, { data: { mode: "down" } });
  await page.getByRole("tab", { name: "Listen" }).click();
  await expect(page.getByText(/Provider: reconnecting/)).toBeVisible({ timeout: 15000 });
  await request.post(`${BACKEND}/__control`, { data: { mode: "shuffle" } }); // back up, but out-of-order + duplicates
  await expect(page.getByText(/Provider: active/)).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
  d = await diag(page);
  expect(d.timeline.duplicates + d.timeline.outOfOrder).toBeGreaterThan(0);
  expect(d.timelineSources).toEqual(["svs-5313"]);
  await expect(status(page)).toHaveText("playing");
});

test("events globe shows backend events with an accessible list", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("events-tab").click();
  await expect(page.getByTestId("events-source")).toHaveText(/From backend/);
  const items = page.getByRole("list", { name: "Events" }).getByRole("button");
  await expect(items).toHaveCount(5);
  await items.first().click();
  await expect(items.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("event-globe")).toBeVisible();
  await page.getByTestId("event-globe").focus();
  await page.keyboard.press("ArrowLeft");
});

test("automated WCAG 2.1 AA scan (axe-core) finds no violations in either view", async ({ page }) => {
  await open(page, "svs-5313");
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("tab", { name: "Mapping" }).click();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByTestId("events-tab").click();
  await expect(page.getByTestId("events-source")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByTestId("ocean-tab").click();
  await expect(page.getByTestId("ocean-table")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("returning from the events view keeps the playback position", async ({ page }) => {
  await open(page, "svs-3912");
  await page.getByTestId("seek-slider").focus();
  for (let i = 0; i < 80; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  await page.getByTestId("events-tab").click();
  await page.getByRole("tab", { name: "NASA visualizations (sonified)" }).click();
  await expect(status(page)).toHaveText(/ready|paused/);
  await page.waitForTimeout(800);
  const t = await page.getByTestId("nasa-video").evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(t).toBeGreaterThan(7.5);
});

type OceanDiag = { status: string; dayIndex: number; stepsScheduled: number; skippedSteps: number; engine: { notes: number; outputRms: number; leadTimesS: number[] } | null };
const oceanDiag = (page: Page) => page.evaluate(() => (window as unknown as { __ejbOceanDiagnostics: () => unknown }).__ejbOceanDiagnostics() as OceanDiag);

test("ocean & temperature series: backend data is sonified day by day and stops cleanly", async ({ page }) => {
  await countAudioContexts(page);
  await open(page, "svs-3912");
  await page.getByTestId("play-toggle").click(); // NASA playing first
  await expect(status(page)).toHaveText("playing");
  await page.getByTestId("ocean-tab").click();
  await expect(page.getByTestId("ocean-source")).toHaveText("From backend");
  await expect(page.getByTestId("ocean-table").locator("tbody tr")).toHaveCount(10);
  await page.getByTestId("ocean-play").click();
  await expect(page.getByTestId("ocean-status")).toHaveText("playing");
  await page.waitForTimeout(2600); // 1 s per day
  let d = await oceanDiag(page);
  expect(d.stepsScheduled).toBeGreaterThanOrEqual(3);
  expect(d.skippedSteps).toBe(0);
  expect(d.engine!.notes).toBeGreaterThan(0);
  expect(d.engine!.outputRms).toBeGreaterThan(0);
  expect(Math.min(...d.engine!.leadTimesS)).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId("ocean-hearing")).toHaveText(/°C → piano note [A-G]/);
  await expect(page.getByTestId("ocean-table").locator('tr[aria-current="true"]')).toHaveCount(1);
  // only one sonification at a time, one AudioContext
  expect((await diag(page)).sourceId).toBe("svs-3912");
  expect(await page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(1);

  await page.getByTestId("ocean-play").click();
  await expect(page.getByTestId("ocean-status")).toHaveText("paused");
  await page.waitForTimeout(400);
  d = await oceanDiag(page);
  expect(d.engine!.outputRms).toBeLessThan(1e-4);

  // chart is readable with the keyboard
  await page.getByTestId("ocean-chart").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ocean-chart").getByRole("status")).toContainText("2023-01-01");
});

test("ocean series falls back to the labelled sample when the backend is down", async ({ page, request }) => {
  await request.post(`${BACKEND}/__control`, { data: { mode: "down" } });
  await page.goto("/");
  await page.getByTestId("ocean-tab").click();
  await expect(page.getByTestId("ocean-source")).toHaveText("Sample backend payload — not live");
  await expect(page.getByText(/backend answered HTTP 503/)).toBeVisible();
  await expect(page.getByTestId("ocean-table").locator("tbody tr")).toHaveCount(10);
});
