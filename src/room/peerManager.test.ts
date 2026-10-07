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
  senders: { track: MediaStreamTrack; getParameters: () => RTCRtpSendParameters; setParameters: () => Promise<void> }[] = [];
  localDescriptions: RTCSessionDescriptionInit[] = [];
  stats = new Map<string, Record<string, unknown>>();
  closed = 0;

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
  removeTrack(sender: RTCRtpSender) {
    this.senders = this.senders.filter((item) => (item as unknown as RTCRtpSender) !== sender);
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
  ) {
    return new PeerManager({
      localId,
      configuration,
      getLocalStreams: () => {
        const stream = getLocalStream();
        return stream ? [stream] : [];
      },
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

  it("envia tela e câmera juntas e remove só as tracks pedidas", async () => {
    const screen = { kind: "video" } as MediaStreamTrack;
    const camera = { kind: "video" } as MediaStreamTrack;
    const peers = new PeerManager({
      localId: "user-z",
      configuration: {},
      getLocalStreams: () => [
        { getTracks: () => [screen] } as MediaStream,
        { getTracks: () => [camera] } as MediaStream,
      ],
      getVideoBitrate: () => 10_000_000,
      preferH264: () => true,
      send: vi.fn(),
      onRemoteStream: vi.fn(),
      onConnectionState: vi.fn(),
      onMediaStatus: vi.fn(),
      onError: vi.fn(),
    });
    await peers.offer("user-a");
    expect(created[0]!.senders.map((sender) => sender.track)).toEqual([screen, camera]);

    peers.removeLocalTracks([camera]);
    expect(created[0]!.senders.map((sender) => sender.track)).toEqual([screen]);
  });

  it("segura o segundo offer até o answer do primeiro chegar", async () => {
    const peers = manager(() => null);
    await peers.offer("user-a");
    await peers.offer("user-a");
    const connection = created[0]!;
    expect(connection.localDescriptions.map((item) => item.type)).toEqual(["offer"]);

    await peers.handleDescription("user-a", "answer", "v=0 answer");
    expect(connection.localDescriptions.map((item) => item.type)).toEqual(["offer", "offer"]);
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
