/**
 * Flags que o operador muda sem mexer em código.
 *
 * A única fonte hoje é o ambiente, mas a leitura acontece a cada requisição: se um dia for
 * preciso mudar sem reiniciar (endpoint admin, JSON remoto), basta trocar a função `source`.
 */
export interface RuntimeFlags {
  /** Desligado, o servidor entrega só STUN e não chama a Cloudflare. */
  turnEnabled: boolean;
  /** Teto de vídeo em kbps quando a rota ICE é relay. `null` significa sem limite. */
  turnMaxBitrateKbps: number | null;
}

export interface RuntimeConfig {
  read(): RuntimeFlags;
}

const OFF = new Set(["0", "false", "off", "no"]);

/** Ligado por padrão; só os valores desligados explicitamente contam. */
export function parseTurnEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const value = raw.trim().toLowerCase();
  if (value === "") return true;
  return !OFF.has(value);
}

/** Inteiro positivo; vazio, zero, negativo ou lixo significam sem limite. */
export function parseTurnMaxBitrateKbps(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === "" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export type FlagSource = () => {
  TURN_ENABLED?: string;
  TURN_MAX_BITRATE_KBPS?: string;
};

export function createRuntimeConfig(source: FlagSource): RuntimeConfig {
  return {
    read() {
      const raw = source();
      return {
        turnEnabled: parseTurnEnabled(raw.TURN_ENABLED),
        turnMaxBitrateKbps: parseTurnMaxBitrateKbps(raw.TURN_MAX_BITRATE_KBPS),
      };
    },
  };
}
