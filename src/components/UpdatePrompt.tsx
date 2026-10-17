interface UpdatePromptProps {
  required: boolean;
  version: string;
  progress: number | null;
  error: string | null;
  updating: boolean;
  /** Versão web: atualizar é recarregar a página, sem instalador. */
  web?: boolean;
  onUpdate: () => void;
  onLater: () => void;
}

export function UpdatePrompt({
  required,
  version,
  progress,
  error,
  updating,
  web = false,
  onUpdate,
  onLater,
}: UpdatePromptProps) {
  const percent = progress == null ? null : Math.round(progress * 100);
  return (
    <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="notice update-prompt">
        <strong id="update-title">
          {required ? "Atualização obrigatória" : "Nova versão do Telinha"}
        </strong>
        <p>
          {web
            ? `A versão ${version} já está no ar. Recarregue a página para continuar.`
            : required
              ? `A versão ${version} precisa ser instalada para continuar usando as salas.`
              : `A versão ${version} está disponível. A instalação baixa o instalador e reabre o app.`}
        </p>
        {percent != null && (
          <div className="update-progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        {error && <p className="update-error">{error}</p>}
        <div className="notice-actions">
          {!required && (
            <button type="button" className="btn btn-secondary" onClick={onLater} disabled={updating}>
              Depois
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onUpdate} disabled={updating}>
            {web ? "Recarregar" : updating ? "Atualizando..." : "Atualizar agora"}
          </button>
        </div>
      </div>
    </div>
  );
}
