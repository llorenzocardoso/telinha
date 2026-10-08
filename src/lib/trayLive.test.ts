import { describe, expect, it } from "vitest";
import { inviteLink } from "./trayLive";

describe("inviteLink", () => {
  it("é a URL pública do servidor + /j/CODE, sem query string", () => {
    expect(inviteLink("AB23CD", "https://telinha-server.onrender.com")).toBe(
      "https://telinha-server.onrender.com/j/AB23CD",
    );
  });

  it("ignora barra final na URL base", () => {
    expect(inviteLink("AB23CD", "https://telinha-server.onrender.com/")).toBe(
      "https://telinha-server.onrender.com/j/AB23CD",
    );
  });
});
