import {
  APP_VERSION,
  PROTOCOL_VERSION,
  type ClientAuthentication,
} from "./protocol";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface SessionIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RoomSession {
  code: string;
  participantId: string;
  token: string;
  displayName: string;
  wsUrl: string;
  protocolVersion: number;
  wsAuthMode?: "message" | "query";
  iceServers?: SessionIceServer[];
  features?: string[];
}

export interface AppConfig {
  minAppVersion: string;
  minProtocolVersion: number;
}

export class RoomNotFoundError extends Error {
  constructor(message = "Sala não encontrada.") {
    super(message);
    this.name = "RoomNotFoundError";
  }
}

export class UpdateRequiredError extends Error {
  constructor(message = "Esta versão do Telinha precisa ser atualizada.") {
    super(message);
    this.name = "UpdateRequiredError";
  }
}

export const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_CHARACTERS}]{${ROOM_CODE_LENGTH}}$`);

export function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .split("")
    .filter((character) => ROOM_CODE_CHARACTERS.includes(character))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export function signalingUrl(session: RoomSession): string {
  const url = new URL(session.wsUrl);
  url.searchParams.set("protocolVersion", String(PROTOCOL_VERSION));
  url.searchParams.set("appVersion", APP_VERSION);
  if (session.wsAuthMode !== "message") {
    url.searchParams.set("code", session.code);
    url.searchParams.set("participantId", session.participantId);
    url.searchParams.set("token", session.token);
  }
  return url.toString();
}

export function signalingAuthentication(session: RoomSession): ClientAuthentication {
  return {
    type: "authenticate",
    code: session.code,
    participantId: session.participantId,
    token: session.token,
    protocolVersion: PROTOCOL_VERSION,
    appVersion: APP_VERSION,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { error: text.slice(0, 120) };
  }
}

function parseRoomSession(data: Record<string, unknown>): RoomSession {
  const { code, participantId, token, displayName, wsUrl, protocolVersion, wsAuthMode } = data;
  if (
    typeof code !== "string" ||
    typeof participantId !== "string" ||
    typeof token !== "string" ||
    typeof displayName !== "string" ||
    typeof wsUrl !== "string" ||
    !code ||
    !participantId ||
    !token ||
    !wsUrl
  ) {
    throw new Error("Resposta inválida do servidor");
  }
  return {
    code,
    participantId,
    token,
    displayName,
    wsUrl,
    protocolVersion: typeof protocolVersion === "number" ? protocolVersion : 1,
    wsAuthMode: wsAuthMode === "message" ? "message" : "query",
    iceServers: parseIceServers(data.iceServers),
    features: Array.isArray(data.features)
      ? data.features.filter((feature): feature is string => typeof feature === "string")
      : undefined,
  };
}

export function sessionSupports(session: RoomSession, feature: string): boolean {
  return session.features?.includes(feature) ?? false;
}

function parseIceServers(value: unknown): SessionIceServer[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const servers = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const urls = Array.isArray(record.urls)
      ? record.urls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : typeof record.urls === "string" && record.urls
        ? [record.urls]
        : [];
    if (urls.length === 0) return [];
    const server: SessionIceServer = { urls: urls.length === 1 ? urls[0]! : urls };
    if (typeof record.username === "string" && record.username) server.username = record.username;
    if (typeof record.credential === "string" && record.credential) server.credential = record.credential;
    return [server];
  });
  return servers.length > 0 ? servers : undefined;
}

async function roomRequest(path: string, body: Record<string, unknown>): Promise<RoomSession> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (response.status === 404) {
    throw new RoomNotFoundError(typeof data.error === "string" ? data.error : undefined);
  }
  if (response.status === 426 || data.code === "UPDATE_REQUIRED") {
    throw new UpdateRequiredError(typeof data.error === "string" ? data.error : undefined);
  }
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Falha ao falar com o servidor");
  }
  return parseRoomSession(data);
}

export async function createRoom(displayName: string): Promise<RoomSession> {
  const body: Record<string, unknown> = {
    displayName,
    protocolVersion: PROTOCOL_VERSION,
    appVersion: APP_VERSION,
  };
  return roomRequest("/rooms", body);
}

export async function joinRoom(code: string, displayName: string): Promise<RoomSession> {
  return roomRequest(`/rooms/${encodeURIComponent(code)}/join`, {
    displayName,
    protocolVersion: PROTOCOL_VERSION,
    appVersion: APP_VERSION,
  });
}

export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    const response = await fetch(`${API_URL}/app-config`, { method: "GET", cache: "no-store" });
    if (!response.ok) return null;
    const data = await readJson(response);
    if (typeof data.minAppVersion !== "string" || !data.minAppVersion) return null;
    return {
      minAppVersion: data.minAppVersion,
      minProtocolVersion:
        typeof data.minProtocolVersion === "number" ? data.minProtocolVersion : PROTOCOL_VERSION,
    };
  } catch {
    return null;
  }
}

export async function fetchIceServers(session: RoomSession): Promise<SessionIceServer[]> {
  const response = await fetch(
    `${API_URL}/rooms/${encodeURIComponent(session.code)}/ice-servers?participantId=${encodeURIComponent(session.participantId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${session.token}` },
      cache: "no-store",
    },
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Não foi possível renovar o TURN.");
  }
  return parseIceServers(data.iceServers) ?? [];
}

export async function pingHealth(): Promise<void> {
  await fetch(`${API_URL}/health`, { method: "GET", cache: "no-store" });
}

export async function leaveRoomSession(
  session: RoomSession,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);
  try {
    const response = await fetch(
      `${API_URL}/rooms/${encodeURIComponent(session.code)}/participants/${encodeURIComponent(session.participantId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
        cache: "no-store",
        keepalive: true,
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const data = await readJson(response);
      throw new Error(typeof data.error === "string" ? data.error : "Não foi possível sair da sala.");
    }
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function enterRoom(code: string, displayName: string): Promise<RoomSession> {
  return joinRoom(code, displayName);
}

export function parseTelinhaUrl(raw: string): { action: "join" | "open" | "share"; code?: string; name?: string } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "telinha:") {
      return null;
    }
    const host = url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0] || "";
    const rest = url.pathname.replace(/^\/+/, "");
    if (host === "join" || rest.startsWith("join")) {
      const fromPath = host === "join" ? rest : rest.replace(/^join\/?/, "");
      const code = normalizeRoomCode(url.searchParams.get("code") ?? fromPath);
      const name = url.searchParams.get("name")?.trim() || undefined;
      return isValidRoomCode(code) ? { action: "join", code, name } : { action: "open" };
    }
    if (host === "share" || rest.startsWith("share")) {
      return { action: "share" };
    }
    return { action: "open" };
  } catch {
    return null;
  }
}
