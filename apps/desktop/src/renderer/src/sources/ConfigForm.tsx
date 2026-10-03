import type { ConfigField, ConfigSchema } from '@photobeaver/shared';
import { useTranslation } from 'react-i18next';
import { buttonStyles } from '../components/Modal';

interface ConfigFormProps {
  schema: ConfigSchema;
  values: Record<string, unknown>;
  errors: Record<string, string>;
  onChange(key: string, value: unknown): void;
}

const inputStyle =
  'w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700';

function DirectoryField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange(v: unknown): void;
}) {
  const { t } = useTranslation();
  const pick = async () => {
    const dir = await window.pb.sources.pickDirectory();
    if (dir) onChange(dir);
  };
  return (
    <div className="flex gap-2">
      <input
        id={id}
        className={inputStyle}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className={buttonStyles.secondary} onClick={() => void pick()}>
        {t('sources.browse')}
      </button>
    </div>
  );
}

interface FieldProps {
  id: string;
  field: ConfigField;
  value: unknown;
  onChange(v: unknown): void;
}

interface FieldRowProps {
  name: string;
  field: ConfigField;
  value: unknown;
  error: string | undefined;
  onChange(key: string, value: unknown): void;
}

function EnumField({ id, field, value, onChange }: FieldProps) {
  const options = field.enum ?? [];
  return (
    <select
      id={id}
      className={inputStyle}
      value={String(value ?? '')}
      onChange={(e) => onChange(options.find((o) => String(o) === e.target.value))}
    >
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}

function CheckboxField({ id, value, onChange }: FieldProps) {
  return (
    <input
      id={id}
      type="checkbox"
      checked={value === true}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function NumberField({ id, field, value, onChange }: FieldProps) {
  return (
    <input
      id={id}
      type="number"
      className={inputStyle}
      min={field.minimum}
      max={field.maximum}
      value={value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

function TextField({ id, value, onChange }: FieldProps) {
  return (
    <input
      id={id}
      className={inputStyle}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FieldInput(props: FieldProps) {
  const { field } = props;
  if (field.format === 'directory') return <DirectoryField {...props} />;
  if (field.enum) return <EnumField {...props} />;
  if (field.type === 'boolean') return <CheckboxField {...props} />;
  if (field.type === 'integer' || field.type === 'number') return <NumberField {...props} />;
  return <TextField {...props} />;
}

function FieldMessages({ field, error }: { field: ConfigField; error: string | undefined }) {
  return (
    <>
      {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function ConfigFieldRow({ name, field, value, error, onChange }: FieldRowProps) {
  const id = `config-${name}`;
  const inline = field.type === 'boolean';
  const input = (
    <FieldInput id={id} field={field} value={value} onChange={(v) => onChange(name, v)} />
  );
  return (
    <div className={inline ? 'flex items-center gap-2' : 'space-y-1'}>
      {inline && input}
      <label htmlFor={id} className="block text-sm font-medium">
        {field.title ?? name}
      </label>
      {!inline && input}
      <FieldMessages field={field} error={error} />
    </div>
  );
}

/**
 * Renders a plugin's `configSchema` as a form (SPEC 5.2 "The UI renders the form
 * from this automatically"). Supports string, number, integer, boolean, enum and
 * the `directory` format.
 */
export function ConfigForm({ schema, values, errors, onChange }: ConfigFormProps) {
  return (
    <div className="space-y-4">
      {Object.entries(schema.properties ?? {}).map(([key, field]) => (
        <ConfigFieldRow
          key={key}
          name={key}
          field={field}
          value={values[key]}
          error={errors[key]}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
