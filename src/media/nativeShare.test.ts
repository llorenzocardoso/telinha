// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const runtime = vi.hoisted(() => ({ tauri: true }));
vi.mock("../lib/runtime", () => ({ isTauriRuntime: () => runtime.tauri }));

const { invoke } = await import("@tauri-apps/api/core");
const {
  NATIVE_SHARE_KEY,
  groupSources,
  isNativeSourceId,
  loadThumbnails,
  nativeShareFlag,
  setNativeShareFlag,
  shouldFallBackToWindowsPicker,
} = await import("./nativeShare");
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  localStorage.clear();
  runtime.tauri = true;
  mockedInvoke.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("nativeShareFlag", () => {
  it("fica desligado por padrão", () => {
    expect(nativeShareFlag()).toBe(false);
  });

  it("liga pelo localStorage no app desktop", () => {
    localStorage.setItem(NATIVE_SHARE_KEY, "1");
    expect(nativeShareFlag()).toBe(true);
  });

  it("liga pela variável de ambiente", () => {
    vi.stubEnv("VITE_NATIVE_SHARE", "1");
    expect(nativeShareFlag()).toBe(true);
  });

  it("nunca liga no navegador, que não tem a captura em Rust", () => {
    runtime.tauri = false;
    localStorage.setItem(NATIVE_SHARE_KEY, "1");
    vi.stubEnv("VITE_NATIVE_SHARE", "1");
    expect(nativeShareFlag()).toBe(false);
  });
});

describe("setNativeShareFlag", () => {
  it("guarda a escolha e o interruptor a lê de volta", () => {
    setNativeShareFlag(true);
    expect(localStorage.getItem(NATIVE_SHARE_KEY)).toBe("1");
    expect(nativeShareFlag()).toBe(true);
    setNativeShareFlag(false);
    expect(localStorage.getItem(NATIVE_SHARE_KEY)).toBe("0");
    expect(nativeShareFlag()).toBe(false);
  });
});

describe("shouldFallBackToWindowsPicker", () => {
  it("cai no seletor do Windows quando o envio nativo é que falhou", () => {
    for (const message of [
      "Nenhum codificador H.264 por hardware",
      "O codificador H.264 não é da GPU de captura",
      "A captura não iniciou a tempo",
      "Nenhuma GPU compatível encontrada",
    ]) {
      expect(shouldFallBackToWindowsPicker(message)).toBe(true);
    }
  });

  it("não cai quando o problema é a fonte escolhida", () => {
    expect(shouldFallBackToWindowsPicker("A janela não existe mais")).toBe(false);
    expect(shouldFallBackToWindowsPicker("Fonte inválida")).toBe(false);
  });
});

describe("isNativeSourceId", () => {
  it("aceita telas e janelas e recusa o id do seletor do Windows", () => {
    expect(isNativeSourceId("screen:65537")).toBe(true);
    expect(isNativeSourceId("window:329498")).toBe(true);
    expect(isNativeSourceId("screen:windows-picker")).toBe(false);
    expect(isNativeSourceId("window:")).toBe(false);
    expect(isNativeSourceId("tab:1")).toBe(false);
  });
});

describe("groupSources", () => {
  it("separa telas de janelas mantendo a ordem", () => {
    const sources = [
      { id: "screen:1", kind: "screen" as const, name: "A", width: 1, height: 1 },
      { id: "window:2", kind: "window" as const, name: "B", width: 1, height: 1 },
      { id: "screen:3", kind: "screen" as const, name: "C", width: 1, height: 1 },
    ];
    const { screens, windows } = groupSources(sources);
    expect(screens.map((s) => s.id)).toEqual(["screen:1", "screen:3"]);
    expect(windows.map((s) => s.id)).toEqual(["window:2"]);
  });
});

describe("loadThumbnails", () => {
  it("entrega cada miniatura e respeita o limite de pedidos simultâneos", async () => {
    let running = 0;
    let peak = 0;
    mockedInvoke.mockImplementation(async (_cmd, args) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return `data:${(args as { id: string }).id}`;
    });
    const got: Record<string, string> = {};
    await loadThumbnails(
      ["screen:1", "window:2", "window:3", "window:4"],
      (id, url) => (got[id] = url),
      () => false,
      2,
    );
    expect(Object.keys(got)).toHaveLength(4);
    expect(got["window:3"]).toBe("data:window:3");
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("pula a janela que falhou e segue com as outras", async () => {
    mockedInvoke.mockImplementation(async (_cmd, args) => {
      if ((args as { id: string }).id === "window:2") throw new Error("sumiu");
      return "data:ok";
    });
    const got: string[] = [];
    await loadThumbnails(["window:1", "window:2", "window:3"], (id) => got.push(id), () => false);
    expect(got.sort()).toEqual(["window:1", "window:3"]);
  });

  it("para de buscar quando é cancelado", async () => {
    mockedInvoke.mockResolvedValue("data:ok");
    let cancelled = false;
    const got: string[] = [];
    await loadThumbnails(
      ["a", "b", "c", "d"].map((n) => `window:${n}`),
      (id) => {
        got.push(id);
        cancelled = true;
      },
      () => cancelled,
      1,
    );
    expect(got).toHaveLength(1);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});
