// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CameraGrid, columnsFor } from "./CameraGrid";
import type { CameraFeedInfo } from "../room/types";

vi.mock("./VideoTile", () => ({ VideoTile: () => <div data-testid="video" /> }));

const feed = (id: string, overrides: Partial<CameraFeedInfo> = {}): CameraFeedInfo => ({
  participantIdentity: id,
  participantName: id.toUpperCase(),
  stream: {} as MediaStream,
  isLocal: false,
  ...overrides,
});

afterEach(cleanup);

describe("columnsFor", () => {
  it("cresce com a quantidade de câmeras", () => {
    expect([1, 2, 3, 4, 5, 9, 10].map(columnsFor)).toEqual([1, 2, 2, 2, 3, 3, 4]);
  });
});

describe("CameraGrid", () => {
  it("não renderiza nada sem câmeras", () => {
    const { container } = render(<CameraGrid cameras={[]} focusedId={null} onFocus={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("mostra todas as câmeras na grade quando nenhuma está em foco", () => {
    const { container } = render(
      <CameraGrid cameras={[feed("ana"), feed("bia")]} focusedId={null} onFocus={vi.fn()} />,
    );
    const grid = container.querySelector(".camera-grid") as HTMLElement;
    expect(grid.className).not.toContain("has-focus");
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(screen.getAllByTestId("video")).toHaveLength(2);
  });

  it("clicar numa câmera a põe em foco", () => {
    const onFocus = vi.fn();
    render(<CameraGrid cameras={[feed("ana"), feed("bia")]} focusedId={null} onFocus={onFocus} />);
    fireEvent.click(screen.getByRole("button", { name: "Focar na câmera de BIA" }));
    expect(onFocus).toHaveBeenCalledWith("bia");
  });

  it("com foco, a câmera fica grande e as outras viram miniaturas", () => {
    const onFocus = vi.fn();
    const { container } = render(
      <CameraGrid cameras={[feed("ana"), feed("bia")]} focusedId="ana" onFocus={onFocus} />,
    );
    expect(container.querySelector(".camera-grid.has-focus")).not.toBeNull();
    expect(container.querySelector(".camera-grid-main .camera-cell.is-focused")).not.toBeNull();
    expect(container.querySelectorAll(".camera-grid-rail .camera-cell")).toHaveLength(1);

    // Clicar na que está em foco avisa para o pai voltar à grade.
    fireEvent.click(screen.getByRole("button", { name: "Voltar para a grade (ANA)" }));
    expect(onFocus).toHaveBeenCalledWith("ana");
  });

  it("ignora um foco que não existe mais", () => {
    const { container } = render(
      <CameraGrid cameras={[feed("ana")]} focusedId="fantasma" onFocus={vi.fn()} />,
    );
    expect(container.querySelector(".has-focus")).toBeNull();
  });

  it("o botão de câmera não conta como clique na câmera", () => {
    const onFocus = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <CameraGrid
        cameras={[feed("me", { isLocal: true })]}
        focusedId={null}
        onFocus={onFocus}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trocar câmera" }));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("Enter na câmera a põe em foco", () => {
    const onFocus = vi.fn();
    render(<CameraGrid cameras={[feed("ana")]} focusedId={null} onFocus={onFocus} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Focar na câmera de ANA" }), {
      key: "Enter",
    });
    expect(onFocus).toHaveBeenCalledWith("ana");
  });
});
