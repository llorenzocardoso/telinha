import { describe, expect, it, vi } from "vitest";
import { createIceServerProvider, parseIceServers, PUBLIC_STUN_SERVERS } from "./turn.js";

const TURN_RESPONSE = {
  iceServers: [
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
      username: "user",
      credential: "secret",
    },
  ],
};

describe("parseIceServers", () => {
  it("ignora entradas sem urls", () => {
    expect(parseIceServers({ iceServers: [{ username: "user" }, { urls: "stun:stun.example.com:3478" }] })).toEqual([
      { urls: "stun:stun.example.com:3478" },
    ]);
  });
});

describe("createIceServerProvider", () => {
  it("entrega só STUN quando a Cloudflare não está configurada", async () => {
    const provider = createIceServerProvider();
    await expect(provider.getIceServers()).resolves.toEqual(PUBLIC_STUN_SERVERS);
  });

  it("busca credenciais na Cloudflare e reutiliza o cache", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TURN_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    let now = 1_000;
    const provider = createIceServerProvider({
      keyId: "key",
      apiToken: "token",
      ttlSeconds: 86_400,
      fetchImpl,
      now: () => now,
    });

    const first = await provider.getIceServers();
    now += 60_000;
    const second = await provider.getIceServers();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/turn/keys/key/credentials/generate-ice-servers");
    expect(first.some((server) => server.username === "user")).toBe(true);
    expect(first.some((server) => String(server.urls).includes("stun.l.google.com"))).toBe(true);
    expect(second).toEqual(first);
  });

  it("entrega só STUN e não chama a Cloudflare com a flag desligada", async () => {
    const fetchImpl = vi.fn();
    const provider = createIceServerProvider({
      keyId: "key",
      apiToken: "token",
      fetchImpl,
      isEnabled: () => false,
    });

    await expect(provider.getIceServers()).resolves.toEqual(PUBLIC_STUN_SERVERS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("volta a usar TURN quando a flag é religada", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TURN_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    let enabled = false;
    const provider = createIceServerProvider({
      keyId: "key",
      apiToken: "token",
      fetchImpl,
      isEnabled: () => enabled,
    });

    await expect(provider.getIceServers()).resolves.toEqual(PUBLIC_STUN_SERVERS);
    enabled = true;
    await expect(provider.getIceServers()).resolves.toContainEqual(
      expect.objectContaining({ username: "user" }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cai para STUN quando a Cloudflare falha", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const provider = createIceServerProvider({
      keyId: "key",
      apiToken: "token",
      fetchImpl,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(provider.getIceServers()).resolves.toEqual(PUBLIC_STUN_SERVERS);
    error.mockRestore();
  });
});
