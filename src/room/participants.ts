import type { RoomPerson } from "./types";

export interface ParticipantState {
  id: string;
  name: string;
  /** Estado curto mostrado sob o nome. */
  status: string;
  /** Ponto vermelho no avatar: esta pessoa transmite. */
  live: boolean;
  /** Dá para assistir esta pessoa agora. */
  watchable: boolean;
  /** Já estou assistindo esta pessoa. */
  watching: boolean;
}

interface DescribeInput {
  people: Iterable<RoomPerson>;
  localId: string;
  /** Quem eu estou assistindo. */
  watching: Iterable<string>;
  /** Quem está assistindo a minha tela. */
  watchers: Iterable<string>;
}

/**
 * Texto curto de cada pessoa, como nas seções 2.3 e 2.5: Você, Na sala, Assistindo,
 * Reconectando... A pessoa local vem primeiro; o resto mantém a ordem da sala.
 */
export function describeParticipants(input: DescribeInput): ParticipantState[] {
  const watching = new Set(input.watching);
  const watchers = new Set(input.watchers);
  let local: ParticipantState | null = null;
  const others: ParticipantState[] = [];

  for (const person of input.people) {
    const isLocal = person.identity === input.localId;
    const state: ParticipantState = {
      id: person.identity,
      name: person.name,
      status: statusOf(person, isLocal, watchers.has(person.identity)),
      live: person.isSharing,
      // Só dá para assistir quem transmite, está conectado e não sou eu.
      watchable: !isLocal && person.isSharing && person.connected,
      watching: watching.has(person.identity),
    };
    if (isLocal) local = state;
    else others.push(state);
  }

  return local ? [local, ...others] : others;
}

function statusOf(person: RoomPerson, isLocal: boolean, watchingMe: boolean): string {
  if (isLocal) {
    return person.isSharing ? "Você · ao vivo" : "Você";
  }
  // A reconexão é o que mais importa saber, então vem antes de qualquer outro estado.
  if (!person.connected) return "Reconectando...";
  if (person.isSharing) return "Ao vivo";
  if (watchingMe) return "Assistindo";
  if (person.hasCamera) return "Na sala · câmera";
  return "Na sala";
}
