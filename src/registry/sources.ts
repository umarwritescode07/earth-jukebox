/**
 * Verified NASA source registry.
 *
 * Every statement here is taken from the NASA SVS page/API for the source
 * (fetched 2026-11-14) or from our own documented frame analysis. Anything we
 * could not verify is left out or stated as unknown. See docs/SOURCES.md.
 */
import type {
  AnalysisProfile,
  ColorGroup,
  SonificationProfile,
  SourceDefinition,
  TimedPhase,
  YearLabelSpan,
} from "@/registry/types";

const PENTATONIC = [0, 2, 4, 7, 9];

/*
 * Normalisation ceilings (signalForFullPad, shareForFullVelocity, changeNormMax)
 * are the ~p90 of each feature measured on the prepared NASA rendition with
 * tests/calibration/media.calibration.ts (2 samples/s, same extraction code).
 * Values above the ceiling are clipped, so loud moments stay bounded.
 */
const SVS = "https://svs.gsfc.nasa.gov/vis/a000000";

function sonification(overrides: Partial<SonificationProfile> = {}): SonificationProfile {
  return {
    rootMidi: 50,
    scale: PENTATONIC,
    octaves: 2,
    stepS: 0.25,
    smoothingS: 0.6,
    noteThreshold: 0.002,
    shareForFullVelocity: 0.05,
    signalForFullPad: 0.25,
    maxVoicesPerStep: 2,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* 5313 Night Lights: phases and year labels verified frame-by-frame.  */
/* Method: scripts/analyze-nightlights-phases.mjs + visual check of the */
/* centre label at frames 16..1200 (see docs/SOURCES.md).              */
/* ------------------------------------------------------------------ */
const NL_FPS = 30;
const f = (frame: number) => frame / NL_FPS;

const nightLightsPhases: TimedPhase[] = [
  { id: "annual-global", label: "Annual averages 2012–2023 (global map)", description: "Each year's average night lights; the year is shown at the centre of the frame.", startS: 0, endS: f(283) },
  { id: "transition", label: "Transition (lights fade, change colour bar appears)", description: "Cross-fade between views; mixed meanings, so colour groups are not interpreted.", startS: f(283), endS: f(305) },
  { id: "change-global", label: "Change 2012 → 2023 (global map)", description: "Purple = more light in 2023, orange = less light in 2023.", startS: f(305), endS: f(615) },
  { id: "transition-2", label: "Transition (back to annual averages)", description: "Cross-fade between views; colour groups are not interpreted.", startS: f(615), endS: f(645) },
  { id: "annual-insets", label: "Annual averages 2012–2023 with regional insets", description: "Pop-out views of India, Ukraine, Western Europe and the Eastern Mediterranean appear during this phase.", startS: f(645), endS: f(1094) },
  { id: "transition-3", label: "Transition (change colour bar appears)", description: "Cross-fade between views; colour groups are not interpreted.", startS: f(1094), endS: f(1120) },
  { id: "change-insets", label: "Change 2012 → 2023 with regional insets", description: "Purple = more light in 2023, orange = less light in 2023, including the inset panels.", startS: f(1120), endS: 43.333333 },
];

function yearSpans(starts: [number, number][], endFrame: number): YearLabelSpan[] {
  return starts.map(([year, start], i) => ({
    year,
    startS: f(start),
    endS: f(i + 1 < starts.length ? starts[i + 1][1] : endFrame),
  }));
}
const nightLightsYears: YearLabelSpan[] = [
  ...yearSpans([[2012, 0], [2013, 15], [2014, 33], [2015, 51], [2016, 69], [2017, 86], [2018, 104], [2019, 122], [2020, 139], [2021, 157], [2022, 175], [2023, 193]], 283),
  ...yearSpans([[2012, 645], [2013, 830], [2014, 848], [2015, 866], [2016, 884], [2017, 901], [2018, 919], [2019, 937], [2020, 954], [2021, 972], [2022, 990], [2023, 1008]], 1094),
];

const nlLights: ColorGroup = {
  id: "lights",
  label: "Lit areas (annual average)",
  meaning: "Night lights in that year's annual average. Brightness is absolute, not change.",
  evidence: "NASA SVS 5313 description: 'a time series depicting annual averages from 2012 to 2023'.",
  swatch: "#e9cf8f",
  hue: [20, 70],
  minSat: 0.18,
  minLum: 0.14,
  voice: "glass",
};
const nlMore: ColorGroup = {
  id: "more-light",
  label: "Purple: more light in 2023",
  meaning: "Regions with more light in 2023 than in 2012.",
  evidence: "NASA SVS 5313 description ('regions of more light depicted in purple') and the on-screen colour bar, sampled at hue ≈268–302°.",
  swatch: "#9368c4",
  hue: [255, 315],
  minSat: 0.15,
  minLum: 0.12,
  voice: "bell",
};
const nlLess: ColorGroup = {
  id: "less-light",
  label: "Orange: less light in 2023",
  meaning: "Regions with less light in 2023 than in 2012.",
  evidence: "NASA SVS 5313 description ('regions with less light depicted in orange') and the on-screen colour bar, sampled at hue ≈23–29°.",
  swatch: "#e69d5a",
  hue: [12, 42],
  minSat: 0.35,
  minLum: 0.12,
  voice: "reed",
};

const nightLightsAnalysis: AnalysisProfile = {
  sampleWidth: 384,
  exclude: [
    { x0: 0.46, y0: 0.42, x1: 0.6, y1: 0.61, reason: "Centre year label and change colour bar ('Change in Lighting Intensity from 2012 to 2023')." },
  ],
  signal: { minLum: 0.12, minSat: 0.15, brightLum: 0.55, description: "Coloured or bright pixels; the grey land/ice base map and black background are ignored." },
  colorGroupsByPhase: {
    "annual-global": [nlLights],
    "annual-insets": [nlLights],
    "change-global": [nlMore, nlLess],
    "change-insets": [nlMore, nlLess],
    transition: [],
    "transition-2": [],
    "transition-3": [],
    default: [],
  },
  changeNormMax: 0.002,
};

/* ------------------------------------------------------------------ */

export const SOURCES: SourceDefinition[] = [
  {
    id: "svs-5313",
    svsId: 5313,
    title: "Change in Night Lights between 2012 and 2023 — EIC Version",
    shortTitle: "Night Lights 2012–2023",
    category: "Human activity · satellite observations (Black Marble, Suomi NPP VIIRS)",
    sourcePage: "https://svs.gsfc.nasa.gov/5313/",
    status: "playable",
    assetId: "svs5313-nightlights-eic",
    presentation: { kind: "video" },
    publication: { released: "2024-06-14", updated: "2024-06-14" },
    coverage: {
      summary: "Annual averages for each year 2012–2023, then the change between 2012 and 2023.",
      start: "2012",
      end: "2023",
      basis: "NASA page description; per-frame years read from the on-screen labels.",
    },
    summary: "A flat world map of annual night lights from 2012 to 2023, followed by a map of change between 2012 and 2023, then repeated with zoomed regional insets.",
    pageDescription:
      "This global, flat map view of night lights data begins with a time series depicting annual averages from 2012 to 2023. The lights then fade away to reveal night lights change between 2012 and 2023, with regions of more light depicted in purple and regions with less light depicted in orange. The sequence then repeats with pop-out, zoomed-in views of India, Ukraine, Western Europe, and the Eastern Mediterranean region.",
    interpretation: [
      "During the annual phases, warm-coloured pixels show how bright the night was in that year's average.",
      "During the change phases, colours mean something different: purple = more light in 2023 than 2012, orange = less light.",
      "This EIC-wall version shows the world map twice side by side (32:9), so every region appears twice in the frame.",
    ],
    cautions: [
      "Brightness is not population, electricity use or economic growth. Do not infer those from pixel brightness.",
      "Pixel shares describe the displayed image (including the duplicated map and inset panels), not land area.",
      "Inset panels in the second half add zoomed copies of regions, which raises pixel shares without any change on Earth.",
    ],
    camera: { moves: false, disclosure: "Fixed flat map; no camera motion. Inset panels pop out during the second half and change the image statistics." },
    credits: [
      { role: "Visualizer", people: ["Kel Elkins (USRA)"] },
      { role: "Scientist", people: ["Zhuosen Wang (University of Maryland)", "Miguel Román (Leidos)", "Ranjay Shrestha (SSAI)", "Srija Chakraborty (USRA)", "Virginia Kalb (NASA)"] },
    ],
    datasets: ["Black Marble: Next Generation — Suomi NPP VIIRS (NASA/NOAA)"],
    legend: null,
    phases: nightLightsPhases,
    observationMapping: {
      type: "phase-and-year-labels",
      years: nightLightsYears,
      comparison: {
        phaseIds: ["change-global", "change-insets"],
        observation: { kind: "comparison", start: "2012", end: "2023", label: "Change between 2012 and 2023", basis: "on-screen-label-verified" },
      },
      evidence: "Year label transitions found by frame differencing (frames 15, 33, 51, 69, 86, 104, 122, 139, 157, 175, 193 and 830 … 1008) and read visually; see docs/SOURCES.md.",
    },
    analysis: nightLightsAnalysis,
    sonification: sonification({ rootMidi: 50, shareForFullVelocity: 0.012, signalForFullPad: 0.024, noteThreshold: 0.0004 }),
    mapping: [
      { feature: "Share of lit/coloured pixels", origin: "image-derived", sound: "Pad loudness", detail: "More lit pixels → louder sustained pad (smoothed over 0.6 s)." },
      { feature: "Annual-average lights (warm pixels)", origin: "image-derived", sound: "Glass voice", detail: "Their mean brightness sets the pitch; their share sets how loud each note is." },
      { feature: "Purple 'more light' pixels (change phases)", origin: "image-derived", sound: "Bell voice", detail: "Only in change phases. Brightness → pitch, share → loudness." },
      { feature: "Orange 'less light' pixels (change phases)", origin: "image-derived", sound: "Reed voice", detail: "Only in change phases. Brightness → pitch, share → loudness." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Year-to-year image changes and fades drive a deterministic Euclidean rhythm." },
    ],
    disabledControls: [],
    visualDescription:
      "Dark world map, shown twice side by side, with warm yellow dots of city light. A year label counts from 2012 to 2023 in the middle, then the lights fade and a purple-and-orange change map appears with a colour bar. The sequence repeats with zoomed boxes over India, Ukraine, Western Europe and the Eastern Mediterranean.",
  },
  {
    id: "svs-3912",
    svsId: 3912,
    title: "Global Sea Surface Currents and Temperature",
    shortTitle: "Sea Surface Currents & Temperature",
    category: "Ocean · model output (ECCO2)",
    sourcePage: "https://svs.gsfc.nasa.gov/3912/",
    status: "playable",
    assetId: "svs3912-ecco2-sst-flow",
    presentation: { kind: "video" },
    publication: { released: "2012-03-16", updated: "2025-02-18" },
    coverage: {
      summary: "Model time 2007-03-25 12:00 UTC to 2008-03-03 12:00 UTC.",
      start: "2007-03-25T12:00:00Z",
      end: "2008-03-03T12:00:00Z",
      basis: "NASA page caption and NASA per-frame date table (flat_ecco2_dates.txt, 2001 entries).",
    },
    summary: "Sea surface current flows from the ECCO2 ocean model, coloured by corresponding sea surface temperature, on a flat world map.",
    pageDescription:
      "This visualization shows sea surface current flows. The flows are colored by corresponding sea surface temperature data. This visualization was produced using model output from the joint MIT/JPL project entitled Estimating the Circulation and Climate of the Ocean, Phase II (ECCO2). The ECCO2 model simulates ocean flows at all depths, but only surface flows are used in this visualization.",
    interpretation: [
      "Flow lines follow modelled surface currents; their colour follows the sea surface temperature colour bar (0–32 °C).",
      "The NASA date table gives a model timestamp for every frame, so the 'model time' readout is exact for this asset.",
    ],
    cautions: [
      "We group colours into hue bands of the NASA colour bar. We do not decode temperatures: glow and blending make pixel colours unreliable as numbers.",
      "Screen-space motion of the rendered flow lines is not a measurement of current speed.",
      "This is model output (ECCO2), not direct observation.",
    ],
    camera: { moves: false, disclosure: "Fixed flat map; no camera motion. Frame-to-frame change comes from the animated flow lines." },
    credits: [
      { role: "Animator", people: ["Greg Shirah (NASA/GSFC)", "Horace Mitchell (NASA/GSFC)", "Eric Sokolowsky (Global Science and Technology, Inc.)"] },
      { role: "Producer", people: ["Michael Starobin (HTSI)"] },
      { role: "Scientist", people: ["Hong Zhang (UCLA)", "Dimitris Menemenlis (NASA/JPL CalTech)"] },
    ],
    datasets: ["ECCO2 High Resolution Ocean and Sea Ice Model (NASA/JPL)", "GTOPO30 Topography and Bathymetry (USGS)"],
    legend: {
      url: `${SVS}/a003900/a003912/sst_ecco2_cbar.png`,
      alt: "Sea Surface Temp (°C) colour bar from 0 (blue) through 10 and 20 (green to yellow) to 32 (red).",
      description: "NASA colour bar: blue is 0 °C, green is 10–20 °C, yellow is about 25 °C, red is 32 °C.",
    },
    phases: [],
    observationMapping: {
      type: "linear-frame-table",
      startIso: "2007-03-25T12:00:00Z",
      endIso: "2008-03-03T12:00:00Z",
      frameCount: 2001,
      fps: 30,
      evidence: "NASA flat_ecco2_dates.txt lists 2001 timestamps evenly spaced from 2007-03-25T12:00Z to 2008-03-03T12:00Z; the selected rendition has exactly 2001 frames at 30 fps. Linearity is checked against every line of the table in tests.",
    },
    analysis: {
      sampleWidth: 256,
      exclude: [],
      signal: { minLum: 0.1, minSat: 0.3, brightLum: 0.9, description: "Saturated flow-line pixels; grey land and dark background ignored." },
      colorGroupsByPhase: {
        default: [
          { id: "cool", label: "Blue–cyan flows (cool end)", meaning: "Blue end of the 0–32 °C colour bar (around 0 °C).", evidence: "NASA colour bar caption.", swatch: "#2f6cf0", hue: [180, 250], minSat: 0.35, minLum: 0.12, voice: "glass" },
          { id: "mid", label: "Green flows (≈10–20 °C band)", meaning: "Green section of the colour bar (10–20 °C).", evidence: "NASA colour bar caption.", swatch: "#3fe07a", hue: [75, 165], minSat: 0.35, minLum: 0.12, voice: "reed" },
          { id: "warm", label: "Yellow–red flows (warm end)", meaning: "Yellow (≈25 °C) to red (32 °C) section of the colour bar.", evidence: "NASA colour bar caption.", swatch: "#f0402a", hue: [355, 62], minSat: 0.4, minLum: 0.12, voice: "bell" },
        ],
      },
      changeNormMax: 0.017,
    },
    sonification: sonification({ rootMidi: 45, shareForFullVelocity: 0.15, signalForFullPad: 0.45, noteThreshold: 0.01 }),
    mapping: [
      { feature: "Share of flow-line pixels", origin: "image-derived", sound: "Pad loudness", detail: "Smoothed share of coloured flow pixels." },
      { feature: "Blue–cyan hue band", origin: "image-derived", sound: "Glass voice (low)", detail: "Hue band of the colour bar, not a temperature value." },
      { feature: "Green hue band", origin: "image-derived", sound: "Reed voice", detail: "Hue band of the colour bar, not a temperature value." },
      { feature: "Yellow–red hue band", origin: "image-derived", sound: "Bell voice (high)", detail: "Hue band of the colour bar, not a temperature value." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Animated flow lines; not current speed." },
    ],
    disabledControls: [{ control: "Numeric temperature readout", reason: "No validated numerical source or colour-decoding method for this rendered video." }],
    visualDescription: "Flat world map with grey continents. Thousands of thin swirling lines fill the oceans: red and orange near the equator, yellow and green in mid-latitudes, blue and cyan near the poles. The lines drift and curl as the model year advances.",
  },
  {
    id: "svs-5425",
    svsId: 5425,
    title: "Perpetual Ocean 2: Western Boundary Currents",
    shortTitle: "Perpetual Ocean 2 (beauty shot)",
    category: "Ocean · model output (ECCO2, 3D currents)",
    sourcePage: "https://svs.gsfc.nasa.gov/5425/",
    status: "playable",
    assetId: "svs5425-perpetual-ocean2-beauty",
    presentation: { kind: "video" },
    publication: { released: "2025-02-27", updated: "2025-05-20" },
    coverage: {
      summary: "Model output covering 2021–2023 (the page's date layer runs 15 Jan 2021 – 25 Dec 2023). The selected 'clean, no date' version shows no dates, so playback is not mapped to model time.",
      start: "2021-01-15",
      end: "2023-12-25",
      basis: "NASA page text for the model output and the dates-only layer.",
    },
    summary: "The 'beauty shot' version: a rotating globe zooms to the Kuroshio, Agulhas and Gulf Stream western boundary currents, with particle trails moving in the 3D velocity field.",
    pageDescription:
      "The visualization starts with a rotating globe showing ocean currents. The camera then zooms into the Kuroshio current, moves over the Indian Ocean to the Agulhas Current, then over to the Gulf Stream. The flows from the surface down to 600 meters deep are all white. Flows below 600 meters depth use the blue-cyan-white color table.",
    interpretation: [
      "White trails are flows from the surface down to 600 m.",
      "Flows deeper than 600 m use a blue–cyan–white table (−3 to 22 °C), so bright blue/cyan trails indicate deep flows.",
    ],
    cautions: [
      "This beauty-shot palette is not a sea-surface-temperature map.",
      "White is ambiguous in pixels: it marks shallow flows but is also the warm end of the deep-flow table, and appears in snow and ice on land.",
      "Camera rotation and zooms dominate frame-to-frame change; screen motion is not current speed.",
    ],
    camera: { moves: true, disclosure: "Rotating globe with zooms to three regions. Changes in the sound can come from the camera, not from the ocean." },
    credits: [
      { role: "Visualizer", people: ["Greg Shirah (NASA/GSFC)", "Horace Mitchell (NASA/GSFC)"] },
      { role: "Technical support", people: ["Laurence Schuler (ADNET Systems, Inc.)", "Ian Jones (ADNET Systems, Inc.)"] },
      { role: "Scientist", people: ["Atousa Saberi (NASA/GSFC)", "Josh Willis (JPL)"] },
      { role: "Producer", people: ["Kathleen Gaeta (Advocates in Manpower Management, Inc.)"] },
    ],
    datasets: ["ECCO2 High Resolution Ocean and Sea Ice Model (NASA/JPL)", "Blue Marble: Next Generation (courtesy Reto Stöckli, NASA/GSFC)", "ETOPO-30 global relief"],
    legend: {
      url: `${SVS}/a005400/a005425/perpetual_ocean2_CLOSE_101_cbar_beauty.png`,
      alt: "Temperature (°C) colour bar for flows at 600 m and deeper, from −3 (deep blue) to 22 (white).",
      description: "Applies only to flows at 600 m and below. All flows above 600 m are drawn white.",
    },
    phases: [],
    observationMapping: { type: "none", reason: "The selected 'clean, no date' rendition shows no dates and NASA publishes no frame-to-date table for it." },
    analysis: {
      sampleWidth: 256,
      exclude: [],
      signal: { minLum: 0.3, minSat: 0.45, brightLum: 0.72, description: "Bright trails and saturated blue/cyan pixels; dark ocean and space ignored." },
      colorGroupsByPhase: {
        default: [
          { id: "white-trails", label: "White trails (≤ 600 m, ambiguous)", meaning: "Flows from the surface to 600 m are white (also the warm end of the deep table, and snow/ice).", evidence: "NASA page description and colour-bar caption.", swatch: "#f4f8ff", hue: [0, 360], minSat: 0, maxSat: 0.22, minLum: 0.78, voice: "glass" },
          { id: "deep-blue", label: "Blue–cyan trails (deeper than 600 m)", meaning: "Flows deeper than 600 m on the blue–cyan–white table.", evidence: "NASA colour-bar caption for the beauty version.", swatch: "#1e9bff", hue: [185, 240], minSat: 0.5, minLum: 0.38, voice: "reed" },
        ],
      },
      changeNormMax: 0.14,
    },
    sonification: sonification({ rootMidi: 43, shareForFullVelocity: 0.08, signalForFullPad: 0.32, noteThreshold: 0.002 }),
    mapping: [
      { feature: "Share of bright trail pixels", origin: "image-derived", sound: "Pad loudness", detail: "Smoothed; strongly affected by zoom level." },
      { feature: "White trails", origin: "image-derived", sound: "Glass voice", detail: "Ambiguous colour (see cautions)." },
      { feature: "Blue–cyan trails", origin: "image-derived", sound: "Reed voice (low)", detail: "Deep-flow colour table." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Mostly camera motion." },
    ],
    disabledControls: [{ control: "Model-time readout", reason: "No dates in the selected rendition." }],
    visualDescription: "A dark-blue globe with land in natural colours. Countless thin white particle trails swirl through the oceans. The camera rotates, then zooms to the meandering Kuroshio current near Japan, sweeps to the Agulhas Current off southern Africa, and ends over the Gulf Stream.",
  },
  {
    id: "svs-5533",
    svsId: 5533,
    title: "Air Quality Model Runs",
    shortTitle: "Air Quality Model Runs (GEOS-CF)",
    category: "Atmosphere · model output (GEOS-CF)",
    sourcePage: "https://svs.gsfc.nasa.gov/5533/",
    status: "playable",
    assetId: "svs5533-airquality-map-labels",
    presentation: { kind: "video" },
    publication: { released: "2025-05-05", updated: "2026-01-28" },
    coverage: {
      summary: "July–August 2024 (an active fire season in North America), modelled by GEOS-CF.",
      start: "2024-07",
      end: "2024-08",
      basis: "NASA media-group caption for the selected asset.",
    },
    summary: "Modelled concentrations of PM2.5, ozone, carbon monoxide and nitrogen oxides from NASA's GEOS-CF system, shown as labelled vertical map panels.",
    pageDescription:
      "This visualization shows concentrations of air pollutants, such as Particulate Matter (PM2.5), Ozone (O3), Carbon Monoxide (CO), and Nitrogen Oxides (NOx) as they are tracked from NASA's Goddard Earth Observing System Composition Forecasting (GEOS-CF) system.",
    interpretation: [
      "Each vertical panel shows one modelled pollutant, labelled at the bottom: PM2.5, NOx, O3 or CO.",
      "Panels use different colour families: NOx green, O3 violet, PM2.5 and CO orange tones.",
    ],
    cautions: [
      "This is a research model visualization, not an Air Quality Index measurement or a health advisory.",
      "NASA does not publish a colour bar for this asset, so we do not claim that darker or lighter means more pollution.",
      "The panels slide sideways during playback. Changes in colour shares mostly reflect the layout moving, not pollution changing.",
    ],
    camera: { moves: true, disclosure: "Flat map panels that slide horizontally; screen-space changes follow the panel motion." },
    credits: [
      { role: "Data visualizer", people: ["Helen-Nicole Kostis (USRA)", "Joseph V. Ardizzone (NASA/GSFC)"] },
      { role: "Scientist", people: ["Lesley Ott (NASA/GSFC)"] },
      { role: "Technical support", people: ["Laurence Schuler (ADNET Systems, Inc.)", "Ian Jones (ADNET Systems, Inc.)", "Ella Kaplan (Global Science and Technology, Inc.)"] },
    ],
    datasets: ["GEOS-CF (NASA GMAO)"],
    legend: null,
    phases: [],
    observationMapping: { type: "none", reason: "The asset shows no per-frame dates; only the July–August 2024 period is stated." },
    analysis: {
      sampleWidth: 256,
      exclude: [{ x0: 0, y0: 0.73, x1: 1, y1: 0.81, reason: "Row of pollutant name labels." }],
      signal: { minLum: 0.08, minSat: 0.2, brightLum: 2, description: "Coloured panel pixels; grey/black/white regions ignored." },
      colorGroupsByPhase: {
        default: [
          { id: "green", label: "Green-shaded panels (NOx)", meaning: "Colour family of the panels labelled 'Nitrous Oxides (NOx)'.", evidence: "On-screen panel labels in the selected asset.", swatch: "#2fd13a", hue: [85, 150], minSat: 0.35, minLum: 0.1, voice: "reed" },
          { id: "violet", label: "Violet-shaded panels (O₃)", meaning: "Colour family of the panels labelled 'Ozone (O3)'.", evidence: "On-screen panel labels in the selected asset.", swatch: "#7a52e0", hue: [240, 290], minSat: 0.2, minLum: 0.1, voice: "glass" },
          { id: "orange", label: "Orange–red panels (PM2.5 and CO share these hues)", meaning: "PM2.5 and CO panels both use orange tones, so they are not separated.", evidence: "On-screen panel labels in the selected asset.", swatch: "#ef8a2a", hue: [0, 52], minSat: 0.35, minLum: 0.1, voice: "bell" },
        ],
      },
      changeNormMax: 0.12,
    },
    sonification: sonification({ rootMidi: 48, shareForFullVelocity: 0.35, signalForFullPad: 0.9, noteThreshold: 0.02 }),
    mapping: [
      { feature: "Share of coloured pixels", origin: "image-derived", sound: "Pad loudness", detail: "Nearly constant: panels fill the frame." },
      { feature: "Green panel lightness", origin: "image-derived", sound: "Reed voice", detail: "Lightness → pitch. Not a concentration." },
      { feature: "Violet panel lightness", origin: "image-derived", sound: "Glass voice", detail: "Lightness → pitch. Not a concentration." },
      { feature: "Orange panel lightness", origin: "image-derived", sound: "Bell voice", detail: "PM2.5 and CO combined (same hues)." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Includes panel sliding." },
    ],
    disabledControls: [
      { control: "Per-pollutant layers (PM2.5 / O₃ / CO / NOx)", reason: "The asset does not separate pollutants into channels: panels slide across the frame and PM2.5 and CO share orange hues. Enable only when the backend supplies separated pollutant fields." },
      { control: "AQI / health advisory", reason: "GEOS-CF model output is not an AQI measurement." },
    ],
    visualDescription: "Tall vertical strips of world map side by side, each tinted by one pollutant: cream-to-brown for PM2.5, green for nitrogen oxides, violet and grey for ozone, yellow-to-red for carbon monoxide. Labels sit near the bottom of each strip. The strips slowly slide sideways while plumes swirl within them.",
  },
  {
    id: "svs-5196",
    svsId: 5196,
    title: "DYAMOND Global Carbon Dioxide",
    shortTitle: "DYAMOND Global CO₂ (orbit)",
    category: "Atmosphere · model output (GEOS / DYAMOND)",
    sourcePage: "https://svs.gsfc.nasa.gov/5196/",
    status: "playable",
    assetId: "svs5196-dyamond-co2-orbit",
    presentation: { kind: "video" },
    publication: { released: "2024-07-22", updated: "2025-06-23" },
    coverage: {
      summary: "Modelled CO₂ for January–March 2020. A date stamp is burned into the video; we do not machine-read it.",
      start: "2020-01",
      end: "2020-03",
      basis: "NASA page caption ('Global CO2 ppm for January-March of 2020').",
    },
    summary: "Modelled carbon dioxide moving through the atmosphere from January to March 2020, with the camera orbiting Earth from a distance.",
    pageDescription: "Global CO2 ppm for January-March of 2020. This camera move orbits the Earth from a distance.",
    interpretation: [
      "Brighter orange–red shading marks the dense end of NASA's CO₂ colour and opacity transfer function.",
      "NASA's caption explains the pulsing: fires flare by day, and plants take up and release CO₂ on a daily cycle.",
    ],
    cautions: [
      "This is a model of January–March 2020, not current atmospheric CO₂.",
      "The NASA colour bar has no numeric labels, so no ppm values are shown or inferred from colours.",
      "The orbiting camera changes which regions are visible; sound changes can come from the camera.",
    ],
    camera: { moves: true, disclosure: "The camera orbits Earth; screen-space changes partly reflect the orbit." },
    credits: [
      { role: "Visualizer", people: ["AJ Christensen (SSAI)", "Greg Shirah (NASA/GSFC)", "Helen-Nicole Kostis (USRA)", "Mark SubbaRao (NASA/GSFC)"] },
      { role: "Technical support", people: ["Laurence Schuler (ADNET Systems, Inc.)", "Ian Jones (ADNET Systems, Inc.)"] },
      { role: "Scientist", people: ["Lesley Ott (NASA/GSFC)", "Brad Weir (Morgan State University)", "William Putman (NASA/GSFC)", "Tomohiro Oda (USRA/EfSI)"] },
    ],
    datasets: ["DYAMOND experimental coupled GEOS-MITgcm model (NASA/JPL, NASA/GMAO)"],
    legend: {
      url: `${SVS}/a005100/a005196/dyamondCbar_6-27-2024a.png`,
      alt: "Colour and opacity transfer function: transparent grey through tan to orange and red. No numeric labels.",
      description: "Range, colour and opacity transfer function (NASA). It has no numeric labels.",
    },
    phases: [],
    observationMapping: { type: "none", reason: "Dates appear only as burned-in text; NASA publishes no frame-to-date table for this rendition." },
    analysis: {
      sampleWidth: 256,
      exclude: [{ x0: 0.76, y0: 0.9, x1: 1, y1: 1, reason: "Burned-in date stamp." }],
      signal: { minLum: 0.18, minSat: 0.25, brightLum: 0.45, description: "Coloured or bright CO₂ shading; black space ignored." },
      colorGroupsByPhase: {
        default: [
          { id: "dense", label: "Orange–red shading (dense end)", meaning: "High end of NASA's colour/opacity transfer function.", evidence: "NASA colour bar image.", swatch: "#e2401b", hue: [0, 32], minSat: 0.5, minLum: 0.2, voice: "bell" },
          { id: "pale", label: "Tan–white shading (lower end)", meaning: "Lower, semi-transparent end of the transfer function.", evidence: "NASA colour bar image.", swatch: "#d7c08e", hue: [25, 60], minSat: 0.08, maxSat: 0.5, minLum: 0.45, voice: "glass" },
        ],
      },
      changeNormMax: 0.027,
    },
    sonification: sonification({ rootMidi: 47, shareForFullVelocity: 0.012, signalForFullPad: 0.04, noteThreshold: 0.0008 }),
    mapping: [
      { feature: "Share of shaded pixels", origin: "image-derived", sound: "Pad loudness", detail: "Smoothed; the visible hemisphere changes with the orbit." },
      { feature: "Orange–red shading", origin: "image-derived", sound: "Bell voice", detail: "No ppm value implied." },
      { feature: "Tan–white shading", origin: "image-derived", sound: "Glass voice", detail: "No ppm value implied." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Includes daily pulsing and camera orbit." },
    ],
    disabledControls: [{ control: "CO₂ ppm readout", reason: "The colour bar has no numeric scale; ppm cannot be derived from rendered colours." }],
    visualDescription: "A dark globe seen from space, slowly orbiting. Wispy grey and tan veils of carbon dioxide drift across it, with brighter orange and red patches over fire regions and cities that pulse with day and night. A date stamp in the lower right advances through early 2020.",
  },
  {
    id: "svs-5011",
    svsId: 5011,
    title: "Lightning Events Detected from the International Space Station (ISS) 2017–2023",
    shortTitle: "ISS Lightning 2017–2023",
    category: "Atmosphere · satellite observations (ISS LIS)",
    sourcePage: "https://svs.gsfc.nasa.gov/5011/",
    status: "playable",
    assetId: "svs5011-iss-lis-lightning-sphere",
    presentation: { kind: "video" },
    publication: { released: "2023-10-19", updated: "2025-03-28" },
    coverage: {
      summary: "Lightning detected by the ISS Lightning Imaging Sensor through July 2023, shown with a 10-day roving window. A date stamp is burned into the video. NASA's captions disagree on the start month.",
      start: "2017",
      end: "2023-07",
      basis: "NASA page captions and the selected video's burned-in date stamp.",
      conflicts: [
        "Main caption (selected media group): 'between January 2017 and July 2023'.",
        "Science On a Sphere caption on the same page: 'between March 2017 and July 2023'.",
        "The selected video's burned-in date reads 'Mar 01 2017 03:32' at 0.5 s (checked on the NASA file's frames).",
      ],
    },
    summary: "Lightning events from the quality-controlled ISS LIS science dataset, accumulated in a 10-day roving window on a rotating globe.",
    pageDescription:
      "Lightning events detected by the LIS sensor on the ISS between January 2017 and July 2023 using a 10-day roving window. Data is from the quality controlled science dataset.",
    interpretation: [
      "Yellow glows are lightning detections within the current 10-day window.",
      "LIS only sees the tropics and mid-latitudes covered by the ISS orbit.",
    ],
    cautions: [
      "Percussion follows the displayed lightning glow, not individual strikes: there is no one-note-per-strike mapping.",
      "This is historical data (2017–2023), not a live strike counter.",
      "The globe rotates, so activity entering and leaving view changes the sound.",
    ],
    camera: { moves: true, disclosure: "Rotating globe; lightning entering or leaving view changes the sound." },
    credits: [{ role: "Visualizer", people: ["Michala Garrison (SSAI)", "Greg Shirah (NASA/GSFC)", "Kel Elkins (USRA)", "Alex Kekesi (Global Science and Technology, Inc.)"] }],
    datasets: [
      "Quality Controlled Lightning Imaging Sensor (LIS) on ISS Science Data V1 (NASA GHRC DAAC)",
      "CPC Cloud Composite",
      "Gray Earth with Shaded Relief (Natural Earth), as credited on the NASA page",
      "MODIS Land Cover CMG (MCD12C1)",
    ],
    legend: null,
    phases: [],
    observationMapping: { type: "none", reason: "Dates appear only as burned-in text, and playback speed through the record is not uniform." },
    analysis: {
      sampleWidth: 256,
      exclude: [{ x0: 0.8, y0: 0.9, x1: 1, y1: 1, reason: "Burned-in date stamp." }],
      signal: { minLum: 0.35, minSat: 0.5, brightLum: 2, description: "Saturated yellow lightning glows only." },
      colorGroupsByPhase: {
        default: [
          { id: "lightning", label: "Yellow lightning glows", meaning: "Lightning detections in the 10-day window.", evidence: "NASA page description; glows are the only saturated yellow elements.", swatch: "#ffd21f", hue: [35, 65], minSat: 0.5, minLum: 0.35, voice: "pluck" },
        ],
      },
      changeNormMax: 0.034,
    },
    sonification: sonification({ rootMidi: 52, shareForFullVelocity: 0.005, signalForFullPad: 0.006, noteThreshold: 0.0003 }),
    mapping: [
      { feature: "Share of lightning-glow pixels", origin: "image-derived", sound: "Pad loudness + pluck voice", detail: "More displayed activity → louder and denser. Not a strike count." },
      { feature: "Glow brightness", origin: "image-derived", sound: "Pluck pitch", detail: "Brighter glow → higher pitch." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Includes globe rotation." },
    ],
    disabledControls: [{ control: "Strike counter", reason: "Pixels cannot be converted into individual strikes." }],
    visualDescription: "A grey, cloud-dappled globe rotating against a starry background. Small yellow flashes cluster over Africa, South America and Southeast Asia, shifting with the seasons. A date stamp in the lower right advances from 2017 to 2023.",
  },
  {
    id: "svs-4960",
    svsId: 4960,
    title: "A 3D View of an Atmospheric River from an Earth System Model",
    shortTitle: "Atmospheric River (3D render)",
    category: "Atmosphere · reanalysis (MERRA-2)",
    sourcePage: "https://svs.gsfc.nasa.gov/4960/",
    status: "playable",
    assetId: "svs4960-atmospheric-river-nonnarrated",
    presentation: { kind: "video" },
    publication: { released: "2022-01-25", updated: "2025-04-23" },
    coverage: {
      summary: "MERRA-2 reanalysis of one atmospheric-river ('pineapple express') event. The event dates are not stated in the page text; NASA provides a separate date-overlay layer.",
      basis: "NASA page description.",
    },
    summary: "A rendered 3D scene of an atmospheric river carrying tropical moisture toward the US west coast, from NASA's MERRA-2 reanalysis.",
    pageDescription:
      "Clouds and precipitation shown here are from NASA's MERRA-2 reanalysis, a retrospective blend of a weather model and conventional and satellite observations. The blue shading shown here gives a three-dimensional view of the water vapor transport.",
    interpretation: [
      "Blue shading is the 3D water-vapour transport of the atmospheric river.",
      "Surface colours follow NASA's surface-layer colour tables (snow, liquid precipitation, snow depth, soil moisture, ocean).",
    ],
    cautions: [
      "This is a video of a rendered 3D scene, not an interactive 3D model.",
      "We use the non-narrated, visualization-only version. NASA's narration is not mixed with our sonification.",
      "Camera motion through the scene drives much of the frame-to-frame change.",
    ],
    camera: { moves: true, disclosure: "The camera flies through the rendered scene; sound changes can come from the camera." },
    credits: [
      { role: "Visualizer", people: ["Greg Shirah (NASA/GSFC)", "Horace Mitchell (NASA/GSFC)", "Cindy Starr (Global Science and Technology, Inc.)", "Kel Elkins (USRA)"] },
      { role: "Scientist", people: ["Allison Collow (UMBC)", "Natalie Thomas (UMBC)", "Michael Bosilovich (NASA/GSFC)"] },
      { role: "Producer", people: ["Jefferson Beck (KBR Wyle Services, LLC)", "LK Ward (KBR Wyle Services, LLC)"] },
    ],
    datasets: ["MERRA-2 reanalysis (NASA GMAO)", "GTOPO30 Topography and Bathymetry (USGS)"],
    legend: {
      url: `${SVS}/a004900/a004960/atmo_rivers_cbars01.png`,
      alt: "Surface layer colour tables: snow (white), liquid precipitation (blue to yellow, 0–0.001 kg/m²/s), snow depth (grey to cyan, 0.25–1.5 m), soil moisture (white to blue-grey, 0–1), ocean (grey).",
      description: "Surface-layer colour tables only. The blue water-vapour shading has no published colour bar.",
    },
    phases: [],
    observationMapping: { type: "none", reason: "Event dates are not stated in the page text." },
    analysis: {
      sampleWidth: 256,
      exclude: [],
      signal: { minLum: 0.2, minSat: 0.35, brightLum: 0.8, description: "Coloured shading and bright streamlines; dark sky ignored." },
      colorGroupsByPhase: {
        default: [
          { id: "vapour", label: "Blue water-vapour shading", meaning: "3D view of water vapour transport.", evidence: "NASA page description.", swatch: "#2a8cf0", hue: [190, 232], minSat: 0.45, minLum: 0.3, voice: "reed" },
          { id: "white", label: "White elements (streamlines, snow, labels)", meaning: "Mixed meaning: wind streamlines, snow and pressure labels are all white.", evidence: "Visual inspection of the asset and NASA surface legend.", swatch: "#f2f4f7", hue: [0, 360], minSat: 0, maxSat: 0.15, minLum: 0.8, voice: "glass" },
        ],
      },
      changeNormMax: 0.11,
    },
    sonification: sonification({ rootMidi: 46, shareForFullVelocity: 0.1, signalForFullPad: 0.33, noteThreshold: 0.002 }),
    mapping: [
      { feature: "Share of shaded pixels", origin: "image-derived", sound: "Pad loudness", detail: "Smoothed." },
      { feature: "Blue vapour shading", origin: "image-derived", sound: "Reed voice", detail: "Lightness → pitch, share → loudness." },
      { feature: "White elements", origin: "image-derived", sound: "Glass voice", detail: "Mixed meaning (see legend notes)." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Mostly camera motion." },
    ],
    disabledControls: [{ control: "Interactive 3D", reason: "The source is a rendered video, not a 3D model." }],
    visualDescription: "A tilted 3D view over the North Pacific. A long band of bright blue moisture stretches from near Hawaii toward the US west coast. White wind streaks flow around a large 'H' high-pressure label and an 'L' low. The camera glides along the river toward California.",
  },
  {
    id: "svs-4950",
    svsId: 4950,
    title: "GEDI Forest Height",
    shortTitle: "GEDI Forest Height (global)",
    category: "Land · satellite lidar observations (GEDI on ISS)",
    sourcePage: "https://svs.gsfc.nasa.gov/4950/",
    status: "playable",
    assetId: "svs4950-gedi-global-colorbar",
    presentation: { kind: "video" },
    publication: { released: "2021-10-29", updated: "2025-04-01" },
    coverage: {
      summary: "One year of GEDI lidar data. NASA's descriptions disagree on which year.",
      basis: "NASA SVS 4950 media-group captions.",
      conflicts: [
        "Selected asset (global view WITH colour bar): 'This visualization uses data collected between April 2019 and April 2020.'",
        "Same global view WITHOUT colour bar: 'This visualization uses data collected between April 2018 and April 2019.'",
        "Not resolved here: no frame-level metadata identifies which range applies.",
      ],
    },
    summary: "A rotating globe of forest canopy height from the GEDI lidar on the ISS, with height exaggerated and an on-screen 'Height Above Ground' colour bar (0–50 m).",
    pageDescription:
      "This visualization depicts a global view of forest height data collected by the GEDI instrument aboard the International Space Station. Brown and dark green represent shorter vegetation. Bright green and white represent taller vegetation. Height is exaggerated to depict variation at this scale.",
    interpretation: ["Brown and dark green = shorter vegetation; bright green and white = taller vegetation (on-screen scale 0–50 m)."],
    cautions: [
      "Height is visually exaggerated; pixel height on screen is not canopy height.",
      "The data period is ambiguous in NASA's own captions (see coverage).",
      "We do not count white pixels as tall vegetation, because ice and clouds are white too.",
      "The globe rotates, so changes in the sound can come from the camera.",
    ],
    camera: { moves: true, disclosure: "Rotating globe; vegetation entering and leaving view changes the sound." },
    credits: [
      { role: "Visualizer", people: ["Kel Elkins (USRA)", "Horace Mitchell (NASA/GSFC)", "Greg Shirah (NASA/GSFC)"] },
      { role: "Technical support", people: ["Laurence Schuler (ADNET Systems, Inc.)", "Ian Jones (ADNET Systems, Inc.)"] },
      { role: "Scientist", people: ["Temilola Fatoyinbo (NASA/GSFC)", "Atticus Stovall (University of Maryland)"] },
    ],
    datasets: ["GEDI L2B relative height RH100 (gedi.umd.edu)"],
    legend: null,
    phases: [],
    observationMapping: { type: "none", reason: "Coverage period conflicts between NASA captions; no per-frame time." },
    analysis: {
      sampleWidth: 256,
      exclude: [{ x0: 0, y0: 0.86, x1: 0.3, y1: 1, reason: "On-screen 'Height Above Ground' colour bar." }],
      signal: { minLum: 0.1, minSat: 0.2, brightLum: 2, description: "Coloured vegetation pixels; ocean blue and space excluded by the colour groups." },
      colorGroupsByPhase: {
        default: [
          { id: "short", label: "Brown–dark green (shorter vegetation)", meaning: "Shorter vegetation.", evidence: "NASA page description.", swatch: "#6b5a2a", hue: [25, 110], minSat: 0.2, minLum: 0.1, maxLum: 0.32, voice: "reed" },
          { id: "tall", label: "Bright green (taller vegetation)", meaning: "Taller vegetation (white, the very top of the scale, is excluded).", evidence: "NASA page description and on-screen colour bar.", swatch: "#b9e07a", hue: [55, 110], minSat: 0.25, minLum: 0.45, voice: "bell" },
        ],
      },
      changeNormMax: 0.037,
    },
    sonification: sonification({ rootMidi: 45, shareForFullVelocity: 0.1, signalForFullPad: 0.4, noteThreshold: 0.002 }),
    mapping: [
      { feature: "Share of vegetation pixels", origin: "image-derived", sound: "Pad loudness", detail: "Smoothed." },
      { feature: "Brown–dark green pixels", origin: "image-derived", sound: "Reed voice (low)", detail: "Shorter vegetation colour family." },
      { feature: "Bright green pixels", origin: "image-derived", sound: "Bell voice (high)", detail: "Taller vegetation colour family." },
      { feature: "Frame-to-frame change", origin: "image-derived", sound: "Soft percussion density", detail: "Mostly globe rotation." },
    ],
    disabledControls: [{ control: "Canopy height in metres", reason: "Exaggerated 3D rendering; colours are not decoded to metres." }],
    visualDescription: "A blue globe rotating slowly, its continents covered in a textured carpet of green. Forests stand up as raised, exaggerated bristles: bright green in the tropics of South America, Africa and Southeast Asia, browner in drier regions. A 'Height Above Ground' colour bar from 0 to 50 metres sits at the lower left.",
  },
  {
    id: "svs-5669",
    svsId: 5669,
    title: "GEOS Aerosols (2025)",
    shortTitle: "GEOS Aerosols — 19 Aug 2025 (still)",
    category: "Atmosphere · model output (GEOS-FP)",
    sourcePage: "https://svs.gsfc.nasa.gov/5669/",
    status: "playable",
    assetId: "svs5669-geos-aerosols-2025-08-19",
    presentation: { kind: "still-scan", scanDurationS: 48, bandWidth: 1 / 48 },
    publication: { released: "2026-08-10", updated: "2026-08-10" },
    coverage: {
      summary: "A single model time: 19 August 2025, 20:00 UTC.",
      start: "2025-08-19T20:00:00Z",
      basis: "NASA page caption and dataset date range (GEOS-FP 2 km replay).",
    },
    summary: "A still image of modelled aerosols on 19 August 2025: sea salt, dust, smoke/black carbon and sulfates, including Hurricane Erin and Saharan dust.",
    pageDescription:
      "This visualization still, captured for August 19, 2025 (20:00 UTC), is based on NASA's Goddard Earth Observing System (GEOS) model. Different colors represent different types of aerosols: sea salt (blue), dust (pink/magenta), smoke from fires (orange/red), and sulfates from pollution and volcanoes (green).",
    interpretation: [
      "The NASA page currently presents a single still image, so we scan it left to right like a radar sweep (method inspired by NASA's Caldwell 73 sonification).",
      "Playback position is the scan position across the image, not time passing in the atmosphere.",
      "NASA's colour legend labels the red group 'Black Carbon'; the page text calls it 'smoke from fires'. Both names are shown.",
    ],
    cautions: [
      "Scan position is screen x, not a verified longitude: NASA does not state the map projection for this 16:9 still.",
      "Colour groups are estimated from pixel hues; mixed colours where aerosol types overlap are assigned to the nearest group or ignored.",
      "This is model output (GEOS-FP), not a measurement or a current air-quality advisory.",
    ],
    camera: { moves: false, disclosure: "Still image; only the scan line moves." },
    credits: [
      { role: "Data visualizer", people: ["Joseph V. Ardizzone (NASA/GSFC)", "Helen-Nicole Kostis (Science and Technology Corporation)"] },
      { role: "Scientist", people: ["Lesley Ott (NASA/GSFC)"] },
    ],
    datasets: ["GEOS Forward Processing 2 km replay (GEOS-FP), 19 August 2025"],
    legend: {
      url: `${SVS}/a005600/a005669/Aerosols_cbar.png`,
      alt: "Aerosols legend with four swatches: Black Carbon (red-orange), Dust (lilac), Sea Salt (grey-teal), Sulfate (green).",
      description: "NASA legend: Black Carbon, Dust, Sea Salt, Sulfate.",
    },
    phases: [],
    observationMapping: {
      type: "fixed",
      observation: { kind: "instant", start: "2025-08-19T20:00:00Z", label: "Model time 19 Aug 2025 20:00 UTC (whole image)", basis: "page-stated-coverage" },
      evidence: "NASA page caption.",
    },
    analysis: {
      sampleWidth: 480,
      exclude: [],
      signal: { minLum: 0.2, minSat: 0.08, brightLum: 2, description: "Coloured aerosol pixels; grey land, dark ocean and city lights ignored." },
      colorGroupsByPhase: {
        default: [
          { id: "black-carbon", label: "Black Carbon / smoke (red-orange)", meaning: "Legend: 'Black Carbon'. Page text: 'smoke from fires (orange/red)'.", evidence: "NASA legend swatch rgb(210,94,69), hue ≈11°.", swatch: "#d25e45", hue: [355, 28], minSat: 0.4, minLum: 0.25, voice: "reed" },
          { id: "dust", label: "Dust (lilac / pink-magenta)", meaning: "Legend: 'Dust'. Page text: 'dust (pink/magenta)'.", evidence: "NASA legend swatch rgb(193,154,220), hue ≈276°.", swatch: "#c19adc", hue: [262, 320], minSat: 0.2, minLum: 0.45, voice: "glass" },
          { id: "sea-salt", label: "Sea salt (grey-teal / blue)", meaning: "Legend: 'Sea Salt'. Page text: 'sea salt (blue)'.", evidence: "NASA legend swatch rgb(133,170,169), hue ≈178°, low saturation.", swatch: "#85aaa9", hue: [165, 215], minSat: 0.08, maxSat: 0.5, minLum: 0.45, voice: "pluck" },
          { id: "sulfate", label: "Sulfate (green)", meaning: "Legend: 'Sulfate'. Page text: 'sulfates from pollution and volcanoes (green)'.", evidence: "NASA legend swatch rgb(83,220,52), hue ≈109°.", swatch: "#53dc34", hue: [85, 140], minSat: 0.45, minLum: 0.25, voice: "bell" },
        ],
      },
      changeNormMax: 0.16,
    },
    sonification: sonification({ rootMidi: 48, stepS: 0.25, smoothingS: 0.35, shareForFullVelocity: 0.05, signalForFullPad: 0.34, noteThreshold: 0.004 }),
    mapping: [
      { feature: "Share of aerosol-coloured pixels in the scan band", origin: "image-derived", sound: "Pad loudness", detail: "The band sweeps left → right over 48 s." },
      { feature: "Black carbon / smoke", origin: "image-derived", sound: "Reed voice", detail: "Lightness → pitch, share → loudness." },
      { feature: "Dust", origin: "image-derived", sound: "Glass voice", detail: "Lightness → pitch, share → loudness." },
      { feature: "Sea salt", origin: "image-derived", sound: "Pluck voice", detail: "Lightness → pitch, share → loudness." },
      { feature: "Sulfate", origin: "image-derived", sound: "Bell voice", detail: "Lightness → pitch, share → loudness." },
      { feature: "Band-to-band change", origin: "image-derived", sound: "Soft percussion density", detail: "Spatial change between neighbouring bands, not time." },
    ],
    disabledControls: [{ control: "Concentration values", reason: "The still image has categorical colours only; no concentrations are published with it." }],
    visualDescription:
      "Flat world map at night-dark tones. A lilac plume of Saharan dust stretches across the Atlantic toward the Caribbean, where Hurricane Erin spins as a small swirl. Bright green sulfate streams wrap the northern Pacific and Asia, red-orange smoke rises over southern Africa and Spain, and grey-blue sea-salt swirls cover the southern oceans.",
  },
];

/** Method reference only: astronomical, never treated as Earth data. */
export const METHOD_REFERENCES = [
  {
    svsId: 13786,
    title: "Data Sonification: Caldwell 73",
    sourcePage: "https://svs.gsfc.nasa.gov/13786/",
    note: "A Hubble image of a globular cluster sonified with a radar-style scan (credit: SYSTEM Sounds, M. Russo and A. Santaguida). We borrow only the method: a sweeping scan and distinct timbres per colour family. It is astronomical content and is not used as Earth data.",
  },
];

export const EIC_COLLECTION_URL = "https://svs.gsfc.nasa.gov/gallery/earth-information-center/";

export function getSource(id: string): SourceDefinition | undefined {
  return SOURCES.find((s) => s.id === id);
}
