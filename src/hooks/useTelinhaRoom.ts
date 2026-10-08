import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  enterRoom,
  fetchIceServers,
  pingHealth,
  signalingAuthentication,
  signalingUrl,
  type RoomSession,
} from "../lib/api";
import { buildDiagnostics, recordDiagnostic } from "../lib/diagnostics";
import { buildIceServers } from "../lib/ice";
import { parseServerSignal, type ClientSignal } from "../lib/protocol";
import { playStreamStarted, playViewerJoined } from "../lib/sounds";
import { needsNativeAudioLoopback, startDisplayMediaShare } from "../media/displayShare";
import { isTauriRuntime } from "../lib/runtime";
import { createShareAudioPump, createShareAudioTrack } from "../media/shareAudio";
import { ConnectionState } from "./connectionState";
import {
  classifyConnectionQuality,
  type ConnectionQuality,
  type PeerHealthSample,
} from "../room/connectionQuality";
import { nextWatchAction } from "../lib/watch";
import { PeerManager } from "../room/peerManager";
import { buildScreenShares } from "../room/screenShares";
import type { RoomPerson, ScreenShareInfo } from "../room/types";
import { ShareAudience } from "../room/shareAudience";

export { ConnectionState } from "./connectionState";

export type { RoomPerson, ScreenShareInfo } from "../room/types";

export interface ShareQuality {
  fps: number;
  maxWidth: number;
  maxHeight?: number;
  maxBitrate?: number;
  includeAudio: boolean;
  preferH264: boolean;
}

const E2E_MEDIA = import.meta.env.DEV && import.meta.env.VITE_E2E_MEDIA === "1";

function roomIceConfig(session: RoomSession): RTCConfiguration {
  if (E2E_MEDIA) return { iceServers: [], iceCandidatePoolSize: 0 };
  return {
    iceServers: buildIceServers(import.meta.env, session.iceServers ?? []),
    iceCandidatePoolSize: 4,
  };
}

const VIDEO_MAX_BITRATE = 10_000_000;
const P2P_BLOCKED_MESSAGE =
  "Não foi possível conectar direto. A rede pode estar bloqueando o P2P.";
const MEDIA_RECOVERING_NETWORK = "A live não recebeu dados. Tentando reconectar...";
const MEDIA_RECOVERING_CODEC = "A live chegou sem imagem. Tentando outro codec...";
const MEDIA_STALLED_NETWORK =
  "A rede não entregou o vídeo. Tente novamente; algumas redes exigem um servidor TURN.";
const MEDIA_STALLED_CODEC =
  "O vídeo chegou, mas não pôde ser decodificado. Tente novamente ou use uma qualidade menor.";
const WATCH_FAILED_MESSAGE = "A live não chegou. Tente assistir de novo.";
const WATCH_CHECK_MS = 1_000;
const SIGNAL_PING_MS = 20_000;
const HEALTH_PING_MS = 120_000;
const MAX_RESEATS = 6;

export function useTelinhaRoom(
  session: RoomSession | null,
  options?: {
    onSessionRefresh?: (next: RoomSession) => void;
    onUpdateRequired?: () => void;
  },
) {
  const wsRef = useRef<WebSocket | null>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const peopleRef = useRef<Map<string, RoomPerson>>(new Map());
  const unlistensRef = useRef<UnlistenFn[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodeRef = useRef<AudioNode | null>(null);
  const audioPortRef = useRef<MessagePort | null>(null);
  const sharingRef = useRef(false);
  const preferH264Ref = useRef(true);
  const shareBitrateRef = useRef(VIDEO_MAX_BITRATE);
  const stopShareRef = useRef<() => Promise<void>>(async () => undefined);
  const reseatCountRef = useRef(0);
  const onSessionRefresh = options?.onSessionRefresh;
  const onUpdateRequiredRef = useRef(options?.onUpdateRequired);
  onUpdateRequiredRef.current = options?.onUpdateRequired;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [isSharing, setIsSharing] = useState(false);
  const [screenShares, setScreenShares] = useState<ScreenShareInfo[]>([]);
  const [participants, setParticipants] = useState<RoomPerson[]>([]);
  const [watcherCounts, setWatcherCounts] = useState<Record<string, number>>({});
  const [watcherNames, setWatcherNames] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>("offline");
  const [peerHealth, setPeerHealth] = useState<PeerHealthSample[]>([]);
  const audienceRef = useRef(new ShareAudience());
  const audienceCountRef = useRef(0);
  const watchingRef = useRef<Set<string>>(new Set());
  const watchWaitRef = useRef<Map<string, { since: number; resent: boolean; failed: boolean }>>(
    new Map(),
  );

  const publishPeople = useCallback(() => {
    setParticipants([...peopleRef.current.values()]);
  }, []);

  const publishWatchers = useCallback((localId: string) => {
    const audience = audienceRef.current;
    setWatcherCounts({ [localId]: audience.size });
    setWatcherNames({ [localId]: audience.names() });
    if (audience.size !== audienceCountRef.current) {
      audienceCountRef.current = audience.size;
      recordDiagnostic("audience-change", { count: audience.size });
    }
  }, []);

  const publishShares = useCallback((localId: string) => {
    setScreenShares(
      buildScreenShares({
        localId,
        people: peopleRef.current.values(),
        remoteStreams: remoteStreamsRef.current,
        localStream: localStreamRef.current,
        localSharing: sharingRef.current,
      }),
    );
  }, []);

  const sendSignal = useCallback((payload: ClientSignal) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const closePeer = useCallback((peerId: string) => {
    peerManagerRef.current?.close(peerId);
    remoteStreamsRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    peerManagerRef.current?.closeAll();
  }, []);

  // SPEC_DEVIATION: o plano previa PeerManager.closeIfIdle; a conexão é fechada com closePeer.
  // Reason: a faixa recebida do par segue "live" até a renegociação terminar, então um teste
  // de ociosidade pela conexão não a fecharia a tempo. A audiência (quem recebe de mim) e o
  // conjunto "assistindo" (de quem eu recebo) já dizem se ainda há mídia útil no par.
  const reconcilePeer = useCallback(
    async (peerId: string) => {
      const sending = audienceRef.current.has(peerId);
      if (!sending && !watchingRef.current.has(peerId)) {
        closePeer(peerId);
        if (session) publishShares(session.participantId);
      } else if (!sending) {
        await peerManagerRef.current?.stopSending(peerId);
      }
    },
    [closePeer, publishShares, session],
  );

  const offerToViewer = useCallback(async (peerId: string) => {
    try {
      await peerManagerRef.current?.offer(peerId);
    } catch {
      recordDiagnostic("audience-offer-failed");
    }
  }, []);

  const offerToAudience = useCallback(
    async () => {
      const viewers = audienceRef.current
        .ids()
        .filter((id) => peopleRef.current.get(id)?.connected);
      await Promise.all(viewers.map((id) => offerToViewer(id)));
    },
    [offerToViewer],
  );

  const cleanupNativeShare = useCallback(async () => {
    for (const unlisten of unlistensRef.current) {
      unlisten();
    }
    unlistensRef.current = [];
    audioPortRef.current = null;
    if (isTauriRuntime()) {
      try {
        await invoke("stop_share_capture");
      } catch (error) {
        recordDiagnostic("native-capture-stop-failed", { message: errorMessage(error) });
      }
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
    }
    localStreamRef.current = null;

    audioNodeRef.current?.disconnect();
    audioNodeRef.current = null;
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    peerManagerRef.current?.removeLocalTracks();

    sharingRef.current = false;
    setIsSharing(false);
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    let closed = false;
    const localId = session.participantId;
    const remoteStreams = remoteStreamsRef.current;
    const audience = audienceRef.current;
    const watching = watchingRef.current;
    const peerManager = new PeerManager({
      localId,
      configuration: roomIceConfig(session),
      getLocalStream: () => localStreamRef.current,
      shouldSendTo: (peerId) => audience.has(peerId),
      getVideoBitrate: () => shareBitrateRef.current,
      preferH264: () => preferH264Ref.current,
      send: sendSignal,
      onRemoteStream: (peerId, stream) => {
        remoteStreamsRef.current.set(peerId, stream);
        publishShares(localId);
      },
      onConnectionState: (peerId, state) => {
        recordDiagnostic("peer-state", { peerId, state });
        if (state === "connected") {
          setError((current) => (current === P2P_BLOCKED_MESSAGE ? null : current));
        } else if (state === "failed") {
          setError(P2P_BLOCKED_MESSAGE);
        }
      },
      refreshIceServers: async () => {
        if (E2E_MEDIA) return [];
        try {
          const servers = await fetchIceServers(session);
          return buildIceServers(import.meta.env, servers);
        } catch (err) {
          recordDiagnostic("ice-refresh-failed", { message: errorMessage(err) });
          return null;
        }
      },
      onIceError: (details) => recordDiagnostic("ice-error", details),
      onMediaStatus: (peerId, status) => {
        recordDiagnostic("media-status", { peerId, status });
        if (status === "receiving") {
          setError((current) =>
            [
              MEDIA_RECOVERING_NETWORK,
              MEDIA_RECOVERING_CODEC,
              MEDIA_STALLED_NETWORK,
              MEDIA_STALLED_CODEC,
            ].includes(current ?? "")
              ? null
              : current,
          );
        } else if (status === "recovering-network") {
          setError(MEDIA_RECOVERING_NETWORK);
        } else if (status === "recovering-codec") {
          setError(MEDIA_RECOVERING_CODEC);
        } else if (status === "stalled-network") {
          setError(MEDIA_STALLED_NETWORK);
        } else {
          setError(MEDIA_STALLED_CODEC);
        }
      },
      onError: (message) => recordDiagnostic("peer-warning", { message }),
    });
    peerManagerRef.current = peerManager;
    if (E2E_MEDIA) {
      (window as unknown as { __telinhaDebug?: unknown }).__telinhaDebug = {
        peerIds: () => peerManager.peerIds(),
      };
    }
    setConnectionState(ConnectionState.Connecting);
    setError(null);
    peopleRef.current = new Map([
      [
        localId,
        {
          identity: localId,
          name: session.displayName,
          isSharing: false,
          isLocal: true,
          connected: true,
        },
      ],
    ]);
    publishPeople();

    let attempts = 0;
    let fatal = false;
    let reseating = false;
    let reconnectTimer: number | undefined;

    const refreshSeat = async () => {
      if (reseating || closed || !onSessionRefresh) {
        return false;
      }
      if (reseatCountRef.current >= MAX_RESEATS) {
        fatal = true;
        setConnectionState(ConnectionState.Disconnected);
        setError("A sala caiu. Saia e peça ao host para abrir de novo, depois entre outra vez.");
        return false;
      }
      reseating = true;
      reseatCountRef.current += 1;
      setConnectionState(ConnectionState.Reconnecting);
      try {
        const next = await enterRoom(session.code, session.displayName);
        if (closed) return false;
        onSessionRefresh(next);
        return true;
      } catch (err) {
        reseating = false;
        recordDiagnostic("seat-refresh-failed", { message: errorMessage(err) });
        setError(err instanceof Error ? err.message : "Não foi possível voltar para a sala.");
        return false;
      }
    };

    const handleMessage = async (event: MessageEvent) => {
      const message = parseServerSignal(String(event.data));
      if (!message) {
        recordDiagnostic("invalid-server-signal");
        return;
      }

      if (message.type === "pong" || message.type === "ping") {
        return;
      }

      if (message.type === "error") {
        const text = message.message ?? "Erro na sala";
        recordDiagnostic("server-error", { errorCode: message.code, message: text });
        setError(text);
        if (message.code === "update-required") {
          fatal = true;
          setConnectionState(ConnectionState.Disconnected);
          onUpdateRequiredRef.current?.();
        } else if (text.includes("Sala inválida")) {
          const refreshed = await refreshSeat();
          if (refreshed) {
            return;
          }
        } else {
          fatal = true;
          setConnectionState(ConnectionState.Disconnected);
        }
        wsRef.current?.close();
        return;
      }

      if (message.type === "hello" && message.participants) {
        peopleRef.current = new Map(
          message.participants.map((person) => [
            person.id,
            {
              identity: person.id,
              name: person.name,
              isSharing: person.sharing,
              isLocal: person.id === localId,
              connected: person.connected ?? true,
            },
          ]),
        );
        const local = peopleRef.current.get(localId);
        if (local) {
          local.isSharing = sharingRef.current;
        }
        publishPeople();
        setConnectionState(ConnectionState.Connected);
        setError(null);
        reseatCountRef.current = 0;
        publishShares(localId);
        for (const sharerId of [...watching]) {
          if (peopleRef.current.get(sharerId)?.isSharing) {
            sendSignal({ type: "watch-started", to: sharerId });
          } else {
            watching.delete(sharerId);
          }
        }
        if (sharingRef.current) {
          sendSignal({ type: "share-started" });
          await offerToAudience();
        }
        return;
      }

      if (message.type === "participant-joined" && message.participant) {
        peopleRef.current.set(message.participant.id, {
          identity: message.participant.id,
          name: message.participant.name,
          isSharing: message.participant.sharing,
          isLocal: false,
          connected: message.participant.connected ?? true,
        });
        publishPeople();
        publishShares(localId);
        if (
          sharingRef.current &&
          (message.participant.connected ?? true) &&
          audience.has(message.participant.id)
        ) {
          await offerToViewer(message.participant.id);
        }
        return;
      }

      if (message.type === "participant-presence") {
        const person = peopleRef.current.get(message.participantId);
        if (!person) return;
        person.connected = message.connected;
        if (!message.connected) {
          closePeer(message.participantId);
          remoteStreamsRef.current.delete(message.participantId);
          audience.remove(message.participantId);
          publishWatchers(localId);
          publishShares(localId);
        } else {
          if (watching.has(message.participantId)) {
            sendSignal({ type: "watch-started", to: message.participantId });
          }
          if (sharingRef.current && audience.has(message.participantId)) {
            await offerToViewer(message.participantId);
          }
        }
        publishPeople();
        return;
      }

      if (message.type === "participant-left" && message.participantId) {
        peopleRef.current.delete(message.participantId);
        closePeer(message.participantId);
        audience.remove(message.participantId);
        watchingRef.current.delete(message.participantId);
        publishWatchers(localId);
        publishPeople();
        publishShares(localId);
        return;
      }

      if (message.type === "share-started" && message.participantId) {
        const person = peopleRef.current.get(message.participantId);
        if (person) {
          person.isSharing = true;
          publishPeople();
          publishShares(localId);
        }
        playStreamStarted();
        return;
      }

      if (message.type === "share-stopped" && message.participantId) {
        const person = peopleRef.current.get(message.participantId);
        if (person) {
          person.isSharing = false;
        }
        remoteStreamsRef.current.delete(message.participantId);
        watching.delete(message.participantId);
        publishPeople();
        publishShares(localId);
        await reconcilePeer(message.participantId);
        return;
      }

      if (message.type === "watch-started" && message.from && message.to) {
        const viewer = peopleRef.current.get(message.from);
        if (
          message.to !== localId ||
          message.from === localId ||
          !sharingRef.current ||
          !viewer?.connected
        ) {
          return;
        }
        const added =
          audience.add(message.from, message.name ?? viewer.name ?? "Alguém") === "added";
        publishWatchers(localId);
        if (added) playViewerJoined();
        if (added || !peerManager.peerIds().includes(message.from)) {
          await offerToViewer(message.from);
        }
        return;
      }

      if (message.type === "watch-stopped" && message.from && message.to) {
        if (message.to === localId && audience.remove(message.from)) {
          publishWatchers(localId);
          await reconcilePeer(message.from);
        }
        return;
      }

      if (message.type === "offer" && message.from && message.sdp) {
        await peerManager.handleDescription(message.from, "offer", message.sdp);
        return;
      }

      if (message.type === "answer" && message.from && message.sdp) {
        await peerManager.handleDescription(message.from, "answer", message.sdp);
        return;
      }

      if (message.type === "ice" && message.from && message.candidate) {
        await peerManager.handleIce(message.from, message.candidate);
      }
    };

    const attachSocket = (socket: WebSocket) => {
      let pingTimer: number | undefined;
      socket.addEventListener("open", () => {
        if (session.wsAuthMode === "message") {
          socket.send(JSON.stringify(signalingAuthentication(session)));
        }
        if (!closed) {
          attempts = 0;
          setConnectionState(ConnectionState.Connecting);
          recordDiagnostic("signal-open");
        }
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, SIGNAL_PING_MS);
      });
      socket.addEventListener("message", (event) => {
        void handleMessage(event).catch((cause) => {
          const message = errorMessage(cause);
          recordDiagnostic("signal-handler-failed", { message });
          setError("Falha ao processar a conexão da sala.");
        });
      });
      socket.addEventListener("error", () => recordDiagnostic("signal-transport-error"));
      socket.addEventListener("close", () => {
        recordDiagnostic("signal-close", { attempts, fatal });
        if (pingTimer != null) {
          window.clearInterval(pingTimer);
        }
        if (closed || fatal || reseating) return;
        if (attempts >= 8) {
          setConnectionState(ConnectionState.Disconnected);
          setError("A conexão caiu e não foi possível reconectar.");
          return;
        }
        setConnectionState(ConnectionState.Reconnecting);
        const delay = Math.min(1000 * 2 ** attempts, 8_000);
        attempts += 1;
        reconnectTimer = window.setTimeout(() => {
          if (closed || reseating) return;
          const next = new WebSocket(signalingUrl(session));
          wsRef.current = next;
          attachSocket(next);
        }, delay);
      });
    };

    const ws = new WebSocket(signalingUrl(session));
    wsRef.current = ws;
    attachSocket(ws);

    const healthTimer = window.setInterval(() => {
      void pingHealth().catch(() => undefined);
    }, HEALTH_PING_MS);
    void pingHealth().catch(() => undefined);
    const watchWaiting = watchWaitRef.current;
    const watchTimer = window.setInterval(() => {
      if (watching.size === 0 && watchWaiting.size === 0) return;
      for (const sharerId of watchWaiting.keys()) {
        if (!watching.has(sharerId)) watchWaiting.delete(sharerId);
      }
      for (const sharerId of watching) {
        const hasStream = remoteStreamsRef.current.has(sharerId);
        const state = watchWaiting.get(sharerId) ?? {
          since: Date.now(),
          resent: false,
          failed: false,
        };
        const action = nextWatchAction(Date.now() - state.since, state.resent, hasStream);
        if (action === "idle") {
          if (watchWaiting.delete(sharerId)) {
            setError((current) => (current === WATCH_FAILED_MESSAGE ? null : current));
          }
          continue;
        }
        watchWaiting.set(sharerId, state);
        if (action === "resend") {
          state.resent = true;
          sendSignal({ type: "watch-started", to: sharerId });
        } else if (action === "fail" && !state.failed) {
          state.failed = true;
          setError(WATCH_FAILED_MESSAGE);
        }
      }
    }, WATCH_CHECK_MS);
    const qualityTimer = window.setInterval(() => {
      void peerManager.collectHealth().then((samples) => {
        if (closed) return;
        setPeerHealth(samples);
        for (const sample of samples) {
          recordDiagnostic("peer-health", {
            peerId: sample.peerId,
            connectionState: sample.connectionState,
            roundTripTimeMs: sample.roundTripTimeMs,
            packetLossPercent: sample.packetLossPercent,
            bitrateKbps: sample.bitrateKbps,
            codec: sample.codec,
            bytesReceived: sample.bytesReceived,
            bytesSent: sample.bytesSent,
            framesDecoded: sample.framesDecoded,
            candidateType: sample.candidateType,
            transport: sample.transport,
            localIceCandidates: sample.localIceCandidates,
            remoteIceCandidates: sample.remoteIceCandidates,
            localHostCandidates: sample.localHostCandidates,
            localSrflxCandidates: sample.localSrflxCandidates,
            localRelayCandidates: sample.localRelayCandidates,
            remoteHostCandidates: sample.remoteHostCandidates,
            remoteSrflxCandidates: sample.remoteSrflxCandidates,
            remoteRelayCandidates: sample.remoteRelayCandidates,
            selectedLocalType: sample.selectedLocalType,
            selectedRemoteType: sample.selectedRemoteType,
            iceTransportPolicy: sample.iceTransportPolicy,
          });
        }
      });
    }, 2_000);

    return () => {
      closed = true;
      window.clearInterval(healthTimer);
      window.clearInterval(qualityTimer);
      window.clearInterval(watchTimer);
      watchWaiting.clear();
      if (E2E_MEDIA) delete (window as unknown as { __telinhaDebug?: unknown }).__telinhaDebug;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "leave" }));
      }
      closeAllPeers();
      if (peerManagerRef.current === peerManager) peerManagerRef.current = null;
      socket?.close();
      wsRef.current = null;
      remoteStreams.clear();
      peopleRef.current.clear();
      audience.clear();
      audienceCountRef.current = 0;
      watching.clear();
      setWatcherCounts({});
      setWatcherNames({});
      setScreenShares([]);
      setParticipants([]);
      setConnectionState(ConnectionState.Disconnected);
      setConnectionQuality("offline");
      setPeerHealth([]);
    };
  }, [
    session,
    closeAllPeers,
    closePeer,
    onSessionRefresh,
    publishWatchers,
    offerToAudience,
    offerToViewer,
    reconcilePeer,
    publishPeople,
    publishShares,
    sendSignal,
  ]);

  useEffect(() => {
    const next = classifyConnectionQuality(connectionState, peerHealth);
    setConnectionQuality((current) => {
      if (next !== current) recordDiagnostic("quality-change", { quality: next });
      return next;
    });
  }, [connectionState, peerHealth]);

  useEffect(() => {
    return () => {
      void cleanupNativeShare();
    };
  }, [cleanupNativeShare]);

  const startShare = useCallback(
    async (sourceId: string, quality: ShareQuality) => {
      if (!session) return;

      await cleanupNativeShare();
      setError(null);
      preferH264Ref.current = quality.preferH264;
      shareBitrateRef.current = quality.maxBitrate ?? VIDEO_MAX_BITRATE;

      try {
        const stream = await startDisplayMediaShare(quality, sourceId);

        if (
          needsNativeAudioLoopback(quality.includeAudio, stream.getAudioTracks().length)
        ) {
          await attachLoopbackAudio(
            sourceId,
            {
              unlistensRef,
              audioContextRef,
              audioNodeRef,
              audioPortRef,
            },
            stream,
            (message) => {
              recordDiagnostic("share-audio-failed", { message });
              setError("O vídeo está no ar, mas o áudio do sistema não pôde ser capturado.");
            },
          );
        }

        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (sharingRef.current) {
            void stopShareRef.current();
          }
        });

        localStreamRef.current = stream;
        sharingRef.current = true;
        const local = peopleRef.current.get(session.participantId);
        if (local) {
          local.isSharing = true;
        }
        setIsSharing(true);
        publishPeople();
        publishShares(session.participantId);
        sendSignal({ type: "share-started" });
      } catch (error) {
        await cleanupNativeShare();
        recordDiagnostic("share-start-failed", { message: errorMessage(error) });
        setError(error instanceof Error ? error.message : "Não foi possível compartilhar");
        throw error;
      }
    },
    [
      cleanupNativeShare,
      publishPeople,
      publishShares,
      sendSignal,
      session,
    ],
  );

  const setWatchingShare = useCallback(
    (sharerId: string, watching: boolean) => {
      if (!session || sharerId === session.participantId) return;
      watchWaitRef.current.delete(sharerId);
      if (watching) {
        watchingRef.current.add(sharerId);
      } else {
        watchingRef.current.delete(sharerId);
      }
      sendSignal({ type: watching ? "watch-started" : "watch-stopped", to: sharerId });
      if (!watching) void reconcilePeer(sharerId);
    },
    [reconcilePeer, sendSignal, session],
  );

  const stopShare = useCallback(async () => {
    if (!session) {
      await cleanupNativeShare();
      return;
    }
    sendSignal({ type: "share-stopped" });
    audienceRef.current.clear();
    publishWatchers(session.participantId);
    await Promise.all(
      (peerManagerRef.current?.peerIds() ?? []).map((peerId) =>
        reconcilePeer(peerId).catch(() => undefined),
      ),
    );
    await cleanupNativeShare();
    const local = peopleRef.current.get(session.participantId);
    if (local) {
      local.isSharing = false;
    }
    publishPeople();
    publishShares(session.participantId);
  }, [cleanupNativeShare, publishPeople, publishShares, publishWatchers, reconcilePeer, sendSignal, session]);

  stopShareRef.current = stopShare;

  const retryConnections = useCallback(async () => {
    setError(null);
    recordDiagnostic("manual-media-retry");
    try {
      await peerManagerRef.current?.retryAll();
    } catch (cause) {
      recordDiagnostic("manual-media-retry-failed", { message: errorMessage(cause) });
      setError("Não foi possível tentar novamente.");
    }
  }, []);

  return {
    connectionState,
    isSharing,
    screenShares,
    participants,
    watcherCounts,
    watcherNames,
    connectionQuality,
    copyDiagnostics: buildDiagnostics,
    startShare,
    stopShare,
    setWatchingShare,
    retryConnections,
    error,
  };
}

interface AudioShareRefs {
  unlistensRef: MutableRefObject<UnlistenFn[]>;
  audioContextRef: MutableRefObject<AudioContext | null>;
  audioNodeRef: MutableRefObject<AudioNode | null>;
  audioPortRef: MutableRefObject<MessagePort | null>;
}

async function attachLoopbackAudio(
  sourceId: string,
  refs: AudioShareRefs,
  stream: MediaStream,
  onError: (message: string) => void,
) {
  const audio = await createShareAudioTrack();
  if (!audio) return;
  refs.audioContextRef.current = audio.context;
  refs.audioNodeRef.current = audio.node;
  refs.audioPortRef.current = audio.port ?? null;
  const pumpAudio = createShareAudioPump(() => refs.audioPortRef.current);
  refs.unlistensRef.current.push(await listen("share-audio", () => {
    void pumpAudio();
  }));
  refs.unlistensRef.current.push(
    await listen<string>("share-audio-error", (event) => onError(event.payload)),
  );
  await invoke("start_share_capture", {
    id: sourceId,
    fps: 15,
    maxWidth: 0,
    includeAudio: true,
    includeVideo: false,
  });
  if (audio.track) {
    stream.addTrack(audio.track);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
