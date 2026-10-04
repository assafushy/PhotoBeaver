import { describe, expect, it } from 'vitest';
import { connectorContract, createFakeSyncContext, runSync } from '../src/testing';
import memory, { makeItems, memoryConfig, type MemoryConfig } from './memory-connector';

function fixtureFor(config: MemoryConfig) {
  return {
    config,
    removeOne: async () => config.items.pop()!.externalId,
  };
}

async function failures(config: MemoryConfig): Promise<string[]> {
  const failed: string[] = [];
  for (const check of connectorContract(memory, fixtureFor(config))) {
    await check.run().catch(() => failed.push(check.name));
  }
  return failed;
}

describe('fake contexts', () => {
  it('records storage, progress, logs, notifications and secrets', async () => {
    const ctx = createFakeSyncContext(
      { a: 1 },
      { pickDirectory: '/tmp/x', known: { k: { etag: 'e' } } },
    );
    await ctx.storage.set('key', 42);
    ctx.reportProgress({ done: 1 });
    ctx.log.info('hello', { n: 1 });
    ctx.ui.notify('note', 'warn');
    await ctx.secret.set({ token: 't' });
    expect(await ctx.storage.get('key')).toBe(42);
    expect(ctx.recorded.progress).toEqual([{ done: 1 }]);
    expect(ctx.recorded.logs).toEqual([{ level: 'info', msg: 'hello', data: { n: 1 } }]);
    expect(ctx.recorded.notifications).toEqual([{ msg: 'note', level: 'warn' }]);
    expect(await ctx.secret.get()).toEqual({ token: 't' });
    expect(await ctx.ui.pickDirectory()).toBe('/tmp/x');
    expect(await ctx.isKnown(['k', 'z'])).toEqual({ k: { etag: 'e' } });
    expect(
      (await ctx.oauth.authorize({ authUrl: '', tokenUrl: '', clientId: '', scopes: [] }))
        .accessToken,
    ).toBeTruthy();
    expect(ctx.signal.aborted).toBe(false);
    expect(ctx.dataDir).toBeTruthy();
  });
});

describe('runSync', () => {
  it('collects batches, items and the final cursor', async () => {
    const result = await runSync(memory, { config: memoryConfig(makeItems(5), 2) });
    expect(result.batches.map((b) => b.upserts?.length)).toEqual([2, 2, 1, 0]);
    expect(result.items).toHaveLength(5);
    expect(result.finalCursor).toBe('done');
  });

  it('resumes from a cursor and honors known items', async () => {
    const config = memoryConfig(makeItems(5), 2);
    expect((await runSync(memory, { config, cursor: '2' })).items).toHaveLength(3);
    const known = { 'item-0': { etag: 'etag-0' } };
    expect((await runSync(memory, { config, known })).items).toHaveLength(4);
  });
});

describe('connectorContract', () => {
  it('passes for a well-behaved connector', async () => {
    expect(await failures(memoryConfig(makeItems(5), 2))).toEqual([]);
  });

  it('fails oversized batches', async () => {
    expect(await failures(memoryConfig(makeItems(1001), 1001))).toEqual([
      'no batch has more than 1000 upserts',
    ]);
  });

  it('fails unstable ids', async () => {
    const failed = await failures({ ...memoryConfig(makeItems(3), 2), unstableIds: true });
    expect(failed).toContain('externalIds are unique and stable across full syncs');
  });

  it('fails broken resume, idempotency and delete handling', async () => {
    expect(await failures({ ...memoryConfig(makeItems(3), 2), brokenCursor: true })).toEqual([
      'resumes from a batch cursor with exactly the remaining items',
    ]);
    expect(await failures({ ...memoryConfig(makeItems(3), 2), ignoreKnown: true })).toEqual([
      'a re-sync with known etags yields no upserts',
    ]);
    expect(await failures({ ...memoryConfig(makeItems(3), 2), forgetDeletes: true })).toEqual([
      'reports a removed item as deleted or omits it from a full scan',
    ]);
  });

  it('skips the resume check when there is a single data batch', async () => {
    expect(await failures({ ...memoryConfig(makeItems(2), 5), brokenCursor: true })).toEqual([]);
  });
});
