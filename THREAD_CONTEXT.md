# Thread Context

This repository came from a non-botting advisory audio cue detector exploration.

## Safety Boundary

Do not automate or control World of Warcraft gameplay. Do not attach to the game process, read game memory, inspect packets, use hidden game state, send keystrokes or clicks, or automate rating gain.

The allowed direction is a separate advisory process that listens to microphone, system, or remote-device audio and emits human-facing guidance such as `RUN`, `ATTACK`, or `NEUTRAL`.

## Implemented

The project contains:

- `build_audio_index.py`: scans local loose audio clips and builds numeric spectral fingerprints only.
- `detect_audio_stream.py`: reads signed 16-bit little-endian mono PCM from stdin in 128-byte chunks.
- `actions.example.json`: maps path/name substrings to advisory actions.
- `Dockerfile`: packages the detector with Python, NumPy, and ffmpeg.
- `README.md`: includes local and Docker usage.

At 16 kHz, 128 bytes is 64 samples, or 4 ms. Detection accumulates short rolling windows for stable frequency matching and emits JSON events with fields such as `t_stream_ms`, `label`, `action`, `score`, `matched_ms`, and `source`.

The detector includes cooldown and global cooldown logic to reduce duplicate or tail detections.

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

Local tooling observed during setup:

- `ffmpeg`: `/opt/homebrew/bin/ffmpeg`
- `python3`: `/opt/homebrew/bin/python3`
- Python `numpy`: available
- Python `scipy`, `sounddevice`, `soundfile`, `librosa`: not available locally
- Docker CLI: available, but Docker daemon was not running during verification

## Verification Already Run

- Indexed 40 loose addon clips into `/tmp/wow-audio-cues.json`.
- `python3 -m py_compile build_audio_index.py detect_audio_stream.py` passed.
- Quiet PCM input produced no detections.
- `alarmbeep.ogg` detected at 80 ms as `RUN` with score `1.0` and `matched_ms` `64.0`.
- `Details Horn.ogg` detected at 80 ms as `ATTACK` with score `1.0` and `matched_ms` `64.0`.

Docker build was not verified locally because the Docker daemon was unavailable.

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

- Verify Docker build when the daemon is running.
- Add an optional overlay or audio-output notifier that consumes detector JSON events.
- Add tests with synthetic PCM fixtures.
- Add a remote-device stream bridge that feeds raw 16 kHz mono `s16le` PCM into stdin.
- Tune thresholds against real microphone recordings.
