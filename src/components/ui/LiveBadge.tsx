/** Duração no ar, em m:ss ou h:mm:ss. */
export function formatAirTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

interface LiveBadgeProps {
  /** Milissegundos no ar; sem isso o selo só diz "Ao vivo". */
  airTimeMs?: number;
}

export function LiveBadge({ airTimeMs }: LiveBadgeProps) {
  return (
    <span className="ui-live-badge">
      <span className="ui-live-dot" aria-hidden="true" />
      Ao vivo
      {airTimeMs !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <time className="ui-live-time">{formatAirTime(airTimeMs)}</time>
        </>
      )}
    </span>
  );
}
