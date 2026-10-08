import { createSyntheticStream } from "./displayShare";

const DEVICE_KEY = "telinha-camera-device";

export const CAMERA_MAX_BITRATE = 1_500_000;

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export function loadCameraDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveCameraDeviceId(deviceId: string | null): void {
  try {
    if (deviceId) {
      localStorage.setItem(DEVICE_KEY, deviceId);
    } else {
      localStorage.removeItem(DEVICE_KEY);
    }
  } catch {
  }
}

export function cameraConstraints(deviceId?: string | null): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) {
    video.deviceId = { exact: deviceId };
  }
  return { video, audio: false };
}

export function describeCameras(
  devices: Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[],
): CameraDevice[] {
  return devices
    .filter((device) => device.kind === "videoinput" && device.deviceId)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label:
        device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim() ||
        `Câmera ${index + 1}`,
    }));
}

export async function listCameras(): Promise<CameraDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    return describeCameras(await navigator.mediaDevices.enumerateDevices());
  } catch {
    return [];
  }
}

export function cameraErrorMessage(error: unknown): string {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
      return "O acesso à câmera foi negado. Libere a câmera nas configurações de privacidade do Windows.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Nenhuma câmera foi encontrada.";
    case "NotReadableError":
    case "AbortError":
      return "A câmera está em uso por outro aplicativo.";
    default:
      return "Não foi possível ligar a câmera.";
  }
}

export async function startCameraStream(
  deviceId?: string | null,
  options: { allowFallback?: boolean } = {},
): Promise<MediaStream> {
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_MEDIA === "1") {
    return createSyntheticStream(30, "Câmera E2E", 640, 360);
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("A câmera não está disponível neste dispositivo.");
  }

  try {
    return await navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId));
  } catch (error) {
    const missing = ["NotFoundError", "OverconstrainedError"].includes(errorName(error));
    if (deviceId && missing && (options.allowFallback ?? true)) {
      // A câmera escolhida foi desconectada: volta para a padrão do sistema.
      saveCameraDeviceId(null);
      return startCameraStream(null, { allowFallback: false });
    }
    throw Object.assign(new Error(cameraErrorMessage(error)), { cause: error });
  }
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String(error.name) : "";
}
