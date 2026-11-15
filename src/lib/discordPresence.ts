import { useSyncExternalStore } from "react";
import { inviteLink } from "./trayLive";

/**
 * O que aparece no perfil do Discord enquanto se está numa sala:
 * - `link`: status + botão que abre o convite da sala (padrão);
 * - `plain`: só o status, sem código nem link;
 * - `off`: nada.
 */
export type DiscordStatusMode = "link" | "plain" | "off";

export const DISCORD_STATUS_KEY = "telinha-discord-status";

const MODES: readonly DiscordStatusMode[] = ["link", "plain", "off"];
const listeners = new Set<() => void>();

export function readDiscordStatusMode(): DiscordStatusMode {
  try {
    const stored = localStorage.getItem(DISCORD_STATUS_KEY);
    return MODES.find((mode) => mode === stored) ?? "link";
  } catch {
    return "link";
  }
}

export function writeDiscordStatusMode(mode: DiscordStatusMode): void {
  try {
    localStorage.setItem(DISCORD_STATUS_KEY, mode);
  } catch {
    // Sem armazenamento a escolha vale só até fechar o app.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDiscordStatusMode(): DiscordStatusMode {
  return useSyncExternalStore(subscribe, readDiscordStatusMode, () => "link" as const);
}

/** O mesmo formato que o comando `set_discord_presence` do Rust espera. */
export interface DiscordPresencePayload {
  details: string;
  buttonLabel?: string;
  buttonUrl?: string;
  startedAt?: number;
}

interface PresenceInput {
  mode: DiscordStatusMode;
  code: string;
  /** Transmitindo a tela agora. */
  live: boolean;
  /** Desde quando (ms): início da live, ou entrada na sala. */
  since: number | null;
  baseUrl?: string;
}

export function buildDiscordPresence({
  mode,
  code,
  live,
  since,
  baseUrl,
}: PresenceInput): DiscordPresencePayload | null {
  if (mode === "off") return null;
  const payload: DiscordPresencePayload = {
    details: live ? "Ao vivo no Telinha" : "Numa sala do Telinha",
  };
  if (since !== null && since > 0) payload.startedAt = Math.floor(since / 1000);
  if (mode === "link") {
    const url = inviteLink(code, baseUrl);
    // O Discord só aceita botão com https; em desenvolvimento (localhost) o status vai sem ele.
    if (url.startsWith("https://")) {
      payload.buttonLabel = live ? "Assistir no Telinha" : "Entrar na sala";
      payload.buttonUrl = url;
    }
  }
  return payload;
}
