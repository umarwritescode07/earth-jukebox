import * as Tone from 'tone';

const nasaData = [
  { year: 1880, value: -0.16 },
  { year: 1890, value: -0.37 },
  { year: 1900, value: -0.08 },
  { year: 1910, value: -0.40 },
  { year: 1920, value: -0.27 },
  { year: 1930, value: -0.16 },
  { year: 1940, value: 0.12 },
  { year: 1950, value: -0.18 },
  { year: 1960, value: -0.03 },
  { year: 1970, value: 0.02 },
  { year: 1980, value: 0.26 },
  { year: 1990, value: 0.45 },
  { year: 2000, value: 0.42 },
  { year: 2010, value: 0.72 },
  { year: 2023, value: 1.18 }
];

const app = document.querySelector('#app');
if (!app) {
  throw new Error('The app root element (#app) was not found.');
}

app.innerHTML = `
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #07111f;
      color: #f1f5f9;
    }

    * { box-sizing: border-box; }

    body {
      min-width: 320px;
      max-width: none;
      min-height: 100vh;
      margin: 0;
      padding: 0;
      background:
        radial-gradient(ellipse at 10% 5%, rgba(14, 116, 144, 0.2), transparent 40%),
        radial-gradient(ellipse at 95% 95%, rgba(30, 64, 175, 0.18), transparent 42%),
        #07111f;
      color: #f1f5f9;
    }

    #app {
      display: grid;
      min-height: 100vh;
      place-items: center;
      padding: clamp(1rem, 4vw, 3rem);
    }

    .jukebox {
      width: min(100%, 44rem);
      padding: clamp(1.25rem, 4vw, 2.5rem);
      border: 1px solid #26364a;
      border-radius: 1.25rem;
      background: linear-gradient(145deg, rgba(17, 31, 49, 0.98), rgba(11, 23, 39, 0.98));
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
    }

    .eyebrow, .metric-label {
      color: #7dd3fc;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .eyebrow { margin: 0 0 0.5rem; }
    h1 { margin: 0; font-size: clamp(1.7rem, 5vw, 2.35rem); line-height: 1.15; }
    .intro { max-width: 58ch; margin: 0.8rem 0 1.5rem; color: #cbd5e1; line-height: 1.6; }

    .readout {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
      margin: 1.5rem 0;
    }

    .metric {
      min-width: 0;
      padding: 1rem;
      border: 1px solid #33465d;
      border-radius: 0.85rem;
      background: #101f32;
    }

    .metric-label { display: block; color: #a9bdd1; letter-spacing: 0.06em; }
    .metric-value { display: block; margin-top: 0.4rem; font-size: clamp(1.65rem, 5vw, 2.25rem); font-variant-numeric: tabular-nums; }
    #value-display.warm { color: #fda4af; }
    #value-display.cool { color: #7dd3fc; }

    .timeline { margin: 1.5rem 0; }
    .slider-heading, .range-labels, .controls { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
    .slider-heading label { font-weight: 700; }
    #selected-year { color: #bae6fd; font-variant-numeric: tabular-nums; font-weight: 700; }
    input[type="range"] { display: block; width: 100%; margin: 1rem 0 0.35rem; accent-color: #38bdf8; cursor: pointer; }
    .range-labels { color: #cbd5e1; font-size: 0.8rem; }
    .help, .mapping, .data-note { color: #cbd5e1; font-size: 0.88rem; line-height: 1.55; }
    .help { margin: 0.7rem 0 0; }

    .controls { justify-content: flex-start; margin: 1.5rem 0 0.85rem; }
    button {
      min-height: 2.9rem;
      padding: 0.75rem 1rem;
      border: 1px solid transparent;
      border-radius: 0.7rem;
      color: #f8fafc;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    button:focus-visible, input:focus-visible, a:focus-visible {
      outline: 3px solid #facc15;
      outline-offset: 3px;
    }

    #play-btn { flex: 1; background: #047857; }
    #play-btn:hover:not(:disabled) { background: #059669; }
    #stop-btn { border-color: #52657c; background: #17283d; }
    #stop-btn:hover:not(:disabled) { background: #243a54; }
    button:disabled { cursor: not-allowed; opacity: 0.55; }

    .status { min-height: 1.4em; margin: 0; color: #bae6fd; font-size: 0.9rem; }
    .mapping { margin: 1rem 0 0; }
    .data-note { margin: 1rem 0 0; padding-top: 1rem; border-top: 1px solid #33465d; color: #a9bdd1; }
    .data-note a { color: #7dd3fc; }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 420px) {
      .readout { grid-template-columns: 1fr; }
      .controls { align-items: stretch; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; }
    }
  </style>

  <section class="jukebox" aria-labelledby="jukebox-title">
    <header>
      <p class="eyebrow">NASA Space Apps · Climate sonification</p>
      <h1 id="jukebox-title">Earth Information Jukebox</h1>
      <p class="intro">Explore selected global temperature-anomaly milestones through sound. Use the timeline to preview a year or play the sequence.</p>
    </header>

    <section class="readout" aria-label="Selected climate data">
      <div class="metric">
        <span id="selected-year-label" class="metric-label">Selected year</span>
        <span id="year-display" class="metric-value" aria-labelledby="selected-year-label">1880</span>
      </div>
      <div class="metric">
        <span id="anomaly-label" class="metric-label">Temperature anomaly</span>
        <span id="value-display" class="metric-value cool" aria-labelledby="anomaly-label">-0.16°C</span>
      </div>
    </section>

    <section class="timeline" aria-label="Climate timeline">
      <div class="slider-heading">
        <label for="year-slider">Explore sample years</label>
        <span id="selected-year" aria-hidden="true">1880</span>
      </div>
      <input id="year-slider" type="range" min="0" max="${nasaData.length - 1}" step="1" value="0" aria-describedby="slider-help" aria-valuetext="Year 1880, temperature anomaly -0.16 degrees Celsius">
      <div class="range-labels" aria-hidden="true"><span>1880</span><span>2023</span></div>
      <p id="slider-help" class="help">Use the left and right arrow keys to select a year. Each selection plays its note.</p>
    </section>

    <div class="controls" aria-label="Audio playback controls">
      <button id="play-btn" type="button">Play climate symphony</button>
      <button id="stop-btn" type="button" disabled>Stop</button>
    </div>
    <p id="player-status" class="status" aria-live="off">Ready to play.</p>

    <p class="mapping"><strong>How the sound maps:</strong> lower anomalies use lower notes; higher anomalies use higher notes on a minor pentatonic scale.</p>
    <p class="data-note">Prototype note: this demo contains 15 selected sample points, not the complete annual record. Verify the values against the <a href="https://data.giss.nasa.gov/gistemp/" target="_blank" rel="noopener noreferrer">NASA GISTEMP data portal</a> before presenting it as a full dataset.</p>
    <div id="sr-announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true">Audio player ready. Use the timeline or playback controls to explore climate data.</div>
  </section>
`;

const yearEl = document.getElementById('year-display');
const valueEl = document.getElementById('value-display');
const yearSlider = document.getElementById('year-slider');
const selectedYearEl = document.getElementById('selected-year');
const srAnnouncer = document.getElementById('sr-announcer');
const playerStatus = document.getElementById('player-status');
const playButton = document.getElementById('play-btn');
const stopButton = document.getElementById('stop-btn');

const noteScale = [48, 51, 53, 55, 58, 60, 63, 65, 67, 70, 72, 75, 77];
const minAnomaly = -0.5;
const maxAnomaly = 1.5;

let synth = null;
let audioInitialization = null;
let playbackToken = 0;
let currentIndex = 0;
let isPlaying = false;

function formatAnomaly(value) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function updateDataDisplay(index, announce = false) {
  const item = nasaData[index];
  if (!item) {
    throw new RangeError(`No climate data point exists at index ${index}.`);
  }

  currentIndex = index;
  const formattedValue = formatAnomaly(item.value);
  const spokenValue = `${formattedValue} degrees Celsius`;

  yearEl.textContent = String(item.year);
  valueEl.textContent = `${formattedValue}°C`;
  valueEl.classList.toggle('warm', item.value > 0);
  valueEl.classList.toggle('cool', item.value <= 0);
  selectedYearEl.value = String(item.year);
  yearSlider.setAttribute('aria-valuetext', `Year ${item.year}, temperature anomaly ${spokenValue}`);

  if (announce) {
    srAnnouncer.textContent = `Year ${item.year}, temperature anomaly ${spokenValue}.`;
  }

  return item;
}

function valueToFrequency(value) {
  const normalized = Math.max(0, Math.min(1, (value - minAnomaly) / (maxAnomaly - minAnomaly)));
  const scaleIndex = Math.round(normalized * (noteScale.length - 1));
  return Tone.Midi(noteScale[scaleIndex]).toFrequency();
}

async function initAudio() {
  await Tone.start();
  if (synth) {
    return;
  }

  if (!audioInitialization) {
    audioInitialization = Promise.resolve().then(() => {
      const reverb = new Tone.Reverb({ roomSize: 0.65, wet: 0.2 }).toDestination();
      synth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.04, decay: 0.1, sustain: 0.28, release: 0.12 },
        volume: -6
      }).toDestination();
      synth.connect(reverb);
    });
  }

  try {
    await audioInitialization;
  } catch (error) {
    audioInitialization = null;
    throw error;
  }
}

function stopPlayback() {
  playbackToken += 1;
  Tone.Transport.stop();
  Tone.Transport.cancel();
  isPlaying = false;
  playButton.disabled = false;
  playButton.textContent = 'Play climate symphony';
  stopButton.disabled = true;
}

function reportAudioError(error) {
  const detail = error instanceof Error ? error.message : String(error);
  playerStatus.textContent = 'Audio could not start. Check the browser audio permission and try again.';
  srAnnouncer.textContent = 'Audio could not start. Check the browser audio permission and try again.';
  console.error('Audio playback failed:', detail);
}

updateDataDisplay(0);

yearSlider.addEventListener('input', () => {
  updateDataDisplay(Number(yearSlider.value));
});

yearSlider.addEventListener('change', async () => {
  const index = Number(yearSlider.value);
  const item = updateDataDisplay(index, true);
  stopPlayback();
  playerStatus.textContent = `Previewing ${item.year}.`;

  try {
    await initAudio();
    synth.triggerAttackRelease(valueToFrequency(item.value), '8n');
  } catch (error) {
    reportAudioError(error);
  }
});

playButton.addEventListener('click', async () => {
  if (isPlaying) {
    return;
  }

  playButton.disabled = true;
  playerStatus.textContent = 'Starting audio…';

  try {
    await initAudio();
    Tone.Transport.stop();
    Tone.Transport.cancel();

    const runToken = ++playbackToken;
    let index = 0;
    isPlaying = true;
    playButton.textContent = 'Playing…';
    stopButton.disabled = false;
    playerStatus.textContent = `Playing ${nasaData[0].year}–${nasaData[nasaData.length - 1].year}.`;
    Tone.Transport.bpm.value = 140;

    Tone.Transport.scheduleRepeat((time) => {
      if (runToken !== playbackToken) {
        return;
      }

      if (index >= nasaData.length) {
        Tone.Transport.stop(time);
        Tone.Draw.schedule(() => {
          if (runToken !== playbackToken) {
            return;
          }
          isPlaying = false;
          playButton.disabled = false;
          playButton.textContent = 'Play climate symphony';
          stopButton.disabled = true;
          playerStatus.textContent = 'Playback complete.';
        }, time);
        return;
      }

      const dataIndex = index++;
      const item = nasaData[dataIndex];
      synth.triggerAttackRelease(valueToFrequency(item.value), '8n', time);

      Tone.Draw.schedule(() => {
        if (runToken !== playbackToken) {
          return;
        }
        const shouldAnnounce = dataIndex === 0 || dataIndex % 7 === 0 || dataIndex === nasaData.length - 1;
        updateDataDisplay(dataIndex, shouldAnnounce);
        playerStatus.textContent = `Playing ${item.year}: ${formatAnomaly(item.value)}°C.`;
      }, time);
    }, '4n');

    Tone.Transport.start();
  } catch (error) {
    stopPlayback();
    reportAudioError(error);
  }
});

stopButton.addEventListener('click', () => {
  const item = nasaData[currentIndex];
  stopPlayback();
  playerStatus.textContent = `Playback stopped at ${item.year}.`;
  srAnnouncer.textContent = `Playback stopped at year ${item.year}, temperature anomaly ${formatAnomaly(item.value)} degrees Celsius.`;
});