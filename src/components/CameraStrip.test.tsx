// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CameraStrip } from "./CameraStrip";
import type { CameraFeedInfo } from "../room/types";

vi.mock("./VideoTile", () => ({ VideoTile: () => <div data-testid="video" /> }));

const feed = (id: string, overrides: Partial<CameraFeedInfo> = {}): CameraFeedInfo => ({
  participantIdentity: id,
  participantName: id.toUpperCase(),
  stream: {} as MediaStream,
  isLocal: false,
  ...overrides,
});

// O jsdom não tem PointerEvent: sem ele, button e clientX chegam vazios aos handlers.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  // O jsdom não implementa captura de ponteiro.
  Element.prototype.setPointerCapture = vi.fn();
  // A janela de teste tem 1024x768; o quadrado de 200x112 começa em (100, 100).
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    right: 300,
    bottom: 212,
    width: 200,
    height: 112,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tile = (name: string) => screen.getByText(name).closest(".camera-tile") as HTMLElement;

describe("CameraStrip", () => {
  it("não renderiza nada sem câmeras", () => {
    const { container } = render(<CameraStrip cameras={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("arrasta o quadrado segurando o clique e movendo", () => {
    render(<CameraStrip cameras={[feed("ana")]} />);
    const ana = tile("ANA");
    expect(ana.style.transform).toBe("translate(0px, 0px)");

    fireEvent.pointerDown(ana, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    expect(ana.className).toContain("is-dragging");
    fireEvent.pointerMove(ana, { clientX: 190, clientY: 170, pointerId: 1 });
    expect(ana.style.transform).toBe("translate(40px, 20px)");

    fireEvent.pointerUp(ana, { pointerId: 1 });
    expect(ana.className).not.toContain("is-dragging");
    // Soltar mantém a posição.
    expect(ana.style.transform).toBe("translate(40px, 20px)");
  });

  it("não deixa o quadrado sair da janela", () => {
    render(<CameraStrip cameras={[feed("ana")]} />);
    const ana = tile("ANA");
    fireEvent.pointerDown(ana, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    // Para a esquerda e para cima além da borda: para em left=0 e top=0.
    fireEvent.pointerMove(ana, { clientX: -900, clientY: -900, pointerId: 1 });
    expect(ana.style.transform).toBe("translate(-100px, -100px)");
    // Para a direita e para baixo além da borda: para na borda da janela.
    fireEvent.pointerMove(ana, { clientX: 9000, clientY: 9000, pointerId: 1 });
    expect(ana.style.transform).toBe(
      `translate(${window.innerWidth - 300}px, ${window.innerHeight - 212}px)`,
    );
  });

  it("cada câmera tem a sua própria posição", () => {
    render(<CameraStrip cameras={[feed("ana"), feed("bia")]} />);
    const ana = tile("ANA");
    fireEvent.pointerDown(ana, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(ana, { clientX: 160, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(ana, { pointerId: 1 });
    expect(ana.style.transform).toBe("translate(10px, 0px)");
    expect(tile("BIA").style.transform).toBe("translate(0px, 0px)");
  });

  it("um clique sem arrastar põe a câmera em foco", () => {
    const onFocus = vi.fn();
    render(<CameraStrip cameras={[feed("ana")]} onFocus={onFocus} />);
    const ana = tile("ANA");
    fireEvent.pointerDown(ana, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(ana, { clientX: 152, clientY: 151, pointerId: 1 });
    fireEvent.pointerUp(ana, { pointerId: 1 });
    expect(onFocus).toHaveBeenCalledWith("ana");
  });

  it("arrastar não conta como clique", () => {
    const onFocus = vi.fn();
    render(<CameraStrip cameras={[feed("ana")]} onFocus={onFocus} />);
    const ana = tile("ANA");
    fireEvent.pointerDown(ana, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(ana, { clientX: 190, clientY: 170, pointerId: 1 });
    fireEvent.pointerUp(ana, { pointerId: 1 });
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("marca a câmera em foco para ela ficar maior", () => {
    render(<CameraStrip cameras={[feed("ana"), feed("bia")]} focusedId="bia" />);
    expect(tile("BIA").className).toContain("is-focused");
    expect(tile("ANA").className).not.toContain("is-focused");
  });

  it("tem um botão de foco para teclado, com aria-pressed", () => {
    const onFocus = vi.fn();
    render(<CameraStrip cameras={[feed("ana"), feed("bia")]} focusedId="bia" onFocus={onFocus} />);
    const ana = screen.getByRole("button", { name: "Ampliar a câmera de ANA" });
    const bia = screen.getByRole("button", { name: "Reduzir a câmera de BIA" });
    expect(ana.getAttribute("aria-pressed")).toBe("false");
    expect(bia.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(ana);
    expect(onFocus).toHaveBeenCalledWith("ana");
  });

  it("ignora o botão direito e o clique no botão de configurações", () => {
    const onOpenSettings = vi.fn();
    render(<CameraStrip cameras={[feed("me", { isLocal: true })]} onOpenSettings={onOpenSettings} />);
    const mine = tile("Você");

    fireEvent.pointerDown(mine, { button: 2, clientX: 150, clientY: 150, pointerId: 1 });
    expect(mine.className).not.toContain("is-dragging");

    const settings = screen.getByRole("button", { name: "Trocar câmera" });
    fireEvent.pointerDown(settings, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
    expect(mine.className).not.toContain("is-dragging");
    fireEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
