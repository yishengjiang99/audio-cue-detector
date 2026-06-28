## Product Goal

Build a **browser-native advisory audio coach** to help players legitimately pursue 2400 rating in World of Warcraft Solo Shuffle (Midnight expansion).

The app should detect simple strategic audio cues from the game and recommend one of three actions:

- **PUSH** — trade forward, follow pressure, commit damage, or capitalize on a cooldown window.
- **PULL** — kite, line of sight, reset, avoid overextending, or wait for defensive recovery.
- **NEUTRAL** — no strong recommendation.

**Core rule**: This is strictly a coaching / training aid. It must never play the game, select targets, move the character, press abilities, automate inputs, or infer hidden game state. It only analyzes user-provided or user-routed audio.

## Required Architecture

- Single self-contained webpage (vanilla HTML + JS preferred; no heavy frameworks).
- Use only browser APIs: Web Audio API, `getUserMedia`, `AudioContext`, AnalyserNode, etc.
- Require explicit user gesture (click/tap) to initialize `AudioContext`.
- Audio input must be **microphone-only**. User clicks to choose a physical mic; exclude loopback/virtual devices from the picker.
- Support loading user-provided audio examples via file inputs (WAV/MP3/etc.).
- All cue extraction, feature computation, and matching must happen in client-side JavaScript.
- No Swift, Python, Docker, or server-side components for normal operation.

**Note on input**: Do not support system output or loopback capture. Document microphone-only setup in the UI/README.

## Data & Training Boundaries

- Allowed: User-provided audio clips, browser-captured audio (with explicit permission), user-exported combat logs, user-authored labels/action maps, manually exported notes.
- Strictly forbidden: Datamining, reverse-engineering, or parsing the WoW binary / CASC assets. Do not redistribute any Blizzard audio.
- Fingerprints / models (if added) must store only derived numeric features + user labels — never raw copyrighted audio.

## Recommendation Model

Frame the system as an **advisory cue matcher / strategy scorer**. Compare live audio features against user-authored examples and output PUSH / PULL / NEUTRAL.

- Prefer simple, interpretable matching (e.g., time-domain stats + spectral similarity) over complex ML unless it adds clear value.
- Support a training feedback loop: users should be able to record short clips during/after gameplay and label them easily.

**Non-goals**: Full ML classifier, real-time action automation, hidden state inference, or perfect accuracy. Focus on helpful, tunable cues that augment human decision-making.

## Audio + Combat Log Analysis Sessions (Training Data Enrichment)

Support **Analysis Sessions** that let users rapidly build high-quality labeled training data by combining recorded game audio with exported combat logs.

**Core flow**:
- User starts an Analysis Session and records a segment via the chosen microphone while playing or reviewing footage. The app captures the raw audio with timestamps.
- User optionally uploads the corresponding WoW combat log file (or a relevant time-range excerpt) from `_retail_/Logs/WoWCombatLog.txt`. The app should support both normal and Advanced Combat Logging formats.
- The app parses the log for relevant events (especially `SPELL_CAST_*`, `SPELL_AURA_*`, damage/heal events, and other audible effects) within the recording’s time window.
- **Timestamp alignment**: Provide a simple interface for the user to align the recording’s start time with the log (manual offset slider + visual timeline of audio waveform + log events). Offer automatic suggestions based on audio energy spikes or silence detection.
- **Auto-proposal of labeled examples**: For each matching event in the time window, the app extracts the corresponding short audio segment and proposes a labeled cue example, e.g.:
  - “Cast: [SpellName] by [SourceName]”
  - “Aura applied: [SpellName] on [TargetName]”
  - Include spell ID/name when available for richer metadata.
- **User review & confirmation**: Show a review interface (waveform with event markers on a timeline). User can play individual segments, adjust boundaries, edit labels, add notes, or discard. Only confirmed examples are added to the main cue library.
- **Optional positioning enrichment** (“cast source origin”):
  - When Advanced Combat Logging is enabled, extract available positional data (X/Y coordinates, MapID, facing) from relevant log events and attach it as metadata.
  - Perform basic client-side stereo audio analysis (left/right balance and volume envelope) to suggest rough direction/distance.
  - Clearly label these as approximate/supplementary. Allow easy user override or manual tagging (“Sound came from left/front”).
  - Positioning metadata can later be used for filtering or weighted matching but is **not required** for core PUSH/PULL recommendations.

**Goals & Benefits**:
- Dramatically accelerate creation of spell- and effect-specific cue examples.
- Enable more precise, context-aware recommendations (e.g., distinguish friendly vs. enemy casts, or note high-priority spells).
- Strengthen the training feedback loop with semi-automated labeling while keeping the human in full control.

**Constraints & Guardrails**:
- All processing is local and client-side.
- No automatic addition of examples — user must review and confirm.
- Do not attempt to reconstruct hidden game state beyond what is explicitly present in the user-provided audio recording + uploaded combat log.
- Keep positioning features clearly marked as optional and approximate.
- Focus on events that produce audible cues. Provide clear progress indicators for large logs/recordings.
- Examples created this way should be fully compatible with the existing cue library (playable, deletable, re-labelable, exportable).

This feature should feel like a natural extension of the existing “Record Example from Live” flow, but scaled up for entire sessions/fights.

## Safety & Fair Play Constraints

- No WoW process interaction, input injection, memory/packet inspection, or binary access.
- No protected API abuse.
- Include a prominent disclaimer that the tool is advisory only and preserves fair play.
- All processing is local and client-side.

## Deliverables & Polish

- Clean, dark/gaming-themed UI with real-time waveform + spectrum visualizers.
- Large, glanceable recommendation display.
- Easy cue library management (load, record, label, delete, play examples).
- Tunable parameters (sensitivity, analysis window, refractory period).
- Comprehensive README with microphone setup instructions, usage tips for 2400-level play, and limitations.
- Make it feel professional and fun for a dedicated Solo Shuffle player.

Prioritize a solid v1 that is immediately usable and extensible. Keep the experience lightweight, responsive, and fully offline-capable after loading.
```

This version integrates the new section cleanly while maintaining the overall improvements from before (tighter language, non-goals, structure). It’s ready to use as a continuation prompt. Let me know if you want further tweaks!