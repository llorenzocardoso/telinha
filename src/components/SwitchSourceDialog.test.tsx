// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SwitchSourceDialog } from "./SwitchSourceDialog";
import { ShareCancelledError } from "../media/displayShare";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { invoke } = await import("@tauri-apps/api/core");
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset().mockImplementation(async (cmd) => {
    if (cmd === "native_share_sources") {
      return [
        { id: "window:10", kind: "window", name: "Bloco de notas", app: "notepad.exe", width: 800, height: 600 },
      ];
    }
    return "data:image/png;base64,x";
  });
});
afterEach(cleanup);

describe("SwitchSourceDialog", () => {
  it("na live nativa, escolher uma fonte da lista já faz a troca", async () => {
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    render(<SwitchSourceDialog native onCancel={vi.fn()} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bloco de notas/ }));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("window:10"));
  });

  it("na live do WebView, abre o seletor do Windows", async () => {
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    render(<SwitchSourceDialog native={false} onCancel={vi.fn()} onSwitch={onSwitch} />);
    fireEvent.click(screen.getByRole("button", { name: "Escolher outra tela ou janela" }));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("screen:windows-picker"));
  });

  it("fechar o seletor do Windows não mostra erro e deixa tentar de novo", async () => {
    const onSwitch = vi.fn().mockRejectedValue(new ShareCancelledError());
    render(<SwitchSourceDialog native={false} onCancel={vi.fn()} onSwitch={onSwitch} />);
    fireEvent.click(screen.getByRole("button", { name: "Escolher outra tela ou janela" }));
    await waitFor(() => expect(onSwitch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Escolher outra tela ou janela" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("mostra o motivo quando a troca falha", async () => {
    const onSwitch = vi.fn().mockRejectedValue(new Error("A janela não existe mais"));
    render(<SwitchSourceDialog native onCancel={vi.fn()} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bloco de notas/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("A janela não existe mais");
  });
});
