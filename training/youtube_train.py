#!/usr/bin/env python3
"""Offline YouTube arena-audio training pipeline (Python).

Downloads user-listed VOD audio with yt-dlp, slices labeled segments with ffmpeg,
and fingerprints them by delegating to the shared Node audio-dsp extractor so
output matches the browser coach import format.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAINING = Path(__file__).resolve().parent
DOWNLOADS = TRAINING / "downloads"
OUTPUT_DIR = TRAINING / "output"
FINGERPRINT_HELPER = TRAINING / "lib" / "fingerprint-segment.mjs"


def normalize_action(action: str) -> str:
    value = (action or "").strip().upper()
    if value in {"PUSH", "ATTACK", "GO", "FORWARD"}:
        return "PUSH"
    if value in {"PULL", "RUN", "RESET", "KITE", "LINE"}:
        return "PULL"
    return "NEUTRAL"


def video_id_from_url(url: str) -> str:
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{6,})", url)
    return match.group(1) if match else "video"


def require_tools() -> None:
    missing = []
    for tool in ("yt-dlp", "ffmpeg", "node"):
        if subprocess.run(["which", tool], capture_output=True).returncode != 0:
            missing.append(tool)
    if missing:
        raise RuntimeError(f"Missing required tools: {', '.join(missing)}")


def download_youtube_audio(url: str, output_stem: Path) -> Path:
    result = subprocess.run(
        [
            "yt-dlp",
            url,
            "-f",
            "bestaudio",
            "-o",
            f"{output_stem}.%(ext)s",
            "--no-playlist",
            "--print",
            "after_move:filepath",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"yt-dlp returned no output path for {url}")
    return Path(lines[-1])


def fingerprint_segment(audio_path: Path, start: float, end: float) -> list:
    result = subprocess.run(
        [
            "node",
            str(FINGERPRINT_HELPER),
            str(audio_path),
            str(start),
            str(end),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(result.stdout)
    return payload["features"]


def train_from_manifest(manifest_path: Path) -> Path:
    require_tools()
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(manifest_path.read_text())
    sources = manifest.get("sources", [])
    if not isinstance(sources, list):
        raise ValueError("Manifest must contain a sources array")

    cues = []
    report = []

    for source in sources:
        url = source["url"]
        video_id = video_id_from_url(url)
        stem = DOWNLOADS / video_id
        audio_path = Path(source["localAudio"]) if source.get("localAudio") else None

        if not audio_path or not audio_path.exists():
            print(f"Downloading audio: {source.get('title') or url}")
            audio_path = download_youtube_audio(url, stem)
        else:
            print(f"Using cached audio: {audio_path}")

        for segment in source.get("segments", []):
            start = float(segment["start"])
            end = float(segment["end"])
            label = segment["label"]
            if end <= start:
                print(f"Skipping invalid segment {label}")
                continue

            print(f"  Fingerprint {label} ({start}s – {end}s)")
            features = fingerprint_segment(audio_path, start, end)
            if not features:
                print(f"    No features extracted for {label}")
                continue

            cues.append(
                {
                    "label": label,
                    "action": normalize_action(segment.get("action", "NEUTRAL")),
                    "features": features,
                    "metadata": {
                        "sourceUrl": url,
                        "sourceTitle": source.get("title", ""),
                        "segmentStart": start,
                        "segmentEnd": end,
                        "notes": segment.get("notes", ""),
                        "trainingPipeline": "python-youtube-train",
                    },
                    "source": "youtube-train",
                }
            )
            report.append(
                {
                    "videoId": video_id,
                    "label": label,
                    "frames": len(features),
                    "start": start,
                    "end": end,
                }
            )

    payload = {
        "version": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "training": {
            "pipeline": "python",
            "manifest": manifest_path.name,
            "segmentCount": len(report),
        },
        "cues": cues,
    }

    out_file = OUTPUT_DIR / f"fingerprints-{int(datetime.now().timestamp())}.json"
    out_file.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {len(cues)} cues to {out_file}")
    print("Import this file in the browser app via Cue Library → Import Fingerprints.")
    return out_file


def main() -> int:
    manifest = Path(sys.argv[1]) if len(sys.argv) > 1 else TRAINING / "sources.example.json"
    try:
        train_from_manifest(manifest.resolve())
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())