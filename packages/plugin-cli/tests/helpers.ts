import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Output } from '../src';

export interface RecordingOutput extends Output {
  lines: string[];
  errors: string[];
}

/**
 * An Output that records lines instead of printing.
 *
 * @returns The recording output.
 */
export function recordingOutput(): RecordingOutput {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, info: (m) => void lines.push(m), error: (m) => void errors.push(m) };
}

const created: string[] = [];

/**
 * Creates a temp folder with the given files; removed by `cleanupTemp`.
 *
 * @param files - Relative path to content.
 * @returns The folder.
 */
export function tempProject(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-cli-'));
  created.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    writeFileSync(path.join(dir, relative), content);
  }
  return dir;
}

/** Removes every folder made by `tempProject`. */
export function cleanupTemp(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * A minimal valid manifest.
 *
 * @param overrides - Fields to replace.
 * @returns Manifest JSON text.
 */
export function manifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'com.example.test',
    name: 'Test',
    version: '1.2.3',
    type: 'connector',
    apiVersion: '1',
    main: 'dist/index.js',
    connector: { syncModes: ['manual'], defaultIntervalSec: 3600 },
    ...overrides,
  });
}

export const CONNECTOR_JS = `export default {
  async setupSource() { return { displayName: 'x' }; },
  async *sync() {},
  async getOriginal() { return new ReadableStream(); },
};
`;

export const CONNECTOR_TS = `const plugin: { setupSource(): Promise<{ displayName: string }> } & Record<string, unknown> = {
  async setupSource() { return { displayName: 'x' }; },
  async *sync() {},
  async getOriginal() { return new ReadableStream(); },
};
export default plugin;
`;
