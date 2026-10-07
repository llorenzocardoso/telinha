import { useEffect, useState } from "react";
import {
  listCameras,
  loadCameraDeviceId,
  saveCameraDeviceId,
  startCameraStream,
  type CameraDevice,
} from "../media/camera";
import { VideoTile } from "./VideoTile";

interface CameraSettingsProps {
  onClose: () => void;
}

export function CameraSettings({ onClose }: CameraSettingsProps) {
  const [selected, setSelected] = useState<string | null>(loadCameraDeviceId);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: MediaStream | null = null;
    setError(null);

    // Os nomes das câmeras só aparecem depois que o sistema libera o acesso a uma delas.
    void startCameraStream(selected, { allowFallback: false })
      .then((stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }
        opened = stream;
        setPreview(stream);
      })
      .catch((cause) => {
        if (cancelled) return;
        setPreview(null);
        setError(cause instanceof Error ? cause.message : "Não foi possível abrir a câmera.");
      })
      .then(listCameras)
      .then((found) => {
        if (!cancelled) setDevices(found);
      });

    return () => {
      cancelled = true;
      if (opened) stopStream(opened);
      setPreview(null);
    };
  }, [selected]);

  function choose(deviceId: string | null) {
    saveCameraDeviceId(deviceId);
    setSelected(deviceId);
  }

  const options: { deviceId: string | null; label: string }[] = [
    { deviceId: null, label: "Padrão do sistema" },
    ...devices,
  ];

  return (
    <div
      className="update-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-settings-title"
    >
      <div className="notice camera-settings">
        <strong id="camera-settings-title">Câmera padrão</strong>
        <p>O Telinha usa esta câmera sempre que você ligar o vídeo.</p>

        <div className="camera-preview">
          {preview ? (
            <VideoTile stream={preview} />
          ) : (
            <p role={error ? "alert" : undefined}>{error ?? "Abrindo a câmera..."}</p>
          )}
        </div>

        <div className="camera-device-list" role="radiogroup" aria-label="Câmeras disponíveis">
          {options.map((option) => (
            <button
              key={option.deviceId ?? "default"}
              type="button"
              role="radio"
              aria-checked={option.deviceId === selected}
              className="camera-device"
              onClick={() => choose(option.deviceId)}
            >
              <span className="camera-device-mark" aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        <div className="notice-actions">
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
