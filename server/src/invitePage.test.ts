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
});
