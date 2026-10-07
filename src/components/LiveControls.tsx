import type { ReactNode } from "react";
import { PhoneOff, Video, VideoOff } from "lucide-react";
import { VolumeControl } from "./VolumeControl";

export interface StreamVolume {
  id: string;
  // Só vem preenchido quando há mais de uma transmissão na tela.
  name?: string;
  volume: number;
  onChange: (volume: number) => void;
}

interface LiveControlsProps {
  volumes: StreamVolume[];
  fullscreen: boolean;
  connected: boolean;
  isSharing: boolean;
  cameraOn: boolean;
  cameraReady: boolean;
  cameraLabel: string;
  onToggleFullscreen: () => void;
  onToggleShare: () => void;
  onToggleCamera: () => void;
  onStopWatching: () => void;
  onLeaveRoom: () => void;
  onLockChange: (locked: boolean) => void;
}

export function LiveControls({
  volumes,
  fullscreen,
  connected,
  isSharing,
  cameraOn,
  cameraReady,
  cameraLabel,
  onToggleFullscreen,
  onToggleShare,
  onToggleCamera,
  onStopWatching,
  onLeaveRoom,
  onLockChange,
}: LiveControlsProps) {
  function releaseControls(event: React.FocusEvent<HTMLElement> | React.PointerEvent<HTMLElement>) {
    if (
      "relatedTarget" in event &&
      event.currentTarget.contains(event.relatedTarget as Node | null)
    ) {
      return;
    }
    onLockChange(false);
  }

  return (
    <footer
      className="watch-controls-layer"
      onPointerEnter={() => onLockChange(true)}
      onPointerLeave={releaseControls}
      onFocusCapture={() => onLockChange(true)}
      onBlurCapture={releaseControls}
    >
      <div className="watch-edge-controls watch-audio-controls">
        {volumes.map((item) => (
          <div key={item.id} className="watch-volume-item">
            <VolumeControl
              volume={item.volume}
              label={item.name ? `Volume de ${item.name}` : undefined}
              onChange={item.onChange}
              onInteract={() => onLockChange(true)}
            />
            {item.name && <span className="watch-volume-name">{item.name}</span>}
          </div>
        ))}
      </div>

      <div className="watch-control-dock" aria-label="Controles da transmissão">
        <ControlButton
          label={isSharing ? "Parar minha transmissão" : "Transmitir também"}
          active={isSharing}
          disabled={!connected}
          onClick={onToggleShare}
        >
          <ScreenShareIcon active={isSharing} />
        </ControlButton>

        <ControlButton
          label={cameraLabel}
          active={cameraOn}
          disabled={!cameraReady}
          onClick={onToggleCamera}
        >
          {cameraOn ? (
            <Video aria-hidden="true" strokeWidth={2.2} />
          ) : (
            <VideoOff aria-hidden="true" strokeWidth={2.2} />
          )}
        </ControlButton>

        <ControlButton label="Parar de assistir" onClick={onStopWatching}>
          <StopWatchingIcon />
        </ControlButton>

        <ControlButton label="Sair da sala" danger onClick={onLeaveRoom}>
          <PhoneOff aria-hidden="true" strokeWidth={2.2} />
        </ControlButton>
      </div>

      <div className="watch-edge-controls watch-viewport-controls">
        <ControlButton
          label={fullscreen ? "Restaurar janela" : "Tela cheia"}
          onClick={onToggleFullscreen}
        >
          <FullscreenIcon restore={fullscreen} />
        </ControlButton>
      </div>
    </footer>
  );
}

function ControlButton({
  label,
  children,
  active,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const classes = ["watch-control-button", active ? "active" : "", danger ? "danger" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ScreenShareIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      {active ? (
        <path d="M8 10h8M8 13h8M8 21h8M12 17v4" />
      ) : (
        <path d="M8 21h8M12 17v4M9 11l3-3 3 3M12 8v6" />
      )}
    </svg>
  );
}

function StopWatchingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

function FullscreenIcon({ restore }: { restore: boolean }) {
  return restore ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}
