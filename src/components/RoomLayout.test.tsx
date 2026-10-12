// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RoomLayout } from "./RoomLayout";
import type { ParticipantState } from "../room/participants";

const people: ParticipantState[] = [
  { id: "a", name: "ana", status: "Você", self: true, connected: true, live: false, watchable: false, watching: false },
  { id: "b", name: "bia", status: "Na sala", self: false, connected: true, live: false, watchable: false, watching: false },
];

function renderLayout() {
  return render(
    <RoomLayout
      code="ABC123"
      onCopyCode={() => true}
      connectionQuality={"good" as never}
      people={people}
      stage={<div>palco</div>}
      dock={<div>dock</div>}
      onWatch={vi.fn()}
    />,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("RoomLayout: lista de pessoas", () => {
  it("começa recolhida: só os avatares, com a lista no cartão", () => {
    const { container } = renderLayout();
    expect(container.querySelector(".room-body.has-people")).toBeNull();
    expect(container.querySelector("aside.room-people")).toBeNull();
    expect(container.querySelector(".room-people-card")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Fixar a lista de pessoas na lateral" })).toBeTruthy();
  });

  it("clicar nos avatares fixa a lista na lateral e lembra a escolha", () => {
    const { container, unmount } = renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "Fixar a lista de pessoas na lateral" }));
    expect(container.querySelector(".room-body.has-people aside.room-people")).not.toBeNull();
    // Fixada, não precisa do cartão de hover; os avatares seguem no cabeçalho.
    expect(container.querySelector(".room-people-card")).toBeNull();
    expect(container.querySelector(".room-people-toggle.is-active")).not.toBeNull();
    expect(localStorage.getItem("telinha-people-panel")).toBe("1");
    unmount();

    const again = renderLayout();
    expect(again.container.querySelector("aside.room-people")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Soltar a lista de pessoas da lateral" }));
    expect(again.container.querySelector("aside.room-people")).toBeNull();
    expect(localStorage.getItem("telinha-people-panel")).toBe("0");
  });

  it("Esc fecha o cartão e ele volta quando o mouse reentra", () => {
    const { container } = renderLayout();
    const pop = container.querySelector(".room-people-pop") as HTMLElement;
    const card = () => container.querySelector(".room-people-card") as HTMLElement;
    expect(card().className).not.toContain("is-dismissed");

    fireEvent.keyDown(pop, { key: "Escape" });
    expect(card().className).toContain("is-dismissed");

    fireEvent.pointerEnter(pop);
    expect(card().className).not.toContain("is-dismissed");
  });

  it("o botão dos avatares aponta para o cartão que controla", () => {
    const { container } = renderLayout();
    const toggle = screen.getByRole("button", { name: "Fixar a lista de pessoas na lateral" });
    const card = container.querySelector(".room-people-card") as HTMLElement;
    expect(card.id).not.toBe("");
    expect(toggle.getAttribute("aria-controls")).toBe(card.id);
  });
});
