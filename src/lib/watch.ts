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

export const WATCH_RESEND_MS = 10_000;
export const WATCH_FAIL_MS = 20_000;

export function nextWatchAction(
  elapsedMs: number,
  resent: boolean,
  hasStream: boolean,
): "idle" | "wait" | "resend" | "fail" {
  if (hasStream) return "idle";
  if (!resent) return elapsedMs >= WATCH_RESEND_MS ? "resend" : "wait";
  return elapsedMs >= WATCH_FAIL_MS ? "fail" : "wait";
}

export function mosaicColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}
