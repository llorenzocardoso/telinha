import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSignal } from "../lib/protocol";
import { ShareReceiver } from "./shareReceiver";

class FakeStream {
  readonly tracks: unknown[];
  constructor(tracks: unknown[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return this.tracks;
  }
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
}

class FakePeer {
  static all: FakePeer[] = [];
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  ontrack: ((event: { track: { kind: string }; streams: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { sdp: string } | null = null;
  remote: { type: string; sdp: string } | null = null;
  added: RTCIceCandidateInit[] = [];
  closed = false;
  constructor(public readonly configuration?: RTCConfiguration) {
    FakePeer.all.push(this);
  }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remote = description;
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0 answer" };
  }
  async setLocalDescription(description: { sdp: string }) {
    this.localDescription = description;
  }
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remote) throw new Error("no remote description");
    this.added.push(candidate);
  }
  stats: Array<Record<string, unknown>> = [];
  async getStats() {
    const stats = this.stats;
    return { forEach: (visit: (stat: Record<string, unknown>) => void) => stats.forEach(visit) };
  }
  close() {
    this.closed = true;
  }
}

const sent: ClientSignal[] = [];
const onStream = vi.fn();
const onConnectionState = vi.fn();

function receiver() {
  return new ShareReceiver({
    send: (payload) => sent.push(payload),
    configuration: () => ({ iceServers: [{ urls: "stun:example.test" }] }),
    onStream,
    onConnectionState,
  });
}

beforeEach(() => {
  FakePeer.all = [];
  sent.length = 0;
  onStream.mockReset();
  onConnectionState.mockReset();
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("MediaStream", FakeStream);
});

afterEach(() => vi.unstubAllGlobals());

describe("ShareReceiver", () => {
  it("responde a oferta pelo canal share-in", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0 offer");
    const peer = FakePeer.all[0]!;
    expect(peer.configuration).toEqual({ iceServers: [{ urls: "stun:example.test" }] });
    expect(peer.remote).toEqual({ type: "offer", sdp: "v=0 offer" });
    expect(sent).toEqual([{ type: "answer", to: "sharer", sdp: "v=0 answer", channel: "share-in" }]);
  });

  it("manda os próprios candidatos pelo canal share-in e ignora o fim da lista", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0 offer");
    const peer = FakePeer.all[0]!;
    peer.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: "candidate:7", sdpMid: "0" }) } });
    peer.onicecandidate?.({ candidate: null });
    expect(sent[sent.length - 1]).toEqual({
      type: "ice",
      to: "sharer",
      candidate: { candidate: "candidate:7", sdpMid: "0" },
      channel: "share-in",
    });
    expect(sent.filter((signal) => signal.type === "ice")).toHaveLength(1);
  });

  it("aplica candidatos que chegaram antes da oferta, na ordem", async () => {
    const link = receiver();
    await link.handleIce("sharer", { candidate: "candidate:1" });
    await link.handleIce("sharer", { candidate: "candidate:2" });
    await link.handleOffer("sharer", "v=0 offer");
    expect(FakePeer.all[0]!.added.map((c) => c.candidate)).toEqual(["candidate:1", "candidate:2"]);
  });

  it("adiciona candidatos direto depois da oferta", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0 offer");
    await link.handleIce("sharer", { candidate: "candidate:3" });
    expect(FakePeer.all[0]!.added.map((c) => c.candidate)).toEqual(["candidate:3"]);
  });

  it("entrega a stream quando o vídeo chega, não quando só o áudio chegou", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0 offer");
    const peer = FakePeer.all[0]!;
    const stream = new FakeStream();
    peer.ontrack?.({ track: { kind: "audio" }, streams: [stream] });
    expect(onStream).not.toHaveBeenCalled();

    peer.ontrack?.({ track: { kind: "video" }, streams: [stream] });
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledWith("sharer", stream);
  });

  it("junta vídeo e áudio numa só stream quando o transmissor não as associa", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0 offer");
    const peer = FakePeer.all[0]!;
    const audio = { kind: "audio" };
    const video = { kind: "video" };
    peer.ontrack?.({ track: audio, streams: [] });
    peer.ontrack?.({ track: video, streams: [] });
    expect(onStream).toHaveBeenCalledTimes(1);
    const stream = onStream.mock.calls[0]![1] as FakeStream;
    expect(stream.getTracks()).toEqual([audio, video]);

    // Um áudio que chegue depois entra na stream já entregue, sem entregá-la de novo.
    const late = { kind: "audio" };
    peer.ontrack?.({ track: late, streams: [] });
    expect(stream.getTracks()).toContain(late);
    expect(onStream).toHaveBeenCalledTimes(1);
  });

  it("uma oferta nova do mesmo transmissor troca a conexão", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0 first");
    await link.handleOffer("sharer", "v=0 second");
    expect(FakePeer.all).toHaveLength(2);
    expect(FakePeer.all[0]!.closed).toBe(true);
    expect(FakePeer.all[1]!.closed).toBe(false);
    expect(link.has("sharer")).toBe(true);
  });

  it("repassa o estado da conexão só da conexão atual", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0 first");
    const old = FakePeer.all[0]!;
    await link.handleOffer("sharer", "v=0 second");
    const current = FakePeer.all[1]!;
    current.connectionState = "connected";
    current.onconnectionstatechange?.();
    expect(onConnectionState).toHaveBeenCalledWith("sharer", "connected");
    onConnectionState.mockReset();
    old.onconnectionstatechange?.();
    expect(onConnectionState).not.toHaveBeenCalled();
  });

  it("resume a saúde da live recebida", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0");
    const peer = FakePeer.all[0]!;
    peer.connectionState = "connected";
    peer.stats = [
      { type: "codec", id: "c1", mimeType: "video/H264" },
      {
        type: "inbound-rtp",
        kind: "video",
        codecId: "c1",
        bytesReceived: 1_000_000,
        packetsReceived: 950,
        packetsLost: 50,
        framesDecoded: 300,
      },
      { type: "local-candidate", id: "l1", candidateType: "relay" },
      { type: "candidate-pair", nominated: true, localCandidateId: "l1", currentRoundTripTime: 0.042 },
    ];
    const [sample] = await link.collectHealth();
    expect(sample).toMatchObject({
      peerId: "sharer",
      channel: "native-share",
      connectionState: "connected",
      codec: "video/H264",
      bytesReceived: 1_000_000,
      framesDecoded: 300,
      candidateType: "relay",
    });
    expect(sample!.packetLossPercent).toBeCloseTo(5, 5);
    expect(sample!.roundTripTimeMs).toBeCloseTo(42, 5);
  });

  it("mede o bitrate recebido entre duas leituras", async () => {
    vi.useFakeTimers();
    try {
      const link = receiver();
      await link.handleOffer("sharer", "v=0");
      const peer = FakePeer.all[0]!;
      const inbound = (bytes: number) => ({ type: "inbound-rtp", kind: "video", bytesReceived: bytes });
      peer.stats = [inbound(1_000_000)];
      const [first] = await link.collectHealth();
      expect(first!.bitrateKbps).toBeUndefined();
      vi.advanceTimersByTime(2000);
      peer.stats = [inbound(1_000_000 + 250_000)];
      const [second] = await link.collectHealth();
      // 250 kB em 2 s = 1000 kbit/s.
      expect(second!.bitrateKbps).toBeCloseTo(1000, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem estatísticas devolve só o estado da conexão", async () => {
    const link = receiver();
    await link.handleOffer("sharer", "v=0");
    FakePeer.all[0]!.getStats = async () => {
      throw new Error("closed");
    };
    const [sample] = await link.collectHealth();
    expect(sample).toEqual({ peerId: "sharer", channel: "native-share", connectionState: "new" });
  });

  it("close e closeAll encerram as conexões e esquecem candidatos antigos", async () => {
    const link = receiver();
    await link.handleOffer("a", "v=0");
    await link.handleOffer("b", "v=0");
    link.close("a");
    expect(FakePeer.all[0]!.closed).toBe(true);
    expect(link.has("a")).toBe(false);
    expect(link.has("b")).toBe(true);

    await link.handleIce("c", { candidate: "candidate:early" });
    link.closeAll();
    expect(FakePeer.all[1]!.closed).toBe(true);
    await link.handleOffer("c", "v=0");
    expect(FakePeer.all[FakePeer.all.length - 1]!.added).toEqual([]);
  });
});
