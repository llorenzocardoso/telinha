import { Settings } from "lucide-react";
import type { CSSProperties } from "react";
import type { CameraFeedInfo } from "../hooks/useTelinhaRoom";
import { mosaicColumns } from "../lib/watch";
import { VideoTile } from "./VideoTile";

interface CameraStripProps {
  cameras: CameraFeedInfo[];
  variant: "stage" | "row" | "overlay";
  onOpenSettings?: () => void;
}

export function CameraStrip({ cameras, variant, onOpenSettings }: CameraStripProps) {
  if (cameras.length === 0) return null;
  const columns = mosaicColumns(cameras.length);
  const grid = {
    "--camera-columns": columns,
    "--camera-rows": Math.ceil(cameras.length / columns),
  } as CSSProperties;
  return (
    <section
      className={`camera-strip ${variant}`}
      aria-label="Câmeras"
      style={variant === "stage" ? grid : undefined}
    >
      {cameras.map((camera) => (
        <div
          key={camera.participantIdentity}
          className={`camera-tile ${camera.isLocal ? "local" : ""}`}
        >
          <VideoTile stream={camera.stream} />
          <span className="camera-tile-name">
            {camera.isLocal ? "Você" : camera.participantName}
          </span>
          {camera.isLocal && onOpenSettings && (
            <button
              type="button"
              className="camera-tile-settings"
              aria-label="Trocar câmera"
              title="Trocar câmera"
              onClick={onOpenSettings}
            >
              <Settings aria-hidden="true" strokeWidth={2.2} />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
