import { Button, Dialog } from "./ui";

interface ClosePromptProps {
  inRoom: boolean;
  isSharing: boolean;
  onMinimize: () => void;
  onLeaveRoom: () => void;
  onQuit: () => void;
  onCancel: () => void;
}

/** O que acontece com a sala e a transmissão em cada escolha, em uma frase. */
function messageFor(inRoom: boolean, isSharing: boolean): string {
  if (isSharing) {
    return "Minimizar esconde a janela e a transmissão continua. Encerrar fecha o app e derruba a live.";
  }
  if (inRoom) {
    return "Minimizar esconde a janela e você continua na sala. Encerrar fecha o app.";
  }
  return "Minimizar manda o app para a bandeja. Encerrar fecha o app.";
}

export function ClosePrompt({
  inRoom,
  isSharing,
  onMinimize,
  onLeaveRoom,
  onQuit,
  onCancel,
}: ClosePromptProps) {
  return (
    <Dialog
      title={isSharing ? "Você ainda está no ar" : "Fechar a Telinha?"}
      onClose={onCancel}
      compact
      top
      footerClassName="close-prompt-footer"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Voltar
          </Button>
          {inRoom && (
            <Button variant="outline" onClick={onLeaveRoom}>
              Sair da sala
            </Button>
          )}
          <Button variant="outline" onClick={onMinimize}>
            Minimizar
          </Button>
          <Button variant="danger" onClick={onQuit}>
            Encerrar
          </Button>
        </>
      }
    >
      <p className="close-prompt-copy">{messageFor(inRoom, isSharing)}</p>
    </Dialog>
  );
}
