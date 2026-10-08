import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface RoomCodeProps {
  code: string;
  /** Deve devolver se a cópia deu certo. */
  onCopy: () => Promise<boolean> | boolean;
}

/** O código em mono, clicável para copiar, com retorno curto no próprio botão. */
export function RoomCode({ code, onCopy }: RoomCodeProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const ok = await onCopy();
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      className="ui-room-code"
      onClick={() => void copy()}
      aria-label={`Copiar o código da sala ${code}`}
    >
      <span className="ui-room-code-caption">Sala</span>
      <strong data-testid="room-code">{code}</strong>
      <span className="ui-room-code-feedback" aria-live="polite">
        {state === "copied" ? (
          <>
            <Check aria-hidden="true" strokeWidth={1.8} /> Copiado
          </>
        ) : state === "failed" ? (
          "Não deu"
        ) : (
          <Copy aria-hidden="true" strokeWidth={1.8} />
        )}
      </span>
    </button>
  );
}
