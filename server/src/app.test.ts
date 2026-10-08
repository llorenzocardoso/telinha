import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createTelinhaServer, type TelinhaServer } from "./app.js";
import { CURRENT_PROTOCOL_VERSION } from "./protocol.js";

interface RoomSession {
  code: string;
  participantId: string;
  token: string;
  displayName: string;
  wsUrl: string;
  protocolVersion?: number;
  wsAuthMode?: "message" | "query";
}

async function listen(publicWsUrl?: string): Promise<{ server: TelinhaServer; base: string }> {
  const server = createTelinhaServer({ disableRateLimit: true, publicWsUrl });
  await new Promise<void>((resolve) => {
    server.http.listen(0, "127.0.0.1", resolve);
  });
  const address = server.http.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function postJson(url: string, body: unknown, includeProtocol = true) {
  const requestBody =
    includeProtocol && body && typeof body === "object" && !Array.isArray(body)
      ? { protocolVersion: CURRENT_PROTOCOL_VERSION, ...body }
      : body;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const data = (await response.json()) as Record<string, unknown>;
  return { response, data };
}

function signalingUrl(session: RoomSession): string {
  const url = new URL(session.wsUrl);
  url.searchParams.set("code", session.code);
  url.searchParams.set("participantId", session.participantId);
  url.searchParams.set("token", session.token);
  if (session.protocolVersion) {
    url.searchParams.set("protocolVersion", String(session.protocolVersion));
  }
  return url.toString();
}

function authenticatedSocket(
  session: RoomSession,
  origin?: string,
): { socket: WebSocket; url: URL } {
  const url = new URL(session.wsUrl);
  url.searchParams.set(
    "protocolVersion",
    String(session.protocolVersion ?? CURRENT_PROTOCOL_VERSION),
  );
  const socket = new WebSocket(url, origin ? { headers: { Origin: origin } } : undefined);
  socket.once("open", () => {
    socket.send(
      JSON.stringify({
        type: "authenticate",
        code: session.code,
        participantId: session.participantId,
        token: session.token,
        protocolVersion: session.protocolVersion ?? CURRENT_PROTOCOL_VERSION,
        appVersion: "0.2.0",
      }),
    );
  });
  return { socket, url };
}

function waitMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 3000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(raw)) as Record<string, unknown>);
    });
    ws.once("error", reject);
  });
}

function waitForType(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${type}`)), 3000);
    function onMessage(raw: WebSocket.RawData) {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(data);
    }
    ws.on("message", onMessage);
    ws.once("error", reject);
  });
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting close")), 3000);
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.once("error", () => undefined);
  });
}

describe("telinha server", () => {
  let running: TelinhaServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it("cria sala com token e rejeita join inexistente", async () => {
    const { server, base } = await listen();
    running = server;

    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    expect(created.response.status).toBe(200);
    expect(created.data.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(created.data.token).toEqual(expect.any(String));
    expect(created.data.wsAuthMode).toBe("message");

    const missing = await postJson(`${base}/rooms/ZZZZZZ/join`, { displayName: "Bia" });
    expect(missing.response.status).toBe(404);

    const joined = await postJson(`${base}/rooms/${created.data.code}/join`, { displayName: "Bia" });
    expect(joined.response.status).toBe(200);
    expect(joined.data.token).not.toBe(created.data.token);
  });

  it("serve a página de convite para um código válido e 404 para inválido", async () => {
    const { server, base } = await listen();
    running = server;

    const valid = await fetch(`${base}/j/ab-23-cd`);
    expect(valid.status).toBe(200);
    expect(valid.headers.get("content-type")).toContain("text/html");
    expect(await valid.text()).toContain('href="telinha://join/AB23CD"');

    const invalid = await fetch(`${base}/j/AB12CD`);
    expect(invalid.status).toBe(404);
    expect(await invalid.text()).not.toContain("telinha://join");
  });

  it("rejeita código personalizado na criação", async () => {
    const { server, base } = await listen();
    running = server;

    const custom = await postJson(`${base}/rooms`, {
      displayName: "Ana",
      code: "D1198789764279717921",
    });
    expect(custom.response.status).toBe(400);
    expect(custom.data.error).toBe("Código personalizado não é suportado.");
  });

  it("usa WS_PUBLIC_URL fixa quando configurada", async () => {
    const { server, base } = await listen("https://telinha-server.onrender.com");
    running = server;
    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    expect(created.data.wsUrl).toBe("wss://telinha-server.onrender.com/ws");
  });

  it("rejeita cliente sem protocolo e aceita a versão atual", async () => {
    const server = createTelinhaServer({ disableRateLimit: true, minProtocolVersion: 2 });
    running = server;
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const address = server.http.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const legacy = await postJson(`${base}/rooms`, { displayName: "Ana" }, false);
    expect(legacy.response.status).toBe(426);
    expect(legacy.data.code).toBe("UPDATE_REQUIRED");

    const current = await postJson(`${base}/rooms`, { displayName: "Ana", protocolVersion: 2 });
    expect(current.response.status).toBe(200);
    expect(current.data.protocolVersion).toBe(2);

    const session = current.data as unknown as RoomSession;
    const legacyUrl = new URL(signalingUrl(session));
    legacyUrl.searchParams.delete("protocolVersion");
    const legacySocket = new WebSocket(legacyUrl);
    await expect(waitMessage(legacySocket)).resolves.toMatchObject({
      type: "error",
      code: "update-required",
    });
    legacySocket.close();
  });

  it("recusa WebSocket sem token e aceita o assento HTTP", async () => {
    const { server, base } = await listen();
    running = server;
    const { data } = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const session = data as unknown as RoomSession;

    const bad = new WebSocket(`${session.wsUrl}?code=${session.code}&participantId=${session.participantId}`);
    const denied = await waitMessage(bad);
    expect(denied.type).toBe("error");
    bad.close();

    const good = new WebSocket(signalingUrl(session));
    const hello = await waitMessage(good);
    expect(hello.type).toBe("hello");
    good.close();
  });

  it("autentica por mensagem sem colocar identidade ou token na URL", async () => {
    const { server, base } = await listen();
    running = server;
    const { data } = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const session = data as unknown as RoomSession;

    const { socket, url } = authenticatedSocket(session);
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.searchParams.has("participantId")).toBe(false);
    expect(url.searchParams.has("code")).toBe(false);
    const hello = await waitMessage(socket);
    expect(hello.type, JSON.stringify(hello)).toBe("hello");
    socket.close();
  });

  it("restringe CORS e a origem do WebSocket sem bloquear Tauri", async () => {
    const { server, base } = await listen();
    running = server;

    const allowed = await fetch(`${base}/health`, {
      headers: { Origin: "http://tauri.localhost" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://tauri.localhost",
    );

    const blocked = await fetch(`${base}/health`, {
      headers: { Origin: "https://example.invalid" },
    });
    expect(blocked.headers.has("access-control-allow-origin")).toBe(false);

    const { data } = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const session = data as unknown as RoomSession;
    const denied = authenticatedSocket(session, "https://example.invalid").socket;
    await expect(waitMessage(denied)).resolves.toMatchObject({
      type: "error",
      code: "origin-not-allowed",
    });
    denied.close();

    const accepted = authenticatedSocket(session, "http://tauri.localhost").socket;
    const hello = await waitMessage(accepted);
    expect(hello.type, JSON.stringify(hello)).toBe("hello");
    accepted.close();
  });

  it("remove participante por HTTP com token e mantém a saída idempotente", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, {
      displayName: "Bia",
    });
    const viewerSession = viewerHttp.data as unknown as RoomSession;
    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await Promise.all([waitForType(host, "hello"), waitForType(viewer, "hello")]);

    const denied = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: "Bearer errado" } },
    );
    expect(denied.status).toBe(403);

    const leftMessage = waitForType(host, "participant-left");
    const removed = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${viewerSession.token}` } },
    );
    expect(removed.status).toBe(204);
    await expect(leftMessage).resolves.toMatchObject({
      participantId: viewerSession.participantId,
    });

    const repeated = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${viewerSession.token}` } },
    );
    expect(repeated.status).toBe(204);
    host.close();
  });

  it("remove também uma identidade estacionada após queda do WebSocket", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, {
      displayName: "Bia",
    });
    const viewerSession = viewerHttp.data as unknown as RoomSession;
    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await Promise.all([waitForType(host, "hello"), waitForType(viewer, "hello")]);
    const offline = waitForType(host, "participant-presence");
    viewer.close();
    await offline;

    const leftMessage = waitForType(host, "participant-left");
    const removed = await fetch(
      `${base}/rooms/${viewerSession.code}/participants/${viewerSession.participantId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${viewerSession.token}` } },
    );
    expect(removed.status).toBe(204);
    await expect(leftMessage).resolves.toMatchObject({
      participantId: viewerSession.participantId,
    });
    host.close();
  });

  it("avisa o host quando alguém começa a assistir", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(viewer, "hello");

    host.send(JSON.stringify({ type: "share-started" }));
    const live = await waitForType(viewer, "share-started");
    expect(live.type).toBe("share-started");

    const noticed = waitForType(host, "watch-started");
    viewer.send(JSON.stringify({ type: "watch-started", to: hostSession.participantId }));
    const payload = await noticed;
    expect(payload.from).toBe(viewerSession.participantId);
    expect(payload.to).toBe(hostSession.participantId);

    host.close();
    viewer.close();
  });

  it("encerra WebSocket que excede o limite de sinalização", async () => {
    const { server, base } = await listen();
    running = server;
    const { data } = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const session = data as unknown as RoomSession;
    const socket = new WebSocket(signalingUrl(session));
    await waitForType(socket, "hello");
    const closing = waitClose(socket);
    socket.send("x".repeat(64 * 1024 + 1));
    await expect(closing).resolves.toBe(1009);
  });

  it("não divulga espectadores para terceiros", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;
    const thirdHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Cris" });
    const thirdSession = thirdHttp.data as unknown as RoomSession;
    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    const third = new WebSocket(signalingUrl(thirdSession));
    await Promise.all([
      waitForType(host, "hello"),
      waitForType(viewer, "hello"),
      waitForType(third, "hello"),
    ]);
    host.send(JSON.stringify({ type: "share-started" }));
    await waitForType(viewer, "share-started");

    let leaked = false;
    third.on("message", (raw) => {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type === "watch-started") leaked = true;
    });
    const noticed = waitForType(host, "watch-started");
    viewer.send(JSON.stringify({ type: "watch-started", to: hostSession.participantId }));
    await noticed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leaked).toBe(false);
    host.close();
    viewer.close();
    third.close();
  });

  it("substitui o WebSocket se o mesmo participante reconectar ainda admitido", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const first = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(first, "hello");

    host.send(JSON.stringify({ type: "share-started" }));
    await waitForType(first, "share-started");

    let viewerLeft = false;
    host.on("message", (raw) => {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type === "participant-left") {
        viewerLeft = true;
      }
    });

    const second = new WebSocket(signalingUrl(viewerSession));
    await waitForType(second, "hello");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(viewerLeft).toBe(false);

    const noticed = waitForType(host, "watch-started");
    second.send(JSON.stringify({ type: "watch-started", to: hostSession.participantId }));
    const payload = await noticed;
    expect(payload.from).toBe(viewerSession.participantId);

    first.close();
    second.close();
    host.close();
  });

  it("mantém a sala e o viewer depois de uma queda curta do WebSocket", async () => {
    const { server, base } = await listen();
    running = server;
    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(viewer, "hello");
    host.send(JSON.stringify({ type: "share-started" }));
    await waitForType(viewer, "share-started");

    let viewerLeft = false;
    host.on("message", (raw) => {
      const data = JSON.parse(String(raw)) as Record<string, unknown>;
      if (data.type === "participant-left") {
        viewerLeft = true;
      }
    });

    const disconnecting = waitForType(host, "participant-presence");
    viewer.close();
    const disconnected = await disconnecting;
    expect(disconnected).toMatchObject({
      participantId: viewerSession.participantId,
      connected: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(viewerLeft).toBe(false);

    const presence = waitForType(host, "participant-presence");
    const again = new WebSocket(signalingUrl(viewerSession));
    const hello = await waitForType(again, "hello");
    expect(hello.type).toBe("hello");
    await expect(presence).resolves.toMatchObject({
      participantId: viewerSession.participantId,
      connected: true,
    });
    expect(viewerLeft).toBe(false);

    const rejoined = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Cris" });
    expect(rejoined.response.status).toBe(200);

    again.close();
    host.close();
  });

  it("avisa saída só depois da graça de reconexão", async () => {
    const server = createTelinhaServer({
      disableRateLimit: true,
      reconnectGraceMs: 80,
      cleanupIntervalMs: 20,
    });
    running = server;
    await new Promise<void>((resolve) => {
      server.http.listen(0, "127.0.0.1", resolve);
    });
    const address = server.http.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const hostHttp = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const hostSession = hostHttp.data as unknown as RoomSession;
    const viewerHttp = await postJson(`${base}/rooms/${hostSession.code}/join`, { displayName: "Bia" });
    const viewerSession = viewerHttp.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    const viewer = new WebSocket(signalingUrl(viewerSession));
    await waitForType(host, "hello");
    await waitForType(viewer, "hello");

    viewer.close();
    const left = await waitForType(host, "participant-left");
    expect(left.participantId).toBe(viewerSession.participantId);
    host.close();
  });

  it("preserva o share do host durante uma reconexão", async () => {
    const { server, base } = await listen();
    running = server;
    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    expect(created.response.status).toBe(200);
    const hostSession = created.data as unknown as RoomSession;

    const host = new WebSocket(signalingUrl(hostSession));
    await waitForType(host, "hello");
    host.send(JSON.stringify({ type: "share-started" }));
    host.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const again = new WebSocket(signalingUrl(hostSession));
    const hello = await waitForType(again, "hello") as { you?: { sharing?: boolean } };
    expect(hello.you?.sharing).toBe(true);
    again.close();

  });

  it("publica a versão mínima do app", async () => {
    const server = createTelinhaServer({ disableRateLimit: true, minAppVersion: "0.3.0" });
    running = server;
    await new Promise<void>((resolve) => {
      server.http.listen(0, "127.0.0.1", resolve);
    });
    const address = server.http.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/app-config`);
    await expect(response.json()).resolves.toEqual({ minAppVersion: "0.3.0", minProtocolVersion: 2 });
  });

  it("entrega os iceServers da sessão e renova com o token do participante", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          iceServers: [{ urls: "turn:turn.example.com:3478", username: "user", credential: "secret" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const server = createTelinhaServer({
      disableRateLimit: true,
      turn: { keyId: "key", apiToken: "token", fetchImpl },
    });
    running = server;
    await new Promise<void>((resolve) => {
      server.http.listen(0, "127.0.0.1", resolve);
    });
    const address = server.http.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const created = await postJson(`${base}/rooms`, { displayName: "Ana" });
    const session = created.data as unknown as RoomSession & { iceServers?: { username?: string }[] };
    expect(session.iceServers?.some((server) => server.username === "user")).toBe(true);

    const denied = await fetch(
      `${base}/rooms/${session.code}/ice-servers?participantId=${session.participantId}`,
    );
    expect(denied.status).toBe(403);

    const renewed = await fetch(
      `${base}/rooms/${session.code}/ice-servers?participantId=${encodeURIComponent(session.participantId)}`,
      { headers: { Authorization: `Bearer ${session.token}` } },
    );
    const body = (await renewed.json()) as { iceServers?: { username?: string }[] };
    expect(renewed.status).toBe(200);
    expect(body.iceServers?.some((server) => server.username === "user")).toBe(true);
  });
});
