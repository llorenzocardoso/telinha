// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativePreview } from "./nativePreview";

const drawn: Array<{ width: number; height: number }> = [];
let tracks: Array<{ stopped: boolean; stop(): void }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  drawn.length = 0;
  tracks = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = 640;
      naturalHeight = 360;
      async decode() {
        if (this.src === "data:bad") throw new Error("bad image");
      }
    },
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: () => drawn.push({ width: 1, height: 1 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.captureStream = vi.fn(() => {
    const track = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    tracks.push(track);
    return { getTracks: () => [track] } as unknown as MediaStream;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NativePreview", () => {
  it("desenha um quadro logo ao começar e outros a cada intervalo", async () => {
    const fetchFrame = vi.fn().mockResolvedValue("data:image/jpeg;base64,x");
    const preview = new NativePreview({ fetchFrame, intervalMs: 500 });
    const stream = preview.start("window:10");
    expect(stream.getTracks()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFrame).toHaveBeenCalledWith("window:10");
    expect(drawn).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1500);
    expect(drawn.length).toBeGreaterThanOrEqual(3);
    preview.stop();
  });

  it("não empilha pedidos quando a captura demora mais que o intervalo", async () => {
    let release: (value: string) => void = () => undefined;
    const fetchFrame = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const preview = new NativePreview({ fetchFrame, intervalMs: 100 });
    preview.start("window:10");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFrame).toHaveBeenCalledTimes(1);
    release("data:image/jpeg;base64,x");
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchFrame.mock.calls.length).toBeGreaterThanOrEqual(2);
    preview.stop();
  });

  it("segue com o último quadro quando uma captura falha", async () => {
    const fetchFrame = vi
      .fn()
      .mockResolvedValueOnce("data:image/jpeg;base64,x")
      .mockRejectedValueOnce(new Error("janela minimizada"))
      .mockResolvedValue("data:image/jpeg;base64,y");
    const preview = new NativePreview({ fetchFrame, intervalMs: 100 });
    preview.start("window:10");
    await vi.advanceTimersByTimeAsync(500);
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    preview.stop();
  });

  it("para os timers e as faixas ao parar, e nada desenha depois", async () => {
    const fetchFrame = vi.fn().mockResolvedValue("data:image/jpeg;base64,x");
    const preview = new NativePreview({ fetchFrame, intervalMs: 100 });
    preview.start("window:10");
    await vi.advanceTimersByTimeAsync(300);
    preview.stop();
    expect(tracks.every((track) => track.stopped)).toBe(true);
    const count = drawn.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(drawn).toHaveLength(count);
    preview.stop();
  });

  it("recomeçar troca a stream e encerra a anterior", () => {
    const preview = new NativePreview({ fetchFrame: async () => "data:x", intervalMs: 100 });
    preview.start("window:1");
    preview.start("window:2");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.stopped).toBe(true);
    expect(tracks[1]!.stopped).toBe(false);
    preview.stop();
  });
});
