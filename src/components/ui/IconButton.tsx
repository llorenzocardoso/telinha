import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label"> {
  /** Obrigatório: o botão não tem texto visível. */
  label: string;
  icon: ReactNode;
  variant?: "tonal" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Marca estado ligado e publica aria-pressed. */
  active?: boolean;
  /** Mostra o rótulo como dica no hover, além do aria-label. */
  tooltip?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  active,
  tooltip = true,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-tooltip={tooltip ? label : undefined}
      className={["ui-icon-button", `is-${variant}`, `is-${size}`, active ? "is-active" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {icon}
    </button>
  );
}
