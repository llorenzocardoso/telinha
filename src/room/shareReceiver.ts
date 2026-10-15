import type { ClientSignal } from "../lib/protocol";
import type { PeerHealthSample } from "./connectionQuality";

export interface ShareReceiverOptions {
  send: (payload: ClientSignal) => void;
  /** Configuração de ICE da sala, lida a cada nova conexão. */
  configuration: () => RTCConfiguration;
  /** Chega a stream da live nativa de `peerId`. */
  onStream: (peerId: string, stream: MediaStream) => void;
  onConnectionState?: (peerId: string, state: RTCPeerConnectionState) => void;
}

interface Link {
  pc: RTCPeerConnection;
  /** Stream montada aqui quando o transmissor não associa as faixas a uma. */
  stream?: MediaStream;
  /** Candidatos que chegaram antes da oferta ser aplicada. */
  pending: RTCIceCandidateInit[];
  remoteReady: boolean;
  /** Bytes e instante da leitura anterior, para medir o bitrate recebido. */
  previous?: { bytes: number; at: number };
}

/**
 * Lado espectador do compartilhamento nativo: uma conexão só de recepção por transmissor, separada
 * do `PeerManager` (câmera e lives legadas). Quem transmite sempre oferece; aqui só se responde.
 */
export class ShareReceiver {
  private readonly links = new Map<string, Link>();
  /** Candidatos que antecedem a oferta, por transmissor. */
  private readonly early = new Map<string, RTCIceCandidateInit[]>();

  constructor(private readonly options: ShareReceiverOptions) {}

  has(peerId: string): boolean {
    return this.links.has(peerId);
  }

  async handleOffer(peerId: string, sdp: string): Promise<void> {
    // Candidatos que chegaram antes da oferta entram na fila do novo link.
    const early = this.early.get(peerId) ?? [];
    // Uma oferta nova do mesmo transmissor (reconexão) começa do zero.
    this.close(peerId);
    const pc = new RTCPeerConnection(this.options.configuration());
    const link: Link = { pc, pending: [...early], remoteReady: false };
    this.links.set(peerId, link);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.options.send({
        type: "ice",
        to: peerId,
        candidate: event.candidate.toJSON(),
        channel: "share-in",
      });
    };
    pc.ontrack = (event) => {
      // Vídeo e áudio vêm na mesma stream; sem ela, as faixas são juntadas numa só.
      let stream = event.streams[0];
      if (!stream) {
        link.stream ??= new MediaStream();
        if (!link.stream.getTracks().includes(event.track)) link.stream.addTrack(event.track);
        stream = link.stream;
      }
      // A live aparece quando o vídeo chega; o áudio que vier depois entra na mesma stream.
      if (event.track.kind === "video") this.options.onStream(peerId, stream);
    };
    pc.onconnectionstatechange = () => {
      if (this.links.get(peerId) !== link) return;
      this.options.onConnectionState?.(peerId, pc.connectionState);
    };

    await pc.setRemoteDescription({ type: "offer", sdp });
    link.remoteReady = true;
    for (const candidate of link.pending.splice(0)) {
      await pc.addIceCandidate(candidate).catch(() => undefined);
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // Uma oferta mais nova pode ter substituído esta enquanto aguardávamos.
    if (this.links.get(peerId) !== link) return;
    this.options.send({
      type: "answer",
      to: peerId,
      sdp: answer.sdp ?? pc.localDescription?.sdp ?? "",
      channel: "share-in",
    });
  }

  async handleIce(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const link = this.links.get(peerId);
    // Pode chegar antes da oferta: guarda numa conexão provisória só com a fila.
    if (!link) {
      this.holdBeforeOffer(peerId, candidate);
      return;
    }
    if (!link.remoteReady) {
      link.pending.push(candidate);
      return;
    }
    await link.pc.addIceCandidate(candidate).catch(() => undefined);
  }

  /** Uma amostra por live recebida, no formato do indicador de qualidade da sala. */
  async collectHealth(): Promise<PeerHealthSample[]> {
    const samples: PeerHealthSample[] = [];
    for (const [peerId, link] of this.links) {
      const sample: PeerHealthSample = {
        peerId,
        channel: "native-share",
        connectionState: link.pc.connectionState,
      };
      try {
        const report = await link.pc.getStats();
        const local = new Map<string, string>();
        const codecs = new Map<string, string>();
        let inbound: Record<string, unknown> | undefined;
        let pair: Record<string, unknown> | undefined;
        report.forEach((stat: Record<string, unknown>) => {
          if (stat.type === "inbound-rtp" && stat.kind === "video") inbound = stat;
          else if (stat.type === "local-candidate") local.set(String(stat.id), String(stat.candidateType));
          else if (stat.type === "codec") codecs.set(String(stat.id), String(stat.mimeType));
          else if (stat.type === "candidate-pair" && (stat.nominated || stat.selected)) pair = stat;
        });
        if (inbound) {
          const bytes = Number(inbound.bytesReceived ?? 0);
          const received = Number(inbound.packetsReceived ?? 0);
          const lost = Math.max(0, Number(inbound.packetsLost ?? 0));
          sample.bytesReceived = bytes;
          sample.framesDecoded = Number(inbound.framesDecoded ?? 0);
          sample.packetLossPercent = received + lost > 0 ? (lost / (received + lost)) * 100 : 0;
          sample.codec = codecs.get(String(inbound.codecId));
          const now = Date.now();
          if (link.previous && now > link.previous.at) {
            sample.bitrateKbps = ((bytes - link.previous.bytes) * 8) / (now - link.previous.at);
          }
          link.previous = { bytes, at: now };
        }
        if (pair) {
          const rtt = Number(pair.currentRoundTripTime);
          if (Number.isFinite(rtt) && rtt > 0) sample.roundTripTimeMs = rtt * 1000;
          sample.candidateType = local.get(String(pair.localCandidateId));
        }
      } catch {
        // Conexão encerrando: fica só o estado.
      }
      samples.push(sample);
    }
    return samples;
  }

  close(peerId: string): void {
    const link = this.links.get(peerId);
    this.early.delete(peerId);
    if (!link) return;
    this.links.delete(peerId);
    link.pc.onicecandidate = null;
    link.pc.ontrack = null;
    link.pc.onconnectionstatechange = null;
    link.pc.close();
  }

  closeAll(): void {
    for (const peerId of [...this.links.keys()]) this.close(peerId);
    this.early.clear();
  }

  private holdBeforeOffer(peerId: string, candidate: RTCIceCandidateInit): void {
    const queue = this.early.get(peerId) ?? [];
    queue.push(candidate);
    this.early.set(peerId, queue.slice(-64));
  }
}
