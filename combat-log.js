const AUDIBLE_EVENT_TYPES = new Set([
  "SPELL_CAST_START",
  "SPELL_CAST_SUCCESS",
  "SPELL_CAST_FAILED",
  "SPELL_AURA_APPLIED",
  "SPELL_AURA_APPLIED_DOSE",
  "SPELL_AURA_REFRESH",
  "SPELL_AURA_REMOVED",
  "SPELL_DAMAGE",
  "SPELL_PERIODIC_DAMAGE",
  "SPELL_MISSED",
  "SPELL_HEAL",
  "SPELL_PERIODIC_HEAL",
  "SWING_DAMAGE",
  "SWING_MISSED",
  "RANGE_DAMAGE",
  "RANGE_MISSED",
  "ENVIRONMENTAL_DAMAGE",
  "UNIT_DIED",
  "PARTY_KILL",
]);

const CAST_EVENTS = new Set([
  "SPELL_CAST_START",
  "SPELL_CAST_SUCCESS",
  "SPELL_CAST_FAILED",
]);

const AURA_EVENTS = new Set([
  "SPELL_AURA_APPLIED",
  "SPELL_AURA_APPLIED_DOSE",
  "SPELL_AURA_REFRESH",
  "SPELL_AURA_REMOVED",
]);

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

function parseTimestamp(monthDay, time) {
  const [month, day] = monthDay.split("/").map(Number);
  const [hours, minutes, secondsMs] = time.split(":");
  const [seconds, millis = "0"] = secondsMs.split(".");
  const date = new Date(2026, month - 1, day, Number(hours), Number(minutes), Number(seconds), Number(millis));
  return date.getTime();
}

function parseCsvFields(payload) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < payload.length; i += 1) {
    const char = payload[i];
    if (char === '"') {
      if (inQuotes && payload[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

function looksLikeUnitName(value) {
  if (!value || /^0x[0-9a-f]+$/i.test(value) || /^\d+$/.test(value)) return false;
  return /^[A-Za-z]/.test(value) && value.length > 2;
}

function findUnitName(fields, start = 0, end = 8) {
  for (let i = start; i < Math.min(end, fields.length); i += 1) {
    const value = unquote(fields[i]);
    if (looksLikeUnitName(value)) return value;
  }
  return "";
}

function findSpellInfo(fields) {
  for (let i = 6; i < fields.length - 1; i += 1) {
    const idValue = unquote(fields[i]);
    const nameValue = unquote(fields[i + 1]);
    if (/^\d+$/.test(idValue) && /^[A-Za-z]/.test(nameValue) && nameValue.length > 1) {
      return { spellId: Number(idValue), spellName: nameValue, index: i + 1 };
    }
  }
  for (let i = 6; i < fields.length; i += 1) {
    const value = unquote(fields[i]);
    if (/^[A-Za-z]/.test(value) && value.length > 2 && !/^0x/i.test(value)) {
      return { spellId: null, spellName: value, index: i };
    }
  }
  return null;
}

function extractPosition(fields) {
  const nums = fields
    .map((field) => unquote(field))
    .filter((value) => /^-?\d+(\.\d+)?$/.test(value))
    .map(Number);
  if (nums.length >= 4) {
    const [x, y, z, facing] = nums.slice(-4);
    const mapId = nums.length >= 5 ? nums[nums.length - 5] : null;
    if (Math.abs(x) < 50000 && Math.abs(y) < 50000) {
      return { x, y, z, facing, mapId, approximate: true };
    }
  }
  return null;
}

export function parseCombatLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(/^(\d{1,2}\/\d{1,2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+([^,]+),(.*)$/);
  if (!match) return null;

  const [, monthDay, time, eventType, payload] = match;
  if (!AUDIBLE_EVENT_TYPES.has(eventType)) return null;

  const fields = parseCsvFields(payload);
  const sourceName = findUnitName(fields, 0, 5) || "Unknown";
  const destName = findUnitName(fields, 4, 10);
  const spell = findSpellInfo(fields);
  const spellId = spell?.spellId ?? null;
  const position = extractPosition(fields);

  return {
    eventType,
    timestampMs: parseTimestamp(monthDay, time),
    sourceName: sourceName || "Unknown",
    destName: destName || "",
    spellName: spell?.spellName || "",
    spellId,
    position,
    raw: trimmed,
  };
}

export function parseCombatLog(text, onProgress) {
  const lines = text.split(/\r?\n/);
  const events = [];
  const step = Math.max(1, Math.floor(lines.length / 100));
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseCombatLogLine(lines[i]);
    if (parsed) events.push(parsed);
    if (onProgress && i % step === 0) onProgress(i / lines.length);
  }
  if (onProgress) onProgress(1);
  events.sort((a, b) => a.timestampMs - b.timestampMs);
  return events;
}

export function getLogTimeBounds(events) {
  if (!events.length) return { startMs: 0, endMs: 0, durationMs: 0 };
  const startMs = events[0].timestampMs;
  const endMs = events[events.length - 1].timestampMs;
  return { startMs, endMs, durationMs: endMs - startMs };
}

export function filterEventsInRecording(events, offsetSec, audioDurationSec) {
  const logStart = events[0]?.timestampMs ?? 0;
  return events.filter((event) => {
    const relativeSec = (event.timestampMs - logStart) / 1000 + offsetSec;
    return relativeSec >= 0 && relativeSec <= audioDurationSec;
  }).map((event) => ({
    ...event,
    audioSec: (event.timestampMs - logStart) / 1000 + offsetSec,
  }));
}

export function eventToLabel(event) {
  if (CAST_EVENTS.has(event.eventType)) {
    return `Cast: ${event.spellName || "Unknown spell"} by ${event.sourceName}`;
  }
  if (AURA_EVENTS.has(event.eventType)) {
    const verb = event.eventType.includes("REMOVED") ? "Aura removed" : "Aura applied";
    const target = event.destName ? ` on ${event.destName}` : "";
    return `${verb}: ${event.spellName || "Unknown aura"}${target}`;
  }
  if (event.eventType.includes("DAMAGE") || event.eventType.includes("MISSED")) {
    return `Damage: ${event.spellName || event.eventType} from ${event.sourceName}`;
  }
  if (event.eventType.includes("HEAL")) {
    return `Heal: ${event.spellName || event.eventType} on ${event.destName || event.sourceName}`;
  }
  if (event.eventType === "UNIT_DIED") {
    return `Unit died: ${event.destName || event.sourceName}`;
  }
  return `${event.eventType}: ${event.spellName || event.sourceName}`;
}

export function suggestAlignmentOffset(audioEnvelope, events, audioDurationSec) {
  if (!audioEnvelope.length || !events.length) return 0;

  const logStart = events[0].timestampMs;
  const firstEventSec = 0;
  let peakSec = 0;
  let peakValue = 0;
  for (let i = 0; i < audioEnvelope.length; i += 1) {
    if (audioEnvelope[i] > peakValue) {
      peakValue = audioEnvelope[i];
      peakSec = (i / audioEnvelope.length) * audioDurationSec;
    }
  }

  const burstWindowSec = Math.min(8, audioDurationSec * 0.25);
  const burstCount = events.filter((event) => {
    const sec = (event.timestampMs - logStart) / 1000;
    return sec <= burstWindowSec;
  }).length;

  if (burstCount > 3) {
    const burstCenter = burstWindowSec * 0.35;
    return Math.max(0, Math.min(audioDurationSec, peakSec - burstCenter));
  }
  return Math.max(0, Math.min(audioDurationSec, peakSec - firstEventSec));
}

export function buildAudioEnvelope(samples, bucketCount = 400) {
  const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));
  const envelope = [];
  for (let i = 0; i < samples.length; i += bucketSize) {
    let peak = 0;
    for (let j = i; j < Math.min(i + bucketSize, samples.length); j += 1) {
      peak = Math.max(peak, Math.abs(samples[j]));
    }
    envelope.push(peak);
  }
  const max = Math.max(...envelope, 0.0001);
  return envelope.map((value) => value / max);
}