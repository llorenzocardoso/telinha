import { Settings } from "lucide-react";
import type { CameraFeedInfo } from "../hooks/useTelinhaRoom";
import { VideoTile } from "./VideoTile";

interface CameraGridProps {
  cameras: CameraFeedInfo[];
  /** A câmera em foco, ou null para a grade igual para todo mundo. */
  focusedId: string | null;
  /** Clicar numa câmera a põe em foco; clicar na que já está em foco volta para a grade. */
  onFocus: (id: string) => void;
  onOpenSettings?: () => void;
}

/** Colunas da grade: 1 câmera ocupa tudo, 2 ficam lado a lado, e cresce com a quantidade. */
export function columnsFor(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

/**
 * Sala sem transmissão: as câmeras ocupam o palco inteiro, como numa chamada do Discord.
 * Com uma câmera em foco, ela fica grande e as outras viram miniaturas embaixo.
 */
export function CameraGrid({ cameras, focusedId, onFocus, onOpenSettings }: CameraGridProps) {
  if (cameras.length === 0) return null;

  const focused = cameras.find((camera) => camera.participantIdentity === focusedId) ?? null;

  if (focused) {
    const others = cameras.filter((camera) => camera !== focused);
    return (
      <section className="camera-grid has-focus" aria-label="Câmeras">
        <div className="camera-grid-main">
          <CameraCell camera={focused} focused onFocus={onFocus} onOpenSettings={onOpenSettings} />
        </div>
        {others.length > 0 && (
          <div className="camera-grid-rail">
            {others.map((camera) => (
              <CameraCell
                key={camera.participantIdentity}
                camera={camera}
                onFocus={onFocus}
                onOpenSettings={onOpenSettings}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="camera-grid"
      data-count={cameras.length}
      style={{ gridTemplateColumns: `repeat(${columnsFor(cameras.length)}, minmax(0, 1fr))` }}
      aria-label="Câmeras"
    >
      {cameras.map((camera) => (
        <CameraCell
          key={camera.participantIdentity}
          camera={camera}
          onFocus={onFocus}
          onOpenSettings={onOpenSettings}
        />
      ))}
    </section>
  );
}

function CameraCell({
  camera,
  focused = false,
  onFocus,
  onOpenSettings,
}: {
  camera: CameraFeedInfo;
  focused?: boolean;
  onFocus: (id: string) => void;
  onOpenSettings?: () => void;
}) {
  const name = camera.isLocal ? "Você" : camera.participantName;

  // O botão de foco cobre a câmera inteira e é irmão do botão de configurações: um botão
  // dentro de outro seria interativo aninhado, que leitores de tela tratam mal.
  return (
    <div
      className={`camera-cell ${camera.isLocal ? "local" : ""} ${focused ? "is-focused" : ""}`}
    >
      <VideoTile stream={camera.stream} />
      <button
        type="button"
        className="camera-cell-focus"
        aria-pressed={focused}
        aria-label={focused ? `Voltar para a grade (${name})` : `Focar na câmera de ${name}`}
        onClick={() => onFocus(camera.participantIdentity)}
      />
      <span className="camera-tile-name">{name}</span>
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
