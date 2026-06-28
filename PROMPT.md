# Continuation Prompt

You are working in the public repo:

```text
https://github.com/yishengjiang99/audio-cue-detector
```

Local checkout:

```text
/Applications/World of Warcraft/_retail_/tools/audio_cue_detector
```

## Product Goal

Build a browser-native advisory audio coach to help a human player legitimately pursue `2400` rating in World of Warcraft `Solo Shuffle` during the `Midnight` expansion.

The app should recommend simple strategic audio/visual cues such as:

- `PUSH`: trade forward, follow pressure, commit damage, or capitalize on a teammate/enemy cooldown window.
- `PULL`: kite, line, reset, avoid overextending, or wait for defensive recovery.
- `NEUTRAL`: no strong recommendation.

The tool must be a coaching aid only. It must never play the game, select targets, move the character, press abilities, automate inputs, or infer hidden state.

## Required Architecture

- Run as a webpage.
- Use Web Audio APIs and ordinary browser media permissions.
- Require the user to explicitly enable `AudioContext` with a click or equivalent browser gesture.
- Capture only browser-visible audio inputs through `getUserMedia`, such as a loopback/system-audio input device if the user has configured one.
- Allow local cue/audio examples to be loaded by the user through file inputs.
- Keep all cue extraction and matching in JavaScript.
- Do not use Swift.
- Do not use Python.
- Do not require Docker for normal operation.

Browser APIs cannot directly capture macOS output-only devices such as `External Headphones`. If the user wants game-output analysis, they must provide a browser-visible loopback/system-audio input source.

## Data And Training Boundary

Do not datamine, reverse engineer, inspect, or parse the World of Warcraft `_retail_` binary or CASC game assets.

Allowed inputs:

- User-provided audio clips.
- Browser-captured audio that the user explicitly grants.
- User-authored action maps.
- User-provided notes, match reviews, or manually exported data that does not require violating game terms or extracting hidden state.

Do not redistribute Blizzard/game audio assets. If fingerprints are added later, store only user-generated numeric features and labels, never copyrighted audio.

## Recommendation Model

If adding a model or scoring layer, frame it as an advisory strategy scorer, not as an automation engine. It may compare visible/audio-observable cues against player-authored strategic labels and produce `PUSH`, `PULL`, or `NEUTRAL`.

Avoid language or implementation that implies exploiting, botting, binary mining, memory inspection, packet inspection, or adversarial manipulation of the game client. Use terms like:

- `strategy scorer`
- `cue matcher`
- `pressure/reset classifier`
- `training feedback loop`

Do not use an "adversarial gain network" to optimize gameplay actions or exploit opponent behavior. Any learning loop should support post-game review, cue tuning, or player training.

## Safety Constraints

- No WoW process control.
- No input injection.
- No memory reads.
- No packet inspection.
- No binary datamining.
- No protected API abuse.
- No hidden game-state inference.
- No automated combat, movement, targeting, cooldown usage, interrupts, or rotations.

The final experience should help the player make better human decisions while preserving fair play.
