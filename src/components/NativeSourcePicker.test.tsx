// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NativeSourcePicker } from "./NativeSourcePicker";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { invoke } = await import("@tauri-apps/api/core");
const mockedInvoke = vi.mocked(invoke);

const SOURCES = [
  { id: "screen:1", kind: "screen", name: "Monitor 1", width: 1920, height: 1080 },
  { id: "screen:2", kind: "screen", name: "Monitor 2", width: 2560, height: 1440 },
  {
    id: "window:10",
    kind: "window",
    name: "Documento - Bloco de notas",
    app: "notepad.exe",
    width: 800,
    height: 600,
  },
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

function backend(sources: unknown[] = SOURCES) {
  mockedInvoke.mockReset().mockImplementation(async (cmd, args) => {
    const { id } = (args ?? {}) as { id: string };
    if (cmd === "native_share_sources") return sources;
    if (cmd === "native_share_thumbnail") return `data:image/jpeg;base64,${id}`;
    if (cmd === "native_share_icon") return `data:image/png;base64,${id}`;
    throw new Error(`unexpected ${cmd}`);
  });
}

beforeEach(() => backend());
afterEach(cleanup);

describe("NativeSourcePicker", () => {
  it("abre nos aplicativos, como o Discord, e não escolhe nada sozinho", async () => {
    const onPick = vi.fn();
    render(<NativeSourcePicker value={null} onPick={onPick} />);
    expect(await screen.findByText("Documento - Bloco de notas")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Aplicativos" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Monitor 1")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("sem aplicativos abre nas telas", async () => {
    backend(SOURCES.slice(0, 2));
    render(<NativeSourcePicker value={null} onPick={vi.fn()} />);
    expect(await screen.findByText("Monitor 1")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Telas" }).getAttribute("aria-checked")).toBe("true");
  });

  it("troca para as telas e entrega a fonte inteira ao clicar", async () => {
    const onPick = vi.fn();
    render(<NativeSourcePicker value={null} onPick={onPick} />);
    await screen.findByText("Documento - Bloco de notas");
    fireEvent.click(screen.getByRole("radio", { name: "Telas" }));
    const card = await screen.findByRole("button", { name: /Monitor 2/ });
    expect(card.textContent).toContain("2560×1440");
    fireEvent.click(card);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "screen:2", kind: "screen" }));
  });

  it("mostra o aplicativo e o tamanho, e destaca a fonte recebida em value", async () => {
    render(<NativeSourcePicker value="window:10" onPick={vi.fn()} />);
    const card = await screen.findByRole("button", { name: /Bloco de notas/ });
    expect(card.textContent).toContain("notepad.exe · 800×600");
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });

  it("abre sem as imagens e vai preenchendo as miniaturas", async () => {
    render(<NativeSourcePicker value={null} onPick={vi.fn()} />);
    const card = await screen.findByRole("button", { name: /Bloco de notas/ });
    await waitFor(() =>
      expect(card.querySelector(".source-thumb img")?.getAttribute("src")).toContain("window:10"),
    );
  });

  it("janela minimizada leva o selo e o ícone no lugar da imagem, sem pedir miniatura", async () => {
    render(<NativeSourcePicker value={null} onPick={vi.fn()} />);
    const card = await screen.findByRole("button", { name: /VALORANT/ });
    expect(card.textContent).toContain("Minimizada");
    expect(card.textContent).toContain("1920×1080");
    await waitFor(() =>
      expect(card.querySelector("img.source-thumb-icon")?.getAttribute("src")).toContain("window:20"),
    );
    const thumbnailIds = mockedInvoke.mock.calls
      .filter(([cmd]) => cmd === "native_share_thumbnail")
      .map(([, args]) => (args as { id: string }).id);
    expect(thumbnailIds).not.toContain("window:20");
  });

  it("Atualizar lista de novo", async () => {
    render(<NativeSourcePicker value={null} onPick={vi.fn()} />);
    await screen.findByText("Documento - Bloco de notas");
    mockedInvoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(mockedInvoke.mock.calls.some(([cmd]) => cmd === "native_share_sources")).toBe(true),
    );
  });

  it("avisa quando não há aplicativos", async () => {
    backend(SOURCES.slice(0, 2));
    render(<NativeSourcePicker value={null} onPick={vi.fn()} />);
    await screen.findByText("Monitor 1");
    fireEvent.click(screen.getByRole("radio", { name: "Aplicativos" }));
    expect(screen.getByText("Nenhum aplicativo aberto para compartilhar.")).toBeTruthy();
  });

  it("mostra o erro quando a listagem falha", async () => {
    mockedInvoke.mockReset().mockRejectedValue(new Error("sem permissão"));
    render(<NativeSourcePicker value={null} onPick={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("sem permissão");
  });
});
