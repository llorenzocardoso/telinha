import type { ReactNode } from "react";
import { Avatar, type AvatarTone } from "./Avatar";

export interface ParticipantRow {
  id: string;
  name: string;
  /** Estado curto: "Você", "Na sala", "Assistindo", "Reconectando...". */
  status: string;
  tone?: AvatarTone;
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
      <header className="ui-participants-header">Na sala · {people.length}</header>
      {people.length === 0 && emptyHint && <p className="ui-participants-empty">{emptyHint}</p>}
      <ul>
        {people.map((person) => (
          <li
            key={person.id}
            data-testid="participant"
            className={person.tone === "dim" ? "is-dim" : undefined}
          >
            <Avatar name={person.name} tone={person.tone} live={person.live} />
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
