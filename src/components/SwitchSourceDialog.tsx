import { useState } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { ShareCancelledError } from "../media/displayShare";
import { WINDOWS_PICKER_ID } from "../media/nativeShare";
import { NativeSourcePicker } from "./NativeSourcePicker";
import { Button, Dialog } from "./ui";

interface SwitchSourceDialogProps {
  /** A live sai pelo envio nativo: a lista própria do app. Senão, o seletor do Windows. */
  native: boolean;
  onCancel: () => void;
  onSwitch: (sourceId: string) => Promise<void>;
}

/** Troca o que a live mostra sem encerrá-la: quem assiste continua conectado. */
export function SwitchSourceDialog({ native, onCancel, onSwitch }: SwitchSourceDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(sourceId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSwitch(sourceId);
    } catch (cause) {
      // Fechar o seletor do Windows é uma escolha, não um erro.
      if (!(cause instanceof ShareCancelledError)) {
        setError(cause instanceof Error ? cause.message : "Não foi possível trocar a tela");
      }
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Trocar o que compartilha"
      summary="A live continua no ar; só a imagem muda."
      onClose={onCancel}
      wide={native}
      footer={
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      }
    >
      {native ? (
        <NativeSourcePicker value={null} onPick={(source) => void change(source.id)} />
      ) : (
        <>
          <p className="share-note">
            {isTauriRuntime()
              ? "O Windows mostra aplicativos e monitores no próximo passo."
              : "O navegador mostra abas, janelas e monitores no próximo passo."}
          </p>
          <Button variant="primary" size="lg" disabled={busy} onClick={() => void change(WINDOWS_PICKER_ID)}>
            {busy ? "Abrindo..." : "Escolher outra tela ou janela"}
          </Button>
        </>
      )}
      {busy && native && <p className="share-hint">Trocando…</p>}
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
