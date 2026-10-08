import { useRef } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";

interface VolumeControlProps {
  volume: number;
  /** Identifica de qual transmissão é o slider quando há mais de uma na tela. */
  label?: string;
  onChange: (volume: number) => void;
  onInteract?: () => void;
}

/** Slider horizontal dentro da dock flutuante (seção 2.6). */
export function VolumeControl({
  volume,
  label = "Volume da transmissão",
  onChange,
  onInteract,
}: VolumeControlProps) {
  const lastVolume = useRef(volume || 80);
  const railRef = useRef<HTMLDivElement>(null);

  if (volume > 0) lastVolume.current = volume;

  function setFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    onChange(Math.round(Math.min(100, Math.max(0, ratio * 100))));
  }

  function toggleMute() {
    onInteract?.();
    onChange(volume === 0 ? lastVolume.current || 80 : 0);
  }

  return (
    <div className="watch-volume" onPointerDown={onInteract}>
      <button
        type="button"
        className="watch-volume-btn"
        onClick={toggleMute}
        aria-label={volume === 0 ? `Ativar som — ${label}` : `Silenciar — ${label}`}
      >
        {volume === 0 ? (
          <VolumeX aria-hidden="true" strokeWidth={1.8} />
        ) : volume > 40 ? (
          <Volume2 aria-hidden="true" strokeWidth={1.8} />
        ) : (
          <Volume1 aria-hidden="true" strokeWidth={1.8} />
        )}
      </button>
      <div
        className="watch-volume-slider"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            onChange(Math.min(100, volume + 5));
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            onChange(Math.max(0, volume - 5));
          }
        }}
      >
        <div
          ref={railRef}
          className="watch-volume-rail"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) setFromPointer(event);
          }}
        >
          <span className="watch-volume-fill" style={{ width: `${volume}%` }} />
          <span className="watch-volume-thumb" style={{ left: `${volume}%` }} />
        </div>
      </div>
    </div>
  );
}
