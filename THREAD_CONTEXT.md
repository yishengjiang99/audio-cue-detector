# Thread Context

This repository is a non-botting advisory audio cue detector for WoW Solo Shuffle.

## Safety Boundary

Do not automate or control World of Warcraft gameplay. Do not attach to the game
process, read game memory, inspect packets, use hidden game state, send keystrokes
or clicks, or automate rating gain.

The allowed direction is a separate advisory webpage that listens to a
user-chosen **microphone** and emits human-facing guidance such as `PUSH`,
`PULL`, or `NEUTRAL`. Loopback/system output capture is not supported.

## Current Direction

Browser-native Web Audio implementation only. No Python, Swift, Docker, or ffmpeg
in the normal runtime path.

The app runs as a static webpage deployed to GitHub Pages and served locally via
`npm start` / `bin/audio-cue-coach.js`. Live input is microphone-only: user
clicks **Choose Microphone**, loopback/virtual devices are filtered out.

## Evolution (git history)

| Phase | Commits | What shipped |
|-------|---------|--------------|
| Prototype | `ca9f790` → `e431d02` | Dockerized detector; pivoted to browser-native Web Audio |
| Core v1 | `167de13`, PR #1 | Full UI, live coach, cue library, combat-log sessions, npm dev server |
| Safety & perf | `61f15f1`, `0e09b3c` | Microphone-only input; AudioWorklet live detection; advisory tone queue |
| Quality & deploy | `f213a87`, `71fb4db`, `4e08ba7` | GitHub Pages; Playwright e2e (mocked mic); CI workflow |
| Training & polish | `cef6aa6`, `0e24d57` | YouTube VOD fingerprint trainers; 2400-rating hero landing |

Early Docker artifacts were removed on pivot; no stale runtime path remains.

## Implemented (v1 complete vs PROMPT.md)

- `index.html`: tabbed UI (Live Coach, Cue Library, Analysis Session) with 2400 hero landing.
- `app.js`: main-thread UI, advisory audio queue, worklet message handling, session workflow.
- `cue-processor.js`: `AudioWorkletProcessor` analysis in `process()`, posts verdicts to main thread.
- `audio-dsp.js`: shared feature extraction for cue indexing.
- Mel-spectral matching, waveform/spectrum visualizers, cue library, live recording,
  fingerprint export/import, combat-log session workflow.
- `combat-log.js`: WoW combat log parser and timeline alignment helpers.
- `styles.css`: dark-themed UI.
- `actions.example.json`: strategy substring map.
- `bin/audio-cue-coach.js` + `package.json`: local static server.
- `.github/workflows/pages.yml`: deploy static site on push to `main`.
- `.github/workflows/e2e.yml`: Playwright e2e on push/PR to `main`.
- `training/`: optional Node.js / Python YouTube VOD fingerprint trainers.
- `README.md`, `agent.md`, `PROMPT.md`: user and agent documentation.

Detection uses rolling Web Audio feature windows with refractory gating and global
action cooldown. User-facing output is `PUSH`, `PULL`, `NEUTRAL`.

Analysis Sessions require user review before examples enter the cue library.

## Known Gaps (assessment 2026-06-28)

### Highest risk: unvalidated in real arena conditions

- E2e tests use a mocked microphone (`tests/helpers/media-mock.js`); no commit covers
  actual arena mic capture.
- Default threshold (`0.86`) is untuned for noisy speaker-room audio.
- Browser microphone permission still needs manual verification in the opened page.

### Test coverage holes

E2e (`tests/e2e/app.spec.js`) covers page load, hero CTA, disclaimer, tabs, mic
selection, cue upload, and status grid. **Not tested:**

- Start/stop live detection and verdict → decision display
- Advisory tone playback
- Analysis Session: combat log upload, offset suggest, proposal generate/confirm
- Fingerprint import/export round-trip
- `combat-log.js` parsing (no unit tests)

### Usability gaps

- **Cue library does not persist across reloads.** `state.cues` is in-memory only;
  refresh loses the library unless the user re-imports fingerprints.
- Export/import exists but is manual — friction for daily use.

### Code / doc mismatches

- README describes "per-cue refractory" but `handleWorkletVerdict` in `app.js` uses a
  single global `state.lastHitAt` cooldown for all cues.
- `cue-processor.js` duplicates ~90 lines of mel/FFT/scoring from `audio-dsp.js`
  (AudioWorklet cannot import ES modules the same way). No automated parity test;
  drift could cause false negatives.

### Recommendation logic limitations

- Winner-take-all: highest-scoring cue wins; no margin check when PUSH and PULL cues
  score similarly.
- Decision display resets to NEUTRAL after 900 ms even if the sound is ongoing.
- No explicit negative/NEUTRAL cue examples in matching.

### Combat-log alignment

- `suggestAlignmentOffset` correlates audio envelope with event density — workable
  but fragile with clock drift, long pauses, or sparse logs.
- No scrub-to-align or event-click-to-snap UX.

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
- Playwright e2e passes with mocked microphone and AudioWorklet.

## Prioritized Next Work

### Tier 1 — Validate before tuning

1. Manual arena session with physical mic; log false positive/negative rates at default threshold.
2. E2e spec asserting live detection verdict from mocked mic matching test fixture.

### Tier 2 — Daily usability

3. Persist cue library to `localStorage` or IndexedDB (fingerprints + labels; audio blobs optional).
4. Fix refractory semantics: per-cue `Map<cueId, lastHitAt>` or correct UI/README copy.
5. Score-margin gate when multiple cues match (especially PUSH vs PULL conflicts).

### Tier 3 — Data pipeline quality

6. Unit tests for `combat-log.js` (fixture lines + alignment helpers).
7. DSP parity test between `audio-dsp.js` indexing and worklet live path.
8. Analysis Session e2e (combat log + session WAV → proposals → confirm).

### Tier 4 — Detection accuracy (after real-world data)

9. Pre-emphasis / noise gate tuned for speaker bleed.
10. Multi-cue ensemble scoring (aggregate PUSH vs PULL across top-N matches).
11. Position-aware filtering using optional stereo/ACL metadata in live matching.

### Tier 5 — Polish (optional)

12. Browser overlay (picture-in-picture or always-on-top panel).
13. Preset threshold profiles ("Aggressive PUSH", "Defensive PULL", "Quiet room").
14. Training pipeline CI smoke on royalty-free WAV (not copyrighted VOD).

### Recommended next sprint

Make recommendations trustworthy enough for a real arena session:

1. Real mic validation + threshold notes in README
2. Per-cue refractory fix + score-margin gate in `cue-processor.js` / `app.js`
3. `localStorage` persistence for cue library
4. One new e2e test: mocked mic → live verdict
5. Unit tests for combat-log parser (5–10 fixture lines)