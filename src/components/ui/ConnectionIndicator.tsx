import type { ConnectionQuality } from "../../room/connectionQuality";

const LABELS: Record<ConnectionQuality, string> = {
  good: "Conectado",
  unstable: "Conexão instável",
  reconnecting: "Reconectando...",
  offline: "Sem conexão",
};

interface ConnectionIndicatorProps {
  quality: ConnectionQuality;
  /** Fora da sala ao vivo, o indicador bom pode ficar visível. */
  alwaysVisible?: boolean;
}

/** Na tela Assistindo o indicador só aparece quando a conexão não está boa. */
export function ConnectionIndicator({ quality, alwaysVisible }: ConnectionIndicatorProps) {
  if (quality === "good" && !alwaysVisible) return null;
  return (
    <span className={`ui-connection is-${quality}`} role="status">
      <span className="ui-connection-dot" aria-hidden="true" />
      {LABELS[quality]}
    </span>
  );
}
