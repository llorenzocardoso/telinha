interface SwitchProps {
  label: string;
  /** Explica a consequência de ligar, não o mecanismo. */
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, hint, checked, disabled, onChange }: SwitchProps) {
  return (
    <div className={`ui-switch-row ${disabled ? "is-disabled" : ""}`}>
      <span className="ui-switch-copy">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`ui-switch ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-switch-knob" aria-hidden="true" />
      </button>
    </div>
  );
}
