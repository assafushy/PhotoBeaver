import type { ConnectorPlugin } from '../connector';
import type { KnownItemState } from '../context';
import type { MediaItem } from '../media';
import { runSync, type RunSyncResult } from './run-sync';

export const MAX_BATCH_SIZE = 1000;

export interface ConnectorFixture {
  config: unknown;
  removeOne(): Promise<string>;
}

export interface ContractCheck {
  name: string;
  run: () => Promise<void>;
}

type Plugin = ConnectorPlugin<unknown>;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Connector contract: ${message}`);
}

function ids(items: MediaItem[]): string[] {
  return items.map((item) => item.externalId);
}

function sameMembers(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function fullSync(plugin: Plugin, fixture: ConnectorFixture): Promise<RunSyncResult> {
  return runSync(plugin, { config: fixture.config });
}

function knownFrom(items: MediaItem[]): Record<string, KnownItemState> {
  const entries = items.map((item) => [
    item.externalId,
    { etag: item.etag, modifiedAt: item.modifiedAt },
  ]);
  return Object.fromEntries(entries) as Record<string, KnownItemState>;
}

async function checkCursors(plugin: Plugin, fixture: ConnectorFixture): Promise<void> {
  const { batches } = await fullSync(plugin, fixture);
  assert(batches.length > 0, 'a full sync must yield at least one batch');
  batches.forEach((batch, index) => {
    assert(typeof batch.cursor === 'string', `batch ${index} has no string cursor`);
  });
}

async function checkBatchSize(plugin: Plugin, fixture: ConnectorFixture): Promise<void> {
  const { batches } = await fullSync(plugin, fixture);
  batches.forEach((batch, index) => {
    const size = batch.upserts?.length ?? 0;
    assert(size <= MAX_BATCH_SIZE, `batch ${index} has ${size} upserts (max ${MAX_BATCH_SIZE})`);
  });
}

async function checkStableIds(plugin: Plugin, fixture: ConnectorFixture): Promise<void> {
  const first = ids((await fullSync(plugin, fixture)).items);
  assert(new Set(first).size === first.length, 'externalIds within one sync must be unique');
  const second = ids((await fullSync(plugin, fixture)).items);
  assert(sameMembers(first, second), 'externalIds must be stable across two full syncs');
}

async function checkResume(plugin: Plugin, fixture: ConnectorFixture): Promise<void> {
  const { batches, items } = await fullSync(plugin, fixture);
  const dataBatches = batches.filter((batch) => (batch.upserts?.length ?? 0) > 0);
  if (dataBatches.length < 2) return;
  const first = batches[0]!;
  const remaining = ids(items).slice(first.upserts?.length ?? 0);
  const resumed = await runSync(plugin, { config: fixture.config, cursor: first.cursor });
  assert(
    sameMembers(ids(resumed.items), remaining),
    `resuming from the first cursor yielded ${resumed.items.length} items, expected ${remaining.length}`,
  );
}

async function checkIdempotent(plugin: Plugin, fixture: ConnectorFixture): Promise<void> {
  const first = await fullSync(plugin, fixture);
  const known = knownFrom(first.items);
  const second = await runSync(plugin, { config: fixture.config, known });
  assert(
    second.items.length === 0,
    `a re-sync with every item known yielded ${second.items.length} upserts`,
  );
}

function reportsDelete(result: RunSyncResult, removed: string): boolean {
  if (result.deletes.includes(removed)) return true;
  const last = result.batches.at(-1);
  return last?.isFullScan === true && !ids(result.items).includes(removed);
}

async function checkDeletes(plugin: Plugin, fixture: ConnectorFixture): Promise<void> {
  const before = ids((await fullSync(plugin, fixture)).items);
  const removed = await fixture.removeOne();
  assert(before.includes(removed), `removeOne returned ${removed}, which the sync never yielded`);
  const after = await fullSync(plugin, fixture);
  assert(
    reportsDelete(after, removed),
    `${removed} was removed but neither deleted nor omitted from a final full-scan batch`,
  );
}

/**
 * The shared connector contract suite (SPEC 6.2 and 11). Each check throws on failure,
 * so it works with any test runner: `for (const c of connectorContract(p, f)) it(c.name, c.run)`.
 * The delete check runs last and calls `fixture.removeOne()`, which changes the fixture.
 *
 * @param plugin - The connector under test.
 * @param fixture - Config for a populated source and a callback that deletes one item.
 * @returns Named checks to register with a test runner.
 */
export function connectorContract<Config>(
  plugin: ConnectorPlugin<Config>,
  fixture: ConnectorFixture,
): ContractCheck[] {
  const target = plugin as Plugin;
  const checks: [string, (p: Plugin, f: ConnectorFixture) => Promise<void>][] = [
    ['every batch has a string cursor', checkCursors],
    [`no batch has more than ${MAX_BATCH_SIZE} upserts`, checkBatchSize],
    ['externalIds are unique and stable across full syncs', checkStableIds],
    ['resumes from a batch cursor with exactly the remaining items', checkResume],
    ['a re-sync with known etags yields no upserts', checkIdempotent],
    ['reports a removed item as deleted or omits it from a full scan', checkDeletes],
  ];
  return checks.map(([name, check]) => ({ name, run: () => check(target, fixture) }));
}
