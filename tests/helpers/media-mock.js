/**
 * Browser init script: fake microphone devices and stable AudioWorklet stubs.
 * Loaded via page.addInitScript({ path }) before navigation.
 */
(() => {
  const FAKE_DEVICE_ID = "fake-mic-e2e-1";
  const FAKE_DEVICE_LABEL = "Fake Test Microphone";

  function createFakeAudioTrack(deviceId) {
    const track = {
      kind: "audio",
      id: "fake-audio-track",
      label: FAKE_DEVICE_LABEL,
      enabled: true,
      muted: false,
      readyState: "live",
      stop() {
        this.readyState = "ended";
      },
      getSettings() {
        return { deviceId };
      },
      getConstraints() {
        return { audio: { deviceId: { exact: deviceId } } };
      },
    };
    return track;
  }

  function createFakeStream(deviceId = FAKE_DEVICE_ID) {
    const track = createFakeAudioTrack(deviceId);
    return {
      id: "fake-media-stream",
      active: true,
      getTracks() {
        return [track];
      },
      getAudioTracks() {
        return [track];
      },
      getVideoTracks() {
        return [];
      },
      addTrack() {},
      removeTrack() {},
      getTrackById(id) {
        return id === track.id ? track : undefined;
      },
    };
  }

  const fakeDevices = [
    {
      deviceId: FAKE_DEVICE_ID,
      kind: "audioinput",
      label: FAKE_DEVICE_LABEL,
      groupId: "fake-group-1",
      toJSON() {
        return this;
      },
    },
  ];

  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
  }

  navigator.mediaDevices.enumerateDevices = async () => fakeDevices.map((device) => ({ ...device }));

  navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
    const requestedId =
      constraints.audio?.deviceId?.exact ||
      constraints.audio?.deviceId ||
      FAKE_DEVICE_ID;
    return createFakeStream(String(requestedId));
  };

  class MockAudioWorkletNode {
    constructor(context) {
      this.context = context;
      this.numberOfInputs = 1;
      this.numberOfOutputs = 1;
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }

    connect(target) {
      return target || this;
    }

    disconnect() {}
  }

  window.AudioWorkletNode = MockAudioWorkletNode;

  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (NativeAudioContext) {
    const nativeProto = NativeAudioContext.prototype;
    const originalAudioWorkletGetter = Object.getOwnPropertyDescriptor(nativeProto, "audioWorklet");

    class PatchedAudioContext extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const worklet = originalAudioWorkletGetter?.get?.call(this) || this.audioWorklet;
        if (worklet && !worklet.__e2ePatched) {
          worklet.addModule = async () => undefined;
          worklet.__e2ePatched = true;
        }
      }
    }

    window.AudioContext = PatchedAudioContext;
    if (window.webkitAudioContext) {
      window.webkitAudioContext = PatchedAudioContext;
    }
  }
})();