import { describe, expect, it, vi } from "vitest";
import {
  displayMediaOptions,
  needsNativeAudioLoopback,
  startDisplayMediaShare,
} from "./displayShare";

const quality = {
  fps: 60,
  maxWidth: 2560,
  maxHeight: 1440,
  maxBitrate: 24_000_000,
  includeAudio: true,
  preferH264: true,
};

describe("startDisplayMediaShare", () => {
  it("não deixa uma fonte nativa cair no seletor do Windows", async () => {
    const getDisplayMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });
    await expect(startDisplayMediaShare(quality, "window:10")).rejects.toThrow(
      /só pode ser compartilhada pelo envio nativo/,
    );
    expect(getDisplayMedia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

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
