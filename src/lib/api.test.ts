import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "./protocol";
import {
  UpdateRequiredError,
  createRoom,
  isValidRoomCode,
  leaveRoomSession,
  normalizeRoomCode,
  parseTelinhaUrl,
  signalingAuthentication,
  signalingUrl,
} from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("parseTelinhaUrl", () => {
  it("lê join com código e nome", () => {
    expect(parseTelinhaUrl("telinha://join/AB23CD?name=Ana")).toEqual({
      action: "join",
      code: "AB23CD",
      name: "Ana",
    });
  });

  it("normaliza um código válido e reconhece share", () => {
    expect(parseTelinhaUrl("telinha://join/ab-23-cd")).toEqual({
      action: "join",
      code: "AB23CD",
      name: undefined,
    });
    expect(parseTelinhaUrl("telinha://share")).toEqual({ action: "share" });
  });

  it("ignora protocolos estranhos", () => {
    expect(parseTelinhaUrl("https://example.com")).toBeNull();
  });
});

describe("código de sala", () => {
  it("aceita somente seis caracteres do alfabeto Telinha", () => {
    expect(normalizeRoomCode(" ab-23-cd ")).toBe("AB23CD");
    expect(isValidRoomCode("AB23CD")).toBe(true);
    expect(isValidRoomCode("AB12CD")).toBe(false);
    expect(isValidRoomCode("D123456789012345678")).toBe(false);
  });

  it("não abre um convite com código inválido", () => {
    expect(parseTelinhaUrl("telinha://join/AB12")).toEqual({ action: "open" });
  });
});

describe("signalingUrl", () => {
  const session = {
    code: "AB12CD",
    participantId: "user-1",
    token: "secret",
    displayName: "Ana",
    wsUrl: "ws://localhost:3001/ws",
    protocolVersion: 2,
  } as const;

  it("autentica clientes novos sem expor identidade ou token na URL", () => {
    const url = signalingUrl({
      ...session,
      wsAuthMode: "message",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("token")).toBe(false);
    expect(parsed.searchParams.has("participantId")).toBe(false);
    expect(parsed.searchParams.has("code")).toBe(false);
    expect(parsed.searchParams.get("protocolVersion")).toBe("2");
    expect(signalingAuthentication(session)).toEqual({
      type: "authenticate",
      code: "AB12CD",
      participantId: "user-1",
      token: "secret",
      protocolVersion: 2,
      appVersion: APP_VERSION,
    });
  });

  it("mantém a query antiga para sessões emitidas por servidores legados", () => {
    const url = signalingUrl({
      ...session,
      wsAuthMode: "query",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("token")).toBe("secret");
    expect(parsed.searchParams.get("participantId")).toBe("user-1");
    expect(parsed.searchParams.get("code")).toBe("AB12CD");
  });

  it("preserva metadados públicos da conexão", () => {
    const url = signalingUrl({
      code: "AB12CD",
      participantId: "user-1",
      token: "secret",
      displayName: "Ana",
      wsUrl: "ws://localhost:3001/ws",
      protocolVersion: 2,
      wsAuthMode: "message",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("protocolVersion")).toBe("2");
    expect(parsed.searchParams.get("appVersion")).toBe(APP_VERSION);
    expect(parsed.searchParams.has("name")).toBe(false);
  });
});

describe("compatibilidade da API", () => {
  it("envia metadados e traduz HTTP 426", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: "UPDATE_REQUIRED", error: "Atualize o Telinha." }),
        { status: 426 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createRoom("Ana")).rejects.toBeInstanceOf(UpdateRequiredError);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      displayName: "Ana",
      protocolVersion: 2,
      appVersion: APP_VERSION,
    });
  });

  it("confirma saída com token e requisição keepalive", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await leaveRoomSession({
      code: "AB12CD",
      participantId: "user-1",
      token: "secret",
      displayName: "Ana",
      wsUrl: "ws://localhost:3001/ws",
      protocolVersion: 2,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/rooms/AB12CD/participants/user-1");
    expect(init).toMatchObject({ method: "DELETE", keepalive: true });
    expect(init.headers).toEqual({ Authorization: "Bearer secret" });
  });
});
