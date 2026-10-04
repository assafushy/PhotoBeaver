import {
  HOST_METHODS,
  isRpcClosedError,
  RpcPeer,
  type HostCapabilities,
  type HostInit,
} from '@photobeaver/shared/rpc';
import { MINUTE_MS, SECOND_MS, systemClock, type Clock } from '../clock';
import type { CoreLog } from '../connectors/registry';
import { CrashPolicy, RESTART_BACKOFF_MS } from './crash-policy';
import { HostCrashedError, PluginUnavailableError } from './host-errors';
import type { HostLauncher, LaunchedHost, LaunchOptions } from './host-launcher';

export const INIT_TIMEOUT_MS = MINUTE_MS;
export const IDLE_STOP_MS = 10 * MINUTE_MS;
const STOP_GRACE_MS = 3 * SECOND_MS;

export interface Connection {
  peer: RpcPeer;
  capabilities: HostCapabilities;
}

export interface HostHandleDeps {
  pluginId: string;
  launcher: HostLauncher;
  launchOptions: LaunchOptions;
  init: HostInit;
  registerCoreHandlers(peer: RpcPeer): void;
  onStarted(): void;
  onCrashed(restartInMs: number | null): void;
  logger: CoreLog;
  clock?: Clock;
}

interface Running {
  host: LaunchedHost;
  connection: Connection;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One plugin's host process (SPEC 7.6): started lazily, restarted with backoff
 * after a crash, marked crashed after 5 crashes in 10 minutes, killed on a hang,
 * and stopped after 10 minutes idle unless it has active watches.
 */
export class HostHandle {
  private running: Running | null = null;
  private starting: Promise<Connection> | null = null;
  private stopping = false;
  private restartNotBefore = 0;
  private inFlight = 0;
  private lastActivity = 0;
  private gaveUp = false;
  readonly crashes = new CrashPolicy();
  watchCount = 0;
  restarts = 0;

  constructor(private readonly deps: HostHandleDeps) {}

  get pid(): number | undefined {
    return this.running?.host.pid;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  get hasCrashedTooOften(): boolean {
    return this.gaveUp;
  }

  /**
   * Runs a call against the host, starting it if needed. A dead host surfaces as
   * HostCrashedError; a timeout kills the host as a hang.
   *
   * @param call - Uses the connection.
   * @returns The call's result.
   */
  async track<T>(call: (connection: Connection) => Promise<T>): Promise<T> {
    this.begin();
    try {
      return await call(await this.connect());
    } catch (error) {
      throw this.translate(error);
    } finally {
      this.end();
    }
  }

  /**
   * Like `track` for streamed calls.
   *
   * @param call - Produces the remote stream.
   * @returns The stream, with crashes translated.
   */
  async *trackStream<T>(call: (connection: Connection) => AsyncIterable<T>): AsyncGenerator<T> {
    this.begin();
    try {
      yield* call(await this.connect());
    } catch (error) {
      throw this.translate(error);
    } finally {
      this.end();
    }
  }

  /**
   * Starts the host if it is not running.
   *
   * @returns The live connection.
   */
  async connect(): Promise<Connection> {
    if (this.gaveUp)
      throw new PluginUnavailableError(`${this.deps.pluginId} crashed too often and was stopped`);
    if (this.running) return this.running.connection;
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  /** Stops the host gracefully (disable, uninstall, idle, quit). */
  async stop(): Promise<void> {
    const running = this.running;
    if (!running) return;
    this.stopping = true;
    await running.connection.peer
      .request(HOST_METHODS.deactivate, {}, { timeoutMs: STOP_GRACE_MS })
      .catch(() => undefined);
    running.connection.peer.close();
    setTimeout(() => running.host.kill(), STOP_GRACE_MS).unref?.();
    this.running = null;
  }

  /** Clears the crashed state ("Re-enable"). */
  reset(): void {
    this.gaveUp = false;
    this.restartNotBefore = 0;
    this.crashes.reset();
  }

  /**
   * Stops the host when it has been idle too long and has no watches.
   *
   * @returns True when it was stopped.
   */
  async stopIfIdle(): Promise<boolean> {
    const idle = this.now() - this.lastActivity >= IDLE_STOP_MS;
    if (!this.running || this.inFlight > 0 || this.watchCount > 0 || !idle) return false;
    await this.stop();
    return true;
  }

  private async start(): Promise<Connection> {
    const wait = this.restartNotBefore - this.now();
    if (wait > 0) await sleep(wait);
    this.stopping = false;
    const host = this.deps.launcher.launch(this.deps.launchOptions);
    const peer = new RpcPeer(host.port);
    this.deps.registerCoreHandlers(peer);
    host.onExit((code) => this.onExit(host, code));
    peer.onClose(() => this.onPeerClosed(host));
    const capabilities = await this.initialize(host, peer);
    this.running = { host, connection: { peer, capabilities } };
    this.deps.onStarted();
    return this.running.connection;
  }

  private async initialize(host: LaunchedHost, peer: RpcPeer): Promise<HostCapabilities> {
    try {
      return await peer.request<HostCapabilities>(HOST_METHODS.init, this.deps.init, {
        timeoutMs: INIT_TIMEOUT_MS,
      });
    } catch (error) {
      this.stopping = true;
      peer.close();
      host.kill();
      throw error;
    }
  }

  private onPeerClosed(host: LaunchedHost): void {
    if (this.running?.host !== host) return;
    this.running = null;
    if (!this.stopping) host.kill();
  }

  private onExit(host: LaunchedHost, code: number | null): void {
    if (this.running?.host === host) this.running = null;
    if (this.stopping) return;
    this.restarts++;
    const delay = this.crashes.record(this.now());
    this.gaveUp = delay === null;
    this.restartNotBefore = this.now() + (delay ?? 0);
    this.deps.logger.warn(
      { pluginId: this.deps.pluginId, code, restartInMs: delay },
      'Plugin host exited unexpectedly',
    );
    this.deps.onCrashed(delay);
  }

  private translate(error: unknown): unknown {
    if (isRpcClosedError(error)) {
      const retry = Math.max(RESTART_BACKOFF_MS[0], this.restartNotBefore - this.now());
      return new HostCrashedError(this.deps.pluginId, retry);
    }
    if (error instanceof Error && error.name === 'RpcTimeoutError') this.killAsHang();
    return error;
  }

  private killAsHang(): void {
    this.deps.logger.warn({ pluginId: this.deps.pluginId }, 'Plugin host timed out; killing it');
    this.running?.host.kill();
  }

  private begin(): void {
    this.inFlight++;
    this.lastActivity = this.now();
  }

  private end(): void {
    this.inFlight--;
    this.lastActivity = this.now();
  }

  private now(): number {
    return (this.deps.clock ?? systemClock)();
  }
}
