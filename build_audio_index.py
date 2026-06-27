#!/usr/bin/env python3
"""Build spectral fingerprints for local advisory audio-cue detection.

The generated JSON stores numeric features and source paths only. It does not
copy or embed audio content.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np


AUDIO_EXTS = {".ogg", ".mp3", ".wav", ".flac", ".m4a", ".aac", ".opus", ".aiff", ".aif", ".caf"}
BANDS = np.array([80, 160, 320, 640, 1280, 2560, 5120, 7600], dtype=np.float32)


def decode_audio(path: Path, sample_rate: int) -> np.ndarray:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-f",
        "s16le",
        "-",
    ]
    raw = subprocess.check_output(cmd)
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32)
    if pcm.size == 0:
        return pcm
    return pcm / 32768.0


def scan_audio_files(roots: list[Path]) -> list[Path]:
    out: list[Path] = []
    for root in roots:
        if root.is_file() and root.suffix.lower() in AUDIO_EXTS:
            out.append(root)
            continue
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in {".git", "Cache", "WTF", "Logs", "Screenshots"}]
            for name in filenames:
                path = Path(dirpath) / name
                if path.suffix.lower() in AUDIO_EXTS:
                    out.append(path)
    return sorted(set(out))


def band_features(window: np.ndarray, sample_rate: int, n_fft: int) -> np.ndarray:
    if window.size < n_fft:
        padded = np.zeros(n_fft, dtype=np.float32)
        padded[: window.size] = window
        window = padded
    shaped = window[:n_fft] * np.hanning(n_fft).astype(np.float32)
    spectrum = np.abs(np.fft.rfft(shaped)) + 1e-8
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate)
    edges = np.concatenate(([40.0], BANDS, [sample_rate / 2.0]))
    vals = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (freqs >= lo) & (freqs < hi)
        vals.append(float(np.mean(np.log1p(spectrum[mask]))) if np.any(mask) else 0.0)
    vec = np.array(vals, dtype=np.float32)
    vec -= np.mean(vec)
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-6 else vec


def feature_sequence(audio: np.ndarray, sample_rate: int, win_ms: float, hop_ms: float) -> np.ndarray:
    n_fft = max(128, int(round(sample_rate * win_ms / 1000.0)))
    n_fft = 1 << int(math.ceil(math.log2(n_fft)))
    hop = max(1, int(round(sample_rate * hop_ms / 1000.0)))
    if audio.size < n_fft:
        return np.expand_dims(band_features(audio, sample_rate, n_fft), axis=0)
    frames = []
    for start in range(0, audio.size - n_fft + 1, hop):
        frames.append(band_features(audio[start : start + n_fft], sample_rate, n_fft))
    return np.stack(frames, axis=0) if frames else np.empty((0, 9), dtype=np.float32)


def trim_to_onset(audio: np.ndarray, sample_rate: int, pre_ms: float = 24.0) -> np.ndarray:
    if audio.size == 0:
        return audio
    frame = max(64, int(sample_rate * 0.010))
    hop = max(16, frame // 4)
    energies = []
    for start in range(0, max(1, audio.size - frame), hop):
        chunk = audio[start : start + frame]
        energies.append(float(np.sqrt(np.mean(chunk * chunk) + 1e-12)))
    if not energies:
        return audio
    e = np.array(energies)
    floor = float(np.percentile(e, 20))
    peak = float(np.max(e))
    threshold = max(floor * 3.0, peak * 0.08, 0.002)
    hits = np.where(e >= threshold)[0]
    if hits.size == 0:
        return audio
    start = max(0, hits[0] * hop - int(sample_rate * pre_ms / 1000.0))
    return audio[start:]


def load_actions(path: Path | None) -> dict[str, str]:
    if not path:
        return {}
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return {str(k): str(v).upper() for k, v in data.items()}


def infer_action(path: Path, actions: dict[str, str]) -> str:
    low = str(path).lower()
    for needle, action in actions.items():
        if needle.lower() in low:
            return action
    return "NEUTRAL"


def main() -> int:
    parser = argparse.ArgumentParser(description="Fingerprint local audio clips for early advisory detection.")
    parser.add_argument("roots", nargs="+", type=Path, help="Audio files or directories to scan.")
    parser.add_argument("-o", "--output", type=Path, default=Path("audio_cue_index.json"))
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--win-ms", type=float, default=32.0)
    parser.add_argument("--hop-ms", type=float, default=16.0)
    parser.add_argument("--max-ms", type=float, default=900.0, help="Keep only this much post-onset audio per clip.")
    parser.add_argument("--actions", type=Path, help="Optional JSON map of path substring to RUN/ATTACK/PUSH/etc.")
    args = parser.parse_args()

    actions = load_actions(args.actions)
    files = scan_audio_files(args.roots)
    entries = []
    for path in files:
        try:
            audio = decode_audio(path, args.sample_rate)
            audio = trim_to_onset(audio, args.sample_rate)
            max_samples = int(args.sample_rate * args.max_ms / 1000.0)
            if max_samples > 0:
                audio = audio[:max_samples]
            features = feature_sequence(audio, args.sample_rate, args.win_ms, args.hop_ms)
            if features.size == 0:
                continue
            rms = float(np.sqrt(np.mean(audio * audio) + 1e-12)) if audio.size else 0.0
            entries.append(
                {
                    "label": path.stem,
                    "path": str(path),
                    "action": infer_action(path, actions),
                    "duration_ms": round(audio.size * 1000.0 / args.sample_rate, 2),
                    "rms": round(rms, 6),
                    "features": np.round(features, 5).tolist(),
                }
            )
            print(f"indexed {path} ({features.shape[0]} frames)", file=sys.stderr)
        except Exception as exc:
            print(f"skip {path}: {exc}", file=sys.stderr)

    payload = {
        "schema": "audio-cue-index-v1",
        "sample_rate": args.sample_rate,
        "win_ms": args.win_ms,
        "hop_ms": args.hop_ms,
        "feature": "normalized_log_spectral_bands_v1",
        "entries": entries,
    }
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {args.output} with {len(entries)} clips")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
