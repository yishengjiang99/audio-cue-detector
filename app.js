import {
  parseCombatLog,
  filterEventsInRecording,
  eventToLabel,
  suggestAlignmentOffset,
  buildAudioEnvelope,
} from "./combat-log.js";

const LOOPBACK_DEVICE_PATTERN = /loopback|blackhole|soundflower|vb-audio|virtual|cable output|stereo mix|what u hear|aggregate device|multi[- ]output|monitor of/i;

const state = {
  audioContext: null,
  analyser: null,
  mediaStream: null,
  microphoneReady: false,
  source: null,
  raf: 0,
  cues: [],
  featureHistory: [],
  liveCapture: [],
  lastHitAt: 0,
  lastActionAt: { PUSH: 0, PULL: 0, NEUTRAL: 0 },
  actionMap: {
    alarm: "PULL",
    warning: "PULL",
    reset: "PULL",
    kite: "PULL",
    line: "PULL",
    "detected-stealth": "PULL",
    horn: "PUSH",
    go: "PUSH",
    pressure: "PUSH",
    push: "PUSH",
  },
  session: {
    recorder: null,
    chunks: [],
    audioBuffer: null,
    envelope: [],
    events: [],
    proposals: [],
    activeProposalId: null,
    playingSource: null,
  },
};

const el = Object.fromEntries(
  [
    "audioState", "cueCount", "serviceState", "chooseMicrophone", "deviceSelect",
    "microphoneState",
    "cueFiles", "actionMap", "threshold", "thresholdValue", "minMatch",
    "minMatchValue", "refractory", "refractoryValue", "globalCooldown",
    "globalCooldownValue", "startService", "stopService", "decision",
    "inputLevel", "bestScore", "eventLog", "clearLog", "playTone",
    "waveformCanvas", "spectrumCanvas", "recordLiveCue", "cueLibrary",
    "libraryEmpty", "libraryFilter", "exportFingerprints", "importFingerprints",
    "startSession", "stopSession", "sessionAudioFile", "combatLogFile",
    "logOffset", "logOffsetValue", "suggestOffset", "generateProposals",
    "sessionProgress", "sessionProgressLabel", "sessionTimeline",
    "proposalList", "proposalCount", "proposalEmpty", "recordDialog",
    "recordLabel", "recordAction", "recordNotes", "confirmRecord",
    "proposalDialog", "proposalLabel", "proposalAction", "proposalStart",
    "proposalEnd", "proposalDirection", "proposalNotes", "playProposal",
    "confirmProposal",
  ].map((id) => [id, document.getElementById(id)]),
);

const waveformCtx = el.waveformCanvas.getContext("2d");
const spectrumCtx = el.spectrumCanvas.getContext("2d");
const timelineCtx = el.sessionTimeline.getContext("2d");

function setService(text) { el.serviceState.textContent = text; }
function cueId() { return `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function normalizeAction(action) {
  const value = String(action || "").trim().toUpperCase();
  if (["PUSH", "ATTACK", "GO", "FORWARD"].includes(value)) return "PUSH";
  if (["PULL", "RUN", "RESET", "KITE", "LINE"].includes(value)) return "PULL";
  return "NEUTRAL";
}

function normalizeActionMap(map) {
  return Object.fromEntries(
    Object.entries(map || {}).map(([needle, action]) => [needle, normalizeAction(action)]),
  );
}

function inferAction(name) {
  const lower = name.toLowerCase();
  for (const [needle, action] of Object.entries(state.actionMap)) {
    if (lower.includes(needle.toLowerCase())) return normalizeAction(action);
  }
  return "NEUTRAL";
}

function isLoopbackDeviceLabel(label) {
  return LOOPBACK_DEVICE_PATTERN.test(String(label || ""));
}

function isMicrophoneDevice(device) {
  return device.kind === "audioinput" && !isLoopbackDeviceLabel(device.label);
}

function microphoneConstraints(deviceId) {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  };
}

async function ensureAudioContext() {
  if (!state.audioContext) state.audioContext = new AudioContext({ sampleRate: 16000 });
  if (state.audioContext.state !== "running") await state.audioContext.resume();
  el.audioState.textContent = state.audioContext.state;
  updateControlStates();
}

function setMicrophoneState(text) {
  el.microphoneState.textContent = text;
}

async function refreshDevices(preferredDeviceId = "") {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter(isMicrophoneDevice);
  const previous = preferredDeviceId || el.deviceSelect.value;

  el.deviceSelect.replaceChildren();
  if (!microphones.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No microphones found";
    el.deviceSelect.append(option);
    return;
  }

  for (const [index, device] of microphones.entries()) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    el.deviceSelect.append(option);
  }

  const selected = microphones.find((device) => device.deviceId === previous);
  el.deviceSelect.value = selected?.deviceId || microphones[0].deviceId;
}

async function chooseMicrophone() {
  await ensureAudioContext();
  setMicrophoneState("Requesting access…");

  let probeStream = null;
  try {
    if (!el.deviceSelect.options.length || !el.deviceSelect.value) {
      probeStream = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
      probeStream.getTracks().forEach((track) => track.stop());
      probeStream = null;
      await refreshDevices();
    }

    const deviceId = el.deviceSelect.value;
    if (!deviceId) {
      setMicrophoneState("No microphone available");
      state.microphoneReady = false;
      updateControlStates();
      return;
    }

    state.mediaStream?.getTracks().forEach((track) => track.stop());
    if (state.analyser) stop();

    state.mediaStream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId));
    state.microphoneReady = true;
    setMicrophoneState(el.deviceSelect.selectedOptions[0]?.textContent || "Microphone ready");
    updateControlStates();
  } catch (error) {
    state.microphoneReady = false;
    setMicrophoneState("Microphone access denied");
    setService("Idle");
    updateControlStates();
    throw error;
  } finally {
    probeStream?.getTracks().forEach((track) => track.stop());
  }
}

async function getMicrophoneStream() {
  if (!state.microphoneReady || !state.mediaStream) {
    throw new Error("Choose a microphone before starting audio capture.");
  }
  const deviceId = el.deviceSelect.value;
  const [track] = state.mediaStream.getAudioTracks();
  if (track?.getSettings().deviceId === deviceId && track.readyState === "live") {
    return state.mediaStream;
  }
  await chooseMicrophone();
  return state.mediaStream;
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

async function decodeToMono16k(arrayBuffer) {
  const decoded = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered;
}

async function cueFeaturesFromBuffer(buffer) {
  return extractFrames(buffer.getChannelData(0), buffer.sampleRate);
}

async function cueFeatures(file) {
  const rendered = await decodeToMono16k(await file.arrayBuffer());
  return cueFeaturesFromBuffer(rendered);
}

function analyzeStereoBalance(buffer) {
  if (buffer.numberOfChannels < 2) return { balance: 0, approximate: true, note: "mono source" };
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let leftEnergy = 0;
  let rightEnergy = 0;
  const step = Math.max(1, Math.floor(left.length / 2000));
  for (let i = 0; i < left.length; i += step) {
    leftEnergy += left[i] * left[i];
    rightEnergy += right[i] * right[i];
  }
  const total = leftEnergy + rightEnergy || 1;
  const balance = (rightEnergy - leftEnergy) / total;
  let direction = "center";
  if (balance > 0.15) direction = "right";
  if (balance < -0.15) direction = "left";
  return { balance, direction, approximate: true };
}

async function loadCueFiles(files) {
  await ensureAudioContext();
  setService("Indexing");
  for (const file of files) {
    const features = await cueFeatures(file);
    if (!features.length) continue;
    state.cues.push({
      id: cueId(),
      label: file.name.replace(/\.[^.]+$/, ""),
      action: inferAction(file.name),
      features,
      source: "file",
      metadata: { fileName: file.name },
      createdAt: Date.now(),
    });
  }
  refreshCueUI();
  setService("Idle");
  updateControlStates();
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
  const normalized = normalizeAction(action).toLowerCase();
  el.decision.className = `decision ${normalized}`;
  el.decision.textContent = normalizeAction(action);
}

function playAdvisoryTone(action) {
  if (!el.playTone.checked || !state.audioContext) return;
  const normalized = normalizeAction(action);
  if (normalized === "NEUTRAL") return;
  const now = state.audioContext.currentTime;
  const oscillator = state.audioContext.createOscillator();
  const gain = state.audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(normalized === "PUSH" ? 880 : 330, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  oscillator.connect(gain).connect(state.audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.2);
}

function logEvent(event) {
  const li = document.createElement("li");
  li.innerHTML = `<span>${event.time}</span><strong>${event.action}</strong><span>${event.label}</span><span>${event.score.toFixed(3)}</span>`;
  el.eventLog.prepend(li);
}

function drawWaveform(timeData) {
  const { width, height } = el.waveformCanvas;
  waveformCtx.clearRect(0, 0, width, height);
  waveformCtx.fillStyle = "#111719";
  waveformCtx.fillRect(0, 0, width, height);
  waveformCtx.strokeStyle = "#61a8ff";
  waveformCtx.lineWidth = 1.5;
  waveformCtx.beginPath();
  const mid = height / 2;
  for (let i = 0; i < timeData.length; i += 1) {
    const x = (i / timeData.length) * width;
    const y = mid + timeData[i] * mid * 0.9;
    if (i === 0) waveformCtx.moveTo(x, y);
    else waveformCtx.lineTo(x, y);
  }
  waveformCtx.stroke();
}

function drawSpectrum(freqData) {
  const { width, height } = el.spectrumCanvas;
  spectrumCtx.clearRect(0, 0, width, height);
  spectrumCtx.fillStyle = "#111719";
  spectrumCtx.fillRect(0, 0, width, height);
  const bars = 48;
  const step = Math.floor(freqData.length / bars);
  const barWidth = width / bars;
  for (let i = 0; i < bars; i += 1) {
    const value = freqData[i * step];
    const normalized = Math.max(0, (value + 100) / 100);
    const barHeight = normalized * height;
    const hue = 200 - normalized * 120;
    spectrumCtx.fillStyle = `hsl(${hue}, 80%, 55%)`;
    spectrumCtx.fillRect(i * barWidth, height - barHeight, barWidth - 2, barHeight);
  }
}

function tick() {
  if (!state.analyser) return;
  const time = new Float32Array(state.analyser.fftSize);
  const freq = new Float32Array(state.analyser.frequencyBinCount);
  state.analyser.getFloatTimeDomainData(time);
  state.analyser.getFloatFrequencyData(freq);
  const rms = Math.sqrt(time.reduce((sum, value) => sum + value * value, 0) / time.length);
  el.inputLevel.value = Math.min(1, rms * 8);
  drawWaveform(time);
  drawSpectrum(freq);

  const frames = extractFrames(time, state.audioContext.sampleRate).slice(-1);
  state.featureHistory.push(...frames);
  state.featureHistory = state.featureHistory.slice(-90);
  state.liveCapture.push(...time);
  const maxCapture = state.audioContext.sampleRate * 4;
  if (state.liveCapture.length > maxCapture) {
    state.liveCapture = state.liveCapture.slice(-maxCapture);
  }

  const threshold = Number(el.threshold.value);
  const minFrames = Math.max(1, Math.ceil(Number(el.minMatch.value) / 16));
  let best = { cue: null, score: -1, frames: 0 };
  for (const cue of state.cues) {
    const scored = scoreSequence(state.featureHistory, cue.features, minFrames);
    if (scored.score > best.score) best = { cue, ...scored };
  }
  el.bestScore.value = Math.max(0, best.score);

  const now = performance.now();
  const refractory = Number(el.refractory.value);
  const globalCooldown = Number(el.globalCooldown.value);
  const action = best.cue ? normalizeAction(best.cue.action) : "NEUTRAL";
  const globalOk = globalCooldown <= 0 || now - state.lastActionAt[action] > globalCooldown;

  if (best.cue && best.score >= threshold && now - state.lastHitAt > refractory && globalOk) {
    state.lastHitAt = now;
    state.lastActionAt[action] = now;
    const event = {
      time: new Date().toLocaleTimeString(),
      label: best.cue.label,
      action,
      score: best.score,
    };
    setDecision(event.action);
    playAdvisoryTone(event.action);
    logEvent(event);
    state.featureHistory = [];
    window.setTimeout(() => setDecision("NEUTRAL"), 900);
  }

  state.raf = requestAnimationFrame(tick);
}

async function start() {
  await ensureAudioContext();
  const stream = await getMicrophoneStream();
  state.source = state.audioContext.createMediaStreamSource(stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 512;
  state.analyser.smoothingTimeConstant = 0.1;
  state.source.connect(state.analyser);
  el.startService.disabled = true;
  el.stopService.disabled = false;
  el.recordLiveCue.disabled = false;
  setService("Running");
  tick();
}

function stop() {
  cancelAnimationFrame(state.raf);
  state.source = null;
  state.analyser = null;
  state.featureHistory = [];
  state.liveCapture = [];
  el.startService.disabled = false;
  el.stopService.disabled = true;
  el.recordLiveCue.disabled = true;
  setService("Idle");
  setDecision("NEUTRAL");
  waveformCtx.clearRect(0, 0, el.waveformCanvas.width, el.waveformCanvas.height);
  spectrumCtx.clearRect(0, 0, el.spectrumCanvas.width, el.spectrumCanvas.height);
}

function updateControlStates() {
  const hasAudio = Boolean(state.audioContext);
  const hasCues = state.cues.length > 0;
  const hasMicrophone = state.microphoneReady && Boolean(el.deviceSelect.value);
  el.startService.disabled = !(hasAudio && hasCues && hasMicrophone) || Boolean(state.analyser);
  el.startSession.disabled = !hasMicrophone || Boolean(state.session.recorder);
  el.stopSession.disabled = !state.session.recorder;
  el.suggestOffset.disabled = !state.session.audioBuffer;
  el.generateProposals.disabled = !(state.session.audioBuffer && state.session.events.length);
}

function refreshCueUI() {
  el.cueCount.textContent = String(state.cues.length);
  const filter = el.libraryFilter.value.trim().toLowerCase();
  const cues = state.cues.filter((cue) => !filter || cue.label.toLowerCase().includes(filter));
  el.libraryEmpty.hidden = state.cues.length > 0;
  el.cueLibrary.replaceChildren(...cues.map((cue) => {
    const li = document.createElement("li");
    li.className = "cue-item";
    const meta = cue.metadata?.spellName ? ` · ${cue.metadata.spellName}` : "";
    li.innerHTML = `
      <div class="cue-main">
        <strong>${cue.label}</strong>
        <span class="action-pill ${cue.action.toLowerCase()}">${cue.action}</span>
        <span class="subtle">${cue.source || "unknown"}${meta}</span>
      </div>
      <div class="cue-actions">
        <button type="button" data-action="play" data-id="${cue.id}">Play</button>
        <button type="button" data-action="label" data-id="${cue.id}">Relabel</button>
        <button type="button" data-action="delete" data-id="${cue.id}">Delete</button>
      </div>`;
    return li;
  }));
  updateControlStates();
}

async function playCueAudio(cue) {
  await ensureAudioContext();
  if (cue.audioBlob) {
    const buffer = await decodeToMono16k(await cue.audioBlob.arrayBuffer());
    const source = state.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.audioContext.destination);
    source.start();
    return;
  }
  playAdvisoryTone(cue.action);
}

function deleteCue(id) {
  state.cues = state.cues.filter((cue) => cue.id !== id);
  refreshCueUI();
}

function relabelCue(id) {
  const cue = state.cues.find((item) => item.id === id);
  if (!cue) return;
  const label = window.prompt("Label", cue.label);
  if (label === null) return;
  const action = window.prompt("Action (PUSH / PULL / NEUTRAL)", cue.action);
  if (action === null) return;
  cue.label = label.trim() || cue.label;
  cue.action = normalizeAction(action);
  refreshCueUI();
}

function exportFingerprints() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    cues: state.cues.map(({ label, action, features, metadata, source }) => ({
      label, action: normalizeAction(action), features, metadata, source,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cue-fingerprints-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importFingerprints(file) {
  const payload = JSON.parse(await file.text());
  const cues = payload.cues || payload;
  if (!Array.isArray(cues)) return;
  for (const entry of cues) {
    if (!entry.features?.length) continue;
    state.cues.push({
      id: cueId(),
      label: entry.label || "Imported cue",
      action: normalizeAction(entry.action),
      features: entry.features,
      metadata: entry.metadata || {},
      source: entry.source || "import",
      createdAt: Date.now(),
    });
  }
  refreshCueUI();
}

async function openRecordDialog() {
  if (!state.liveCapture.length) return;
  el.recordLabel.value = `Live clip ${new Date().toLocaleTimeString()}`;
  el.recordAction.value = "NEUTRAL";
  el.recordNotes.value = "";
  el.recordDialog.showModal();
}

async function saveLiveRecording() {
  const samples = Float32Array.from(state.liveCapture.slice(-state.audioContext.sampleRate * 1.2));
  const buffer = state.audioContext.createBuffer(1, samples.length, state.audioContext.sampleRate);
  buffer.copyToChannel(samples, 0);
  const features = await cueFeaturesFromBuffer(buffer);
  const blob = bufferToWavBlob(buffer);
  state.cues.push({
    id: cueId(),
    label: el.recordLabel.value.trim() || "Live clip",
    action: normalizeAction(el.recordAction.value),
    features,
    audioBlob: blob,
    metadata: { notes: el.recordNotes.value.trim() },
    source: "live",
    createdAt: Date.now(),
  });
  refreshCueUI();
}

function bufferToWavBlob(buffer) {
  const channel = buffer.getChannelData(0);
  const samples = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) {
    samples[i] = Math.max(-1, Math.min(1, channel[i])) * 0x7fff;
  }
  const dataSize = samples.length * 2;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  return new Blob([header, samples], { type: "audio/wav" });
}

function setSessionProgress(value, label) {
  el.sessionProgress.value = Math.round(value * 100);
  el.sessionProgressLabel.textContent = label;
}

async function loadSessionAudioFromBuffer(buffer) {
  state.session.audioBuffer = buffer;
  state.session.envelope = buildAudioEnvelope(buffer.getChannelData(0));
  drawSessionTimeline();
  updateControlStates();
}

async function loadSessionAudioFile(file) {
  await ensureAudioContext();
  setSessionProgress(0.1, "Decoding session audio…");
  const buffer = await decodeToMono16k(await file.arrayBuffer());
  await loadSessionAudioFromBuffer(buffer);
  setSessionProgress(1, `Audio loaded (${buffer.duration.toFixed(1)} s)`);
}

async function startSessionRecording() {
  await ensureAudioContext();
  const stream = await getMicrophoneStream();
  state.session.chunks = [];
  state.session.recorder = new MediaRecorder(stream);
  state.session.recorder.ondataavailable = (event) => {
    if (event.data.size) state.session.chunks.push(event.data);
  };
  state.session.recorder.onstop = async () => {
    setSessionProgress(0.2, "Processing recording…");
    const blob = new Blob(state.session.chunks, { type: state.session.recorder.mimeType || "audio/webm" });
    await loadSessionAudioFile(new File([blob], "session-recording.webm"));
    state.session.recorder = null;
    updateControlStates();
  };
  state.session.recorder.start(1000);
  setSessionProgress(0, "Recording session…");
  updateControlStates();
}

function stopSessionRecording() {
  state.session.recorder?.stop();
  el.stopSession.disabled = true;
}

async function loadCombatLog(file) {
  setSessionProgress(0, "Parsing combat log…");
  const text = await file.text();
  state.session.events = parseCombatLog(text, (ratio) => {
    setSessionProgress(ratio * 0.9, `Parsing log… ${Math.round(ratio * 100)}%`);
  });
  setSessionProgress(1, `Parsed ${state.session.events.length} audible events`);
  drawSessionTimeline();
  updateControlStates();
}

function drawSessionTimeline() {
  const { width, height } = el.sessionTimeline;
  timelineCtx.clearRect(0, 0, width, height);
  timelineCtx.fillStyle = "#111719";
  timelineCtx.fillRect(0, 0, width, height);

  const buffer = state.session.audioBuffer;
  if (!buffer) return;
  const duration = buffer.duration;
  const offset = Number(el.logOffset.value);

  const envelope = state.session.envelope;
  timelineCtx.strokeStyle = "#61a8ff";
  timelineCtx.beginPath();
  for (let i = 0; i < envelope.length; i += 1) {
    const x = (i / envelope.length) * width;
    const y = height * 0.55 - envelope[i] * height * 0.35;
    if (i === 0) timelineCtx.moveTo(x, y);
    else timelineCtx.lineTo(x, y);
  }
  timelineCtx.stroke();

  const aligned = filterEventsInRecording(state.session.events, offset, duration);
  for (const event of aligned) {
    const x = (event.audioSec / duration) * width;
    timelineCtx.fillStyle = event.eventType.includes("AURA") ? "#ffcc66" : "#47d16c";
    timelineCtx.fillRect(x - 1, height * 0.62, 2, height * 0.3);
  }
}

function suggestOffset() {
  const buffer = state.session.audioBuffer;
  if (!buffer || !state.session.events.length) return;
  const suggested = suggestAlignmentOffset(
    state.session.envelope,
    state.session.events,
    buffer.duration,
  );
  el.logOffset.value = suggested.toFixed(1);
  el.logOffsetValue.textContent = `${suggested.toFixed(1)} s`;
  drawSessionTimeline();
}

async function generateProposals() {
  const buffer = state.session.audioBuffer;
  if (!buffer || !state.session.events.length) return;
  setSessionProgress(0.1, "Generating proposals…");
  const offset = Number(el.logOffset.value);
  const duration = buffer.duration;
  const aligned = filterEventsInRecording(state.session.events, offset, duration);
  const segmentPad = 0.35;
  const minGap = 0.25;
  const proposals = [];
  let lastEnd = -1;

  for (const event of aligned) {
    const start = Math.max(0, event.audioSec - segmentPad);
    const end = Math.min(duration, event.audioSec + segmentPad);
    if (start < lastEnd + minGap) continue;
    lastEnd = end;

    const startSample = Math.floor(start * buffer.sampleRate);
    const endSample = Math.floor(end * buffer.sampleRate);
    const slice = buffer.getChannelData(0).slice(startSample, endSample);
    const sliceBuffer = state.audioContext.createBuffer(1, slice.length, buffer.sampleRate);
    sliceBuffer.copyToChannel(slice, 0);
    const features = await cueFeaturesFromBuffer(sliceBuffer);
    if (!features.length) continue;

    const stereo = analyzeStereoBalance(sliceBuffer);
    const label = eventToLabel(event);
    proposals.push({
      id: cueId(),
      label,
      action: inferAction(label),
      features,
      audioBlob: bufferToWavBlob(sliceBuffer),
      start,
      end,
      metadata: {
        eventType: event.eventType,
        spellName: event.spellName,
        spellId: event.spellId,
        sourceName: event.sourceName,
        destName: event.destName,
        position: event.position,
        stereo,
        approximatePosition: true,
      },
      notes: event.position
        ? `Approx. map ${event.position.mapId ?? "?"} @ (${event.position.x?.toFixed?.(1)}, ${event.position.y?.toFixed?.(1)})`
        : `Stereo hint: ${stereo.direction} (approximate)`,
    });
  }

  state.session.proposals = proposals;
  renderProposals();
  setSessionProgress(1, `Generated ${proposals.length} proposals`);
}

function renderProposals() {
  const proposals = state.session.proposals;
  el.proposalCount.textContent = `${proposals.length} proposals`;
  el.proposalEmpty.hidden = proposals.length > 0;
  el.proposalList.replaceChildren(...proposals.map((proposal) => {
    const li = document.createElement("li");
    li.className = "proposal-item";
    li.innerHTML = `
      <div>
        <strong>${proposal.label}</strong>
        <span class="subtle">${proposal.start.toFixed(2)}s – ${proposal.end.toFixed(2)}s</span>
        <span class="subtle">${proposal.notes || ""}</span>
      </div>
      <div class="cue-actions">
        <button type="button" data-proposal="play" data-id="${proposal.id}">Play</button>
        <button type="button" data-proposal="review" data-id="${proposal.id}">Review</button>
        <button type="button" data-proposal="discard" data-id="${proposal.id}">Discard</button>
      </div>`;
    return li;
  }));
}

function openProposalReview(id) {
  const proposal = state.session.proposals.find((item) => item.id === id);
  if (!proposal) return;
  state.session.activeProposalId = id;
  el.proposalLabel.value = proposal.label;
  el.proposalAction.value = proposal.action;
  el.proposalStart.value = proposal.start.toFixed(2);
  el.proposalEnd.value = proposal.end.toFixed(2);
  el.proposalDirection.value = proposal.metadata?.stereo?.direction || "";
  el.proposalNotes.value = proposal.notes || "";
  el.proposalDialog.showModal();
}

async function playProposalSegment() {
  const proposal = state.session.proposals.find((item) => item.id === state.session.activeProposalId);
  if (!proposal?.audioBlob) return;
  await ensureAudioContext();
  state.session.playingSource?.stop();
  const buffer = await decodeToMono16k(await proposal.audioBlob.arrayBuffer());
  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.audioContext.destination);
  source.start();
  state.session.playingSource = source;
}

async function confirmProposal() {
  const proposal = state.session.proposals.find((item) => item.id === state.session.activeProposalId);
  if (!proposal) return;
  const start = Number(el.proposalStart.value);
  const end = Number(el.proposalEnd.value);
  let features = proposal.features;
  let audioBlob = proposal.audioBlob;

  const buffer = state.session.audioBuffer;
  if (buffer && end > start) {
    const startSample = Math.floor(start * buffer.sampleRate);
    const endSample = Math.floor(end * buffer.sampleRate);
    const slice = buffer.getChannelData(0).slice(startSample, endSample);
    const sliceBuffer = state.audioContext.createBuffer(1, slice.length, buffer.sampleRate);
    sliceBuffer.copyToChannel(slice, 0);
    features = await cueFeaturesFromBuffer(sliceBuffer);
    audioBlob = bufferToWavBlob(sliceBuffer);
  }

  state.cues.push({
    id: cueId(),
    label: el.proposalLabel.value.trim() || proposal.label,
    action: normalizeAction(el.proposalAction.value),
    features,
    audioBlob,
    metadata: {
      ...proposal.metadata,
      directionTag: el.proposalDirection.value.trim(),
      approximatePosition: true,
    },
    source: "session",
    createdAt: Date.now(),
  });
  state.session.proposals = state.session.proposals.filter((item) => item.id !== proposal.id);
  renderProposals();
  refreshCueUI();
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((btn) => {
        btn.classList.toggle("active", btn === tab);
        btn.setAttribute("aria-selected", btn === tab ? "true" : "false");
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${tab.dataset.tab}`);
      });
    });
  });
}

el.chooseMicrophone.addEventListener("click", () => {
  chooseMicrophone().catch(() => {});
});
el.deviceSelect.addEventListener("change", () => {
  state.microphoneReady = false;
  setMicrophoneState("Click Choose Microphone");
  updateControlStates();
});
el.cueFiles.addEventListener("change", (event) => loadCueFiles([...event.target.files]));
el.actionMap.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) state.actionMap = normalizeActionMap(JSON.parse(await file.text()));
});
el.threshold.addEventListener("input", () => { el.thresholdValue.textContent = Number(el.threshold.value).toFixed(2); });
el.minMatch.addEventListener("input", () => { el.minMatchValue.textContent = `${el.minMatch.value} ms`; });
el.refractory.addEventListener("input", () => { el.refractoryValue.textContent = `${el.refractory.value} ms`; });
el.globalCooldown.addEventListener("input", () => { el.globalCooldownValue.textContent = `${el.globalCooldown.value} ms`; });
el.startService.addEventListener("click", start);
el.stopService.addEventListener("click", stop);
el.clearLog.addEventListener("click", () => el.eventLog.replaceChildren());
el.recordLiveCue.addEventListener("click", openRecordDialog);
el.confirmRecord.addEventListener("click", (event) => {
  event.preventDefault();
  saveLiveRecording();
  el.recordDialog.close();
});
el.cueLibrary.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const cue = state.cues.find((item) => item.id === button.dataset.id);
  if (!cue) return;
  if (button.dataset.action === "play") playCueAudio(cue);
  if (button.dataset.action === "delete") deleteCue(cue.id);
  if (button.dataset.action === "label") relabelCue(cue.id);
});
el.libraryFilter.addEventListener("input", refreshCueUI);
el.exportFingerprints.addEventListener("click", exportFingerprints);
el.importFingerprints.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) await importFingerprints(file);
  event.target.value = "";
});
el.startSession.addEventListener("click", startSessionRecording);
el.stopSession.addEventListener("click", stopSessionRecording);
el.sessionAudioFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) await loadSessionAudioFile(file);
});
el.combatLogFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) await loadCombatLog(file);
});
el.logOffset.addEventListener("input", () => {
  el.logOffsetValue.textContent = `${Number(el.logOffset.value).toFixed(1)} s`;
  drawSessionTimeline();
});
el.suggestOffset.addEventListener("click", suggestOffset);
el.generateProposals.addEventListener("click", generateProposals);
el.proposalList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-proposal]");
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.proposal === "play") {
    const proposal = state.session.proposals.find((item) => item.id === id);
    if (proposal) {
      await ensureAudioContext();
      const buffer = await decodeToMono16k(await proposal.audioBlob.arrayBuffer());
      const source = state.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(state.audioContext.destination);
      source.start();
    }
  }
  if (button.dataset.proposal === "review") openProposalReview(id);
  if (button.dataset.proposal === "discard") {
    state.session.proposals = state.session.proposals.filter((item) => item.id !== id);
    renderProposals();
  }
});
el.playProposal.addEventListener("click", playProposalSegment);
el.confirmProposal.addEventListener("click", (event) => {
  event.preventDefault();
  confirmProposal();
  el.proposalDialog.close();
});

setupTabs();

if (!navigator.mediaDevices || !window.AudioContext) {
  setService("Unsupported");
  setMicrophoneState("Unsupported");
} else {
  refreshDevices().catch(() => {});
  setMicrophoneState("Click Choose Microphone");
  navigator.mediaDevices.addEventListener("devicechange", () => {
    refreshDevices().catch(() => {});
  });
}