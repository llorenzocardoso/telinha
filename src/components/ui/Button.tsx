import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "tonal" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ocupa toda a largura disponível. */
  block?: boolean;
  /** Ícone à esquerda do rótulo (Lucide, 18px). */
  icon?: ReactNode;
  /** Atalho mostrado à direita do rótulo, em mono. */
  shortcut?: string;
  children: ReactNode;
}

/**
 * Uma ação principal por tela, sempre a primária (clara e sólida). O resto é tonal, com
 * contorno ou fantasma.
 */
export function Button({
  variant = "tonal",
  size = "md",
  block,
  shortcut,
  icon,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={["ui-button", `is-${variant}`, `is-${size}`, block ? "is-block" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {icon && <span className="ui-button-icon" aria-hidden="true">{icon}</span>}
      <span className="ui-button-label">{children}</span>
      {shortcut && <kbd className="ui-button-shortcut">{shortcut}</kbd>}
    </button>
  );
}
