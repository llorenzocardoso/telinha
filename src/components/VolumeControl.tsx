import { useRef } from "react";

interface VolumeControlProps {
  volume: number;
  label?: string;
  onChange: (volume: number) => void;
  onInteract?: () => void;
}

export function VolumeControl({
  volume,
  label = "Volume da transmissão",
  onChange,
  onInteract,
}: VolumeControlProps) {
  const lastVolume = useRef(volume || 80);
  const railRef = useRef<HTMLDivElement>(null);

  if (volume > 0) {
    lastVolume.current = volume;
  }

  function setFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const ratio = (rect.bottom - event.clientY) / rect.height;
    onChange(Math.round(Math.min(100, Math.max(0, ratio * 100))));
  }

  function toggleMute() {
    onInteract?.();
    onChange(volume === 0 ? lastVolume.current || 80 : 0);
  }

  function onRailPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    onInteract?.();
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromPointer(event);
  }

  function onRailPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.buttons !== 1) return;
    setFromPointer(event);
  }

  return (
    <div className="watch-volume" onPointerDown={onInteract}>
      <button
        type="button"
        className="watch-volume-btn"
        onClick={toggleMute}
        aria-label={volume === 0 ? "Ativar som" : "Silenciar"}
        data-tooltip={volume === 0 ? "Ativar som" : "Volume"}
      >
        <SpeakerIcon volume={volume} />
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
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            onChange(Math.min(100, volume + 5));
          }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(Math.max(0, volume - 5));
          }
        }}
      >
        <div
          ref={railRef}
          className="watch-volume-rail"
          onPointerDown={onRailPointerDown}
          onPointerMove={onRailPointerMove}
        >
          <span className="watch-volume-fill" style={{ height: `${volume}%` }} />
          <span className="watch-volume-thumb" style={{ bottom: `${volume}%` }} />
        </div>
      </div>
    </div>
  );
}

function SpeakerIcon({ volume }: { volume: number }) {
  if (volume === 0) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 3.5 7.5 8H3.75C3.336 8 3 8.336 3 8.75v6.5c0 .414.336.75.75.75H7.5L12 20.5V3.5Z"
        />
        <path
          fill="currentColor"
          d="m15.2 10.2 1.4-1.4 1.4 1.4 1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4Z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3.5 7.5 8H3.75C3.336 8 3 8.336 3 8.75v6.5c0 .414.336.75.75.75H7.5L12 20.5V3.5Z"
      />
      {volume > 40 && (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          d="M15.2 8.8a5.2 5.2 0 0 1 0 6.4"
        />
      )}
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M17.6 6.6a8.4 8.4 0 0 1 0 10.8"
      />
    </svg>
  );
}
