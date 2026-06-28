# Agent Notes

## Repository

- Repo path: `/Users/yishengj/audio-cue-detector`
- Remote: `https://github.com/yishengjiang99/audio-cue-detector`
- Branch: `main` (default)
- GitHub Pages: `https://yishengjiang99.github.io/audio-cue-detector/`

## Product Boundary

This is a **browser-native advisory audio coach** for WoW Solo Shuffle. It must never:

- Attach to the WoW process or read game memory
- Inspect packets or infer hidden game state
- Send keystrokes, clicks, or automate gameplay
- Parse CASC assets or redistribute Blizzard audio

Allowed work: Web Audio analysis, user-provided cue files, browser-captured loopback audio, user-exported combat logs, and fingerprint export/import (numeric features + labels only).

User-facing actions are **`PUSH`**, **`PULL`**, and **`NEUTRAL`**. Legacy `ATTACK` / `RUN` map values normalize to `PUSH` / `PULL`.

## Stack

- Static webpage: `index.html`, `app.js`, `styles.css`, `combat-log.js`
- Local dev server: `bin/audio-cue-coach.js` via `npm start` (`package.json`)
- No Python, Swift, Docker, or ffmpeg in the normal runtime path

## Required Workflow

- Keep the app fully client-side; all cue extraction and matching stays in JavaScript.
- Require explicit user gesture before `AudioContext` starts.
- Document macOS loopback (BlackHole + Multi-Output Device) in UI and README when touching audio-input docs.
- Analysis Session examples require **user review and confirm** — never auto-add to the cue library.
- Update `THREAD_CONTEXT.md` when pivoting architecture or recording verification state.
- Use `PROMPT.md` as the continuation spec for new feature work.
- Keep commits focused with clear messages; push to `origin/main`.
- Pushes to `main` deploy the static site via `.github/workflows/pages.yml`.

## Key Files

| File | Purpose |
|------|---------|
| `app.js` | Live detection, cue library, session recording, UI wiring |
| `combat-log.js` | WoW combat log parser and timeline alignment helpers |
| `actions.example.json` | Example player-authored strategy substring map |
| `bin/audio-cue-coach.js` | Node static file server for local dev |
| `PROMPT.md` | Product/architecture continuation prompt |
| `README.md` | User-facing setup and usage |

## Run & Verify

```bash
npm start
# http://127.0.0.1:4173
```

```bash
node --check app.js
node --check combat-log.js
node --check bin/audio-cue-coach.js
```

Browser audio permission and loopback capture require manual verification in the opened page.

## Current Caveats

- Browsers cannot capture macOS output-only devices (e.g. External Headphones) without a loopback virtual input.
- Combat-log ↔ audio alignment is manual/semi-automatic; offset tuning may be needed per session.
- Stereo and Advanced Combat Logging position hints are approximate metadata only.
- `.gitignore` excludes user audio files and generated index JSON — do not commit copyrighted game audio.