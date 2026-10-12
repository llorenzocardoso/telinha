import { describe, expect, it } from "vitest";
import { displayMediaOptions, needsNativeAudioLoopback } from "./displayShare";

const quality = {
  fps: 60,
  maxWidth: 2560,
  maxHeight: 1440,
  maxBitrate: 24_000_000,
  includeAudio: true,
  preferH264: true,
};

describe("display media options", () => {
  it("asks Chromium for a smooth 60fps stream", () => {
    const options = displayMediaOptions(quality, true);
    expect(options.video).toMatchObject({
      frameRate: { ideal: 60 },
      width: { max: 2560 },
      height: { max: 1440 },
      resizeMode: "none",
    });
    expect(options.video).not.toHaveProperty("displaySurface");
    expect(options.audio).toBe(false);
    expect(options.systemAudio).toBe("exclude");
  });

  it("requests browser audio without invoking the native loopback", () => {
    const options = displayMediaOptions(quality, false);
    expect(options.audio).toMatchObject({
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    });
    expect(options.systemAudio).toBe("include");
    expect(needsNativeAudioLoopback(true, 0, false)).toBe(false);
  });

  it("uses native loopback only inside Tauri when the stream has no audio", () => {
    expect(needsNativeAudioLoopback(true, 0, true)).toBe(true);
    expect(needsNativeAudioLoopback(true, 1, true)).toBe(false);
    expect(needsNativeAudioLoopback(false, 0, true)).toBe(false);
  });

  it("can skip system audio and keep native resolution", () => {
    const options = displayMediaOptions({ ...quality, includeAudio: false, maxWidth: 0 });
    expect(options.video).toMatchObject({
      frameRate: { ideal: 60 },
    });
    expect(options.video).not.toHaveProperty("width");
    expect(options.audio).toBe(false);
    expect(options.systemAudio).toBe("exclude");
  });
});
