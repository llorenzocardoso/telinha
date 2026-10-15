// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScreenSharePicker } from "./ScreenSharePicker";
import { QUALITY_KEY } from "../media/shareQuality";
import { ShareCancelledError } from "../media/displayShare";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/runtime", () => ({ isTauriRuntime: () => true }));

const { invoke } = await import("@tauri-apps/api/core");
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  localStorage.clear();
  mockedInvoke.mockReset().mockResolvedValue({ available: true, vendor: "nvidia", name: "RTX" });
});

afterEach(cleanup);

const summary = () => screen.getByRole("dialog").querySelector(".ui-dialog-summary")?.textContent;

describe("ScreenSharePicker", () => {
  it("abre no atalho Equilibrado e mostra o resumo no título", async () => {
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("gpu_encode_info"));
    expect(summary()).toBe("1080p · 60 fps");
    expect(screen.getByRole("radio", { name: "1080p" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "60 fps" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("share-preset-state").textContent).toBe("Equilibrado");
  });

  it("vira Personalizado quando a combinação não bate com um atalho", () => {
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "15 fps" }));
    expect(summary()).toBe("1080p · 15 fps");
    expect(screen.getByTestId("share-preset-state").textContent).toBe("Personalizado");
  });

  it("retoma a escolha salva no formato antigo", () => {
    // Índice 2 era o preset "Leve" (720p, 30 fps).
    localStorage.setItem(QUALITY_KEY, "2");
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    expect(summary()).toBe("720p · 30 fps");
  });

  it("grava a escolha no formato novo", () => {
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "1440p" }));
    expect(JSON.parse(localStorage.getItem(QUALITY_KEY)!)).toEqual({ height: 1440, fps: 60 });
  });

  it("entrega a qualidade montada, com H.264 porque há GPU", async () => {
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={onShare} />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Escolher janela/ }));
    await waitFor(() =>
      expect(onShare).toHaveBeenCalledWith("screen:windows-picker", {
        fps: 60,
        maxWidth: 1920,
        maxHeight: 1080,
        maxBitrate: 10_000_000,
        includeAudio: true,
        preferH264: true,
      }),
    );
  });

  it("sai sem H.264 quando não há encoder por GPU", async () => {
    mockedInvoke.mockResolvedValue({ available: false, vendor: "none", name: "" });
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={onShare} />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Escolher janela/ }));
    await waitFor(() =>
      expect(onShare).toHaveBeenCalledWith(
        "screen:windows-picker",
        expect.objectContaining({ preferH264: false }),
      ),
    );
  });

  it("Original não limita altura", async () => {
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={onShare} />);
    fireEvent.click(screen.getByRole("radio", { name: "Original" }));
    fireEvent.click(screen.getByRole("button", { name: /Escolher janela/ }));
    await waitFor(() => expect(onShare).toHaveBeenCalled());
    const quality = onShare.mock.calls[0]![1];
    expect(quality.maxWidth).toBe(0);
    expect(quality.maxHeight).toBeUndefined();
  });

  it("guarda a escolha do som do computador", () => {
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Incluir som do computador" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(localStorage.getItem("telinha-share-audio")).toBe("0");
  });

  it("mostra o erro e volta a liberar o botão", async () => {
    const onShare = vi.fn().mockRejectedValue(new Error("O Windows não retornou uma faixa de vídeo."));
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={onShare} />);
    fireEvent.click(screen.getByRole("button", { name: /Escolher janela/ }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "O Windows não retornou uma faixa de vídeo.",
    );
    expect(
      screen.getByRole("button", { name: /Escolher janela/ }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("não trata o cancelamento da escolha de tela como erro", async () => {
    const onShare = vi.fn().mockRejectedValue(new ShareCancelledError());
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={onShare} />);
    fireEvent.click(screen.getByRole("button", { name: /Escolher janela/ }));
    await waitFor(() => expect(onShare).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Escolher janela/ }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fecha no Esc e no Cancelar", () => {
    const onCancel = vi.fn();
    render(<ScreenSharePicker onCancel={onCancel} onShare={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("não traz o toggle de H.264 para a interface", () => {
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: /H\.264/ })).toBeNull();
    // Só o som e o seletor próprio (experimental); nada de codec.
    expect(screen.getAllByRole("switch").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Incluir som do computador",
      "Seletor de telas próprio (experimental)",
    ]);
  });
});

describe("ScreenSharePicker com o seletor nativo", () => {
  const sources = [
    { id: "screen:1", kind: "screen", name: "Monitor 1", width: 1920, height: 1080 },
    { id: "window:10", kind: "window", name: "Janela A", app: "a.exe", width: 800, height: 600 },
    {
      id: "window:20",
      kind: "window",
      name: "VALORANT",
      app: "VALORANT-Win64-Shipping.exe",
      width: 1920,
      height: 1080,
      minimized: true,
    },
  ];

  function nativeBackend(capability: Record<string, unknown>) {
    mockedInvoke.mockReset().mockImplementation(async (cmd, args) => {
      if (cmd === "gpu_encode_info") return { available: true, vendor: "nvidia", name: "RTX" };
      if (cmd === "native_share_capability") return capability;
      if (cmd === "native_share_sources") return sources;
      if (cmd === "native_share_thumbnail") return `data:image/jpeg;base64,${(args as { id: string }).id}`;
      if (cmd === "native_share_icon") return null;
      throw new Error(`unexpected ${cmd}`);
    });
  }

  it("o interruptor do diálogo liga o seletor próprio e guarda a escolha", async () => {
    nativeBackend({ available: true, vendor: "nvidia", encoder: "NVIDIA H.264 Encoder MFT" });
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Seletor de telas próprio (experimental)" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("O que compartilhar")).toBeNull();

    fireEvent.click(toggle);
    expect(localStorage.getItem("telinha-native-share")).toBe("1");
    expect(await screen.findByText("O que compartilhar")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(localStorage.getItem("telinha-native-share")).toBe("0");
    await waitFor(() => expect(screen.queryByText("O que compartilhar")).toBeNull());
    expect(screen.getByRole("button", { name: /Escolher janela/ })).toBeTruthy();
  });

  it("com o interruptor desligado nunca consulta o backend nativo", async () => {
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("gpu_encode_info"));
    const commands = mockedInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commands.some((cmd) => String(cmd).startsWith("native_share"))).toBe(false);
    expect(screen.queryByText("O que compartilhar")).toBeNull();
  });

  it("primeiro escolhe a fonte; só depois vem a qualidade, e então compartilha", async () => {
    localStorage.setItem("telinha-native-share", "1");
    nativeBackend({ available: true, vendor: "nvidia", encoder: "NVIDIA H.264 Encoder MFT" });
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={onShare} />);

    // Etapa 1: só a grade. Nada de qualidade nem botão de compartilhar ainda.
    expect(await screen.findByText("O que compartilhar")).toBeTruthy();
    expect(screen.queryByText("Resolução")).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(screen.queryByText(/Gravar 5 s/)).toBeNull();

    // Escolher o aplicativo já avança para a qualidade.
    fireEvent.click(await screen.findByRole("button", { name: /Janela A/ }));
    expect(screen.queryByText("O que compartilhar")).toBeNull();
    expect(screen.getByLabelText("Fonte escolhida").textContent).toContain("Janela A");
    expect(screen.getByText("Resolução")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));

    await waitFor(() =>
      expect(onShare).toHaveBeenCalledWith(
        "window:10",
        expect.objectContaining({ fps: 60, maxHeight: 1080, includeAudio: true }),
      ),
    );
    expect(screen.queryByText(/O Windows mostra aplicativos/)).toBeNull();
    // O som do computador também vale no envio nativo.
    const audio = screen.getByRole("switch", { name: "Incluir som do computador" });
    expect(audio.hasAttribute("disabled")).toBe(false);
    expect(audio.getAttribute("aria-checked")).toBe("true");
  });

  it("Voltar leva de novo à grade, sem perder a qualidade escolhida", async () => {
    localStorage.setItem("telinha-native-share", "1");
    nativeBackend({ available: true, vendor: "nvidia", encoder: "NVIDIA H.264 Encoder MFT" });
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Janela A/ }));
    fireEvent.click(screen.getByRole("radio", { name: "720p" }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(await screen.findByText("O que compartilhar")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Janela A/ }));
    expect(screen.getByRole("radio", { name: "720p" }).getAttribute("aria-checked")).toBe("true");
  });

  it("avisa que uma janela minimizada só mostra imagem depois de aberta", async () => {
    localStorage.setItem("telinha-native-share", "1");
    nativeBackend({ available: true, vendor: "nvidia", encoder: "NVIDIA H.264 Encoder MFT" });
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /VALORANT/ }));
    expect(screen.getByLabelText("Fonte escolhida").textContent).toContain("Está minimizada");
  });

  it("o interruptor do seletor próprio só aparece na etapa da grade", async () => {
    localStorage.setItem("telinha-native-share", "1");
    nativeBackend({ available: true, vendor: "nvidia", encoder: "NVIDIA H.264 Encoder MFT" });
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={vi.fn()} />);

    const name = "Seletor de telas próprio (experimental)";
    await screen.findByText("O que compartilhar");
    expect(screen.getByRole("switch", { name })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Janela A/ }));
    expect(screen.queryByRole("switch", { name })).toBeNull();
  });

  it("sem codificador por GPU cai de volta no seletor do Windows", async () => {
    localStorage.setItem("telinha-native-share", "1");
    nativeBackend({ available: false, vendor: "none", encoder: "", reason: "Nenhuma GPU compatível" });
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<ScreenSharePicker onCancel={vi.fn()} onShare={onShare} />);

    expect(await screen.findByText(/Compartilhamento nativo indisponível/)).toBeTruthy();
    expect(screen.queryByText("O que compartilhar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Escolher janela/ }));
    await waitFor(() =>
      expect(onShare).toHaveBeenCalledWith("screen:windows-picker", expect.anything()),
    );
  });
});
