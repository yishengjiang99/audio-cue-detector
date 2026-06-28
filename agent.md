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

Allowed work: Web Audio analysis, user-provided cue files, browser-captured **microphone** audio (no loopback), user-exported combat logs, and fingerprint export/import (numeric features + labels only).

User-facing actions are **`PUSH`**, **`PULL`**, and **`NEUTRAL`**. Legacy `ATTACK` / `RUN` map values normalize to `PUSH` / `PULL`.

## Stack

- Static webpage: `index.html`, `app.js`, `styles.css`, `combat-log.js`
- Local dev server: `bin/audio-cue-coach.js` via `npm start` (`package.json`)
- No Python, Swift, Docker, or ffmpeg in the **browser runtime** path
- Optional offline trainers under `training/` may use Node, Python, `yt-dlp`, and `ffmpeg`

## Required Workflow

- Keep the app fully client-side; all cue extraction and matching stays in JavaScript.
- Require explicit user gesture before `AudioContext` starts.
- Audio input is **microphone-only**. Filter virtual loopback devices from the picker; require **Choose Microphone** click before `getUserMedia`.
- Analysis Session examples require **user review and confirm** — never auto-add to the cue library.
- Update `THREAD_CONTEXT.md` when pivoting architecture or recording verification state.
- Use `PROMPT.md` as the continuation spec for new feature work.
- Pushes to `main` deploy the static site via `.github/workflows/pages.yml`.

## Remote Persistence (always)

**Persist work to `origin/main` at reasonable intervals.** Do not let large uncommitted
sessions accumulate locally.

### When to commit and push

- After completing a coherent unit of work (feature slice, bugfix, or doc pass).
- Before ending a session if there are staged-quality changes.
- After verification steps pass (`node --check`, local serve, or workflow green).
- At least once per meaningful agent turn when files changed — never leave completed
  work only on disk.

### What to update alongside code

| Change type | Update |
|-------------|--------|
| User-facing behavior, setup, or URLs | `README.md` |
| Architecture, safety, git/Pages workflow | `agent.md` (this file) |
| Implemented state, verification, next steps | `THREAD_CONTEXT.md` |
| Product goals or feature spec | `PROMPT.md` |
| Strategy substring examples | `actions.example.json` |
| Deploy or CI | `.github/workflows/` |

Keep commits focused with clear messages. Push to `origin/main` immediately after
commit unless the user explicitly asks to hold changes local.

## Key Files

| File | Purpose |
|------|---------|
| `app.js` | Main thread UI, advisory audio queue, worklet wiring, session workflow |
| `cue-processor.js` | `AudioWorkletProcessor` live analysis in `process()` |
| `audio-dsp.js` | Shared mel/FFT helpers for cue indexing |
| `combat-log.js` | WoW combat log parser and timeline alignment helpers |
| `actions.example.json` | Example player-authored strategy substring map |
| `bin/audio-cue-coach.js` | Node static file server for local dev |
| `PROMPT.md` | Product/architecture continuation prompt |
| `README.md` | User-facing setup and usage |
| `training/` | Offline YouTube VOD fingerprint trainers (Node + Python) |

## Run & Verify

```bash
npm start
# http://127.0.0.1:4173
```

```bash
node --check app.js
node --check combat-log.js
node --check bin/audio-cue-coach.js
npm run test:e2e
```

Browser microphone permission requires manual verification in the opened page.

## Current Caveats

- Live input is microphone-only; loopback/system output devices are excluded by design.
- Combat-log ↔ audio alignment is manual/semi-automatic; offset tuning may be needed per session.
- Stereo and Advanced Combat Logging position hints are approximate metadata only.
- `.gitignore` excludes user audio files and generated index JSON — do not commit copyrighted game audio.