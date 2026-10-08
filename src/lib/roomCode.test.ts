import { describe, expect, it } from "vitest";
import { roomCodeFromInput } from "./roomCode";

describe("roomCodeFromInput", () => {
  it("aceita o código digitado, em qualquer caixa", () => {
    expect(roomCodeFromInput("AB23CD")).toBe("AB23CD");
    expect(roomCodeFromInput("ab23cd")).toBe("AB23CD");
    expect(roomCodeFromInput("  ab23cd  ")).toBe("AB23CD");
  });

  it("deixa passar o código incompleto para o campo continuar digitável", () => {
    expect(roomCodeFromInput("AB2")).toBe("AB2");
    expect(roomCodeFromInput("")).toBe("");
  });

  it("descarta caracteres fora do alfabeto do código", () => {
    // I, O, 0 e 1 não existem no alfabeto, para não confundir com letra parecida.
    expect(roomCodeFromInput("AB-23-CD")).toBe("AB23CD");
    expect(roomCodeFromInput("AB23CDEF")).toBe("AB23CD");
  });

  it("extrai o código do link telinha://join", () => {
    expect(roomCodeFromInput("telinha://join/AB23CD")).toBe("AB23CD");
    expect(roomCodeFromInput("telinha://join/ab23cd")).toBe("AB23CD");
    expect(roomCodeFromInput("telinha://join/AB23CD?name=Ana")).toBe("AB23CD");
    expect(roomCodeFromInput("telinha://join?code=AB23CD")).toBe("AB23CD");
  });

  it("extrai o código do link https do convite", () => {
    expect(roomCodeFromInput("https://telinha-server.onrender.com/j/AB23CD")).toBe("AB23CD");
    expect(roomCodeFromInput("telinha-server.onrender.com/j/AB23CD")).toBe("AB23CD");
    expect(roomCodeFromInput("http://127.0.0.1:3001/j/ab23cd")).toBe("AB23CD");
  });

  it("devolve vazio para link sem código válido, em vez de inventar um", () => {
    // O risco real: "telinha" e "join" só têm letras do alfabeto do código.
    expect(roomCodeFromInput("telinha://join/AB12")).toBe("");
    expect(roomCodeFromInput("telinha://share")).toBe("");
    expect(roomCodeFromInput("https://telinha-server.onrender.com/")).toBe("");
  });
});
