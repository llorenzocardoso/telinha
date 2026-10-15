import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DiagnosticDetails } from "../lib/diagnostics";
import type { ClientSignal } from "../lib/protocol";
import type { ShareQuality } from "../hooks/useTelinhaRoom";
import type { PeerHealthSample } from "./connectionQuality";

export interface NativeStartInfo {
  width: number;
  height: number;
  encoder: string;
}

export interface NativeSenderStats {
  viewers: number;
  targetKbps: number;
  framesPerSecond: number;
  sentKbps: number;
}

interface IceEvent {
  peerId: string;
  candidate: string;
  sdpMid: string;
  sdpMlineIndex: number;
}

interface StateEvent {
  peerId: string;
  state: string;
}

interface ViewerEvent {
  peerId: string;
  relay: boolean;
  rttMs?: number | null;
  availableKbps?: number | null;
}

interface AudioErrorEvent {
  message: string;
}

interface EndedEvent {
  reason: "source-closed" | "error";
  message?: string | null;
}

/** Quantas vezes uma conexão que caiu é refeita antes de desistir. */
export const MAX_RECOVERY_ATTEMPTS = 2;

export interface NativeSenderOptions {
  send: (payload: ClientSignal) => void;
  /** Lista de ICE da sala (STUN/TURN), lida a cada novo espectador. */
  iceServers: () => RTCIceServer[];
  /** Busca credenciais novas no servidor; `null` se não deu (segue com as que há). */
  refreshIceServers?: () => Promise<RTCIceServer[] | null>;
  /** Limite de banda (kbit/s) do servidor para espectadores que passam pelo relay TURN. */
  relayCapKbps?: () => number | undefined;
  /** A fonte sumiu (janela fechada) ou o pipeline falhou: o compartilhamento terminou. */
  onEnded: (reason: EndedEvent["reason"], message?: string | null) => void;
  /** O som do computador não pôde ser capturado; o vídeo continua no ar sem áudio. */
  onAudioError?: (message: string) => void;
  /** Mudança de estado da conexão de um espectador (conectou, caiu, ...). */
  onConnectionState?: (peerId: string, state: RTCPeerConnectionState) => void;
  /** Uma conexão caiu e as tentativas de refazê-la acabaram. */
  onViewerGaveUp?: (peerId: string) => void;
  onDiagnostic?: (event: string, details?: DiagnosticDetails) => void;
}

interface ViewerRoute {
  relay: boolean;
  rttMs?: number;
  availableKbps?: number;
}

/**
 * Lado transmissor do compartilhamento nativo. A captura, a codificação e o WebRTC rodam em Rust;
 * aqui só ficam a sinalização (oferta, resposta e ICE pelo canal `share-out`/`share-in`), o ciclo
 * de vida por espectador e a recuperação de conexões que caem.
 */
export class NativeSender {
  private unlisten: UnlistenFn[] = [];
  private active = false;
  /** Espectadores com conexão aberta no Rust. */
  private readonly viewers = new Set<string>();
  /** Candidatos que o Rust gerou antes de a oferta sair: vão atrás dela, nunca na frente. */
  private readonly held = new Map<string, RTCIceCandidateInit[]>();
  private readonly offered = new Set<string>();
  /** Espectadores cuja conexão já chegou a "connected" no Rust. */
  private readonly connected = new Set<string>();
  private readonly states = new Map<string, RTCPeerConnectionState>();
  private readonly routes = new Map<string, ViewerRoute>();
  private readonly attempts = new Map<string, number>();
  /** Credenciais renovadas numa recuperação; valem até o fim da live. */
  private freshServers: RTCIceServer[] | null = null;

  constructor(private readonly options: NativeSenderOptions) {}

  get isActive(): boolean {
    return this.active;
  }

  hasViewer(peerId: string): boolean {
    return this.viewers.has(peerId);
  }

  /** A conexão com esse espectador está de pé; se não, vale oferecer de novo. */
  isConnected(peerId: string): boolean {
    return this.connected.has(peerId);
  }

  async start(sourceId: string, quality: ShareQuality): Promise<NativeStartInfo> {
    await this.stop();
    await this.listenToBackend();
    try {
      const info = await invoke<NativeStartInfo>("native_share_start", {
        id: sourceId,
        maxHeight: quality.maxHeight ?? 0,
        fps: quality.fps,
        maxMbps: Math.max(1, Math.round((quality.maxBitrate ?? 10_000_000) / 1_000_000)),
        includeAudio: quality.includeAudio,
        relayCapKbps: this.options.relayCapKbps?.() ?? null,
      });
      this.active = true;
      return info;
    } catch (error) {
      this.dropListeners();
      throw Object.assign(
        new Error(typeof error === "string" ? error : "Não foi possível iniciar a captura"),
        { cause: error },
      );
    }
  }

  /** Abre a conexão com um espectador e manda a oferta. */
  async offerTo(peerId: string, relayOnly = false): Promise<void> {
    if (!this.active) return;
    this.offered.delete(peerId);
    this.held.delete(peerId);
    this.connected.delete(peerId);
    const sdp = await invoke<string>("native_share_offer", {
      peerId,
      iceServers: this.freshServers ?? this.options.iceServers(),
      relayOnly,
    });
    this.viewers.add(peerId);
    this.options.send({ type: "offer", to: peerId, sdp, channel: "share-out" });
    this.offered.add(peerId);
    for (const candidate of this.held.get(peerId) ?? []) this.sendCandidate(peerId, candidate);
    this.held.delete(peerId);
  }

  async handleAnswer(peerId: string, sdp: string): Promise<void> {
    if (!this.viewers.has(peerId)) return;
    await invoke("native_share_answer", { peerId, sdp });
  }

  async handleIce(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.viewers.has(peerId) || !candidate.candidate) return;
    await invoke("native_share_ice", {
      peerId,
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMlineIndex: candidate.sdpMLineIndex ?? null,
    });
  }

  stopViewer(peerId: string): void {
    if (!this.viewers.delete(peerId)) return;
    this.forget(peerId);
    void invoke("native_share_viewer_stop", { peerId }).catch(() => undefined);
  }

  stats(): Promise<NativeSenderStats> {
    return invoke<NativeSenderStats>("native_share_stats");
  }

  /** Uma amostra de saúde por espectador, no formato do indicador de qualidade da sala. */
  healthSamples(): PeerHealthSample[] {
    return [...this.viewers].map((peerId) => {
      const route = this.routes.get(peerId);
      return {
        peerId,
        channel: "native-share",
        connectionState: this.states.get(peerId) ?? "new",
        roundTripTimeMs: route?.rttMs,
        candidateType: route ? (route.relay ? "relay" : "direct") : undefined,
      };
    });
  }

  async stop(): Promise<void> {
    const wasActive = this.active;
    this.active = false;
    this.viewers.clear();
    this.connected.clear();
    this.offered.clear();
    this.held.clear();
    this.states.clear();
    this.routes.clear();
    this.attempts.clear();
    this.freshServers = null;
    this.dropListeners();
    if (wasActive) {
      await invoke("native_share_stop").catch(() => undefined);
    }
  }

  private forget(peerId: string): void {
    this.connected.delete(peerId);
    this.offered.delete(peerId);
    this.held.delete(peerId);
    this.states.delete(peerId);
    this.routes.delete(peerId);
    this.attempts.delete(peerId);
  }

  /**
   * Uma conexão que caiu é refeita: primeiro com credenciais novas, depois, se a sala tem TURN,
   * forçando o relay. Passadas as tentativas, desiste e avisa.
   */
  private async recover(peerId: string): Promise<void> {
    const attempt = (this.attempts.get(peerId) ?? 0) + 1;
    this.attempts.set(peerId, attempt);
    if (attempt > MAX_RECOVERY_ATTEMPTS) {
      this.options.onDiagnostic?.("native-share-recovery-gave-up", { peerId });
      this.options.onViewerGaveUp?.(peerId);
      return;
    }
    try {
      const fresh = await this.options.refreshIceServers?.();
      if (fresh) this.freshServers = fresh;
      const servers = this.freshServers ?? this.options.iceServers();
      const hasTurn = servers.some((server) =>
        [server.urls].flat().some((url) => /^turns?:/i.test(url)),
      );
      const relayOnly = attempt >= 2 && hasTurn;
      this.options.onDiagnostic?.("native-share-recovering", { peerId, attempt, relayOnly });
      // A conexão pode ter sido encerrada (espectador saiu) enquanto as credenciais vinham.
      if (!this.active || !this.viewers.has(peerId)) return;
      await this.offerTo(peerId, relayOnly);
    } catch (error) {
      this.options.onDiagnostic?.("native-share-recovery-failed", {
        peerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async listenToBackend(): Promise<void> {
    this.dropListeners();
    this.unlisten = await Promise.all([
      listen<IceEvent>("native-share-ice", ({ payload }) => {
        if (!this.active && this.viewers.size === 0) return;
        const candidate: RTCIceCandidateInit = {
          candidate: payload.candidate,
          sdpMid: payload.sdpMid,
          sdpMLineIndex: payload.sdpMlineIndex,
        };
        if (this.offered.has(payload.peerId)) {
          this.sendCandidate(payload.peerId, candidate);
        } else {
          const queue = this.held.get(payload.peerId) ?? [];
          queue.push(candidate);
          this.held.set(payload.peerId, queue);
        }
      }),
      listen<StateEvent>("native-share-state", ({ payload }) => {
        const { peerId } = payload;
        if (!this.viewers.has(peerId)) return;
        const state = payload.state as RTCPeerConnectionState;
        this.states.set(peerId, state);
        if (state === "connected") {
          this.connected.add(peerId);
          this.attempts.delete(peerId);
        } else {
          this.connected.delete(peerId);
        }
        this.options.onDiagnostic?.("native-share-state", { ...payload });
        this.options.onConnectionState?.(peerId, state);
        if (state === "failed") void this.recover(peerId);
      }),
      listen<ViewerEvent>("native-share-viewer", ({ payload }) => {
        if (!this.viewers.has(payload.peerId)) return;
        this.routes.set(payload.peerId, {
          relay: payload.relay,
          rttMs: payload.rttMs ?? undefined,
          availableKbps: payload.availableKbps ?? undefined,
        });
      }),
      listen<AudioErrorEvent>("native-share-audio-error", ({ payload }) => {
        this.options.onDiagnostic?.("native-share-audio-error", { message: payload.message });
        this.options.onAudioError?.(payload.message);
      }),
      listen<EndedEvent>("native-share-ended", ({ payload }) => {
        this.options.onDiagnostic?.("native-share-ended", { ...payload });
        this.options.onEnded(payload.reason, payload.message);
      }),
    ]);
  }

  private dropListeners(): void {
    for (const unlisten of this.unlisten) unlisten();
    this.unlisten = [];
  }

  private sendCandidate(peerId: string, candidate: RTCIceCandidateInit): void {
    this.options.send({ type: "ice", to: peerId, candidate, channel: "share-out" });
  }
}
