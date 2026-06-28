# Thread Context

This repository came from a non-botting advisory audio cue detector exploration.

## Safety Boundary

Do not automate or control World of Warcraft gameplay. Do not attach to the game process, read game memory, inspect packets, use hidden game state, send keystrokes or clicks, or automate rating gain.

The allowed direction is a separate advisory webpage that listens to microphone, loopback/system, or remote-device audio and emits human-facing guidance such as `PUSH`, `PULL`, or `NEUTRAL`.

## Current Direction

The project has been pivoted to a browser-native Web Audio implementation. Do not use Swift or Python for the project.

The app runs as a webpage. The user clicks to enable `AudioContext`, grants browser audio permission, selects a browser-visible audio input, loads local cue audio files, and runs advisory detection in JavaScript.

Browser APIs cannot directly capture macOS output-only devices such as `External Headphones`. To inspect game output audio, the browser must be given a loopback/system-audio input source that appears in `navigator.mediaDevices.enumerateDevices()`.

## Implemented

The project contains:

- `index.html`: the Web Audio UI.
- `app.js`: in-browser cue indexing and live detection.
- `styles.css`: UI styling.
- `actions.example.json`: maps path/name substrings to advisory strategy labels.
- `PROMPT.md`: continuation prompt for future work.
- `README.md`: includes local webpage usage.

Detection accumulates short rolling Web Audio analysis windows for stable frequency matching and logs events with fields such as time, label, action, and strategy score.

The detector includes cooldown and global cooldown logic to reduce duplicate or tail detections.

The current app normalizes legacy `ATTACK` and `RUN` strategy-map values to `PUSH` and `PULL` for compatibility, but user-facing output should stay on `PUSH`, `PULL`, and `NEUTRAL`.

## Local Findings

Original workspace:

```text
/Applications/World of Warcraft/_retail_
```

Core Blizzard audio appears to live in CASC storage under:

```text
/Applications/World of Warcraft/Data
```

The tool intentionally indexes only ordinary audio files explicitly provided by the user, such as addon sounds or user-exported cue clips. It does not copy or embed audio content.

Local tooling observed during the Web Audio pivot:

- Node.js: available at `/usr/local/bin/node`

The project should remain a static browser app with no Python, Swift, ffmpeg, or Docker runtime path.

## Verification Already Run

- Static assets were served from localhost.
- `node --check app.js` passed.
- `curl` confirmed `index.html`, `app.js`, and `styles.css` are reachable from the local server.

Browser automation timed out before visual inspection, so user-gesture audio permission and live input capture still need manual verification in the opened page.

## GitHub State At Creation

Public repository:

```text
https://github.com/yishengjiang99/audio-cue-detector
```

Branch:

```text
dockerize-audio-cue-detector
```

Initial commit:

```text
ca9f7907b0442cc02440be7b1c90954c35576f10 Add Dockerized audio cue detector
```

## Next Plausible Work

- Verify the webpage in a browser after the user clicks to enable audio.
- Improve cue-file indexing accuracy.
- Add export/import of cue fingerprints without embedding audio.
- Add optional browser overlay/audio cue output.
- Tune thresholds against real browser-captured loopback audio.
