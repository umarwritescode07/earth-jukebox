import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as oceanGET } from "@/app/api/ocean-temp/route";
import { OCEAN_MAPPING, decideOceanStep, midiToName, oceanScales } from "@/audio/ocean-mapping";
import { parseOceanTemp } from "@/contracts/ocean-temp";
import { SAMPLE_OCEAN_TEMP_PAYLOAD } from "@/data/fixtures/ocean-temp-sample";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sample = parseOceanTemp(SAMPLE_OCEAN_TEMP_PAYLOAD);

describe("ocean/temperature contract", () => {
  it("accepts the teammate's sample exactly (10 days, sorted, no rejects)", () => {
    expect(sample.error).toBeNull();
    expect(sample.rejected).toBe(0);
    expect(sample.records).toHaveLength(10);
    expect(sample.records[0]).toEqual({ dateIso: "2023-01-01", temperatureC: 25.32, oceanIntensity: 6.2 });
    expect(sample.records.at(-1)!.dateIso).toBe("2023-01-10");
  });

  it("does not contain the excluded temperature-only list", () => {
    expect(sample.records.some((r) => r.temperatureC < 20)).toBe(false);
  });

  it("drops invalid records and duplicate dates without repairing them", () => {
    const items = SAMPLE_OCEAN_TEMP_PAYLOAD as object[];
    const r = parseOceanTemp([
      ...items,
      { date: "20230230", temperature_celsius: 25, ocean_intensity: 6 }, // not a real date
      { date: "2023-01-11", temperature_celsius: 25, ocean_intensity: 6 }, // wrong format
      { date: "20230111", temperature_celsius: "25", ocean_intensity: 6 }, // string number
      { date: "20230112", temperature_celsius: 25, ocean_intensity: -1 }, // negative intensity
      { ...items[0], temperature_celsius: 99 }, // duplicate date (and out of bounds)
      { ...items[1] }, // exact duplicate date
    ]);
    expect(r.records).toHaveLength(10);
    expect(r.rejected).toBe(5);
    expect(r.duplicates).toBe(1);
    expect(parseOceanTemp({}).error).toMatch(/array/);
  });
});

describe("ocean/temperature sonification mapping", () => {
  const scales = oceanScales(sample.records);
  const steps = sample.records.map((r, i) => decideOceanStep(r, i, scales));

  it("raises pitch with temperature (monotonic) at 1 semitone per 0.1 °C around the median", () => {
    expect(scales.medianTempC).toBeCloseTo((25.65 + 25.68) / 2, 9); // median of the 10 sample values
    const byTemp = [...steps].sort((a, b) => a.temperatureC - b.temperatureC);
    for (let i = 1; i < byTemp.length; i++) expect(byTemp[i].midi).toBeGreaterThanOrEqual(byTemp[i - 1].midi);
    const warmest = steps.find((s) => s.temperatureC === 26.04)!;
    expect(warmest.semitoneOffset).toBe(Math.round((26.04 - scales.medianTempC) * OCEAN_MAPPING.semitonesPerDegree));
    expect(warmest.noteName).toBe(midiToName(60 + warmest.semitoneOffset));
    expect(steps.every((s) => !s.clipped)).toBe(true);
  });

  it("maps ocean intensity to wave loudness and swell rate within bounds", () => {
    const byInt = [...steps].sort((a, b) => a.oceanIntensity - b.oceanIntensity);
    for (let i = 1; i < byInt.length; i++) {
      expect(byInt[i].waveGain).toBeGreaterThanOrEqual(byInt[i - 1].waveGain);
      expect(byInt[i].swellHz).toBeGreaterThanOrEqual(byInt[i - 1].swellHz);
    }
    expect(byInt[0].waveGain).toBeCloseTo(OCEAN_MAPPING.waveGainMin);
    expect(byInt.at(-1)!.waveGain).toBeCloseTo(OCEAN_MAPPING.waveGainMax);
  });

  it("clips extreme temperatures and handles a flat intensity series", () => {
    const s = oceanScales([{ dateIso: "2023-01-01", temperatureC: 20, oceanIntensity: 3 }, { dateIso: "2023-01-02", temperatureC: 30, oceanIntensity: 3 }]);
    const hot = decideOceanStep({ dateIso: "2023-01-02", temperatureC: 30, oceanIntensity: 3 }, 1, s);
    expect(hot.semitoneOffset).toBe(12);
    expect(hot.clipped).toBe(true);
    expect(hot.waveLevel).toBe(0.5);
    expect(midiToName(60)).toBe("C4");
  });

  it("is deterministic", () => {
    expect(sample.records.map((r, i) => decideOceanStep(r, i, oceanScales(sample.records)))).toEqual(steps);
  });
});

describe("GET /api/ocean-temp", () => {
  it("serves the labelled sample when the backend is not configured", async () => {
    vi.stubEnv("EJB_BACKEND_URL", "");
    const res = await oceanGET();
    expect(res.headers.get("x-ejb-data-source")).toBe("sample");
    expect(res.headers.get("x-ejb-fallback-reason")).toBe("backend-not-configured");
    const body = await res.json();
    expect(body).toHaveLength(10);
    expect(body[0]).toEqual({ date: "20230101", temperature_celsius: 25.32, ocean_intensity: 6.2 });
  });

  it("returns validated backend data with the server-side token and path", async () => {
    vi.stubEnv("EJB_BACKEND_URL", "http://backend.internal/");
    vi.stubEnv("EJB_OCEAN_TEMP_PATH", "/api/ocean");
    vi.stubEnv("EJB_BACKEND_TOKEN", "server-only");
    const payload = [{ date: "20240101", temperature_celsius: 24.5, ocean_intensity: 6.2 }, { date: "bad", temperature_celsius: 1, ocean_intensity: 1 }];
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);
    const res = await oceanGET();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://backend.internal/api/ocean");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer server-only");
    expect(res.headers.get("x-ejb-data-source")).toBe("backend");
    expect(res.headers.get("x-ejb-rejected-records")).toBe("1");
    expect(await res.json()).toEqual([{ date: "20240101", temperature_celsius: 24.5, ocean_intensity: 6.2 }]);
  });

  it("falls back to the labelled sample on backend errors or invalid payloads", async () => {
    vi.stubEnv("EJB_BACKEND_URL", "http://backend.internal");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect((await oceanGET()).headers.get("x-ejb-fallback-reason")).toBe("backend-http-503");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ not: "an array" })));
    expect((await oceanGET()).headers.get("x-ejb-fallback-reason")).toBe("backend-invalid-payload");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const res = await oceanGET();
    expect(res.headers.get("x-ejb-data-source")).toBe("sample");
    expect(res.headers.get("x-ejb-fallback-reason")).toBe("backend-unreachable");
  });
});
