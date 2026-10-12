// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClosePrompt } from "./ClosePrompt";
import { Dialog } from "./ui";

afterEach(cleanup);

const handlers = () => ({
  onMinimize: vi.fn(),
  onLeaveRoom: vi.fn(),
  onQuit: vi.fn(),
  onCancel: vi.fn(),
});

describe("ClosePrompt", () => {
  it("avisa que a live continua ao minimizar quando há transmissão", () => {
    render(<ClosePrompt inRoom isSharing {...handlers()} />);
    expect(screen.getByRole("dialog", { name: "Você ainda está no ar" })).toBeTruthy();
    expect(screen.getByText(/a transmissão continua/)).toBeTruthy();
  });

  it("só oferece Sair da sala quando está numa sala", () => {
    const { rerender } = render(<ClosePrompt inRoom={false} isSharing={false} {...handlers()} />);
    expect(screen.queryByRole("button", { name: "Sair da sala" })).toBeNull();
    rerender(<ClosePrompt inRoom isSharing={false} {...handlers()} />);
    expect(screen.getByRole("button", { name: "Sair da sala" })).toBeTruthy();
  });

  it("cada botão chama a sua ação e o Esc volta", () => {
    const h = handlers();
    render(<ClosePrompt inRoom isSharing={false} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "Minimizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sair da sala" }));
    fireEvent.click(screen.getByRole("button", { name: "Encerrar" }));
    expect([h.onMinimize, h.onLeaveRoom, h.onQuit].map((fn) => fn.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it("abre acima do diálogo que já estava aberto e só ele reage ao Esc", () => {
    const underneath = vi.fn();
    const h = handlers();
    const { container } = render(
      <>
        <Dialog title="Compartilhar tela" onClose={underneath}>
          conteúdo
        </Dialog>
        <ClosePrompt inRoom isSharing={false} {...h} />
      </>,
    );
    expect(container.ownerDocument.querySelector(".ui-dialog-scrim.is-top")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
  });
});
