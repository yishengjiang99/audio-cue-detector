#!/usr/bin/env node

import { decodeSegmentToMono16k, SAMPLE_RATE } from "./audio-utils.mjs";
import { extractFrames } from "../../audio-dsp.js";

const [, , audioPath, startArg, endArg] = process.argv;

if (!audioPath || startArg === undefined || endArg === undefined) {
  console.error("Usage: node fingerprint-segment.mjs <audio> <startSec> <endSec>");
  process.exit(1);
}

const samples = await decodeSegmentToMono16k(audioPath, Number(startArg), Number(endArg));
const features = extractFrames(samples, SAMPLE_RATE);
process.stdout.write(JSON.stringify({ features }));