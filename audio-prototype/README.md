# Climate audio prototype

This standalone Vite/Tone.js prototype lets users explore selected global temperature-anomaly milestones with a timeline slider and audio playback. It is separate from the main Next.js app.

The demo contains 15 selected sample points, not the complete annual record. Verify the values against NASA GISTEMP before presenting them as authoritative climate data.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Audio begins after a user interaction, as required by browser audio policies.

To check the production bundle, run `npm run build`.
