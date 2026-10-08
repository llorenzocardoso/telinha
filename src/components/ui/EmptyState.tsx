import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  hint?: string;
  /** Ícone no tile arredondado acima do título. */
  icon?: ReactNode;
  /** Ações do estado vazio, em geral tonais. */
  actions?: ReactNode;
}

export function EmptyState({ title, hint, icon, actions }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      {icon && (
        <span className="ui-empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {actions && <div className="ui-empty-state-actions">{actions}</div>}
    </div>
  );
}
