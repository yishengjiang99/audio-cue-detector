export function hzToMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
export function melToHz(mel) { return 700 * (10 ** (mel / 2595) - 1); }

export function makeMelFilters(sampleRate, fftSize, count = 18) {
  const minMel = hzToMel(40);
  const maxMel = hzToMel(sampleRate / 2);
  const points = Array.from({ length: count + 2 }, (_, i) => melToHz(minMel + (maxMel - minMel) * i / (count + 1)));
  return Array.from({ length: count }, (_, i) => {
    const left = points[i], center = points[i + 1], right = points[i + 2];
    return Array.from({ length: fftSize / 2 }, (_, bin) => {
      const hz = bin * sampleRate / fftSize;
      if (hz < left || hz > right) return 0;
      return hz <= center ? (hz - left) / (center - left) : (right - hz) / (right - center);
    });
  });
}

export function fft(re, im) {
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

export function extractFrames(samples, sampleRate) {
  const fftSize = 512;
  const hop = 256;
  const filters = makeMelFilters(sampleRate, fftSize);
  const frames = [];
  for (let start = 0; start + fftSize <= samples.length && frames.length < 80; start += hop) {
    let rms = 0;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i += 1) {
      const value = samples[start + i];
      rms += value * value;
      re[i] = value * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));
    }
    rms = Math.sqrt(rms / fftSize);
    if (rms < 0.002 && frames.length === 0) continue;
    fft(re, im);
    const mag = Array.from({ length: fftSize / 2 }, (_, i) => Math.hypot(re[i], im[i]));
    const mel = filters.map((filter) => Math.log1p(filter.reduce((sum, weight, i) => sum + weight * mag[i], 0)));
    const mean = mel.reduce((a, b) => a + b, 0) / mel.length;
    const centered = mel.map((value) => value - mean);
    const norm = Math.hypot(...centered) || 1;
    frames.push(centered.map((value) => value / norm));
  }
  return frames;
}

export function scoreSequence(observed, template, minFrames) {
  const maxLen = Math.min(observed.length, template.length);
  if (maxLen < minFrames) return { score: -1, frames: 0 };
  let best = -1, bestFrames = 0;
  for (let length = minFrames; length <= maxLen; length += 1) {
    let total = 0;
    for (let i = 0; i < length; i += 1) {
      const obs = observed[observed.length - length + i];
      const ref = template[i];
      total += obs.reduce((sum, value, j) => sum + value * ref[j], 0);
    }
    const score = total / length;
    if (score > best) { best = score; bestFrames = length; }
  }
  return { score: best, frames: bestFrames };
}