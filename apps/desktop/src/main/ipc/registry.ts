import {
  IPC_CONTRACT,
  isIpcChannel,
  type IpcChannel,
  type IpcErrorCode,
  type IpcOutput,
  type IpcParsedInput,
  type IpcResult,
  type SessionUser,
} from '@photobeaver/shared';

export interface HandlerContext {
  user: SessionUser;
}

export type IpcHandler<C extends IpcChannel> = (
  input: IpcParsedInput<C>,
  ctx: HandlerContext,
) => IpcOutput<C> | Promise<IpcOutput<C>>;

export type RawListener = (raw: unknown) => Promise<IpcResult<unknown>>;

export interface IpcTransport {
  handle(channel: string, listener: RawListener): void;
}

export interface RegistryLogger {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

function failure(code: IpcErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Registers IPC handlers behind the permission middleware (SPEC 3.3).
 * Every channel must be declared in the shared contract, which names the
 * permission it requires and the zod schema its input must match.
 */
export class IpcRegistry {
  private readonly registered = new Set<IpcChannel>();

  constructor(
    private readonly transport: IpcTransport,
    private readonly currentUser: () => SessionUser,
    private readonly logger: RegistryLogger,
  ) {}

  /**
   * Registers a handler for a contract channel.
   *
   * @param channel - A channel declared in IPC_CONTRACT.
   * @param handler - Business logic, called only after validation and permission checks.
   * @throws Error when the channel is unknown or already registered.
   */
  handle<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
    if (!isIpcChannel(channel)) throw new Error(`Unknown IPC channel: ${String(channel)}`);
    if (this.registered.has(channel)) throw new Error(`IPC channel already registered: ${channel}`);
    this.registered.add(channel);
    this.transport.handle(channel, (raw) => this.dispatch(channel, handler, raw));
  }

  /**
   * Fails fast if any contract channel has no handler.
   *
   * @throws Error listing the missing channels.
   */
  assertComplete(): void {
    const missing = Object.keys(IPC_CONTRACT).filter((c) => !this.registered.has(c as IpcChannel));
    if (missing.length > 0) throw new Error(`IPC channels without handlers: ${missing.join(', ')}`);
  }

  private async dispatch<C extends IpcChannel>(
    channel: C,
    handler: IpcHandler<C>,
    raw: unknown,
  ): Promise<IpcResult<IpcOutput<C>>> {
    const contract = IPC_CONTRACT[channel];
    const user = this.currentUser();
    if (!user.permissions.includes(contract.requires)) {
      this.logger.warn({ channel, userId: user.id }, 'IPC permission denied');
      return failure('PERMISSION_DENIED', `Missing permission: ${contract.requires}`);
    }
    const parsed = contract.input.safeParse(raw);
    if (!parsed.success) return failure('INVALID_INPUT', parsed.error.message);
    return this.run(channel, handler, parsed.data as IpcParsedInput<C>, user);
  }

  private async run<C extends IpcChannel>(
    channel: C,
    handler: IpcHandler<C>,
    input: IpcParsedInput<C>,
    user: SessionUser,
  ): Promise<IpcResult<IpcOutput<C>>> {
    try {
      return { ok: true, value: await handler(input, { user }) };
    } catch (error) {
      this.logger.error({ channel, err: error }, 'IPC handler failed');
      return failure('INTERNAL', error instanceof Error ? error.message : String(error));
    }
  }
}
