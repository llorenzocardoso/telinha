export function addWatching(current: string[], id: string): string[] {
  if (current.includes(id)) return current;
  return [...current, id];
}

export function removeWatching(current: string[], id: string): string[] {
  return current.filter((item) => item !== id);
}

export function pruneWatching(current: string[], available: string[]): string[] {
  const live = new Set(available);
  return current.filter((id) => live.has(id));
}

export function mosaicColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

const MAX_REMEMBERED_VOLUMES = 50;

function clampVolume(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

export function parseWatchVolumes(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const volumes: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) volumes[key] = clampVolume(value);
    }
    return volumes;
  } catch {
    return {};
  }
}

export function setWatchVolume(
  volumes: Record<string, number>,
  key: string,
  volume: number,
): Record<string, number> {
  const next = { ...volumes };
  delete next[key];
  next[key] = clampVolume(volume);
  const keys = Object.keys(next);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_VOLUMES))) {
    delete next[stale];
  }
  return next;
}
