import { describe, expect, it } from "vitest";
import { actionFromUrls, joinFromLocation } from "./deepLink";

describe("actionFromUrls", () => {
  it("escolhe o primeiro deep link válido", () => {
    expect(actionFromUrls(["https://x", "telinha://join/AB23CD?name=Bia"])).toEqual({
      action: "join",
      code: "AB23CD",
      name: "Bia",
    });
  });

  it("reconhece share e open", () => {
    expect(actionFromUrls(["telinha://share"])).toEqual({ action: "share" });
    expect(actionFromUrls(["telinha://"])).toEqual({ action: "open" });
  });

  it("volta null se não houver URL da Telinha", () => {
    expect(actionFromUrls(["https://discord.com"])).toBeNull();
  });
});

describe("joinFromLocation", () => {
  it("lê o convite da versão web por /j/CODE, /join/CODE ou ?sala=", () => {
    expect(joinFromLocation("https://web.test/j/ab-23-cd")).toEqual({ action: "join", code: "AB23CD", name: undefined });
    expect(joinFromLocation("https://web.test/join/AB23CD?name=Bia")).toEqual({
      action: "join",
      code: "AB23CD",
      name: "Bia",
    });
    expect(joinFromLocation("https://web.test/?sala=AB23CD")).toMatchObject({ code: "AB23CD" });
  });

  it("ignora a página inicial e códigos inválidos", () => {
    expect(joinFromLocation("https://web.test/")).toBeNull();
    expect(joinFromLocation("https://web.test/j/AB12CD")).toBeNull();
    expect(joinFromLocation("https://web.test/outra/AB23CD")).toBeNull();
  });
});
