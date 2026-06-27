# Audio Cue Detector

This is a separate advisory detector. It does not attach to World of Warcraft,
read game memory, send inputs, or redistribute audio. It builds numeric
fingerprints from local audio clips and detects them from a raw microphone or
remote-device PCM stream.

## Docker

Build the image:

```bash
docker build -t audio-cue-detector .
```

Build an index from a mounted local clip directory:

```bash
docker run --rm \
  -v "$PWD":/work \
  -v "/path/to/clips":/clips:ro \
  audio-cue-detector build_audio_index.py \
  /clips \
  --actions /work/actions.example.json \
  -o /work/audio_cue_index.json
```

Detect from raw PCM on stdin:

```bash
ffmpeg -hide_banner -loglevel error -i some-recording.wav \
  -ac 1 -ar 16000 -f s16le - \
  | docker run --rm -i -v "$PWD":/work audio-cue-detector \
      detect_audio_stream.py /work/audio_cue_index.json
```

## 1. Build an index from loose local clips

The `_retail_` folder mostly contains addons/logs/app files. Core game assets
live in Blizzard CASC storage under `/Applications/World of Warcraft/Data` and
need a separate local exporter/listfile workflow if you want exact Blizzard
clips. This tool intentionally indexes only ordinary audio files you point it
at, such as addon sounds or your own exported cue clips.

```bash
cd "/Applications/World of Warcraft/_retail_"
python3 tools/audio_cue_detector/build_audio_index.py \
  Interface.before-wowaddons-link/Addons \
  --actions tools/audio_cue_detector/actions.example.json \
  -o /tmp/wow-audio-cues.json
```

The JSON contains paths and numeric feature vectors only.

## 2. Detect from 128-byte frames

The detector reads signed 16-bit little-endian mono PCM from stdin. At 16 kHz,
128 bytes is 64 samples, or 4 ms. Matching still uses a short rolling window
because a 4 ms frame alone does not contain enough frequency information for
reliable identification.

From a prerecorded clip:

```bash
ffmpeg -hide_banner -loglevel error -i some-recording.wav \
  -ac 1 -ar 16000 -f s16le - \
  | python3 tools/audio_cue_detector/detect_audio_stream.py /tmp/wow-audio-cues.json
```

From macOS microphone or virtual audio device:

```bash
ffmpeg -f avfoundation -i ":0" -ac 1 -ar 16000 -f s16le - \
  | python3 tools/audio_cue_detector/detect_audio_stream.py /tmp/wow-audio-cues.json
```

Use `ffmpeg -f avfoundation -list_devices true -i ""` to find the right input
device. If the audio is captured on another machine/device, stream or pipe raw
16 kHz mono s16le PCM into this detector with the same frame size.

## Tuning

- `--min-match-ms 64` reduces latency but increases false positives.
- `--threshold 0.90` is stricter; `0.80` is looser.
- `--global-cooldown-ms` suppresses tail re-detections from long resonant cues.
- `--energy-gate` should be raised in a noisy room and lowered for quiet feeds.
- For arena coaching, map labels to `RUN`, `ATTACK`, or `NEUTRAL` in an actions
  JSON file rather than deriving instructions from hidden game state.
