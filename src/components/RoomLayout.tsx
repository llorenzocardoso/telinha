import { useId, useState, type ReactNode } from "react";
import { Monitor } from "lucide-react";
import type { ConnectionQuality } from "../room/connectionQuality";
import type { ParticipantState } from "../room/participants";
import {
  AvatarStack,
  Button,
  ConnectionIndicator,
  LiveBadge,
  ParticipantList,
  RoomCode,
  type ParticipantRow,
} from "./ui";

interface RoomLayoutProps {
  code: string;
  onCopyCode: () => Promise<boolean> | boolean;
  connectionQuality: ConnectionQuality;
  /** Definido quando a própria tela está no ar; vira o selo "Ao vivo · tempo". */
  airTimeMs?: number;
  people: ParticipantState[];
  /** O palco: estado vazio na sala esperando, prévia na sala ao vivo. */
  stage: ReactNode;
  /** A dock, sempre no mesmo lugar nas duas telas. */
  dock: ReactNode;
  onWatch: (id: string) => void;
  /** Camadas soltas: avisos, diálogos, câmeras flutuantes. */
  children?: ReactNode;
}

const PEOPLE_PANEL_KEY = "telinha-people-panel";

function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PEOPLE_PANEL_KEY) === "1";
  } catch {
    return false;
  }
}

const toneOf = (person: ParticipantState) =>
  person.self ? "bright" : person.connected ? "default" : "dim";

/**
 * Um layout para as duas telas da sala (seções 2.3 e 2.5). Só o palco muda; cabeçalho,
 * lista de pessoas e dock ficam idênticos, para nada pular de lugar quando a live começa.
 */
export function RoomLayout({
  code,
  onCopyCode,
  connectionQuality,
  airTimeMs,
  people,
  stage,
  dock,
  onWatch,
  children,
}: RoomLayoutProps) {
  // Aberta: a lista fica na lateral como antes. Fechada: só os avatares, com a lista ao passar o mouse.
  const [panelOpen, setPanelOpen] = useState(readPanelOpen);
  const cardId = useId();
  // Esc fecha o cartão aberto pelo hover/foco; ele volta quando o mouse ou o foco reentram.
  const [dismissed, setDismissed] = useState(false);
  function togglePanel() {
    const next = !panelOpen;
    setPanelOpen(next);
    try {
      localStorage.setItem(PEOPLE_PANEL_KEY, next ? "1" : "0");
    } catch {
      // Sem armazenamento, a escolha só vale até fechar o app.
    }
  }

  const rows: ParticipantRow[] = people.map((person) => ({
    id: person.id,
    name: person.name,
    status: person.status,
    tone: toneOf(person),
    live: person.live,
    action: person.watchable ? (
      <Button
        size="sm"
        variant={person.watching ? "ghost" : "tonal"}
        onClick={() => onWatch(person.id)}
      >
        {person.watching ? "Assistindo" : "Assistir"}
      </Button>
    ) : undefined,
  }));

  return (
    <div className="screen room">
      <header className="room-head">
        <div className="room-head-left">
          <span className="room-logo" role="img" aria-label="Telinha">
            <Monitor aria-hidden="true" strokeWidth={1.8} />
          </span>
          <RoomCode code={code} onCopy={onCopyCode} />
          {airTimeMs === undefined ? (
            <ConnectionIndicator quality={connectionQuality} alwaysVisible />
          ) : (
            <>
              <LiveBadge airTimeMs={airTimeMs} />
              <ConnectionIndicator quality={connectionQuality} />
            </>
          )}
        </div>
        <div
          className="room-people-pop"
          onPointerEnter={() => setDismissed(false)}
          onFocus={() => setDismissed(false)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || panelOpen || dismissed) return;
            setDismissed(true);
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
        >
          {/* Os avatares são o controle: passar o mouse mostra a lista, clicar fixa na lateral. */}
          <button
            type="button"
            className={`room-people-toggle ${panelOpen ? "is-active" : ""}`}
            aria-pressed={panelOpen}
            aria-controls={panelOpen ? undefined : cardId}
            aria-label={panelOpen ? "Soltar a lista de pessoas da lateral" : "Fixar a lista de pessoas na lateral"}
            onClick={togglePanel}
          >
            <AvatarStack
              people={people.map((person) => ({
                id: person.id,
                name: person.name,
                tone: toneOf(person),
              }))}
            />
          </button>
          {!panelOpen && (
            <div id={cardId} className={`room-people-card ${dismissed ? "is-dismissed" : ""}`}>
              <ParticipantList people={rows} emptyHint="Conectando pessoas..." />
              <p className="room-people-hint">Clique nos avatares para fixar na lateral</p>
            </div>
          )}
        </div>
      </header>

      <div className={`room-body ${panelOpen ? "has-people" : ""}`}>
        <main className="room-stage">{stage}</main>
        {panelOpen && (
          <aside className="room-people">
            <ParticipantList people={rows} emptyHint="Conectando pessoas..." />
          </aside>
        )}
      </div>

      {dock}
      {children}
    </div>
  );
}
