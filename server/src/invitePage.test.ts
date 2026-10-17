import { describe, expect, it } from "vitest";
import { RELEASES_URL, renderInvitePage } from "./invitePage.js";

describe("renderInvitePage", () => {
  it("abre o app com telinha://join/CODE, por botão e automaticamente", () => {
    const html = renderInvitePage("AB23CD");
    expect(html).toContain('href="telinha://join/AB23CD"');
    expect(html).toContain('window.location.href = "telinha://join/AB23CD"');
  });

  it("oferece o link para a release mais recente quando o app não abre", () => {
    expect(renderInvitePage("AB23CD")).toContain(`href="${RELEASES_URL}"`);
    expect(RELEASES_URL).toBe("https://github.com/llorenzocardoso/telinha/releases/latest");
  });

  it("sem versão web configurada, não oferece o navegador", () => {
    expect(renderInvitePage("AB23CD")).not.toContain("Entrar pelo navegador");
  });

  it("com versão web, oferece o navegador e manda quem não está no Windows direto para ela", () => {
    const html = renderInvitePage("AB23CD", "https://web.telinha.test/");
    expect(html).toContain('href="https://web.telinha.test/j/AB23CD"');
    expect(html).toContain("Entrar pelo navegador");
    expect(html).toContain('window.location.replace("https://web.telinha.test/j/AB23CD")');
    expect(html).toContain('window.location.href = "telinha://join/AB23CD"');
  });
});
