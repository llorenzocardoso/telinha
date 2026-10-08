/** Inicial da pessoa; o avatar é um círculo tonal, sem foto. */
export function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

export type AvatarTone = "default" | "bright" | "dim";

interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  /** "bright" é a pessoa local (círculo claro); "dim" é quem está reconectando. */
  tone?: AvatarTone;
  /** Ponto vermelho no canto: esta pessoa está transmitindo. */
  live?: boolean;
}

export function Avatar({ name, size = "md", tone = "default", live }: AvatarProps) {
  return (
    <span
      className={`ui-avatar is-${size} is-${tone}`}
      aria-hidden="true"
      data-live={live ? "" : undefined}
    >
      {initialOf(name)}
      {live && <span className="ui-avatar-live" />}
    </span>
  );
}

export interface StackPerson {
  id: string;
  name: string;
  tone?: AvatarTone;
}

interface AvatarStackProps {
  people: StackPerson[];
  /** Acima disso, o excedente vira "+N". */
  max?: number;
}

/** Quem está na sala, em avatares sobrepostos, no canto do cabeçalho. */
export function AvatarStack({ people, max = 4 }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="ui-avatar-stack" role="img" aria-label={labelFor(people.map((p) => p.name))}>
      {shown.map((person) => (
        <Avatar key={person.id} name={person.name} size="md" tone={person.tone} />
      ))}
      {rest > 0 && <span className="ui-avatar is-md is-rest">+{rest}</span>}
    </span>
  );
}

function labelFor(names: string[]): string {
  if (names.length === 0) return "Ninguém na sala";
  if (names.length === 1) return `Na sala: ${names[0]}`;
  return `Na sala: ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}
