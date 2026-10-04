import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { assertHostAllowed } from '@photobeaver/shared/host-allowlist';

type AnyFn = (...args: unknown[]) => unknown;

function hostOfRequestArgs(args: unknown[]): string | undefined {
  const [first, second] = args;
  if (typeof first === 'string') return new URL(first).hostname;
  if (first instanceof URL) return first.hostname;
  const options = (first ?? second) as { hostname?: string; host?: string } | undefined;
  return options?.hostname ?? options?.host?.replace(/:\d+$/, '');
}

function hostOfConnectArgs(args: unknown[]): string | undefined {
  const [first, second] = args;
  if (typeof first === 'object' && first !== null) return (first as { host?: string }).host;
  return typeof second === 'string' ? second : undefined;
}

function guard(
  target: object,
  name: string,
  hostOf: (args: unknown[]) => string | undefined,
  allow: readonly string[],
): void {
  const original = (target as Record<string, AnyFn>)[name]!;
  (target as Record<string, AnyFn>)[name] = function guarded(this: unknown, ...args: unknown[]) {
    assertHostAllowed(hostOf(args), allow);
    return original.apply(this, args);
  };
}

function guardFetch(allow: readonly string[]): typeof fetch {
  const original = globalThis.fetch.bind(globalThis);
  const guarded: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assertHostAllowed(new URL(url).hostname, allow);
    return original(input, init);
  };
  globalThis.fetch = guarded;
  return guarded;
}

/**
 * Refuses network access outside the manifest allowlist by patching global
 * fetch, http/https, net and tls (SPEC 6.6). Defense in depth, not a sandbox:
 * native code can bypass it.
 *
 * @param allow - `permissions.network` patterns.
 * @returns The guarded fetch, for building `ctx.fetch`.
 */
export function installNetworkGuard(allow: readonly string[]): typeof fetch {
  for (const module of [http, https]) {
    guard(module, 'request', hostOfRequestArgs, allow);
    guard(module, 'get', hostOfRequestArgs, allow);
  }
  guard(net, 'connect', hostOfConnectArgs, allow);
  guard(net, 'createConnection', hostOfConnectArgs, allow);
  guard(tls, 'connect', hostOfConnectArgs, allow);
  return guardFetch(allow);
}
