import { useRef } from "react";

export interface Segment<T extends string | number> {
  value: T;
  label: string;
  /** Linha de apoio sob o rótulo, quando ajuda a decidir. */
  hint?: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string | number> {
  label: string;
  options: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Grupo de opções mutuamente exclusivas. Navega com as setas, como manda o padrão de
 * radiogroup: só a opção escolhida entra na ordem de tabulação.
 */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function move(step: number) {
    const usable = options.filter((option) => !option.disabled);
    if (usable.length === 0) return;
    const current = usable.findIndex((option) => option.value === value);
    const next = usable[(current + step + usable.length) % usable.length];
    if (!next) return;
    onChange(next.value);
    // O foco acompanha a escolha, senão as setas param de funcionar.
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    const index = options.findIndex((option) => option.value === next.value);
    buttons?.[index]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    }
  }

  return (
    <div
      ref={groupRef}
      className="ui-segmented"
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            className={`ui-segment ${selected ? "is-selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            <span className="ui-segment-label">{option.label}</span>
            {option.hint && <span className="ui-segment-hint">{option.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
