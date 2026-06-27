# Continuation Prompt

You are working in the public repo:

```text
https://github.com/yishengjiang99/audio-cue-detector
```

Local checkout:

```text
/Applications/World of Warcraft/_retail_/tools/audio_cue_detector
```

Current direction:

- The project must be browser-native.
- Use Web Audio APIs and ordinary browser media permissions.
- Do not use Swift.
- Do not use Python.
- Do not control World of Warcraft, attach to its process, read memory, inspect packets, send inputs, or automate gameplay.
- Do not redistribute Blizzard/game audio assets.

The app should run as a webpage. The user explicitly enables `AudioContext` by clicking a button. The browser then requests audio input permission with `getUserMedia`. For game-output capture, the selected input should be a browser-visible loopback/system-audio source if one exists. Browser APIs cannot directly capture macOS output-only devices such as `External Headphones`.

The detector should remain advisory only: it may emit human-facing states such as `RUN`, `ATTACK`, or `NEUTRAL`.
