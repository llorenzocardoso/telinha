import { useCallback, type ReactNode } from "react";

interface DockProps {
  label: string;
  /** "fixed" fica colada embaixo da sala; "floating" flutua sobre o vídeo. */
  variant: "fixed" | "floating";
  children: ReactNode;
  /** Avisa quando o ponteiro ou o foco está na dock, para ela não desaparecer. */
  onHoldChange?: (held: boolean) => void;
}

export function Dock({ label, variant, children, onHoldChange }: DockProps) {
  const release = useCallback(
    (event: React.FocusEvent<HTMLElement> | React.PointerEvent<HTMLElement>) => {
      // No jsdom o relatedTarget pode vir undefined, então confirma que é um Node.
      const related = "relatedTarget" in event ? event.relatedTarget : null;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      onHoldChange?.(false);
    },
    [onHoldChange],
  );

  return (
    <div
      className={`ui-dock is-${variant}`}
      role="toolbar"
      aria-label={label}
      onPointerEnter={() => onHoldChange?.(true)}
      onPointerLeave={release}
      onFocusCapture={() => onHoldChange?.(true)}
      onBlurCapture={release}
    >
      {children}
    </div>
  );
}
