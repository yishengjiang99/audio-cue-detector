/* AudioWorkletProcessor: live mic analysis runs in process(); verdicts post to main thread. */

const FFT_SIZE = 512;
const HOP = 256;
const MEL_COUNT = 18;
const HISTORY_LIMIT = 90;

function hzToMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
function melToHz(mel) { return 700 * (10 ** (mel / 2595) - 1); }

function makeMelFilters(sampleRate) {
  const minMel = hzToMel(40);
  const maxMel = hzToMel(sampleRate / 2);
  const points = Array.from({ length: MEL_COUNT + 2 }, (_, i) => melToHz(minMel + (maxMel - minMel) * i / (MEL_COUNT + 1)));
  return Array.from({ length: MEL_COUNT }, (_, i) => {
    const left = points[i], center = points[i + 1], right = points[i + 2];
    return Array.from({ length: FFT_SIZE / 2 }, (_, bin) => {
      const hz = bin * sampleRate / FFT_SIZE;
      if (hz < left || hz > right) return 0;
      return hz <= center ? (hz - left) / (center - left) : (right - hz) / (right - center);
    });
  });
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wlenRe = Math.cos(angle), wlenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm;
        [wRe, wIm] = [wRe * wlenRe - wIm * wlenIm, wRe * wlenIm + wIm * wlenRe];
      }
    }
  }
}

function melFrame(samples, filters) {
  let rms = 0;
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    const value = samples[i];
    rms += value * value;
    re[i] = value * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
  }
  rms = Math.sqrt(rms / FFT_SIZE);
  if (rms < 0.002) return { frame: null, rms, spectrum: null };
  fft(re, im);
  const spectrum = new Float32Array(FFT_SIZE / 2);
  for (let i = 0; i < spectrum.length; i += 1) spectrum[i] = Math.hypot(re[i], im[i]);
  const mel = filters.map((filter) => Math.log1p(filter.reduce((sum, weight, i) => sum + weight * spectrum[i], 0)));
  const mean = mel.reduce((a, b) => a + b, 0) / mel.length;
  const centered = mel.map((value) => value - mean);
  const norm = Math.hypot(...centered) || 1;
  return { frame: centered.map((value) => value / norm), rms, spectrum };
}

function scoreSequence(observed, template, minFrames) {
  const maxLen = Math.min(observed.length, template.length);
  if (maxLen < minFrames) return { score: -1 };
  let best = -1;
  for (let length = minFrames; length <= maxLen; length += 1) {
    let total = 0;
    for (let i = 0; i < length; i += 1) {
      const obs = observed[observed.length - length + i];
      const ref = template[i];
      total += obs.reduce((sum, value, j) => sum + value * ref[j], 0);
    }
    const score = total / length;
    if (score > best) best = score;
  }
  return { score: best };
}

class CueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.filters = makeMelFilters(sampleRate);
    this.sampleRing = new Float32Array(FFT_SIZE);
    this.ringWrite = 0;
    this.samplesSinceHop = 0;
    this.featureHistory = [];
    this.liveCapture = new Float32Array(sampleRate * 4);
    this.captureWrite = 0;
    this.cues = [];
    this.threshold = 0.86;
    this.minFrames = 5;
    this.metricsCounter = 0;
    this.port.onmessage = (event) => this.onConfig(event.data);
  }

  onConfig(message) {
    if (message.type === "config") {
      this.threshold = message.threshold ?? this.threshold;
      this.minFrames = message.minFrames ?? this.minFrames;
    }
    if (message.type === "cues") {
      this.cues = message.cues || [];
    }
  }

  pushSample(value) {
    this.sampleRing[this.ringWrite] = value;
    this.ringWrite = (this.ringWrite + 1) % FFT_SIZE;
    this.liveCapture[this.captureWrite] = value;
    this.captureWrite = (this.captureWrite + 1) % this.liveCapture.length;
    this.samplesSinceHop += 1;
  }

  readWindow() {
    const window = new Float32Array(FFT_SIZE);
    const start = (this.ringWrite + FFT_SIZE - FFT_SIZE) % FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      window[i] = this.sampleRing[(start + i) % FFT_SIZE];
    }
    return window;
  }

  analyzeFrame() {
    const { frame, rms, spectrum } = melFrame(this.readWindow(), this.filters);
    if (!frame) return { rms, spectrum, verdict: null };
    this.featureHistory.push(frame);
    if (this.featureHistory.length > HISTORY_LIMIT) this.featureHistory.shift();

    let best = { score: -1, cueIndex: -1 };
    for (let i = 0; i < this.cues.length; i += 1) {
      const scored = scoreSequence(this.featureHistory, this.cues[i].features, this.minFrames);
      if (scored.score > best.score) best = { score: scored.score, cueIndex: i };
    }

    let verdict = null;
    if (best.cueIndex >= 0 && best.score >= this.threshold) {
      const cue = this.cues[best.cueIndex];
      verdict = {
        type: "verdict",
        action: cue.action,
        label: cue.label,
        score: best.score,
      };
      this.featureHistory = [];
    }
    return { rms, spectrum, verdict, bestScore: Math.max(0, best.score) };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input) return true;

    if (output) output.set(input);

    let blockRms = 0;
    for (let i = 0; i < input.length; i += 1) {
      blockRms += input[i] * input[i];
      this.pushSample(input[i]);
    }
    blockRms = Math.sqrt(blockRms / input.length);

    if (this.samplesSinceHop >= HOP) {
      this.samplesSinceHop = 0;
      const result = this.analyzeFrame();
      if (result.verdict) {
        this.port.postMessage(result.verdict);
      }
      this.metricsCounter += 1;
      if (this.metricsCounter % 4 === 0) {
        const captureLength = Math.min(this.liveCapture.length, sampleRate * 2);
        const capture = new Float32Array(captureLength);
        const start = (this.captureWrite + this.liveCapture.length - captureLength) % this.liveCapture.length;
        for (let i = 0; i < captureLength; i += 1) {
          capture[i] = this.liveCapture[(start + i) % this.liveCapture.length];
        }
        this.port.postMessage({
          type: "metrics",
          rms: result.rms ?? blockRms,
          bestScore: result.bestScore ?? 0,
          waveform: Float32Array.from(input),
          spectrum: result.spectrum ? Float32Array.from(result.spectrum) : null,
          capture,
        });
      }
    }

    return true;
  }
}

registerProcessor("cue-processor", CueProcessor);