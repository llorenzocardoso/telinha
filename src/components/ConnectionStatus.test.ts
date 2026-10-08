import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ErrorNotice } from "./ConnectionStatus";

// O selo de conexão virou ConnectionIndicator, testado em components/ui/ui.test.tsx.
describe("ConnectionStatus", () => {
  it("oferece diagnóstico junto do erro", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorNotice, {
        error: "Falha de rede",
        copied: false,
        onCopy: vi.fn(),
      }),
    );
    expect(html).toContain("Falha de rede");
    expect(html).toContain("Copiar diagnóstico");
  });
});
