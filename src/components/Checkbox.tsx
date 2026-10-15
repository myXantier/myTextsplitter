import './styles/CheckboxStyle.css';

interface CustomCheckboxProps {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  /** Tooltip of the whole checkbox (e.g. when an option only applies to some actions) */
  title?: string;
}

export default function Checkbox({ checked, onChange, label, className, disabled = false, title }: CustomCheckboxProps) {
  return (
    <label className={`checkbox-wrapper ${disabled ? 'disabled' : className}`} title={title}>
      {label && <span className="checkbox-label">{label}</span>}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="checkbox-box">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="checkmark-animated"
        >
          <polyline points="4 12 10 18 20 6" />
        </svg>
      </span>
    </label>
  );
}
