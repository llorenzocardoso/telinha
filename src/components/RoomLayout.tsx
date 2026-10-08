import type { ReactNode } from "react";
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
        <AvatarStack
          people={people.map((person) => ({
            id: person.id,
            name: person.name,
            tone: toneOf(person),
          }))}
        />
      </header>

      <div className="room-body">
        <main className="room-stage">{stage}</main>
        <aside className="room-people">
          <ParticipantList people={rows} emptyHint="Conectando pessoas..." />
        </aside>
      </div>

      {dock}
      {children}
    </div>
  );
}
