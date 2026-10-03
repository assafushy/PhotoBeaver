export type ConfigFieldType = 'string' | 'boolean' | 'integer' | 'number';

export interface ConfigField {
  type?: ConfigFieldType;
  title?: string;
  description?: string;
  format?: 'directory' | string;
  default?: unknown;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
}

export interface ConfigSchema {
  type?: 'object';
  required?: readonly string[];
  properties?: Record<string, ConfigField>;
}

export type ConfigValidation =
  { ok: true; value: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

function typeMatches(field: ConfigField, value: unknown): boolean {
  if (field.enum) return field.enum.includes(value as string | number);
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === 'string';
  }
}

function fieldError(field: ConfigField, value: unknown): string | null {
  if (!typeMatches(field, value))
    return field.enum ? 'Pick one of the options' : `Expected ${field.type ?? 'string'}`;
  if (typeof value !== 'number') return null;
  if (field.minimum !== undefined && value < field.minimum)
    return `Must be at least ${field.minimum}`;
  if (field.maximum !== undefined && value > field.maximum)
    return `Must be at most ${field.maximum}`;
  return null;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Validates a flat config object against the subset of JSON Schema plugins use
 * for `configSchema` (types, enum, min/max, required, defaults). Unknown keys are dropped.
 *
 * @param schema - The plugin's configSchema.
 * @param input - User-entered values.
 * @returns The value with defaults applied, or per-field errors.
 */
export function validateConfig(
  schema: ConfigSchema,
  input: Record<string, unknown>,
): ConfigValidation {
  const value: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    const raw = isMissing(input[key]) ? field.default : input[key];
    if (isMissing(raw)) {
      if (schema.required?.includes(key)) errors[key] = 'Required';
      continue;
    }
    const error = fieldError(field, raw);
    if (error) errors[key] = error;
    else value[key] = raw;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}
