#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFrames } from "../audio-dsp.js";
import {
  SAMPLE_RATE,
  decodeSegmentToMono16k,
  downloadYoutubeAudio,
  fileExists,
  requireTools,
} from "./lib/audio-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOWNLOADS = path.join(__dirname, "downloads");
const OUTPUT_DIR = path.join(__dirname, "output");

function normalizeAction(action) {
  const value = String(action || "").trim().toUpperCase();
  if (["PUSH", "ATTACK", "GO", "FORWARD"].includes(value)) return "PUSH";
  if (["PULL", "RUN", "RESET", "KITE", "LINE"].includes(value)) return "PULL";
  return "NEUTRAL";
}

function videoIdFromUrl(url) {
  const match = String(url).match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return match?.[1] || "video";
}

async function loadManifest(manifestPath) {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.sources)) {
    throw new Error("Manifest must contain a sources array");
  }
  return parsed;
}

async function trainFromManifest(manifestPath) {
  await requireTools(["yt-dlp", "ffmpeg"]);
  await mkdir(DOWNLOADS, { recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const manifest = await loadManifest(manifestPath);
  const cues = [];
  const report = [];

  for (const source of manifest.sources) {
    const videoId = videoIdFromUrl(source.url);
    const stem = path.join(DOWNLOADS, videoId);
    let audioPath = source.localAudio;

    if (!audioPath || !(await fileExists(audioPath))) {
      console.log(`Downloading audio: ${source.title || source.url}`);
      audioPath = await downloadYoutubeAudio(source.url, stem);
    } else {
      console.log(`Using cached audio: ${audioPath}`);
    }

    for (const segment of source.segments || []) {
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        console.warn(`Skipping invalid segment in ${videoId}:`, segment);
        continue;
      }

      console.log(`  Fingerprint ${segment.label} (${start}s – ${end}s)`);
      const samples = await decodeSegmentToMono16k(audioPath, start, end);
      const features = extractFrames(samples, SAMPLE_RATE);
      if (!features.length) {
        console.warn(`    No features extracted for ${segment.label}`);
        continue;
      }

      cues.push({
        label: segment.label,
        action: normalizeAction(segment.action),
        features,
        metadata: {
          sourceUrl: source.url,
          sourceTitle: source.title || "",
          segmentStart: start,
          segmentEnd: end,
          notes: segment.notes || "",
          trainingPipeline: "node-youtube-train",
        },
        source: "youtube-train",
      });
      report.push({ videoId, label: segment.label, frames: features.length, start, end });
    }
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    training: {
      pipeline: "node",
      manifest: path.basename(manifestPath),
      segmentCount: report.length,
    },
    cues,
  };

  const outFile = path.join(OUTPUT_DIR, `fingerprints-${Date.now()}.json`);
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${cues.length} cues to ${outFile}`);
  console.log("Import this file in the browser app via Cue Library → Import Fingerprints.");
  return { outFile, report };
}

const manifestArg = process.argv[2] || path.join(__dirname, "sources.example.json");
trainFromManifest(path.resolve(ROOT, manifestArg)).catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});