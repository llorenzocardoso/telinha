import type { ReactNode } from "react";
import { Avatar } from "./Avatar";

export interface ParticipantRow {
  id: string;
  name: string;
  /** Estado curto: "Você", "Na sala", "Assistindo", "Reconectando...". */
  status: string;
  /** Ponto vermelho no avatar: esta pessoa transmite. */
  live?: boolean;
  /** Ação à direita da linha, como "Assistir". */
  action?: ReactNode;
}

interface ParticipantListProps {
  people: ParticipantRow[];
  emptyHint?: string;
}

export function ParticipantList({ people, emptyHint }: ParticipantListProps) {
  return (
    <section className="ui-participants" aria-label={`Na sala · ${people.length}`}>
      <header className="ui-participants-header">
        <span>Na sala</span>
        <span aria-hidden="true">·</span>
        <strong>{people.length}</strong>
      </header>
      {people.length === 0 && emptyHint && <p className="ui-participants-empty">{emptyHint}</p>}
      <ul>
        {people.map((person) => (
          <li key={person.id} data-testid="participant">
            <Avatar name={person.name} live={person.live} />
            <span className="ui-participant-copy">
              <strong>{person.name}</strong>
              <small>{person.status}</small>
            </span>
            {person.action}
          </li>
        ))}
      </ul>
    </section>
  );
}
