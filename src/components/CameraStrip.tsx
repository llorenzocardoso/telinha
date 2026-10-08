import { Settings } from "lucide-react";
import { useRef, useState } from "react";
import type { CameraFeedInfo } from "../hooks/useTelinhaRoom";
import { VideoTile } from "./VideoTile";

interface CameraStripProps {
  cameras: CameraFeedInfo[];
  onOpenSettings?: () => void;
}

interface Offset {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * As câmeras flutuam sobre a sala e podem ser arrastadas: segure o clique no quadrado e mova.
 * A posição vale enquanto a câmera está no ar e o quadrado nunca sai da janela.
 */
export function CameraStrip({ cameras, onOpenSettings }: CameraStripProps) {
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  if (cameras.length === 0) return null;

  return (
    <section className="camera-strip" aria-label="Câmeras">
      {cameras.map((camera) => (
        <CameraTile
          key={camera.participantIdentity}
          camera={camera}
          offset={offsets[camera.participantIdentity] ?? { x: 0, y: 0 }}
          onMove={(next) =>
            setOffsets((current) => ({ ...current, [camera.participantIdentity]: next }))
          }
          onOpenSettings={onOpenSettings}
        />
      ))}
    </section>
  );
}

interface DragState {
  startX: number;
  startY: number;
  origin: Offset;
  rect: DOMRect;
}

function CameraTile({
  camera,
  offset,
  onMove,
  onOpenSettings,
}: {
  camera: CameraFeedInfo;
  offset: Offset;
  onMove: (offset: Offset) => void;
  onOpenSettings?: () => void;
}) {
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // O botão de configurações continua clicável, sem iniciar o arraste.
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
      rect: event.currentTarget.getBoundingClientRect(),
    };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state) return;
    // Mantém o quadrado inteiro dentro da janela.
    const dx = clamp(
      event.clientX - state.startX,
      -state.rect.left,
      window.innerWidth - state.rect.right,
    );
    const dy = clamp(
      event.clientY - state.startY,
      -state.rect.top,
      window.innerHeight - state.rect.bottom,
    );
    onMove({ x: state.origin.x + dx, y: state.origin.y + dy });
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <div
      className={`camera-tile ${camera.isLocal ? "local" : ""} ${dragging ? "is-dragging" : ""}`}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <VideoTile stream={camera.stream} />
      <span className="camera-tile-name">{camera.isLocal ? "Você" : camera.participantName}</span>
      {camera.isLocal && onOpenSettings && (
        <button
          type="button"
          className="camera-tile-settings"
          aria-label="Trocar câmera"
          title="Trocar câmera"
          onClick={onOpenSettings}
        >
          <Settings aria-hidden="true" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}
