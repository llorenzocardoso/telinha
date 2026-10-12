import type { ShareQuality } from "../hooks/useTelinhaRoom";
import { isTauriRuntime } from "../lib/runtime";

export function displayMediaOptions(
  quality: ShareQuality,
  nativeRuntime = isTauriRuntime(),
) {
  const browserAudio = quality.includeAudio && !nativeRuntime;
  const video: Record<string, unknown> = {
    frameRate: { ideal: quality.fps },
    resizeMode: "none",
  };
  if (quality.maxWidth > 0) {
    video.width = { max: quality.maxWidth };
  }
  if (quality.maxHeight && quality.maxHeight > 0) {
    video.height = { max: quality.maxHeight };
  }
  return {
    video,
    audio: browserAudio
      ? {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        }
      : false,
    systemAudio: browserAudio ? "include" : "exclude",
    selfBrowserSurface: "exclude",
    preferCurrentTab: false,
  };
}

/** A pessoa fechou o seletor de tela sem escolher nada. Não é uma falha. */
export class ShareCancelledError extends Error {
  constructor(cause?: unknown) {
    super("Seleção de tela cancelada.");
    this.name = "ShareCancelledError";
    this.cause = cause;
  }
  // O lib do projeto ainda não tipa Error.cause.
  cause?: unknown;
}

export async function startDisplayMediaShare(
  quality: ShareQuality,
  _sourceId: string,
): Promise<MediaStream> {
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_MEDIA === "1") {
    return createSyntheticStream(quality.fps);
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("A captura de tela do Windows não está disponível.");
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(
      displayMediaOptions(quality) as DisplayMediaStreamOptions,
    );
    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const item of stream.getTracks()) {
        item.stop();
      }
      throw new Error("O Windows não retornou uma faixa de vídeo.");
    }
    track.contentHint = "motion";
    return stream;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "AbortError")
    ) {
      throw new ShareCancelledError(error);
    }
    throw error;
  }
}

export function needsNativeAudioLoopback(
  includeAudio: boolean,
  audioTrackCount: number,
  nativeRuntime = isTauriRuntime(),
): boolean {
  return nativeRuntime && includeAudio && audioTrackCount === 0;
}

export function createSyntheticStream(
  fps: number,
  title = "Telinha E2E",
  width = 1280,
  height = 720,
): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = "fixed";
  canvas.style.left = "-10000px";
  canvas.style.top = "0";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.captureStream !== "function") {
    throw new Error("O navegador não suporta a mídia sintética de teste.");
  }
  let frame = 1;
  paintSyntheticFrame(context, canvas, frame, title);
  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Não foi possível criar a track sintética.");
  const timer = window.setInterval(() => {
    frame += 1;
    paintSyntheticFrame(context, canvas, frame, title);
  }, Math.max(16, Math.round(1000 / fps)));
  track.contentHint = "motion";
  track.addEventListener("ended", () => {
    window.clearInterval(timer);
    canvas.remove();
  });
  return stream;
}

function paintSyntheticFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: number,
  title: string,
): void {
  const hue = frame % 360;
  context.fillStyle = `hsl(${hue} 55% 18%)`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = "700 64px system-ui";
  context.fillText(title, 64, 120);
  context.font = "32px monospace";
  context.fillText(`frame ${frame}`, 64, 180);
}
