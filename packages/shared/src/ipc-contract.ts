import { z } from 'zod';
import { PERMISSIONS, type Permission } from './permissions';
import { ROLES } from './roles';

const emptyInput = z.undefined();

const libraryCursorSchema = z.object({
  capturedAt: z.number().int(),
  id: z.string().min(1),
});

const assetSummarySchema = z.object({
  id: z.string(),
  mediaType: z.enum(['image', 'video']),
  capturedAt: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

export const sessionUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export const appInfoSchema = z.object({
  version: z.string(),
  platform: z.string(),
  userDataDir: z.string(),
  libraryDir: z.string(),
});

export const libraryQueryInputSchema = z.object({
  cursor: libraryCursorSchema.nullable().default(null),
  limit: z.number().int().min(1).max(1000).default(200),
});

export const libraryPageSchema = z.object({
  items: z.array(assetSummarySchema),
  nextCursor: libraryCursorSchema.nullable(),
  total: z.number().int(),
});

interface ChannelContract<I extends z.ZodType, O extends z.ZodType> {
  requires: Permission;
  input: I;
  output: O;
}

const channel = <I extends z.ZodType, O extends z.ZodType>(
  contract: ChannelContract<I, O>,
): ChannelContract<I, O> => contract;

export const IPC_CONTRACT = {
  'app.info': channel({ requires: 'assets.view', input: emptyInput, output: appInfoSchema }),
  'session.current': channel({
    requires: 'assets.view',
    input: emptyInput,
    output: sessionUserSchema,
  }),
  'library.query': channel({
    requires: 'assets.view',
    input: libraryQueryInputSchema,
    output: libraryPageSchema,
  }),
} as const;

export type IpcContract = typeof IPC_CONTRACT;
export type IpcChannel = keyof IpcContract;
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>;
export type IpcParsedInput<C extends IpcChannel> = z.output<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.output<IpcContract[C]['output']>;

export type AppInfo = IpcOutput<'app.info'>;
export type SessionUser = IpcOutput<'session.current'>;
export type LibraryQueryInput = IpcInput<'library.query'>;
export type LibraryPage = IpcOutput<'library.query'>;

/**
 * Narrows an arbitrary string to a known IPC channel.
 *
 * @param name - The candidate channel name.
 * @returns True when the name is declared in the contract.
 */
export function isIpcChannel(name: string): name is IpcChannel {
  return Object.hasOwn(IPC_CONTRACT, name);
}
