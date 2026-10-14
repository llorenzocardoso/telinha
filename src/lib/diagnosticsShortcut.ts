/**
 * Atalho que copia o diagnóstico da sala a qualquer momento (Ctrl+Shift+D). O botão "Copiar
 * diagnóstico" só aparece quando há um erro, e quem testa a qualidade de uma live precisa dos números
 * (bitrate, perdas, rota, estatísticas do envio nativo) sem esperar um erro.
 */
export function isDiagnosticsShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "d"
  );
}
