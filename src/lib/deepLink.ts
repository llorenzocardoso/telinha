import { isValidRoomCode, normalizeRoomCode, parseTelinhaUrl } from "./api";

export type DeepLinkAction =
  | { action: "join"; code: string; name?: string }
  | { action: "open" }
  | { action: "share" };

/**
 * Convite aberto na versão web: `/j/CODE` (o mesmo caminho do link do servidor), `/join/CODE`
 * ou `?sala=CODE`. O nome vem de `?name=`, como no `telinha://join`.
 */
export function joinFromLocation(href: string): DeepLinkAction | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const fromPath = /^\/(?:j|join)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const raw = fromPath ? decodeURIComponent(fromPath) : url.searchParams.get("sala");
  if (!raw) return null;
  const code = normalizeRoomCode(raw);
  if (!isValidRoomCode(code)) return null;
  const name = url.searchParams.get("name")?.trim() || undefined;
  return { action: "join", code, name };
}

export function actionFromUrls(urls: string[]): DeepLinkAction | null {
  for (const raw of urls) {
    const parsed = parseTelinhaUrl(raw);
    if (parsed) {
      return parsed.action === "join" && parsed.code
        ? { action: "join", code: parsed.code, name: parsed.name }
        : { action: parsed.action === "share" ? "share" : "open" };
    }
  }
  return null;
}
