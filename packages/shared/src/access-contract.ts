import { z } from 'zod';
import { channel } from './ipc-channel';
import { PERMISSIONS } from './permissions';
import { ROLES } from './roles';

const emptyInput = z.undefined();
const nothing = z.null();
const id = z.string().min(1).max(64);
const ids = z.array(id).min(1).max(10_000);

export const sessionUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export const sessionStateSchema = z.object({
  state: z.enum(['signedIn', 'locked']),
  user: sessionUserSchema.nullable(),
  multiUser: z.boolean(),
});

const secretKind = z.enum(['password', 'pin']);
const secret = z.string().min(4).max(200);

export const pickerUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  secretKind,
  biometric: z.boolean(),
});

const scopesSchema = z.object({ sourceIds: z.array(id).max(500), albumIds: z.array(id).max(500) });

export const userSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  secretKind: secretKind.nullable(),
  biometric: z.boolean(),
  disabled: z.boolean(),
  lastLoginAt: z.number().nullable(),
  scopes: scopesSchema,
});

export const usersSettingsSchema = z.object({
  multiUser: z.boolean(),
  autoLockMinutes: z.number().int(),
  biometricAvailable: z.boolean(),
});

const userDraft = z.object({
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  secret,
  secretKind,
});

export const albumSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  count: z.number().int(),
  coverAssetId: z.string().nullable(),
});

export const auditPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      userName: z.string().nullable(),
      action: z.string(),
      targetType: z.string().nullable(),
      targetId: z.string().nullable(),
      details: z.record(z.string(), z.unknown()).nullable(),
      createdAt: z.number(),
    }),
  ),
  nextCursor: z.number().int().nullable(),
});

const tagName = z.string().trim().min(1).max(80);

export const SESSION_CHANNELS = {
  'session.current': channel({ requires: 'public', input: emptyInput, output: sessionStateSchema }),
  'auth.users': channel({
    requires: 'public',
    input: emptyInput,
    output: z.array(pickerUserSchema),
  }),
  'auth.signIn': channel({
    requires: 'public',
    input: z.object({ userId: id, secret: z.string().max(200) }),
    output: sessionUserSchema,
  }),
  'auth.signInBiometric': channel({
    requires: 'public',
    input: z.object({ userId: id }),
    output: sessionUserSchema,
  }),
  'auth.recover': channel({
    requires: 'public',
    input: z.object({
      recoveryKey: z.string().min(1).max(100),
      newPassword: z.string().min(8).max(200),
    }),
    output: sessionUserSchema,
  }),
  'auth.lock': channel({ requires: 'assets.view', input: emptyInput, output: nothing }),
} as const;

export const USER_CHANNELS = {
  'users.list': channel({
    requires: 'users.manage',
    input: emptyInput,
    output: z.array(userSummarySchema),
  }),
  'users.create': channel({
    requires: 'users.manage',
    input: userDraft,
    output: userSummarySchema,
  }),
  'users.update': channel({
    requires: 'users.manage',
    input: z.object({
      id,
      displayName: userDraft.shape.displayName.optional(),
      role: z.enum(ROLES).optional(),
      secret: secret.optional(),
      secretKind: secretKind.optional(),
      biometric: z.boolean().optional(),
      disabled: z.boolean().optional(),
    }),
    output: userSummarySchema,
  }),
  'users.delete': channel({ requires: 'users.manage', input: z.object({ id }), output: nothing }),
  'users.setScopes': channel({
    requires: 'users.manage',
    input: scopesSchema.extend({ id }),
    output: nothing,
  }),
  'users.settings': channel({
    requires: 'users.manage',
    input: emptyInput,
    output: usersSettingsSchema,
  }),
  'users.enableMulti': channel({
    requires: 'users.manage',
    input: z.object({ password: z.string().min(8).max(200) }),
    output: z.object({ recoveryKey: z.string() }),
  }),
  'users.disableMulti': channel({
    requires: 'users.manage',
    input: z.object({ password: z.string().max(200) }),
    output: nothing,
  }),
  'users.setAutoLock': channel({
    requires: 'users.manage',
    input: z.object({ minutes: z.number().int().min(0).max(240) }),
    output: nothing,
  }),
} as const;

export const EDIT_CHANNELS = {
  'assets.setFavorite': channel({
    requires: 'assets.edit',
    input: z.object({ ids, favorite: z.boolean() }),
    output: nothing,
  }),
  'assets.setHidden': channel({
    requires: 'assets.edit',
    input: z.object({ ids, hidden: z.boolean() }),
    output: nothing,
  }),
  'assets.addTag': channel({
    requires: 'assets.edit',
    input: z.object({ ids, name: tagName }),
    output: nothing,
  }),
  'assets.removeTag': channel({
    requires: 'assets.edit',
    input: z.object({ ids, name: tagName }),
    output: nothing,
  }),
  'assets.setDate': channel({
    requires: 'assets.edit',
    input: z.object({ id, capturedAt: z.number().int().nullable() }),
    output: nothing,
  }),
  'assets.setLocation': channel({
    requires: 'assets.edit',
    input: z.object({
      id,
      location: z
        .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
        .nullable(),
    }),
    output: nothing,
  }),
  'assets.rerun': channel({ requires: 'sources.sync', input: z.object({ ids }), output: nothing }),
  'albums.list': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: z.array(albumSummarySchema),
  }),
  'albums.create': channel({
    requires: 'albums.edit',
    input: z.object({ name: z.string().trim().min(1).max(120) }),
    output: albumSummarySchema,
  }),
  'albums.rename': channel({
    requires: 'albums.edit',
    input: z.object({ id, name: z.string().trim().min(1).max(120) }),
    output: nothing,
  }),
  'albums.delete': channel({ requires: 'albums.edit', input: z.object({ id }), output: nothing }),
  'albums.addAssets': channel({
    requires: 'albums.edit',
    input: z.object({ id, assetIds: ids }),
    output: nothing,
  }),
  'albums.removeAssets': channel({
    requires: 'albums.edit',
    input: z.object({ id, assetIds: ids }),
    output: nothing,
  }),
  'audit.list': channel({
    requires: 'library.admin',
    input: z.object({
      before: z.number().int().nullable().default(null),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    output: auditPageSchema,
  }),
  'app.capabilities': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: z.object({ faces: z.boolean(), merge: z.boolean() }),
  }),
} as const;

export type SessionUser = z.infer<typeof sessionUserSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
export type PickerUser = z.infer<typeof pickerUserSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UsersSettings = z.infer<typeof usersSettingsSchema>;
export type AlbumSummary = z.infer<typeof albumSummarySchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;
