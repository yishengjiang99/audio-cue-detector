# Solo Shuffle Audio Coach

Browser-native advisory audio cue matching using Web Audio. It helps a human
player react to user-provided cues with `PUSH`, `PULL`, or `NEUTRAL`
recommendations. It does not attach to World of Warcraft, read game memory,
inspect packets, send inputs, infer hidden state, or redistribute audio.

**Advisory only.** This tool coaches human decisions from audio you provide or
route into the browser. It never automates gameplay.

## Project Layout

```text
index.html          Web UI (Live Coach, Cue Library, Analysis Session)
app.js              Detection, library management, session workflow
combat-log.js       WoW combat log parser and alignment helpers
styles.css          Dark-themed UI styles
actions.example.json  Example strategy substring map
bin/audio-cue-coach.js  Local static file server
package.json        npm start / audio-cue-coach bin entry
agent.md            Contributor and agent workflow notes
```

## Run

From the project directory:

```bash
npm start
```

Or run the bin script directly:

```bash
node bin/audio-cue-coach.js
```

Optional custom port:

```bash
node bin/audio-cue-coach.js 8080
# or
PORT=8080 npm start
```

After linking globally (`npm link`), you can also run:

```bash
audio-cue-coach
```

Open locally:

```text
http://127.0.0.1:4173
```

Or use the public GitHub Pages build (deployed on every push to `main`):

```text
https://yishengjiang99.github.io/audio-cue-detector/
```

Click `Enable Audio Context`, choose a browser-visible audio input, load local
cue audio files and an optional player-authored strategy map, then start
detection.

## macOS Loopback Setup (BlackHole)

Browsers cannot capture macOS output-only devices such as `External Headphones`
directly. To hear game audio in the coach:

1. Install [BlackHole](https://existential.audio/blackhole/) (2ch is enough).
2. Open **Audio MIDI Setup** → create a **Multi-Output Device** that includes
   your headphones/speakers **and** BlackHole.
3. Set WoW (or system output) to the Multi-Output Device so you still hear
   audio locally.
4. In the browser app, select **BlackHole** as the audio input.

On Windows, use a similar loopback/virtual cable device that appears in
`navigator.mediaDevices.enumerateDevices()`.

## Features

### Live Coach

- Real-time waveform and spectrum visualizers.
- Mel-spectral fingerprint matching against your cue library.
- Tunable threshold, minimum match window, per-cue refractory period, and
  global action cooldown.
- Optional advisory tones for `PUSH` / `PULL`.
- **Record Example from Live** captures the last ~1.2 s of input while the
  service is running.

### Cue Library

- View, play (when audio blob is available), relabel, and delete cues.
- **Export Fingerprints** — JSON with labels, actions, and numeric features
  only (no copyrighted audio).
- **Import Fingerprints** — merge exported libraries from another machine.

### Analysis Session

Combine recorded fight audio with an exported `WoWCombatLog.txt` to rapidly
build labeled training data:

1. **Start Recording** (or upload session audio).
2. Upload the matching combat log (normal or Advanced Combat Logging).
3. Align log events to audio with the **Log offset** slider or **Suggest
   Offset from Audio**.
4. **Generate Proposals** — short segments around audible log events (casts,
   auras, damage).
5. **Review** each proposal: play, adjust boundaries, edit label/action, add
   approximate direction notes, then **Confirm to Library**.

Position hints from Advanced Combat Logging and stereo balance are marked
**approximate** and optional. Nothing is added automatically — you confirm every
example.

## Allowed Inputs

- User-provided audio clips.
- Browser-captured audio that the user explicitly grants.
- User-exported combat logs from `_retail_/Logs/WoWCombatLog.txt`.
- User-authored strategy maps such as `actions.example.json`.
- User notes, reviews, or manually exported data that do not require extracting
  hidden game state or game assets.

Do not datamine, reverse engineer, parse CASC assets, or bundle Blizzard/game
audio. Fingerprints store only user-generated numeric features and labels.

## Strategy Map

The map matches filename or label substrings to advisory actions:

```json
{
  "pressure": "PUSH",
  "reset": "PULL",
  "unclear": "NEUTRAL"
}
```

Legacy `ATTACK` and `RUN` values are accepted as compatibility aliases and are
normalized to `PUSH` and `PULL`.

## Tuning for 2400 Solo Shuffle

- Lower **Threshold** to catch quieter or less exact matches.
- Raise **Threshold** to reduce false positives in noisy arena audio.
- Lower **Min match** to reduce latency; raise it for stabler matches.
- **Refractory** prevents the same cue from re-firing immediately.
- **Global cooldown** spaces out repeated `PUSH` or `PULL` recommendations
  across different cues.
- Build a focused library: enemy cooldowns → `PULL`, go windows → `PUSH`,
  ambiguous UI sounds → `NEUTRAL` or discard.

## Limitations

- Browser audio capture depends on OS loopback routing.
- Matching is interpretable spectral similarity, not a full ML classifier.
- Combat-log alignment is manual/semi-automatic; clock drift may require offset
  tweaks.
- Stereo/position metadata is supplementary and approximate.
- Offline-capable after the page loads; no server required for normal use.

## Development

Syntax-check JavaScript:

```bash
node --check app.js
node --check combat-log.js
node --check bin/audio-cue-coach.js
```

See `agent.md` for repository boundaries, safety constraints, and agent workflow.