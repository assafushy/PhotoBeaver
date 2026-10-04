import { z } from 'zod';
import type { ConfigSchema } from './config-schema';

export const SUPPORTED_API_VERSIONS = ['1'] as const;

const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HOST_PATTERN = /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i;

const relativePath = z
  .string()
  .min(1)
  .refine(
    (p) => !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes('..'),
    'Must be a relative path inside the plugin',
  );

const permissionsSchema = z.object({
  network: z.array(z.string().regex(HOST_PATTERN, 'Invalid host pattern')).default([]),
  filesystem: z.enum(['none', 'user-selected']).default('none'),
  oauth: z.boolean().default(false),
  originals: z.enum(['none', 'thumbnail', 'read']).default('none'),
  assets: z.enum(['none', 'merge']).default('none'),
  nativeModules: z.boolean().default(false),
  gpu: z.boolean().default(false),
});

const connectorSchema = z.object({
  syncModes: z.array(z.enum(['poll', 'watch', 'manual'])).min(1),
  defaultIntervalSec: z.number().int().positive(),
  minIntervalSec: z.number().int().positive().optional(),
  supportsIncremental: z.boolean().default(false),
  providesContentHash: z.boolean().default(false),
  rateLimit: z
    .object({ requests: z.number().int().positive(), perSec: z.number().int().positive() })
    .optional(),
  multipleSources: z.boolean().default(true),
});

const enricherSchema = z.object({
  accepts: z.array(z.string().min(1)).min(1),
  input: z.enum(['metadata', 'thumbnail', 'original']),
  dependsOn: z.array(z.string().regex(PLUGIN_ID)).default([]),
  produces: z.array(z.string()).default([]),
  concurrency: z.number().int().positive().default(1),
  resourceClass: z.enum(['light', 'cpu-heavy', 'gpu']).default('light'),
  runOn: z.array(z.enum(['new', 'changed'])).default(['new', 'changed']),
});

export const manifestSchema = z
  .object({
    id: z.string().regex(PLUGIN_ID, 'Use a reverse-DNS id such as com.example.my-plugin'),
    name: z.string().min(1).max(80),
    version: z.string().regex(SEMVER, 'Use a semantic version such as 1.2.0'),
    type: z.enum(['connector', 'enricher']),
    apiVersion: z.string().min(1),
    main: relativePath,
    description: z.string().max(500).default(''),
    author: z.object({ name: z.string(), url: z.string().optional() }).optional(),
    license: z.string().optional(),
    icon: relativePath.optional(),
    engines: z.object({ photobeaver: z.string() }).optional(),
    permissions: permissionsSchema.default(() => permissionsSchema.parse({})),
    connector: connectorSchema.optional(),
    enricher: enricherSchema.optional(),
    configSchema: z.custom<ConfigSchema>((v) => typeof v === 'object' && v !== null).default({}),
    settingsSchema: z.custom<ConfigSchema>((v) => typeof v === 'object' && v !== null).optional(),
    default: z.object({ enabledOnInstall: z.boolean() }).optional(),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.type === 'connector' && !manifest.connector)
      ctx.addIssue({
        code: 'custom',
        path: ['connector'],
        message: 'Connectors need a "connector" section',
      });
    if (manifest.type === 'enricher' && !manifest.enricher)
      ctx.addIssue({
        code: 'custom',
        path: ['enricher'],
        message: 'Enrichers need an "enricher" section',
      });
  });

export type PluginManifest = z.infer<typeof manifestSchema>;
export type ConnectorManifest = PluginManifest & {
  type: 'connector';
  connector: NonNullable<PluginManifest['connector']>;
};
export type PluginPermissions = PluginManifest['permissions'];

/**
 * Schema of a plugin's global settings: `configSchema` for enrichers (SPEC 5.2),
 * `settingsSchema` for connectors, whose `configSchema` is per source.
 *
 * @param manifest - Any manifest with the two optional schemas.
 * @returns The settings schema, or null when the plugin has no settings.
 */
export function settingsSchemaOf(manifest: {
  type: string;
  configSchema?: ConfigSchema;
  settingsSchema?: ConfigSchema;
}): ConfigSchema | null {
  const schema = manifest.type === 'enricher' ? manifest.configSchema : manifest.settingsSchema;
  return schema && Object.keys(schema.properties ?? {}).length > 0 ? schema : null;
}

export type ManifestResult =
  { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

/**
 * Validates a `photobeaver-plugin.json` (SPEC 5.2). Run on install and on every load.
 *
 * @param raw - Parsed JSON.
 * @returns The manifest with defaults applied, or readable errors.
 */
export function validateManifest(raw: unknown): ManifestResult {
  const result = manifestSchema.safeParse(raw);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || 'manifest'}: ${i.message}`),
  };
}

/**
 * Whether this app can load a plugin built for the given API major version (SPEC 5.3).
 *
 * @param apiVersion - Manifest `apiVersion`.
 * @returns True when supported.
 */
export function isApiVersionSupported(apiVersion: string): boolean {
  return (SUPPORTED_API_VERSIONS as readonly string[]).includes(apiVersion);
}

/**
 * Narrows a manifest to a connector manifest.
 *
 * @param manifest - Any manifest.
 * @returns True for connectors.
 */
export function isConnectorManifest(manifest: PluginManifest): manifest is ConnectorManifest {
  return manifest.type === 'connector' && manifest.connector !== undefined;
}
