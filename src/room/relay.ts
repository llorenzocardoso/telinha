/**
 * O relay TURN da Cloudflare é cobrado por GB depois da franquia, então uma live que caiu
 * para relay vale um teto de bitrate mais apertado que uma conexão direta.
 */

/** A rota é relay quando qualquer uma das pontas escolhidas é um candidato de relay. */
export function isRelayRoute(route: {
  selectedLocalType?: string;
  selectedRemoteType?: string;
  candidateType?: string;
}): boolean {
  return [route.selectedLocalType, route.selectedRemoteType, route.candidateType].some(
    (type) => type === "relay",
  );
}

/**
 * Aplica o teto do relay sobre o bitrate escolhido pela pessoa.
 *
 * Fora do relay, ou sem teto configurado, o valor passa intacto: o teto nunca aumenta o
 * bitrate, só pode baixá-lo.
 */
export function videoBitrateFor(
  baseBitrate: number,
  relayCapKbps: number | null | undefined,
  relay: boolean,
): number {
  if (!relay || !relayCapKbps || relayCapKbps <= 0) return baseBitrate;
  return Math.min(baseBitrate, Math.round(relayCapKbps * 1000));
}
