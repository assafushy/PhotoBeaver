import type { ReactNode } from 'react';

export const inputStyle =
  'w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700';

/**
 * A labelled form control: the label text above the control it wraps.
 *
 * @param props - Label text and the control.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

/**
 * A checkbox with its label on the right.
 *
 * @param props - Label, state, change handler and test id.
 */
export function CheckboxField({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  testId?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      {label}
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  testId?: string;
  type?: 'text' | 'password';
}

/**
 * A labelled single-line text or password input.
 *
 * @param props - Label, value, change handler, test id and input type.
 */
export function TextField({ label, value, onChange, testId, type = 'text' }: TextFieldProps) {
  return (
    <Field label={label}>
      <input
        type={type}
        className={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
  testId?: string;
}

/**
 * A labelled drop-down of fixed options.
 *
 * @param props - Label, current value, options, change handler and test id.
 */
export function SelectField<T extends string>(props: SelectFieldProps<T>) {
  return (
    <Field label={props.label}>
      <select
        className={inputStyle}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        data-testid={props.testId}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
