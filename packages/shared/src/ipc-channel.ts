import type { z } from 'zod';
import type { Permission } from './permissions';

/**
 * What a channel needs: a permission, or `public` for the few channels that
 * work while the app is locked (sign-in and the user picker, SPEC 3.3).
 */
export type ChannelAccess = Permission | 'public';

export interface ChannelContract<I extends z.ZodType, O extends z.ZodType> {
  requires: ChannelAccess;
  input: I;
  output: O;
}

/**
 * Declares an IPC channel with its access rule and zod input/output schemas.
 *
 * @param contract - Access, input and output.
 * @returns The same contract, typed.
 */
export const channel = <I extends z.ZodType, O extends z.ZodType>(
  contract: ChannelContract<I, O>,
): ChannelContract<I, O> => contract;
