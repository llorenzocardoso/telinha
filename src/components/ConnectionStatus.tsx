export function ErrorNotice({
  error,
  copied,
  onCopy,
  onRetry,
  overlay,
}: {
  error: string;
  copied: boolean;
  onCopy: () => void;
  onRetry?: () => void;
  overlay?: boolean;
}) {
  return (
    <div className={`error error-with-action ${overlay ? "overlay-error" : ""}`}>
      <span>{error}</span>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
      <button type="button" className="btn btn-ghost" onClick={onCopy}>
        {copied ? "Diagnóstico copiado" : "Copiar diagnóstico"}
      </button>
    </div>
  );
}
