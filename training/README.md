# YouTube Training Pipeline (Node.js / Python)

Offline tooling to build **fingerprint-only** cue libraries from labeled segments
in YouTube arena VODs. Output is compatible with **Cue Library → Import
Fingerprints** in the browser coach.

The browser app does not download YouTube audio. Training runs locally on your
machine with tools you install (`yt-dlp`, `ffmpeg`, `node`; Python optional).

## Example source

Midnight Season 1 arena VOD (edit timestamps after listening):

- [THE 3v3 GRIND BEGINS! - Midnight Season 1 Arena](https://www.youtube.com/watch?v=H6SrKEvYOKE)

Copy and customize the manifest:

```bash
cp training/sources.example.json training/sources.json
```

`training/sources.json` is gitignored — keep your labels local.

## Prerequisites

```bash
# macOS (Homebrew)
brew install yt-dlp ffmpeg node

# Python path (optional — stdlib only, calls Node for fingerprints)
python3 --version
```

## Label format (`sources.json`)

```json
{
  "sources": [
    {
      "url": "https://www.youtube.com/watch?v=H6SrKEvYOKE",
      "title": "THE 3v3 GRIND BEGINS! - Midnight Season 1 Arena",
      "segments": [
        { "start": 45.0, "end": 46.2, "label": "gate_pressure", "action": "PUSH" }
      ]
    }
  ]
}
```

- **start / end** — seconds in the VOD (fractions OK)
- **action** — `PUSH`, `PULL`, or `NEUTRAL`
- **localAudio** (optional) — skip re-download if already cached under `training/downloads/`

## Node.js trainer

```bash
node training/youtube-train.mjs training/sources.json
# or example manifest:
npm run train:youtube
```

Writes `training/output/fingerprints-<timestamp>.json`.

## Python trainer

Delegates fingerprint math to the shared Node `audio-dsp.js` extractor:

```bash
python3 training/youtube_train.py training/sources.json
# or:
npm run train:youtube:py
```

## Import into the coach

1. Open the app → **Cue Library** → **Import Fingerprints**
2. Select the JSON from `training/output/`
3. Review labels/actions; tune threshold on **Live Coach**

## Data boundaries

- Use only VODs and segments you are allowed to study (your uploads, creator
  permission, commentary/review use you are comfortable with).
- Downloaded audio stays in `training/downloads/` (gitignored).
- Committed artifacts are **numeric fingerprints + your labels** — never raw
  copyrighted audio.
- Do not datamine WoW client assets or redistribute Blizzard audio.

## Suggested workflow for 2400 Solo Shuffle

1. Watch the VOD with combat awareness; note timestamps for audible cues (enemy
   cooldowns, trinkets, healer CC, wincon horns, etc.).
2. Add segments to `sources.json` with `PUSH` / `PULL` / `NEUTRAL`.
3. Run Node or Python trainer → import fingerprints.
4. Validate with **microphone** pointed at speakers while replaying short clips,
   or refine labels in **Analysis Session** when you have a matching combat log.