import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  hint?: string;
  /** Ações do estado vazio, em geral tonais. */
  actions?: ReactNode;
}

export function EmptyState({ title, hint, actions }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {actions && <div className="ui-empty-state-actions">{actions}</div>}
    </div>
  );
}
