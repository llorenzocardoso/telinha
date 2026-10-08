/** Inicial da pessoa; o avatar é um círculo tonal, sem foto. */
export function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  /** Ponto vermelho no canto: esta pessoa está transmitindo. */
  live?: boolean;
}

export function Avatar({ name, size = "md", live }: AvatarProps) {
  return (
    <span className={`ui-avatar is-${size}`} aria-hidden="true" data-live={live ? "" : undefined}>
      {initialOf(name)}
      {live && <span className="ui-avatar-live" />}
    </span>
  );
}

interface AvatarStackProps {
  names: string[];
  /** Acima disso, o excedente vira "+N". */
  max?: number;
}

export function AvatarStack({ names, max = 4 }: AvatarStackProps) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="ui-avatar-stack" role="img" aria-label={labelFor(names)}>
      {shown.map((name, index) => (
        <Avatar key={`${name}-${index}`} name={name} size="sm" />
      ))}
      {rest > 0 && <span className="ui-avatar is-sm is-rest">+{rest}</span>}
    </span>
  );
}

function labelFor(names: string[]): string {
  if (names.length === 0) return "Ninguém na sala";
  if (names.length === 1) return `Na sala: ${names[0]}`;
  return `Na sala: ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}
