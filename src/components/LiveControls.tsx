import { Columns2, Maximize2, Minimize2, PhoneOff, ScreenShare, ScreenShareOff, Video, VideoOff, X } from "lucide-react";
import { Avatar, Dock, IconButton } from "./ui";
import { VolumeControl } from "./VolumeControl";

export interface StreamVolume {
  id: string;
  /** Só vem preenchido quando há mais de uma transmissão na tela. */
  name?: string;
  volume: number;
  onChange: (volume: number) => void;
}

export interface WatchChoice {
  id: string;
  name: string;
  /** Esta transmissão está na tela agora. */
  active: boolean;
}

interface LiveControlsProps {
  volumes: StreamVolume[];
  /** Transmissões disponíveis, para trocar por avatar lado a lado. */
  choices: WatchChoice[];
  fullscreen: boolean;
  connected: boolean;
  isSharing: boolean;
  cameraOn: boolean;
  cameraReady: boolean;
  cameraLabel: string;
  /** Faz sentido só com duas ou mais transmissões. */
  sideBySide: boolean;
  onWatchOnly: (id: string) => void;
  onWatchAll: () => void;
  onToggleFullscreen: () => void;
  onToggleShare: () => void;
  onToggleCamera: () => void;
  onStopWatching: () => void;
  onLeaveRoom: () => void;
  onLockChange: (locked: boolean) => void;
}

/** A dock flutuante única da tela Assistindo (seção 2.6). */
export function LiveControls({
  volumes,
  choices,
  fullscreen,
  connected,
  isSharing,
  cameraOn,
  cameraReady,
  cameraLabel,
  sideBySide,
  onWatchOnly,
  onWatchAll,
  onToggleFullscreen,
  onToggleShare,
  onToggleCamera,
  onStopWatching,
  onLeaveRoom,
  onLockChange,
}: LiveControlsProps) {
  return (
    <Dock label="Controles da transmissão" variant="floating" onHoldChange={onLockChange}>
      {choices.length > 1 && (
        <div className="watch-switcher" role="group" aria-label="Escolher transmissão">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`watch-switcher-item ${choice.active ? "is-active" : ""}`}
              aria-label={`Assistir ${choice.name}`}
              aria-pressed={choice.active}
              onClick={() => onWatchOnly(choice.id)}
            >
              <Avatar name={choice.name} size="sm" live />
            </button>
          ))}
          <IconButton
            label="Ver lado a lado"
            icon={<Columns2 aria-hidden="true" strokeWidth={1.8} />}
            active={sideBySide}
            onClick={onWatchAll}
          />
        </div>
      )}

      <div className="watch-volumes">
        {volumes.map((item) => (
          <VolumeControl
            key={item.id}
            volume={item.volume}
            label={item.name ? `Volume de ${item.name}` : undefined}
            onChange={item.onChange}
            onInteract={() => onLockChange(true)}
          />
        ))}
      </div>

      <IconButton
        label={fullscreen ? "Restaurar janela" : "Tela cheia"}
        icon={
          fullscreen ? (
            <Minimize2 aria-hidden="true" strokeWidth={1.8} />
          ) : (
            <Maximize2 aria-hidden="true" strokeWidth={1.8} />
          )
        }
        onClick={onToggleFullscreen}
      />

      <IconButton
        label={isSharing ? "Parar minha transmissão" : "Transmitir também"}
        icon={
          isSharing ? (
            <ScreenShareOff aria-hidden="true" strokeWidth={1.8} />
          ) : (
            <ScreenShare aria-hidden="true" strokeWidth={1.8} />
          )
        }
        active={isSharing}
        disabled={!connected}
        onClick={onToggleShare}
      />

      <IconButton
        label={cameraLabel}
        icon={
          cameraOn ? (
            <Video aria-hidden="true" strokeWidth={1.8} />
          ) : (
            <VideoOff aria-hidden="true" strokeWidth={1.8} />
          )
        }
        active={cameraOn}
        disabled={!cameraReady}
        onClick={onToggleCamera}
      />

      {/* Fora do mockup, mas sem isto a função se perde; o Esc continua valendo. */}
      <IconButton
        label="Parar de assistir"
        icon={<X aria-hidden="true" strokeWidth={1.8} />}
        onClick={onStopWatching}
      />

      <IconButton
        label="Sair da sala"
        icon={<PhoneOff aria-hidden="true" strokeWidth={1.8} />}
        variant="danger"
        onClick={onLeaveRoom}
      />
    </Dock>
  );
}
