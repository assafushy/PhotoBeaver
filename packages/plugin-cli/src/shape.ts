const CONNECTOR_REQUIRED = ['setupSource', 'sync', 'getOriginal'] as const;
const ENRICHER_REQUIRED = ['enrich'] as const;

/**
 * The functions a plugin's default export must provide for its type.
 *
 * @param type - Manifest type.
 * @returns Required method names.
 */
export function requiredMethods(type: 'connector' | 'enricher'): readonly string[] {
  return type === 'connector' ? CONNECTOR_REQUIRED : ENRICHER_REQUIRED;
}

/**
 * Checks that a module's default export looks like a plugin of the given type.
 *
 * @param type - Manifest type.
 * @param moduleExports - The imported module namespace.
 * @returns Readable problems, empty when the shape is right.
 */
export function checkExportShape(
  type: 'connector' | 'enricher',
  moduleExports: Record<string, unknown>,
): string[] {
  const plugin = moduleExports.default as Record<string, unknown> | undefined;
  if (typeof plugin !== 'object' || plugin === null) {
    return [
      'main: the default export must be a plugin object (use defineConnector or defineEnricher)',
    ];
  }
  return requiredMethods(type)
    .filter((name) => typeof plugin[name] !== 'function')
    .map((name) => `main: the default export of a ${type} must have a ${name}() function`);
}
