import { ConnectionState } from "../hooks/connectionState";

export type ConnectionQuality = "good" | "unstable" | "reconnecting" | "offline";

export interface PeerHealthSample {
  peerId: string;
  /** `native-share` na conexão do compartilhamento nativo; ausente na conexão comum. */
  channel?: "native-share";
  connectionState?: RTCPeerConnectionState;
  roundTripTimeMs?: number;
  packetLossPercent?: number;
  bitrateKbps?: number;
  codec?: string;
  bytesReceived?: number;
  bytesSent?: number;
  framesDecoded?: number;
  candidateType?: string;
  transport?: string;
  localIceCandidates?: number;
  remoteIceCandidates?: number;
  localHostCandidates?: number;
  localSrflxCandidates?: number;
  localRelayCandidates?: number;
  remoteHostCandidates?: number;
  remoteSrflxCandidates?: number;
  remoteRelayCandidates?: number;
  selectedLocalType?: string;
  selectedRemoteType?: string;
  iceTransportPolicy?: string;
}

export function classifyConnectionQuality(
  state: ConnectionState,
  samples: PeerHealthSample[],
): ConnectionQuality {
  if (state === ConnectionState.Reconnecting || state === ConnectionState.Connecting) {
    return "reconnecting";
  }
  if (state === ConnectionState.Disconnected) return "offline";
  if (
    samples.some((sample) =>
      ["new", "connecting"].includes(sample.connectionState ?? "connected"),
    )
  ) {
    return "reconnecting";
  }
  if (
    samples.some((sample) =>
      ["disconnected", "failed", "closed"].includes(sample.connectionState ?? "connected"),
    )
  ) {
    return "offline";
  }
  if (
    samples.some(
      (sample) =>
        (sample.packetLossPercent ?? 0) > 5 || (sample.roundTripTimeMs ?? 0) > 400,
    )
  ) {
    return "unstable";
  }
  return "good";
}

export function connectionQualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case "good":
      return "Conexão boa";
    case "unstable":
      return "Conexão instável";
    case "reconnecting":
      return "Reconectando";
    case "offline":
      return "Sem conexão";
  }
}
