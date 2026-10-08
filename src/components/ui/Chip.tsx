import type { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  tone?: "neutral" | "live";
  icon?: ReactNode;
}

export function Chip({ children, tone = "neutral", icon }: ChipProps) {
  return (
    <span className={`ui-chip is-${tone}`}>
      {icon}
      {children}
    </span>
  );
}
