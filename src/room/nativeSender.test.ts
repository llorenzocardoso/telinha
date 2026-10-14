import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSignal } from "../lib/protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const bus = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  unlistened: [] as string[],
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    bus.handlers.set(name, handler);
    return () => {
      bus.unlistened.push(name);
      bus.handlers.delete(name);
    };
  }),
}));

const { invoke } = await import("@tauri-apps/api/core");
const { NativeSender } = await import("./nativeSender");
const mockedInvoke = vi.mocked(invoke);

const quality = {
  fps: 60,
  maxWidth: 1920,
  maxHeight: 1080,
  maxBitrate: 10_000_000,
  includeAudio: false,
  preferH264: true,
};

function emit(name: string, payload: unknown) {
  bus.handlers.get(name)?.({ payload });
}

function setup() {
  const sent: ClientSignal[] = [];
  const onEnded = vi.fn();
  const sender = new NativeSender({
    send: (payload) => sent.push(payload),
    iceServers: () => [{ urls: "stun:example.test" }],
    onEnded,
  });
  return { sender, sent, onEnded };
}

beforeEach(() => {
  bus.handlers.clear();
  bus.unlistened.length = 0;
  mockedInvoke.mockReset().mockImplementation(async (command) => {
    if (command === "native_share_start") return { width: 1920, height: 1080, encoder: "NVENC" };
    if (command === "native_share_offer") return "v=0 offer";
    return undefined;
  });
});

describe("NativeSender", () => {
  it("inicia a captura com a qualidade escolhida", async () => {
    const { sender } = setup();
    const info = await sender.start("window:10", quality);
    expect(info.width).toBe(1920);
    expect(sender.isActive).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("native_share_start", {
      id: "window:10",
      maxHeight: 1080,
      fps: 60,
      maxMbps: 10,
      includeAudio: false,
      relayCapKbps: null,
    });
  });

  it("pede o som do computador quando a pessoa o liga", async () => {
    const { sender } = setup();
    await sender.start("screen:1", { ...quality, includeAudio: true });
    expect(mockedInvoke).toHaveBeenCalledWith(
      "native_share_start",
      expect.objectContaining({ includeAudio: true }),
    );
  });

  it("avisa quando o som não pôde ser capturado, sem encerrar a live", async () => {
    const onAudioError = vi.fn();
    const sender = new NativeSender({
      send: () => undefined,
      iceServers: () => [],
      onEnded: vi.fn(),
      onAudioError,
    });
    await sender.start("screen:1", { ...quality, includeAudio: true });
    emit("native-share-audio-error", { message: "PID do aplicativo não encontrado" });
    expect(onAudioError).toHaveBeenCalledWith("PID do aplicativo não encontrado");
    expect(sender.isActive).toBe(true);
  });

  it("Original (sem limite de altura) vai como 0", async () => {
    const { sender } = setup();
    await sender.start("screen:1", { ...quality, maxHeight: undefined, maxBitrate: 24_000_000 });
    expect(mockedInvoke).toHaveBeenCalledWith(
      "native_share_start",
      expect.objectContaining({ maxHeight: 0, maxMbps: 24 }),
    );
  });

  it("devolve o motivo e solta os ouvintes quando a captura não inicia", async () => {
    mockedInvoke.mockRejectedValue("A janela não existe mais");
    const { sender } = setup();
    await expect(sender.start("window:10", quality)).rejects.toThrow("A janela não existe mais");
    expect(sender.isActive).toBe(false);
    expect(bus.handlers.size).toBe(0);
  });

  it("manda a oferta pelo canal share-out e só depois os candidatos que vieram antes", async () => {
    const { sender, sent } = setup();
    await sender.start("window:10", quality);
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "native_share_offer") {
        // O Rust já gerou candidatos antes de a oferta voltar para o JS.
        emit("native-share-ice", { peerId: "peer-a", candidate: "candidate:1", sdpMid: "0", sdpMlineIndex: 0 });
        return "v=0 offer";
      }
      return undefined;
    });
    await sender.offerTo("peer-a");

    expect(sent.map((signal) => signal.type)).toEqual(["offer", "ice"]);
    expect(sent[0]).toEqual({ type: "offer", to: "peer-a", sdp: "v=0 offer", channel: "share-out" });
    expect(sent[1]).toMatchObject({
      type: "ice",
      to: "peer-a",
      channel: "share-out",
      candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
    });

    // Depois da oferta, os candidatos saem na hora.
    emit("native-share-ice", { peerId: "peer-a", candidate: "candidate:2", sdpMid: "0", sdpMlineIndex: 0 });
    expect(sent).toHaveLength(3);
  });

  it("passa os servidores ICE da sala ao Rust", async () => {
    const { sender } = setup();
    await sender.start("window:10", quality);
    await sender.offerTo("peer-a", true);
    expect(mockedInvoke).toHaveBeenCalledWith("native_share_offer", {
      peerId: "peer-a",
      iceServers: [{ urls: "stun:example.test" }],
      relayOnly: true,
    });
  });

  it("não oferece nada sem uma captura ativa", async () => {
    const { sender, sent } = setup();
    await sender.offerTo("peer-a");
    expect(sent).toEqual([]);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("encaminha resposta e ICE só de quem recebeu oferta", async () => {
    const { sender } = setup();
    await sender.start("window:10", quality);
    await sender.handleAnswer("stranger", "v=0 answer");
    await sender.handleIce("stranger", { candidate: "candidate:9" });
    expect(mockedInvoke).not.toHaveBeenCalledWith("native_share_answer", expect.anything());

    await sender.offerTo("peer-a");
    await sender.handleAnswer("peer-a", "v=0 answer");
    await sender.handleIce("peer-a", { candidate: "candidate:3", sdpMid: "0", sdpMLineIndex: 1 });
    expect(mockedInvoke).toHaveBeenCalledWith("native_share_answer", { peerId: "peer-a", sdp: "v=0 answer" });
    expect(mockedInvoke).toHaveBeenCalledWith("native_share_ice", {
      peerId: "peer-a",
      candidate: "candidate:3",
      sdpMid: "0",
      sdpMlineIndex: 1,
    });
  });

  it("fecha a conexão do espectador uma única vez", async () => {
    const { sender } = setup();
    await sender.start("window:10", quality);
    await sender.offerTo("peer-a");
    sender.stopViewer("peer-a");
    sender.stopViewer("peer-a");
    const stops = mockedInvoke.mock.calls.filter(([command]) => command === "native_share_viewer_stop");
    expect(stops).toHaveLength(1);
    expect(sender.hasViewer("peer-a")).toBe(false);
  });

  it("sabe quais espectadores estão conectados", async () => {
    const { sender } = setup();
    await sender.start("window:10", quality);
    await sender.offerTo("peer-a");
    expect(sender.isConnected("peer-a")).toBe(false);
    emit("native-share-state", { peerId: "peer-a", state: "connected" });
    expect(sender.isConnected("peer-a")).toBe(true);
    emit("native-share-state", { peerId: "peer-a", state: "disconnected" });
    expect(sender.isConnected("peer-a")).toBe(false);

    emit("native-share-state", { peerId: "peer-a", state: "connected" });
    await sender.offerTo("peer-a");
    expect(sender.isConnected("peer-a")).toBe(false);
  });

  it("passa o limite de banda do relay ao Rust", async () => {
    const sender = new NativeSender({
      send: () => undefined,
      iceServers: () => [],
      relayCapKbps: () => 2500,
      onEnded: vi.fn(),
    });
    await sender.start("screen:1", quality);
    expect(mockedInvoke).toHaveBeenCalledWith(
      "native_share_start",
      expect.objectContaining({ relayCapKbps: 2500 }),
    );
  });

  describe("quando a conexão de um espectador cai", () => {
    const turn = [{ urls: ["turn:turn.example.test:3478"], username: "u", credential: "c" }];

    function recovering(extra: Partial<ConstructorParameters<typeof NativeSender>[0]> = {}) {
      const sent: ClientSignal[] = [];
      const gaveUp = vi.fn();
      const diagnostics: string[] = [];
      const sender = new NativeSender({
        send: (payload) => sent.push(payload),
        iceServers: () => turn,
        refreshIceServers: async () => [{ urls: "stun:fresh.example.test" }, ...turn],
        onEnded: vi.fn(),
        onViewerGaveUp: gaveUp,
        onDiagnostic: (event) => diagnostics.push(event),
        ...extra,
      });
      return { sender, sent, gaveUp, diagnostics };
    }

    const offers = () =>
      mockedInvoke.mock.calls.filter(([command]) => command === "native_share_offer");
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("refaz a oferta com credenciais novas e, na segunda queda, força o relay", async () => {
      const { sender, sent } = recovering();
      await sender.start("window:10", quality);
      await sender.offerTo("peer-a");
      expect(offers()).toHaveLength(1);

      emit("native-share-state", { peerId: "peer-a", state: "failed" });
      await flush();
      expect(offers()).toHaveLength(2);
      expect(offers()[1]![1]).toMatchObject({
        peerId: "peer-a",
        relayOnly: false,
        iceServers: [{ urls: "stun:fresh.example.test" }, ...turn],
      });

      emit("native-share-state", { peerId: "peer-a", state: "failed" });
      await flush();
      expect(offers()).toHaveLength(3);
      expect(offers()[2]![1]).toMatchObject({ relayOnly: true });
      expect(sent.filter((signal) => signal.type === "offer")).toHaveLength(3);
    });

    it("não força o relay quando a sala não tem TURN", async () => {
      const { sender } = recovering({ iceServers: () => [{ urls: "stun:a.example.test" }], refreshIceServers: async () => null });
      await sender.start("window:10", quality);
      await sender.offerTo("peer-a");
      emit("native-share-state", { peerId: "peer-a", state: "failed" });
      await flush();
      emit("native-share-state", { peerId: "peer-a", state: "failed" });
      await flush();
      expect(offers().map(([, args]) => (args as { relayOnly: boolean }).relayOnly)).toEqual([
        false,
        false,
        false,
      ]);
    });

    it("desiste depois das tentativas e avisa", async () => {
      const { sender, gaveUp } = recovering();
      await sender.start("window:10", quality);
      await sender.offerTo("peer-a");
      for (let i = 0; i < 3; i++) {
        emit("native-share-state", { peerId: "peer-a", state: "failed" });
        await flush();
      }
      expect(offers()).toHaveLength(3);
      expect(gaveUp).toHaveBeenCalledWith("peer-a");
    });

    it("conectar zera as tentativas", async () => {
      const { sender, gaveUp } = recovering();
      await sender.start("window:10", quality);
      await sender.offerTo("peer-a");
      for (let round = 0; round < 3; round++) {
        emit("native-share-state", { peerId: "peer-a", state: "failed" });
        await flush();
        emit("native-share-state", { peerId: "peer-a", state: "connected" });
      }
      expect(gaveUp).not.toHaveBeenCalled();
    });

    it("não refaz a conexão de quem já saiu", async () => {
      const { sender } = recovering();
      await sender.start("window:10", quality);
      await sender.offerTo("peer-a");
      sender.stopViewer("peer-a");
      emit("native-share-state", { peerId: "peer-a", state: "failed" });
      await flush();
      expect(offers()).toHaveLength(1);
    });
  });

  it("monta as amostras de saúde com rota e atraso de cada espectador", async () => {
    const { sender } = setup();
    await sender.start("window:10", quality);
    await sender.offerTo("peer-a");
    await sender.offerTo("peer-b");
    emit("native-share-state", { peerId: "peer-a", state: "connected" });
    emit("native-share-viewer", { peerId: "peer-a", relay: true, rttMs: 80, availableKbps: 3000 });
    const samples = sender.healthSamples();
    expect(samples).toContainEqual({
      peerId: "peer-a",
      channel: "native-share",
      connectionState: "connected",
      roundTripTimeMs: 80,
      candidateType: "relay",
    });
    expect(samples).toContainEqual({
      peerId: "peer-b",
      channel: "native-share",
      connectionState: "new",
      roundTripTimeMs: undefined,
      candidateType: undefined,
    });
  });

  it("avisa quando a fonte some e para tudo com stop()", async () => {
    const { sender, onEnded } = setup();
    await sender.start("window:10", quality);
    emit("native-share-ended", { reason: "source-closed", message: null });
    expect(onEnded).toHaveBeenCalledWith("source-closed", null);

    await sender.stop();
    await sender.stop();
    const stops = mockedInvoke.mock.calls.filter(([command]) => command === "native_share_stop");
    expect(stops).toHaveLength(1);
    expect(sender.isActive).toBe(false);
    expect(bus.unlistened.sort()).toEqual([
      "native-share-audio-error",
      "native-share-ended",
      "native-share-ice",
      "native-share-state",
      "native-share-viewer",
    ]);
  });
});
