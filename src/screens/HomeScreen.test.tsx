// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";
import type { RoomSession } from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    createRoom: vi.fn(),
    enterRoom: vi.fn(),
  };
});

const api = await import("../lib/api");
const createRoom = vi.mocked(api.createRoom);
const enterRoom = vi.mocked(api.enterRoom);

const session = { code: "AB23CD" } as RoomSession;

beforeEach(() => {
  localStorage.clear();
  createRoom.mockReset().mockResolvedValue(session);
  enterRoom.mockReset().mockResolvedValue(session);
});

afterEach(cleanup);

const nameField = () => screen.getByRole("textbox", { name: /Seu nome|Como você quer aparecer/ });
const codeField = () => screen.getByRole("textbox", { name: "Código ou link do convite" });
const createButton = () => screen.getByRole("button", { name: /Criar sala/ });
const joinButton = () => screen.getByRole("button", { name: /Entrar na sala/ });

describe("HomeScreen", () => {
  it("exige o nome antes de liberar as duas ações", () => {
    render(<HomeScreen onJoin={vi.fn()} />);
    expect(createButton().hasAttribute("disabled")).toBe(true);

    fireEvent.change(nameField(), { target: { value: "Ana" } });
    expect(createButton().hasAttribute("disabled")).toBe(false);
    // O código ainda falta, então entrar continua travado.
    expect(joinButton().hasAttribute("disabled")).toBe(true);
  });

  it("mantém o botão de entrar travado com código incompleto", () => {
    render(<HomeScreen onJoin={vi.fn()} />);
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    fireEvent.change(codeField(), { target: { value: "AB2" } });
    expect(joinButton().hasAttribute("disabled")).toBe(true);

    fireEvent.change(codeField(), { target: { value: "AB23CD" } });
    expect(joinButton().hasAttribute("disabled")).toBe(false);
  });

  it("aceita o link do convite colado no campo de código", () => {
    render(<HomeScreen onJoin={vi.fn()} />);
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    fireEvent.change(codeField(), {
      target: { value: "https://telinha-server.onrender.com/j/AB23CD" },
    });
    expect((codeField() as HTMLInputElement).value).toBe("AB23CD");
    expect(joinButton().hasAttribute("disabled")).toBe(false);
  });

  it("entra na sala com o código normalizado e guarda o nome", async () => {
    const onJoin = vi.fn();
    render(<HomeScreen onJoin={onJoin} />);
    fireEvent.change(nameField(), { target: { value: "  Ana  " } });
    fireEvent.change(codeField(), { target: { value: "telinha://join/ab23cd" } });
    fireEvent.click(joinButton());

    await waitFor(() => expect(onJoin).toHaveBeenCalledWith(session));
    expect(enterRoom).toHaveBeenCalledWith("AB23CD", "Ana");
    expect(localStorage.getItem("telinha-display-name")).toBe("Ana");
  });

  it("mostra o erro do servidor ao criar a sala", async () => {
    createRoom.mockRejectedValue(new Error("Sala cheia"));
    render(<HomeScreen onJoin={vi.fn()} />);
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    fireEvent.click(createButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Sala cheia");
  });

  it("limita o nome a 24 caracteres", () => {
    render(<HomeScreen onJoin={vi.fn()} />);
    expect(nameField().getAttribute("maxlength")).toBe("24");
  });
});
