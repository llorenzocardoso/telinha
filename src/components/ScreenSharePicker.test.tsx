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
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });
});
