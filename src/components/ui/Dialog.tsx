import { useCallback, useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

interface DialogProps {
  title: string;
  /** Resumo à direita do título, como "1080p · 60 fps". */
  summary?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Painel mais estreito, para perguntas curtas. */
  compact?: boolean;
  /** Abre acima de qualquer outro diálogo (por exemplo, a confirmação de fechar o app). */
  top?: boolean;
  /** Classe extra no rodapé, para ajustar a disposição dos botões. */
  footerClassName?: string;
}

/** Diálogo modal com foco preso e Esc para fechar; rola quando falta altura. */
/** Diálogos abertos, do mais antigo ao mais novo: só o do topo reage a Esc e Tab. */
const openDialogs: symbol[] = [];

export function Dialog({
  title,
  summary,
  children,
  footer,
  onClose,
  compact,
  top,
  footerClassName,
}: DialogProps) {
  const idRef = useRef(Symbol("dialog"));
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const focusable = useCallback(
    () => [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])],
    [],
  );

  useEffect(() => {
    restoreRef.current = document.activeElement;
    const first = focusable()[0] ?? panelRef.current;
    first?.focus();
    const restore = restoreRef.current;
    return () => {
      if (restore instanceof HTMLElement) restore.focus();
    };
  }, [focusable]);

  useEffect(() => {
    const id = idRef.current;
    openDialogs.push(id);
    return () => {
      const index = openDialogs.indexOf(id);
      if (index >= 0) openDialogs.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== idRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      // Índice em vez de .at(): o TypeScript do projeto não o expõe.
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [focusable, onClose]);

  return (
    <div className={`ui-dialog-scrim ${top ? "is-top" : ""}`} onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={panelRef}
        className={`ui-dialog ${compact ? "is-compact" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="ui-dialog-header">
          <h1>{title}</h1>
          {summary && <span className="ui-dialog-summary">{summary}</span>}
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer && (
          <footer className={`ui-dialog-footer ${footerClassName ?? ""}`}>{footer}</footer>
        )}
      </div>
    </div>
  );
}
