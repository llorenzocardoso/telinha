import { isValidRoomCode, normalizeRoomCode } from "./api";

/**
 * O campo "Código ou link do convite" aceita as três formas que circulam por aí:
 * o código digitado, o link `telinha://join/CODE` e o link https `/j/CODE` que o
 * "Copiar convite" coloca na área de transferência.
 *
 * Passar um link direto por `normalizeRoomCode` não serve: ele só filtra o alfabeto do
 * código, então "telinha://join/AB23CD" viraria "TELINH".
 */
export function roomCodeFromInput(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";

  const fromLink = codeFromLink(value);
  if (fromLink !== null) return fromLink;

  return normalizeRoomCode(value);
}

/** Devolve o código do link, `""` se é um link sem código reconhecível, ou null se não é link. */
function codeFromLink(value: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.includes("/")) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // "telinha://join/CODE" guarda "join" no hostname; o caminho vem na pathname.
  const segments = [url.hostname, ...url.pathname.split("/")]
    .map((segment) => segment.trim())
    .filter(Boolean);
  const marker = segments.findIndex((segment) => segment === "join" || segment === "j");
  const fromQuery = url.searchParams.get("code");
  const tail = marker >= 0 ? segments[marker + 1] : undefined;

  const code = normalizeRoomCode(fromQuery ?? tail ?? "");
  return isValidRoomCode(code) ? code : "";
}
