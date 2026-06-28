# Thread Context

This repository is a non-botting advisory audio cue detector for WoW Solo Shuffle.

## Safety Boundary

Do not automate or control World of Warcraft gameplay. Do not attach to the game
process, read game memory, inspect packets, use hidden game state, send keystrokes
or clicks, or automate rating gain.

The allowed direction is a separate advisory webpage that listens to microphone,
loopback/system, or remote-device audio and emits human-facing guidance such as
`PUSH`, `PULL`, or `NEUTRAL`.

## Current Direction

Browser-native Web Audio implementation only. No Python, Swift, Docker, or ffmpeg
in the normal runtime path.

The app runs as a static webpage deployed to GitHub Pages and served locally via
`npm start` / `bin/audio-cue-coach.js`.

## Implemented

- `index.html`: tabbed UI (Live Coach, Cue Library, Analysis Session).
- `app.js`: mel-spectral matching, waveform/spectrum visualizers, cue library,
  live recording, fingerprint export/import, combat-log session workflow.
- `combat-log.js`: WoW combat log parser and timeline alignment helpers.
- `styles.css`: dark-themed UI.
- `actions.example.json`: strategy substring map.
- `bin/audio-cue-coach.js` + `package.json`: local static server.
- `.github/workflows/pages.yml`: deploy static site on push to `main`.
- `README.md`, `agent.md`, `PROMPT.md`: user and agent documentation.

Detection uses rolling Web Audio feature windows with per-cue refractory and
global action cooldown. User-facing output is `PUSH`, `PULL`, `NEUTRAL`.

Analysis Sessions require user review before examples enter the cue library.

## GitHub State

- Remote: `https://github.com/yishengjiang99/audio-cue-detector`
- Default branch: `main`
- Pages: `https://yishengjiang99.github.io/audio-cue-detector/`
- Merged PR #1 brought `dockerize-audio-cue-detector` into `main`.

## Remote Persistence Policy

Agents should commit and push to `origin/main` at reasonable intervals after
coherent changes, updating relevant docs (`README.md`, `agent.md`,
`THREAD_CONTEXT.md`, `PROMPT.md`) in the same pass. See `agent.md` for the
full checklist.

## Verification Already Run

- `node --check` on `app.js`, `combat-log.js`, `bin/audio-cue-coach.js`.
- Local static server serves `index.html`, `app.js`, `styles.css`.
- GitHub Pages returns 200 for `/` and `/app.js`.
- GitHub Actions Pages deploy succeeds on push to `main`.

Browser audio permission and live loopback capture still need manual verification
in the opened page.

## Next Plausible Work

- Manual browser verification with BlackHole loopback on macOS.
- Tune thresholds against real browser-captured arena audio.
- Improve cue-file indexing accuracy and combat-log alignment heuristics.
- Optional browser overlay or advisory audio cue output.