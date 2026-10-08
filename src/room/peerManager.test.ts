import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerManager } from "./peerManager";

class MockPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  remoteDescription: RTCSessionDescription | null = null;
  localDescription: RTCSessionDescription | null = null;
  onicecandidate: RTCPeerConnection["onicecandidate"] = null;
  ontrack: RTCPeerConnection["ontrack"] = null;
  onconnectionstatechange: RTCPeerConnection["onconnectionstatechange"] = null;
  senders: { track: MediaStreamTrack | null; getParameters: () => RTCRtpSendParameters; setParameters: () => Promise<void> }[] = [];
  localDescriptions: RTCSessionDescriptionInit[] = [];
  stats = new Map<string, Record<string, unknown>>();
  closed = 0;

  offerGate: Promise<void> | null = null;

  addTrack(track: MediaStreamTrack) {
    const sender = {
      track,
      getParameters: () => ({ encodings: [] }) as unknown as RTCRtpSendParameters,
      setParameters: async () => undefined,
    };
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

  getSenders() {
    return this.senders as unknown as RTCRtpSender[];
  }

  getReceivers() {
    return [];
  }

  getTransceivers() {
    return [];
  }

  async createOffer() {
    await this.offerGate;
    return { type: "offer" as const, sdp: "v=0 offer" };
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "v=0 answer" };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescriptions.push(description);
    this.localDescription = description as RTCSessionDescription;
    if (description.type === "offer") this.signalingState = "have-local-offer";
    if (description.type === "answer" || description.type === "rollback") this.signalingState = "stable";
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description as RTCSessionDescription;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }

  async addIceCandidate() {}
  removeTrack(sender: { track: MediaStreamTrack | null }) {
    sender.track = null;
  }
  close() {
    this.closed += 1;
    this.connectionState = "closed";
  }
  configuration: RTCConfiguration = {};

  async getStats() {
    return this.stats as unknown as RTCStatsReport;
  }

  setConfiguration(configuration: RTCConfiguration) {
    this.configuration = configuration;
  }

  getConfiguration() {
    return this.configuration;
  }
}

describe("PeerManager", () => {
  let created: MockPeerConnection[];

  beforeEach(() => {
    vi.restoreAllMocks();
    created = [];
    vi.stubGlobal(
      "RTCPeerConnection",
      class extends MockPeerConnection {
        constructor() {
          super();
          created.push(this);
        }
      },
    );
    vi.stubGlobal("RTCRtpSender", { getCapabilities: () => null });
  });

  function manager(
    getLocalStream: () => MediaStream | null,
    localId = "user-z",
    onMediaStatus = vi.fn(),
    configuration: RTCConfiguration = {},
    shouldSendTo: (peerId: string) => boolean = () => true,
  ) {
    return new PeerManager({
      localId,
      configuration,
      getLocalStream,
      shouldSendTo,
      getVideoBitrate: () => 10_000_000,
      preferH264: () => true,
      send: vi.fn(),
      onRemoteStream: vi.fn(),
      onConnectionState: vi.fn(),
      onMediaStatus,
      onError: vi.fn(),
    });
  }

  it("adiciona tracks novas mesmo quando o peer já existia", async () => {
    let stream: MediaStream | null = null;
    const peers = manager(() => stream);
    await peers.handleIce("user-a", { candidate: "candidate:1" });
    const track = { kind: "video" } as MediaStreamTrack;
    stream = { getTracks: () => [track] } as MediaStream;

    await peers.offer("user-a");
    expect(created).toHaveLength(1);
    expect(created[0]!.senders.map((sender) => sender.track)).toEqual([track]);
  });

  it("só envia tracks locais a peers que shouldSendTo aceita", async () => {
    const track = { kind: "video" } as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as MediaStream;
    const allowed = new Set(["user-a"]);
    const peers = manager(() => stream, "user-z", vi.fn(), {}, (peerId) => allowed.has(peerId));

    await peers.offer("user-b");
    expect(created[0]!.senders).toHaveLength(0);

    await peers.offer("user-a");
    expect(created[1]!.senders.map((sender) => sender.track)).toEqual([track]);
  });

  it("não envia tracks locais em conexão criada por offer de peer fora da audiência", async () => {
    const track = { kind: "video" } as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as MediaStream;
    const peers = manager(() => stream, "user-z", vi.fn(), {}, () => false);

    await peers.handleDescription("user-a", "offer", "v=0 remote");
    expect(created[0]!.senders).toHaveLength(0);
    expect(created[0]!.localDescriptions.map((item) => item.type)).toEqual(["answer"]);
  });

  it("não envia tracks locais em conexão criada por ice de peer fora da audiência", async () => {
    const track = { kind: "video" } as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as MediaStream;
    const peers = manager(() => stream, "user-z", vi.fn(), {}, () => false);

    await peers.handleIce("user-a", { candidate: "candidate:1" });
    expect(created[0]!.senders).toHaveLength(0);
  });

  it("lista os peers abertos e esquece o peer fechado", async () => {
    const peers = manager(() => null);
    expect(peers.peerIds()).toEqual([]);
    await peers.handleIce("user-a", { candidate: "candidate:1" });
    await peers.handleIce("user-b", { candidate: "candidate:1" });
    expect(peers.peerIds()).toEqual(["user-a", "user-b"]);
    peers.close("user-a");
    expect(peers.peerIds()).toEqual(["user-b"]);
  });

  describe("stopSending", () => {
    const track = { kind: "video" } as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as MediaStream;
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const sentTracks = (connection: MockPeerConnection) =>
      connection.senders.filter((sender) => sender.track).map((sender) => sender.track);

    it("remove as faixas só da conexão alvo e renegocia", async () => {
      const send = vi.fn();
      const peers = new PeerManager({
        localId: "user-z",
        configuration: {},
        getLocalStream: () => stream,
        shouldSendTo: () => true,
        getVideoBitrate: () => 10_000_000,
        preferH264: () => true,
        send,
        onRemoteStream: vi.fn(),
        onConnectionState: vi.fn(),
        onMediaStatus: vi.fn(),
        onError: vi.fn(),
      });
      await peers.offer("user-a");
      await peers.offer("user-b");
      await peers.handleDescription("user-a", "answer", "v=0 answer");
      await peers.handleDescription("user-b", "answer", "v=0 answer");
      send.mockClear();

      await peers.stopSending("user-a");

      expect(sentTracks(created[0]!)).toEqual([]);
      expect(sentTracks(created[1]!)).toEqual([track]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ type: "offer", to: "user-a", sdp: "v=0 offer" });
      expect(created[0]!.localDescriptions.map((item) => item.type)).toEqual(["offer", "offer"]);
    });

    it("não faz nada para peer inexistente", async () => {
      const peers = manager(() => stream);
      await expect(peers.stopSending("user-a")).resolves.toBeUndefined();
      expect(created).toHaveLength(0);
    });

    it("executa offer e stopSending em série, sem deixar faixas enviadas", async () => {
      let allowed = true;
      const peers = manager(() => stream, "user-z", vi.fn(), {}, () => allowed);
      await peers.handleIce("user-a", { candidate: "candidate:1" });
      const connection = created[0]!;
      let release!: () => void;
      connection.offerGate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const offering = peers.offer("user-a");
      await tick();
      expect(sentTracks(connection)).toEqual([track]);
      allowed = false;
      const stopping = peers.stopSending("user-a");
      release();
      await Promise.all([offering, stopping]);
      await peers.handleDescription("user-a", "answer", "v=0 answer");

      await vi.waitFor(() => {
        expect(connection.localDescriptions.map((item) => item.type)).toEqual(["offer", "offer"]);
      });
      expect(sentTracks(connection)).toEqual([]);
    });

    it("renegocia depois da resposta quando a colisão impediu a oferta imediata", async () => {
      let allowed = true;
      const peers = manager(() => stream, "user-a", vi.fn(), {}, () => allowed);
      await peers.handleIce("user-z", { candidate: "candidate:1" });
      const connection = created[0]!;
      let release!: () => void;
      connection.offerGate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const offering = peers.offer("user-z");
      await tick();
      await peers.handleDescription("user-z", "offer", "v=0 remote");
      allowed = false;
      const stopping = peers.stopSending("user-z");
      release();
      await Promise.all([offering, stopping]);
      expect(connection.signalingState).toBe("have-local-offer");

      await peers.handleDescription("user-z", "answer", "v=0 answer");
      await vi.waitFor(() => {
        expect(connection.localDescriptions.map((item) => item.type)).toEqual(["offer", "offer"]);
      });
      expect(sentTracks(connection)).toEqual([]);
    });
  });

  it("faz rollback no lado polite durante colisão de offers", async () => {
    const peers = manager(() => null, "user-z");
    await peers.offer("user-a");
    await peers.handleDescription("user-a", "offer", "v=0 remote");
    expect(created[0]!.localDescriptions.map((item) => item.type)).toEqual([
      "offer",
      "rollback",
      "answer",
    ]);
  });

  it("fecha cada conexão apenas uma vez", async () => {
    const peers = manager(() => null);
    await peers.handleIce("user-a", { candidate: "candidate:1" });
    peers.closeAll();
    peers.closeAll();
    expect(created[0]!.closed).toBe(1);
  });

  it("renegocia e informa quando a track não entrega bytes", async () => {
    const onMediaStatus = vi.fn();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const peers = manager(() => null, "user-z", onMediaStatus);
    await peers.handleIce("user-a", { candidate: "candidate:1" });
    const connection = created[0]!;
    connection.connectionState = "connected";
    connection.ontrack?.call(
      connection as unknown as RTCPeerConnection,
      {
        track: { kind: "video", contentHint: "" } as MediaStreamTrack,
        streams: [{ getTracks: () => [] } as unknown as MediaStream],
      } as unknown as RTCTrackEvent,
    );
    now.mockReturnValue(10_000);

    await peers.collectHealth();
    expect(onMediaStatus).toHaveBeenCalledWith("user-a", "recovering-network");
    expect(connection.localDescriptions[connection.localDescriptions.length - 1]?.type).toBe("offer");
  });

  it("conta candidatos por tipo e força relay no primeiro failed", async () => {
    const peers = manager(() => null, "user-z", vi.fn(), {
      iceServers: [{ urls: "turn:turn.example.com:3478", username: "user", credential: "pass" }],
    });
    await peers.handleIce("user-a", {
      candidate: "candidate:1 1 udp 2122260223 1.2.3.4 9 typ host",
    });
    const [sample] = await peers.collectHealth();
    expect(sample?.remoteHostCandidates).toBe(1);
    expect(sample?.remoteRelayCandidates).toBe(0);

    const connection = created[0]!;
    connection.connectionState = "failed";
    connection.onconnectionstatechange?.call(
      connection as unknown as RTCPeerConnection,
      new Event("connectionstatechange"),
    );
    await vi.waitFor(() => {
      expect(connection.configuration.iceTransportPolicy).toBe("relay");
    });
  });
});
