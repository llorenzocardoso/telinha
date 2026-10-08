export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface TurnProviderOptions {
  keyId?: string;
  apiToken?: string;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Lido a cada chamada: desligado, nem toca na Cloudflare. */
  isEnabled?: () => boolean;
}

export const PUBLIC_STUN_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const CLOUDFLARE_ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_TTL_SECONDS = 3_600;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4_000;

export function createIceServerProvider(options: TurnProviderOptions = {}) {
  let cached: { servers: IceServer[]; refreshAt: number } | null = null;

  async function getIceServers(): Promise<IceServer[]> {
    if (options.isEnabled && !options.isEnabled()) return PUBLIC_STUN_SERVERS;
    const keyId = options.keyId?.trim();
    const apiToken = options.apiToken?.trim();
    if (!keyId || !apiToken) return PUBLIC_STUN_SERVERS;

    const now = options.now?.() ?? Date.now();
    if (cached && now < cached.refreshAt) return cached.servers;

    const ttl = normalizeTtl(options.ttlSeconds);
    try {
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(
        `${CLOUDFLARE_ENDPOINT}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        throw new Error(`Cloudflare TURN respondeu HTTP ${response.status}.`);
      }
      const parsed = parseIceServers(await response.json());
      if (parsed.length === 0) {
        throw new Error("Cloudflare TURN não devolveu servidores ICE.");
      }
      const servers = mergeStun(parsed);
      const lifetimeMs = ttl * 1000;
      cached = {
        servers,
        refreshAt: now + Math.max(lifetimeMs / 2, lifetimeMs - REFRESH_MARGIN_MS),
      };
      return servers;
    } catch (error) {
      console.error("Falha ao gerar credenciais TURN. Seguindo só com STUN.", error);
      return cached?.servers ?? PUBLIC_STUN_SERVERS;
    }
  }

  return { getIceServers };
}

export function parseIceServers(value: unknown): IceServer[] {
  const list = isRecord(value) && Array.isArray(value.iceServers) ? value.iceServers : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap(parseIceServer);
}

function parseIceServer(value: unknown): IceServer[] {
  if (!isRecord(value)) return [];
  const urls = normalizeUrls(value.urls);
  if (urls.length === 0) return [];
  const server: IceServer = { urls: urls.length === 1 ? urls[0]! : urls };
  if (typeof value.username === "string" && value.username) server.username = value.username;
  if (typeof value.credential === "string" && value.credential) server.credential = value.credential;
  return [server];
}

function normalizeUrls(value: unknown): string[] {
  const urls = Array.isArray(value) ? value : [value];
  return urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function mergeStun(servers: IceServer[]): IceServer[] {
  const seen = new Set(servers.flatMap(serverUrls));
  const missing = PUBLIC_STUN_SERVERS.filter((server) =>
    serverUrls(server).some((url) => !seen.has(url)),
  );
  return [...missing, ...servers];
}

function serverUrls(server: IceServer): string[] {
  return Array.isArray(server.urls) ? server.urls : [server.urls];
}

function normalizeTtl(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TTL_SECONDS;
  return Math.min(86_400, Math.max(60, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
