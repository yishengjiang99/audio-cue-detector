const bands = [80, 160, 320, 640, 1280, 2560, 5120, 7600];
const state = {
  audioContext: null,
  analyser: null,
  mediaStream: null,
  source: null,
  raf: 0,
  cues: [],
  featureHistory: [],
  lastHitAt: 0,
  actionMap: {
    alarm: "RUN",
    warning: "RUN",
    "detected-stealth": "RUN",
    horn: "ATTACK",
    go: "ATTACK",
    push: "ATTACK",
  },
};

const el = Object.fromEntries(
  [
    "audioState", "cueCount", "serviceState", "enableAudio", "deviceSelect",
    "cueFiles", "actionMap", "threshold", "thresholdValue", "minMatch",
    "minMatchValue", "startService", "stopService", "decision", "inputLevel",
    "bestScore", "eventLog", "clearLog",
  ].map((id) => [id, document.querySelector(`#${id}`)]),
);

function setService(text) { el.serviceState.textContent = text; }

function inferAction(name) {
  const lower = name.toLowerCase();
  for (const [needle, action] of Object.entries(state.actionMap)) {
    if (lower.includes(needle.toLowerCase())) return action.toUpperCase();
  }
  return "NEUTRAL";
}

async function ensureAudioContext() {
  if (!state.audioContext) state.audioContext = new AudioContext({ sampleRate: 16000 });
  if (state.audioContext.state !== "running") await state.audioContext.resume();
  el.audioState.textContent = state.audioContext.state;
  await refreshDevices();
  updateStartState();
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  el.deviceSelect.replaceChildren(...inputs.map((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Audio input ${index + 1}`;
    return option;
  }));
}

function hzToMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
function melToHz(mel) { return 700 * (10 ** (mel / 2595) - 1); }

function makeMelFilters(sampleRate, fftSize, count = 18) {
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

function extractFrames(samples, sampleRate) {
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

async function cueFeatures(file) {
  const arrayBuffer = await file.arrayBuffer();
  const decoded = await state.audioContext.decodeAudioData(arrayBuffer);
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return extractFrames(rendered.getChannelData(0), 16000);
}

async function loadCueFiles(files) {
  await ensureAudioContext();
  setService("Indexing");
  const cues = [];
  for (const file of files) {
    const features = await cueFeatures(file);
    if (features.length) cues.push({ label: file.name.replace(/\.[^.]+$/, ""), action: inferAction(file.name), features });
  }
  state.cues = cues;
  el.cueCount.textContent = String(cues.length);
  setService("Idle");
  updateStartState();
}

function scoreSequence(observed, template, minFrames) {
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

function setDecision(action) {
  const normalized = action === "ATTACK" ? "attack" : action === "RUN" ? "run" : "neutral";
  el.decision.className = `decision ${normalized}`;
  el.decision.textContent = action;
}

function logEvent(event) {
  const li = document.createElement("li");
  li.innerHTML = `<span>${event.time}</span><strong>${event.action}</strong><span>${event.label}</span><span>${event.score.toFixed(3)}</span>`;
  el.eventLog.prepend(li);
}

function tick() {
  if (!state.analyser) return;
  const time = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(time);
  const rms = Math.sqrt(time.reduce((sum, value) => sum + value * value, 0) / time.length);
  el.inputLevel.value = Math.min(1, rms * 8);

  state.featureHistory.push(...extractFrames(time, state.audioContext.sampleRate).slice(-1));
  state.featureHistory = state.featureHistory.slice(-90);

  const threshold = Number(el.threshold.value);
  const minFrames = Math.max(1, Math.ceil(Number(el.minMatch.value) / 16));
  let best = { cue: null, score: -1, frames: 0 };
  for (const cue of state.cues) {
    const scored = scoreSequence(state.featureHistory, cue.features, minFrames);
    if (scored.score > best.score) best = { cue, ...scored };
  }
  el.bestScore.value = Math.max(0, best.score);

  const now = performance.now();
  if (best.cue && best.score >= threshold && now - state.lastHitAt > 1400) {
    state.lastHitAt = now;
    const event = { time: new Date().toLocaleTimeString(), label: best.cue.label, action: best.cue.action, score: best.score };
    setDecision(event.action);
    logEvent(event);
    state.featureHistory = [];
    window.setTimeout(() => setDecision("NEUTRAL"), 900);
  }

  state.raf = requestAnimationFrame(tick);
}

async function start() {
  await ensureAudioContext();
  state.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: el.deviceSelect.value ? { exact: el.deviceSelect.value } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 16000,
    },
  });
  state.source = state.audioContext.createMediaStreamSource(state.mediaStream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 512;
  state.analyser.smoothingTimeConstant = 0.1;
  state.source.connect(state.analyser);
  el.startService.disabled = true;
  el.stopService.disabled = false;
  setService("Running");
  tick();
}

function stop() {
  cancelAnimationFrame(state.raf);
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.mediaStream = null;
  state.source = null;
  state.analyser = null;
  state.featureHistory = [];
  el.startService.disabled = false;
  el.stopService.disabled = true;
  setService("Idle");
  setDecision("NEUTRAL");
}

function updateStartState() {
  el.startService.disabled = !(state.audioContext && state.cues.length && el.deviceSelect.options.length);
}

el.enableAudio.addEventListener("click", ensureAudioContext);
el.cueFiles.addEventListener("change", (event) => loadCueFiles([...event.target.files]));
el.actionMap.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) state.actionMap = JSON.parse(await file.text());
});
el.threshold.addEventListener("input", () => { el.thresholdValue.textContent = Number(el.threshold.value).toFixed(2); });
el.minMatch.addEventListener("input", () => { el.minMatchValue.textContent = `${el.minMatch.value} ms`; });
el.startService.addEventListener("click", start);
el.stopService.addEventListener("click", stop);
el.clearLog.addEventListener("click", () => el.eventLog.replaceChildren());

if (!navigator.mediaDevices || !window.AudioContext) {
  setService("Unsupported");
} else {
  navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
}
