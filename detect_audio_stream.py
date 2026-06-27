#!/usr/bin/env python3
"""Detect indexed audio cues from a raw 16-bit mono PCM stream.

Input is intentionally generic. Feed it 128-byte frames from a microphone,
virtual audio cable, network bridge, or prerecorded file.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np


BANDS = np.array([80, 160, 320, 640, 1280, 2560, 5120, 7600], dtype=np.float32)


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


def load_index(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "audio-cue-index-v1":
        raise ValueError(f"unsupported index schema: {data.get('schema')}")
    for entry in data["entries"]:
        entry["features_np"] = np.array(entry["features"], dtype=np.float32)
    return data


def score_sequence(observed: np.ndarray, template: np.ndarray, min_frames: int) -> tuple[float, int]:
    max_len = min(observed.shape[0], template.shape[0])
    if max_len < min_frames:
        return -1.0, 0
    best = -1.0
    best_len = 0
    for length in range(min_frames, max_len + 1):
        obs = observed[-length:]
        ref = template[:length]
        sim = float(np.mean(np.sum(obs * ref, axis=1)))
        if sim > best:
            best = sim
            best_len = length
    return best, best_len


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect advisory audio cues from raw PCM stdin.")
    parser.add_argument("index", type=Path)
    parser.add_argument("--frame-bytes", type=int, default=128, help="Read granularity from stdin.")
    parser.add_argument("--sample-rate", type=int, help="Override index sample rate.")
    parser.add_argument("--win-ms", type=float, help="Override index window size.")
    parser.add_argument("--hop-ms", type=float, help="Override index hop size.")
    parser.add_argument("--min-match-ms", type=float, default=96.0)
    parser.add_argument("--threshold", type=float, default=0.86)
    parser.add_argument("--cooldown-ms", type=float, default=700.0, help="Per-label cooldown.")
    parser.add_argument("--global-cooldown-ms", type=float, default=1400.0, help="Suppress all labels after any hit.")
    parser.add_argument("--max-buffer-ms", type=float, default=1400.0)
    parser.add_argument("--energy-gate", type=float, default=0.0015)
    args = parser.parse_args()

    index = load_index(args.index)
    sample_rate = args.sample_rate or int(index["sample_rate"])
    win_ms = args.win_ms or float(index["win_ms"])
    hop_ms = args.hop_ms or float(index["hop_ms"])
    n_fft = 1 << int(math.ceil(math.log2(max(128, sample_rate * win_ms / 1000.0))))
    hop_samples = max(1, int(round(sample_rate * hop_ms / 1000.0)))
    min_frames = max(1, int(math.ceil(args.min_match_ms / hop_ms)))
    max_samples = max(n_fft, int(sample_rate * args.max_buffer_ms / 1000.0))

    pcm = np.zeros(0, dtype=np.float32)
    pending = np.zeros(0, dtype=np.float32)
    features = deque(maxlen=max(4, int(args.max_buffer_ms / hop_ms)))
    last_fire: dict[str, float] = {}
    last_any_fire = 0.0
    bytes_seen = 0

    while True:
        raw = sys.stdin.buffer.read(args.frame_bytes)
        if not raw:
            break
        if len(raw) % 2:
            raw = raw[:-1]
        if not raw:
            continue
        bytes_seen += len(raw)
        chunk = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        pending = np.concatenate([pending, chunk])
        pcm = np.concatenate([pcm, chunk])[-max_samples:]

        while pending.size >= hop_samples:
            if pcm.size >= n_fft:
                window = pcm[-n_fft:]
                rms = float(np.sqrt(np.mean(window * window) + 1e-12))
                if rms >= args.energy_gate:
                    features.append(band_features(window, sample_rate, n_fft))
                    observed = np.stack(features, axis=0)
                    now = time.monotonic()
                    best_entry = None
                    best_score = -1.0
                    best_len = 0
                    for entry in index["entries"]:
                        score, length = score_sequence(observed, entry["features_np"], min_frames)
                        if score > best_score:
                            best_entry = entry
                            best_score = score
                            best_len = length
                    if best_entry and best_score >= args.threshold:
                        last = last_fire.get(best_entry["label"], 0.0)
                        global_ready = (now - last_any_fire) * 1000.0 >= args.global_cooldown_ms
                        label_ready = (now - last) * 1000.0 >= args.cooldown_ms
                        if global_ready and label_ready:
                            last_fire[best_entry["label"]] = now
                            last_any_fire = now
                            event = {
                                "t_stream_ms": round(bytes_seen / 2 / sample_rate * 1000.0, 2),
                                "label": best_entry["label"],
                                "action": best_entry["action"],
                                "score": round(best_score, 4),
                                "matched_ms": round(best_len * hop_ms, 2),
                                "source": best_entry["path"],
                            }
                            print(json.dumps(event), flush=True)
                            features.clear()
                            pcm = np.zeros(0, dtype=np.float32)
                            pending = np.zeros(0, dtype=np.float32)
                            break
            pending = pending[hop_samples:]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
