import { Signal, SignalHigh, SignalLow, SignalZero } from "lucide-react";
import type { ConnectionQuality } from "../../room/connectionQuality";

const LABELS: Record<ConnectionQuality, string> = {
  good: "Conectado",
  unstable: "Conexão instável",
  reconnecting: "Reconectando...",
  offline: "Sem conexão",
};

const ICONS = {
  good: Signal,
  unstable: SignalHigh,
  reconnecting: SignalLow,
  offline: SignalZero,
} as const;

interface ConnectionIndicatorProps {
  quality: ConnectionQuality;
  /** Fora da sala ao vivo, o indicador bom pode ficar visível. */
  alwaysVisible?: boolean;
}

/** Na tela Assistindo o indicador só aparece quando a conexão não está boa. */
export function ConnectionIndicator({ quality, alwaysVisible }: ConnectionIndicatorProps) {
  if (quality === "good" && !alwaysVisible) return null;
  const Icon = ICONS[quality];
  return (
    <span className={`ui-connection is-${quality}`} role="status">
      <Icon aria-hidden="true" strokeWidth={1.8} />
      {LABELS[quality]}
    </span>
  );
}
