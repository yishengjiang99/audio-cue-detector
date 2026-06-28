import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

const SAMPLE_RATE = 16000;

export async function commandExists(command) {
  return new Promise((resolve) => {
    const proc = spawn("which", [command]);
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export async function requireTools(tools) {
  const missing = [];
  for (const tool of tools) {
    if (!(await commandExists(tool))) missing.push(tool);
  }
  if (missing.length) {
    throw new Error(`Missing required tools: ${missing.join(", ")}`);
  }
}

export async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const errors = [];
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (chunk) => errors.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${Buffer.concat(errors).toString()}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function downloadYoutubeAudio(url, outputStem) {
  const args = [
    url,
    "-f", "bestaudio",
    "-o", `${outputStem}.%(ext)s`,
    "--no-playlist",
    "--print", "after_move:filepath",
  ];
  const output = await runCommand("yt-dlp", args);
  const filePath = output.toString().trim().split("\n").filter(Boolean).at(-1);
  if (!filePath) throw new Error(`yt-dlp did not return output path for ${url}`);
  return filePath;
}

export async function decodeSegmentToMono16k(audioPath, startSec, endSec) {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-ss", String(startSec),
    "-to", String(endSec),
    "-i", audioPath,
    "-ac", "1",
    "-ar", String(SAMPLE_RATE),
    "-f", "f32le",
    "pipe:1",
  ];
  const buffer = await runCommand("ffmpeg", args);
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

export { SAMPLE_RATE };