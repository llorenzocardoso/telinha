// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
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
];

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <NativeSourcePicker
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange?.(id);
        }}
      />
      <output data-testid="selected">{value}</output>
    </>
  );
}

beforeEach(() => {
  mockedInvoke.mockReset().mockImplementation(async (cmd, args) => {
    if (cmd === "native_share_sources") return SOURCES;
    if (cmd === "native_share_thumbnail") return `data:image/jpeg;base64,${(args as { id: string }).id}`;
    throw new Error(`unexpected ${cmd}`);
  });
});

afterEach(cleanup);

describe("NativeSourcePicker", () => {
  it("lista as telas, escolhe a primeira e mostra as contagens", async () => {
    render(<Harness />);
    expect(await screen.findByText("Monitor 1")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Telas (2)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Janelas (1)" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("screen:1"));
    expect(screen.getByRole("button", { name: /Monitor 1/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Monitor 2/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("abre sem as imagens e vai preenchendo as miniaturas", async () => {
    render(<Harness />);
    const card = await screen.findByRole("button", { name: /Monitor 1/ });
    await waitFor(() => expect(card.querySelector("img")?.getAttribute("src")).toContain("screen:1"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Monitor 2/ }).querySelector("img")?.getAttribute("src"),
      ).toContain("screen:2"),
    );
  });

  it("troca para as janelas e escolhe uma", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await screen.findByText("Monitor 1");
    fireEvent.click(screen.getByRole("radio", { name: "Janelas (1)" }));
    const window = await screen.findByRole("button", { name: /Bloco de notas/ });
    expect(window.textContent).toContain("notepad.exe · 800×600");
    expect(screen.queryByText("Monitor 1")).toBeNull();
    fireEvent.click(window);
    expect(onChange).toHaveBeenLastCalledWith("window:10");
    expect(window.getAttribute("aria-pressed")).toBe("true");
  });

  it("Atualizar lista de novo e mantém a fonte ainda disponível", async () => {
    render(<Harness />);
    await screen.findByText("Monitor 1");
    fireEvent.click(screen.getByRole("button", { name: /Monitor 2/ }));
    mockedInvoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(mockedInvoke.mock.calls.some(([cmd]) => cmd === "native_share_sources")).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("screen:2"));
  });

  it("volta para a primeira tela quando a fonte escolhida sumiu", async () => {
    render(<Harness />);
    await screen.findByText("Monitor 1");
    fireEvent.click(screen.getByRole("radio", { name: "Janelas (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: /Bloco de notas/ }));
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "native_share_sources" ? SOURCES.slice(0, 2) : "data:image/jpeg;base64,x",
    );
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("screen:1"));
  });

  it("avisa quando não há janelas", async () => {
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "native_share_sources" ? SOURCES.slice(0, 1) : "data:image/jpeg;base64,x",
    );
    render(<Harness />);
    await screen.findByText("Monitor 1");
    fireEvent.click(screen.getByRole("radio", { name: "Janelas (0)" }));
    expect(screen.getByText("Nenhuma janela aberta para compartilhar.")).toBeTruthy();
  });

  it("mostra o erro quando a listagem falha", async () => {
    mockedInvoke.mockRejectedValue(new Error("sem permissão"));
    render(<Harness />);
    expect((await screen.findByRole("alert")).textContent).toBe("sem permissão");
  });
});
